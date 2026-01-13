import { Router, Request, Response } from "express";
import mercadopago from "mercadopago";
import colors from "colors";
import mongoose from "mongoose";
import ProductoModel from "../models/Producto";
import Orden from "../models/Orden";
import CuponModel from "../models/Cupon";
import { getCurrentToken, updateStockInMercadoLibre, propagateStockToGroup, getCurrentStockFromMercadoLibre } from "./mercadolibre";
import AdminNotification from "../models/AdminNotification";
import { ClienteService } from "../services/clienteService";

const router = Router();

// 🔒 Mecanismo de deduplicación: evitar procesar el mismo webhook múltiples veces concurrentemente
const processingWebhooks = new Set<string>();
const processedWebhooks = new Map<string, number>(); // paymentId -> timestamp
const WEBHOOK_DEDUP_WINDOW = 60000; // 60 segundos: ignorar webhooks duplicados dentro de esta ventana

// Formateo seguro de montos (evita 704.8800000000001, etc.)
const formatMoney = (value: any) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00";
  return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
};

/**
 * Webhook para recibir notificaciones de MercadoPago
 * Se llama cuando hay cambios en el estado de un pago
 *
 * Nota: MercadoPago puede notificar por POST (webhooks) o por GET (IPN clásico)
 */
router.all("/mercadopago", async (req: Request, res: Response) => {
  let webhookKey: string | undefined; // Definir fuera del try para limpiar en catch
  try {
    // Responder inmediatamente a MercadoPago (requisito de la API)
    res.status(200).send("OK");

    const body: any = req.body || {};
    const query: any = (req as any).query || {};
    const queryDataId =
      query?.["data.id"] ||
      query?.["data[id]"] ||
      query?.["data%5Bid%5D"] ||
      query?.["data_id"];

    // Compatibilidad con diferentes formatos de MP:
    // - IPN clásico: ?topic=payment&id=123 / ?topic=merchant_order&id=456
    // - Webhooks: { type: 'payment', action: 'payment.updated', data: { id } }
    const topic = String(body.type || query.type || body.topic || query.topic || '').toLowerCase();
    const action = String(body.action || '').toLowerCase();
    const rawType = topic || action || 'unknown';

    // Determinar el tipo real de notificación (NO usar action como "type" estricto)
    const isPaymentNotification =
      topic === 'payment' ||
      topic.includes('payment') ||
      action.startsWith('payment.');
    const isMerchantOrderNotification =
      topic === 'merchant_order' ||
      topic.includes('merchant_order') ||
      action.startsWith('merchant_order.');

    const rawData = body.data || {};
    let paymentId: string | undefined = rawData.id || body.id || query.id || queryDataId;

    // A veces viene como 'resource': 'https://api.mercadopago.com/v1/payments/1234567890'
    if (!paymentId && (body.resource || query.resource)) {
      const resource = String(body.resource || query.resource);
      const match = resource.match(/payments\/(\d+)/);
      if (match && match[1]) paymentId = match[1];
    }

    console.log(colors.blue("\n🔔 Webhook de MercadoPago recibido"));
    console.log(colors.blue(`   Método: ${String((req as any).method || '').toUpperCase()}`));
    console.log(colors.blue(`   Type/Topic: ${rawType}`));
    console.log(colors.blue(`   PaymentId: ${paymentId}`));
    // Log limitado del cuerpo para diagnóstico
    if (!rawType || !paymentId) {
      console.log(colors.yellow("   ℹ️  Payload parcial recibido (body/query):"));
      console.log(colors.yellow(`   body: ${JSON.stringify(body).slice(0, 500)}${JSON.stringify(body).length > 500 ? '…' : ''}`));
      console.log(colors.yellow(`   query: ${JSON.stringify(query)}`));
    }

    // Si viene un topic/action que no corresponde a pago u orden de MP, salir
    if (!isPaymentNotification && !isMerchantOrderNotification) {
      console.log(colors.yellow("   ⚠️  Notificación no reconocida (no payment/merchant_order), ignorando"));
      return;
    }

    // Si es merchant_order, primero resolver el payment_id real (MP suele notificar Checkout Pro así)
    if (isMerchantOrderNotification) {
      let merchantOrderId: string | undefined = rawData.id || body.id || query.id;

      // A veces viene como resource: https://api.mercadopago.com/merchant_orders/123
      if (!merchantOrderId && (body.resource || query.resource)) {
        const resource = String(body.resource || query.resource);
        const match = resource.match(/merchant_orders\/(\d+)/);
        if (match && match[1]) merchantOrderId = match[1];
      }

      if (!merchantOrderId) {
        console.log(colors.red("   ❌ Notificación merchant_order sin ID"));
        return;
      }

      const merchantOrderIdNum = parseInt(String(merchantOrderId), 10);
      if (Number.isNaN(merchantOrderIdNum)) {
        console.log(colors.red("   ❌ merchantOrderId no es numérico"));
        return;
      }

      console.log(colors.yellow(`   🧾 Consultando merchant_order ${merchantOrderIdNum}...`));
      try {
        const merchantOrderResp = await (mercadopago as any).merchant_orders.get(merchantOrderIdNum);
        const merchantOrderData = merchantOrderResp?.body;
        const payments: any[] = Array.isArray(merchantOrderData?.payments) ? merchantOrderData.payments : [];

        if (!payments.length) {
          console.log(colors.yellow("   ⚠️ merchant_order sin payments aún, esperando próximo webhook"));
          return;
        }

        // Priorizar pagos aprobados; si no hay, tomar el último disponible
        const approvedPayment = payments.find(p => String(p?.status || '').toLowerCase() === 'approved');
        const selected = approvedPayment || payments[payments.length - 1];

        if (!selected?.id) {
          console.log(colors.red("   ❌ No se pudo obtener payment_id desde merchant_order"));
          return;
        }

        paymentId = String(selected.id);
        console.log(colors.cyan(`   🔗 merchant_order → payment_id resuelto: ${paymentId} (status=${selected.status || 'N/A'})`));
      } catch (moErr: any) {
        console.log(colors.red("   ❌ Error consultando merchant_order en MP:"), moErr?.message || moErr);
        return;
      }
    }

    if (!paymentId) {
      console.log(colors.red("   ❌ No se pudo determinar el payment ID"));
      return;
    }

    // 🔒 DEDUPLICACIÓN: Evitar procesar el mismo paymentId múltiples veces.
    // MP puede notificar el MISMO pago por 'payment' y por 'merchant_order'.
    // Si deduplicamos por (paymentId + tipo), terminamos procesando doble.
    webhookKey = String(paymentId);
    
    // Si ya se está procesando este webhook, ignorarlo
    if (processingWebhooks.has(webhookKey)) {
      console.log(colors.yellow(`   ⏭️  Webhook ya en procesamiento (${webhookKey}), ignorando duplicado`));
      return;
    }
    
    // Si se procesó recientemente (dentro de la ventana de deduplicación), ignorarlo
    const lastProcessed = processedWebhooks.get(webhookKey);
    if (lastProcessed && Date.now() - lastProcessed < WEBHOOK_DEDUP_WINDOW) {
      console.log(colors.yellow(`   ⏭️  Webhook procesado recientemente (${webhookKey}), ignorando duplicado`));
      return;
    }
    
    // Marcar como en procesamiento
    processingWebhooks.add(webhookKey);

    // Obtener información completa del pago
    console.log(colors.yellow(`   📋 Consultando pago ${paymentId}...`));

    const paymentIdNum = typeof paymentId === 'string' ? parseInt(paymentId, 10) : paymentId;
    if (Number.isNaN(paymentIdNum)) {
      console.log(colors.red("   ❌ paymentId no es numérico"));
      return;
    }

    const payment = await mercadopago.payment.findById(paymentIdNum);
    const paymentData = payment.body;

    console.log(colors.cyan(`   💳 Estado del pago: ${paymentData.status}`));
    console.log(colors.cyan(`   💵 Monto: $${formatMoney(paymentData.transaction_amount)} ${paymentData.currency_id}`));
    console.log(colors.cyan(`   🆔 External Reference: ${paymentData.external_reference}`));
    console.log(colors.cyan(`   🧪 Live Mode: ${paymentData.live_mode}`));
    // Fechas útiles para diagnosticar "webhook tardío" vs "pago aprobado tarde"
    if (paymentData.date_created) console.log(colors.cyan(`   🕒 MP date_created: ${paymentData.date_created}`));
    if (paymentData.date_last_updated) console.log(colors.cyan(`   🔁 MP date_last_updated: ${paymentData.date_last_updated}`));
    if (paymentData.date_approved) console.log(colors.cyan(`   ✅ MP date_approved: ${paymentData.date_approved}`));

    // 🧪 IMPORTANTE: Detectar si es un pago de PRUEBA (sandbox)
    const esPagoDePrueba = paymentData.live_mode === false;
    if (esPagoDePrueba) {
      console.log(colors.yellow("   🧪 PAGO DE PRUEBA DETECTADO"));
      console.log(colors.yellow("   ✅ Modo prueba habilitado para actualizar stock también"));
    } else {
      console.log(colors.green("   ✅ Pago de PRODUCCIÓN detectado, se procesará normalmente"));
    }

    // Procesar cualquier estado
    console.log(colors.yellow(`   🔄 Procesando estado: ${paymentData.status}`));

    // Verificar si ya existe por payment_id o external_reference
    // Buscar primero por payment_id (más específico)
    let ordenExistente = await Orden.findOne({
      payment_id: paymentId.toString()
    });
    
    // Si no existe, buscar por external_reference
    // Esto es importante para actualizar órdenes creadas al generar la preferencia
    if (!ordenExistente && paymentData.external_reference) {
      // 1) Priorizar la orden "pendiente" creada al generar preferencia
      ordenExistente = await Orden.findOne({
        external_reference: paymentData.external_reference,
        // Solo buscar órdenes que sean de "preferencia creada" o que no tengan payment_id real
        $or: [
          { payment_status_detail: 'preference_created' },
          { payment_id: { $in: ['N/A', null, ''] } },
          { payment_id: { $regex: /^pref-/i } } // IDs de preferencia suelen empezar con "pref-"
        ]
      }).sort({ date_created: -1 });

      // 2) Fallback: cualquier orden con ese external_reference (por si el detalle cambió)
      if (!ordenExistente) {
        ordenExistente = await Orden.findOne({
          external_reference: paymentData.external_reference
        }).sort({ date_created: -1 });
      }
      
      if (ordenExistente) {
        console.log(colors.cyan(`   🔄 Encontrada orden por external_reference (${ordenExistente.orden_id}), se actualizará con el pago real`));
      }
    }

    console.log(ordenExistente 
      ? colors.green("   ♻️ Actualizando orden existente...") 
      : colors.green("   ✅ Creando nueva orden..."));

    const wasApproved =
      String(ordenExistente?.payment_status || '').toLowerCase() === 'approved' ||
      String(ordenExistente?.status || '').toLowerCase() === 'approved';

    // Solo aplicar efectos colaterales (stock) cuando el pago transiciona a approved.
    // Esto evita doble descuento cuando llegan notificaciones duplicadas (payment + merchant_order / reintentos).
    const shouldApplyApprovedSideEffects =
      String(paymentData.status || '').toLowerCase() === 'approved' && !wasApproved;

    // Iniciar transacción de MongoDB
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Obtener items de la metadata (puede venir como objeto o string)
      let metadata: any = paymentData.metadata || {};
      let itemsFromMetadata: any[] = [];

      try {
        // Intentar múltiples fuentes para obtener los items
        const rawItems = metadata.items || 
                        paymentData.additional_info?.items || 
                        paymentData.items || 
                        [];
        
        if (typeof rawItems === 'string') {
          itemsFromMetadata = JSON.parse(rawItems);
        } else if (Array.isArray(rawItems)) {
          itemsFromMetadata = rawItems;
        } else if (rawItems && typeof rawItems === 'object') {
          // Caso poco común: objeto con índices
          itemsFromMetadata = Object.values(rawItems);
        }
      } catch (parseErr) {
        console.log(colors.yellow('   ⚠️ No se pudo parsear metadata.items'));
      }

      if (!itemsFromMetadata || itemsFromMetadata.length === 0) {
        console.log(colors.yellow('   ⚠️ No se encontraron items en metadata/additional_info. Usando fallback.'));
        // Fallback: construir un único item resumen para registrar la orden
        itemsFromMetadata = [{
          id: paymentData.external_reference || `ORDER-${Date.now()}`,
          title: 'Compra en Poppy Shop',
          quantity: 1,
          unit_price: Number(paymentData.transaction_amount || 0)
        }];
      }

      // Si el pago pasó a approved (transición), actualizar stock en BD UNA sola vez
      if (shouldApplyApprovedSideEffects) {
        console.log(colors.yellow("   📦 Actualizando stock en BD local..."));
        for (const item of itemsFromMetadata) {
          const producto = await ProductoModel.findOne({ ml_id: item.id }).session(session);
          if (producto) {
            const nuevoStockRaw = producto.available_quantity - item.quantity;
            const nuevoStock = Math.max(0, nuevoStockRaw);
            await ProductoModel.updateOne(
              { ml_id: item.id },
              { $set: { available_quantity: Math.max(0, nuevoStock) } },
              { session }
            );
            console.log(colors.green(`      ✅ BD Local - ${item.title}: ${producto.available_quantity} → ${nuevoStock}`));
          }
        }
      } else if (String(paymentData.status || '').toLowerCase() === 'approved' && wasApproved) {
        console.log(colors.yellow("   ⏭️  Orden ya estaba aprobada: no se descuenta stock nuevamente"));
      }

      // 🔥 IMPORTANTE: Actualizar stock EN MERCADOLIBRE solo si approved
      if (shouldApplyApprovedSideEffects) {
        console.log(colors.yellow("   🛍️  Actualizando stock en MercadoLibre..."));
      
      try {
        const token = await getCurrentToken();
        
        if (token) {
          console.log(colors.blue("      🔑 Token de MercadoLibre obtenido"));
          
          for (const item of itemsFromMetadata) {
            const producto = await ProductoModel.findOne({ ml_id: item.id });
            
            if (producto) {
              try {
                // 🔧 OBTENER STOCK ACTUAL DESDE MERCADOLIBRE (no de la BD local)
                const currentStockML = await getCurrentStockFromMercadoLibre(producto.ml_id, token.access_token);
                
                // 🔧 CALCULAR NUEVO STOCK RESTANDO LA CANTIDAD COMPRADA
                const nuevoStockML = Math.max(0, currentStockML - item.quantity);
                
                console.log(colors.blue(`      📦 Producto: ${item.title || producto.title}`));
                console.log(colors.blue(`      📊 Stock actual ML: ${currentStockML} → Nuevo stock: ${nuevoStockML} (restando ${item.quantity})`));
                
                await updateStockInMercadoLibre(
                  producto.ml_id, 
                  nuevoStockML, 
                  token.access_token
                );
                // 🆕 Propagar al grupo (catálogo/GTIN)
                await propagateStockToGroup(producto.ml_id, nuevoStockML, token.access_token);
                console.log(colors.green(`      ✅ MercadoLibre - ${item.title || producto.title}: Stock actualizado y propagado a grupo con ${nuevoStockML}`));
              } catch (mlError: any) {
                console.log(colors.red(`      ❌ Error actualizando en ML para ${item.title || producto.title}: ${mlError.message}`));
                // No hacer rollback de la transacción, el stock en BD ya se actualizó correctamente
              }
            }
          }
          
          console.log(colors.green("   ✅ Stock sincronizado con MercadoLibre"));
        } else {
          console.log(colors.yellow("      ⚠️  No se pudo obtener token de MercadoLibre"));
          console.log(colors.yellow("      ⚠️  Stock actualizado en BD, pero NO en MercadoLibre"));
        }
      } catch (tokenError) {
        console.log(colors.red("      ❌ Error obteniendo token de ML:"), tokenError);
        console.log(colors.yellow("      ⚠️  Stock actualizado en BD, pero NO en MercadoLibre"));
      }
      }

      // 🔄 RESTAURAR STOCK si el pago cambió de approved a rejected/cancelled/refunded
      const estadosQueRequierenRestauracion = ['rejected', 'cancelled', 'refunded', 'partially_refunded'];
      const estadoAnterior = ordenExistente?.payment_status || ordenExistente?.status;
      const eraAprobado = estadoAnterior === 'approved' || ordenExistente?.status === 'approved';
      const requiereRestauracion = eraAprobado && estadosQueRequierenRestauracion.includes(paymentData.status);
      
      if (requiereRestauracion) {
        console.log(colors.yellow(`   🔄 Restaurando stock (pago cambió de approved a ${paymentData.status})...`));
        
        // Restaurar stock en BD local
        for (const item of itemsFromMetadata) {
          const producto = await ProductoModel.findOne({ ml_id: item.id }).session(session);
          if (producto) {
            const nuevoStock = producto.available_quantity + item.quantity;
            await ProductoModel.updateOne(
              { ml_id: item.id },
              { $set: { available_quantity: nuevoStock } },
              { session }
            );
            console.log(colors.green(`      ✅ BD Local - ${item.title}: ${producto.available_quantity} → ${nuevoStock} (restaurado +${item.quantity})`));
          }
        }
        
        // Restaurar stock en MercadoLibre
        try {
          const token = await getCurrentToken();
          
          if (token) {
            console.log(colors.blue("      🔑 Token de MercadoLibre obtenido para restauración"));
            
            for (const item of itemsFromMetadata) {
              const producto = await ProductoModel.findOne({ ml_id: item.id });
              
              if (producto) {
                try {
                  // Obtener stock actual desde MercadoLibre
                  const currentStockML = await getCurrentStockFromMercadoLibre(producto.ml_id, token.access_token);
                  
                  // Calcular nuevo stock sumando la cantidad (restaurar)
                  const nuevoStockML = currentStockML + item.quantity;
                  
                  console.log(colors.blue(`      📦 Producto: ${item.title || producto.title}`));
                  console.log(colors.blue(`      📊 Stock actual ML: ${currentStockML} → Nuevo stock: ${nuevoStockML} (restaurando +${item.quantity})`));
                  
                  await updateStockInMercadoLibre(
                    producto.ml_id, 
                    nuevoStockML, 
                    token.access_token
                  );
                  // Propagar al grupo (catálogo/GTIN)
                  await propagateStockToGroup(producto.ml_id, nuevoStockML, token.access_token);
                  console.log(colors.green(`      ✅ MercadoLibre - ${item.title || producto.title}: Stock restaurado y propagado a grupo con ${nuevoStockML}`));
                } catch (mlError: any) {
                  console.log(colors.red(`      ❌ Error restaurando stock en ML para ${item.title || producto.title}: ${mlError.message}`));
                }
              }
            }
            
            console.log(colors.green("   ✅ Stock restaurado en MercadoLibre"));
          } else {
            console.log(colors.yellow("      ⚠️  No se pudo obtener token de MercadoLibre para restauración"));
          }
        } catch (tokenError) {
          console.log(colors.red("      ❌ Error obteniendo token de ML para restauración:"), tokenError);
        }
      }

      // Obtener información del cupón si existe
      let cuponInfo: any = null;
      let descuentoCupon = 0;
      
      if (paymentData.metadata?.cupon_codigo) {
        const cupon = await CuponModel.findOne({ 
          codigo: String(paymentData.metadata.cupon_codigo).toUpperCase().trim()
        }).session(session);

        if (cupon) {
          // Registrar uso del cupón
          cupon.usos_actuales += 1;
          
          if (paymentData.payer?.email || metadata.customer_email) {
            const emailCliente = paymentData.payer?.email || metadata.customer_email;
            cupon.usuarios_usados.push(emailCliente);
          }

          await cupon.save({ session });
          console.log(colors.green(`   🎟️ Cupón ${cupon.codigo} registrado`));
          
          // Guardar información completa del cupón
          descuentoCupon = Number(paymentData.metadata.cupon_descuento || 0);
          cuponInfo = {
            codigo: cupon.codigo,
            descripcion: cupon.descripcion,
            tipo: cupon.tipo_descuento,
            valor: cupon.valor_descuento,
            descuento_total: descuentoCupon
          };
        } else {
          // Si hay cupón en metadata pero no se encuentra en BD, usar los datos de metadata
          descuentoCupon = Number(paymentData.metadata.cupon_descuento || 0);
          console.log(colors.yellow(`   ⚠️ Cupón ${paymentData.metadata.cupon_codigo} no encontrado en BD, usando datos de metadata`));
        }
      }

      // Extraer nombre completo del cliente
      let customerName = "Cliente";
      if (metadata.customer_name) {
        customerName = metadata.customer_name;
      } else if (paymentData.payer) {
        const firstName = paymentData.payer.first_name || '';
        const lastName = paymentData.payer.last_name || '';
        customerName = `${firstName} ${lastName}`.trim() || customerName;
      }
      
      // Extraer email del cliente
      const customerEmail = metadata.customer_email || 
                           paymentData.payer?.email || 
                           "cliente@example.com";
      
      // Extraer teléfono del cliente (buscar en múltiples lugares)
      let customerPhone = "";
      // Primero intentar desde metadata
      if (metadata.customer_phone) {
        customerPhone = String(metadata.customer_phone);
      } else if (paymentData.payer?.phone) {
        if (typeof paymentData.payer.phone === 'string') {
          customerPhone = paymentData.payer.phone;
        } else if (paymentData.payer.phone.number) {
          customerPhone = String(paymentData.payer.phone.number);
          if (paymentData.payer.phone.area_code) {
            customerPhone = `${paymentData.payer.phone.area_code}${customerPhone}`;
          }
        }
      }
      
      // Extraer dirección del cliente
      let customerAddress = "";
      let customerCity = 'N/A';
      let customerState = 'N/A';
      
      if (paymentData.payer?.address) {
        if (typeof paymentData.payer.address === 'string') {
          customerAddress = paymentData.payer.address;
        } else {
          customerAddress = paymentData.payer.address.street_name || "";
          if (paymentData.payer.address.street_number) {
            customerAddress += ` ${paymentData.payer.address.street_number}`;
          }
          customerCity = paymentData.payer.address.city?.name || 'N/A';
          customerState = paymentData.payer.address.state?.name || 'N/A';
        }
      }
      
      // Calcular subtotal (antes del descuento)
      const subtotal = paymentData.transaction_amount + descuentoCupon;
      
      // Mapear status del pago al status de la orden
      let orderStatus: 'pending' | 'approved' | 'rejected' | 'cancelled' = 'pending';
      if (paymentData.status === 'approved') {
        orderStatus = 'approved';
      } else if (paymentData.status === 'rejected' || paymentData.status === 'cancelled') {
        orderStatus = paymentData.status as 'rejected' | 'cancelled';
      }
      
      // Generar orden_id y numero_orden si no existen
      const ordenId = ordenExistente ? ordenExistente.orden_id : `ORD-${Date.now()}`;
      const numeroOrden = ordenExistente ? (ordenExistente.numero_orden || ordenId) : ordenId;
      
      // Crear o actualizar registro de la orden
      const baseOrden: any = {
        orden_id: ordenId,
        external_reference: paymentData.external_reference || `ORDER-${Date.now()}`,
        numero_orden: numeroOrden,
        
        payment_id: paymentId.toString(),
        payment_status: paymentData.status,
        payment_status_detail: paymentData.status_detail,
        transaction_amount: paymentData.transaction_amount,
        payment_method_id: paymentData.payment_method_id,
        installments: paymentData.installments || 1,
        
        customer: {
          name: customerName,
          email: customerEmail,
          phone: customerPhone,
          address: customerAddress,
          city: customerCity,
          state: customerState
        },
        
        items: await Promise.all(itemsFromMetadata.map(async (item: any) => {
          // Obtener ml_id y SKU del producto desde la BD si no están en los metadatos
          const mlId = item.ml_id || item.id || item.product_id || 'unknown';
          let sku = item.sku || null;
          
          // Si no tenemos el SKU en los metadatos, buscarlo en la BD
          if (!sku && mlId !== 'unknown') {
            try {
              const producto = await ProductoModel.findOne({ ml_id: mlId });
              if (producto?.seller_sku) {
                sku = producto.seller_sku;
              }
            } catch (err) {
              console.log(colors.yellow(`   ⚠️ No se pudo buscar SKU para producto ${mlId}`));
            }
          }
          
          return {
            product_id: mlId, // ml_id de MercadoLibre
            ml_id: mlId, // También guardar como ml_id explícito
            sku: sku, // SKU del producto
            product_name: item.title || item.product_name || 'Producto',
            quantity: item.quantity || 1,
            unit_price: item.unit_price || 0,
            total_price: (item.quantity || 1) * (item.unit_price || 0)
          };
        })),
        
        subtotal: subtotal,
        descuento_cupon: descuentoCupon,
        cupon_aplicado: cuponInfo || undefined,
        total: paymentData.transaction_amount,
        currency: paymentData.currency_id || 'UYU',
        status: orderStatus,
        
        date_created: ordenExistente ? ordenExistente.date_created : new Date(),
        date_updated: new Date(),
        date_approved: paymentData.status === 'approved' && paymentData.date_approved 
          ? new Date(paymentData.date_approved) 
          : (ordenExistente?.date_approved || undefined),
        // 📝 Detalle diagnóstico
        notes: `estado=${paymentData.status}; detalle=${paymentData.status_detail}; metodo=${paymentData.payment_method_id}; tipo=${paymentData.payment_type_id}; live_mode=${paymentData.live_mode}; ext_ref=${paymentData.external_reference}`
      };
      let finalOrderId: string | undefined;
      if (ordenExistente) {
        // Si la orden existente era solo una "preferencia creada", actualizarla con el pago real
        const eraPreferencia = ordenExistente.payment_status_detail === 'preference_created' || 
                               ordenExistente.payment_id === 'N/A' ||
                               !ordenExistente.payment_id ||
                               String(ordenExistente.payment_id).startsWith('pref-');
        
        if (eraPreferencia) {
          console.log(colors.cyan(`   🔄 Actualizando orden de preferencia (${ordenExistente.orden_id}) con pago real (${paymentId})`));
          // Actualizar con información del pago real
          baseOrden.notes = `[ACTUALIZADA] Orden iniciada como preferencia, ahora con pago real. Payment ID: ${paymentId} | Estado: ${paymentData.status} | Detalle: ${paymentData.status_detail}`;
        }
        
        // Usar $set para actualizar solo los campos necesarios
        await Orden.updateOne({ _id: ordenExistente._id }, { $set: baseOrden }, { session });
        finalOrderId = ordenExistente.orden_id;
        console.log(colors.green(`   ♻️ Orden actualizada (${eraPreferencia ? 'de preferencia a pago real' : 'con nuevo estado'})`));
      } else {
        const nuevaOrden = new Orden(baseOrden);
        await nuevaOrden.save({ session });
        finalOrderId = nuevaOrden.orden_id;
        console.log(colors.green("   ✅ Orden creada"));
      }

      // Confirmar transacción
      await session.commitTransaction();
      
      console.log(colors.green("   ✅ Orden registrada/actualizada"));
      console.log(colors.green(`   🧾 External Reference: ${paymentData.external_reference} | Payment ID: ${paymentId}`));

      // 👤 Crear o actualizar cliente asociado a la orden (fuera de la transacción para no bloquear)
      // Solo crear si el email es válido (no es el default)
      if (baseOrden.customer.email && 
          baseOrden.customer.email !== 'cliente@example.com' && 
          baseOrden.customer.email.includes('@')) {
        try {
          console.log(colors.yellow(`   👤 Intentando crear/actualizar cliente: ${baseOrden.customer.email}`));
          console.log(colors.cyan(`      Nombre: ${baseOrden.customer.name || 'N/A'}`));
          console.log(colors.cyan(`      Teléfono: ${baseOrden.customer.phone || 'N/A'}`));
          console.log(colors.cyan(`      Dirección: ${baseOrden.customer.address || 'N/A'}`));
          
          const cliente = await ClienteService.crearOActualizarDesdeOrden({
            name: baseOrden.customer.name,
            email: baseOrden.customer.email,
            phone: baseOrden.customer.phone,
            address: baseOrden.customer.address,
            city: baseOrden.customer.city,
            state: baseOrden.customer.state
          });
          
          if (String(paymentData.status).toLowerCase() === 'approved') {
            await ClienteService.actualizarEstadisticasCompra(cliente._id.toString(), Number(paymentData.transaction_amount || 0));
            console.log(colors.green(`      ✅ Estadísticas de compra actualizadas`));
          }
          
          console.log(colors.green(`   ✅ Cliente creado/actualizado exitosamente: ${cliente.email}`));
          console.log(colors.green(`      ID: ${cliente._id}`));
          console.log(colors.green(`      Nombre: ${cliente.nombre} ${cliente.apellido}`));
        } catch (clienteErr: any) {
          console.log(colors.red('   ❌ Error al crear/actualizar cliente desde webhook:'));
          console.log(colors.red(`      Email: ${baseOrden.customer.email}`));
          console.log(colors.red(`      Error: ${clienteErr?.message || clienteErr}`));
          if (clienteErr?.stack) {
            console.log(colors.red(`      Stack: ${clienteErr.stack.split('\n').slice(0, 3).join('\n')}`));
          }
        }
      } else {
        console.log(colors.yellow(`   ⚠️ Email inválido o faltante, no se creará cliente:`));
        console.log(colors.yellow(`      Email recibido: ${baseOrden.customer.email || 'undefined'}`));
      }

      // Notificación admin:
      // Crear una notificación NUEVA cuando cambie el estado (para ver tiempos)
      try {
        const status = String(paymentData.status || '').toLowerCase()

        // Solo notificar si hubo cambio de estado (MP puede reintentar el mismo webhook varias veces)
        const prevStatus = String(ordenExistente?.payment_status || '').toLowerCase();
        const shouldCreateNotification = !ordenExistente || prevStatus !== status;

        if (shouldCreateNotification) {
          
          const statusMap: Record<string,string> = {
            approved: 'Pago aprobado',
            pending: 'Pago pendiente',
            in_process: 'Pago en proceso',
            rejected: 'Pago rechazado',
            cancelled: 'Pago cancelado',
            refunded: 'Pago reembolsado',
            partially_refunded: 'Pago reembolsado parcialmente',
            in_mediation: 'Pago en mediación',
            charged_back: 'Pago revertido',
            authorized: 'Pago autorizado',
            null: 'Estado desconocido'
          }
          const friendly = statusMap[status] || `Pago ${status}`
          const method = paymentData.payment_method_id ? String(paymentData.payment_method_id).toUpperCase() : (paymentData.payment_type_id || '')
          const amount = Number(paymentData.transaction_amount || 0)
          const amountFmt = formatMoney(amount)
          const curr = paymentData.currency_id || ''
          const detail = String(paymentData.status_detail || '')
          const detailMap: Record<string,string> = {
            // Estados de aprobación
            accredited: 'acreditado',
            
            // Estados pendientes
            pending_contingency: 'en revisión',
            pending_review_manual: 'en revisión manual',
            pending_waiting_payment: 'esperando pago',
            pending_waiting_transfer: 'esperando transferencia',
            
            // Estados de rechazo
            cc_rejected_other_reason: 'motivo desconocido',
            cc_rejected_bad_filled_security_code: 'CVV incorrecto',
            cc_rejected_bad_filled_date: 'fecha inválida',
            cc_rejected_bad_filled_card_number: 'número inválido',
            cc_rejected_bad_filled_other: 'datos incorrectos',
            cc_rejected_insufficient_amount: 'fondos insuficientes',
            cc_rejected_high_risk: 'rechazado por riesgo alto',
            cc_rejected_call_for_authorize: 'requiere autorización del banco',
            cc_rejected_blacklist: 'tarjeta bloqueada',
            cc_rejected_card_disabled: 'tarjeta deshabilitada',
            cc_rejected_invalid_installments: 'cuotas inválidas',
            cc_rejected_max_attempts: 'máximo de intentos excedido',
            
            // Estados de disputa
            disputed_mediation: 'disputa en mediación',
            disputed_chargeback: 'disputa por chargeback',
            
            // Estados de autorización
            authorized: 'autorizado',
            pending_capture: 'pendiente de captura'
          }
          const friendlyDetail = detailMap[detail] || detail
          
          // Construir mensaje base
          let message = `${friendly} - ${curr} ${amountFmt}${method ? ` - método ${method}` : ''}${friendlyDetail ? ` (${friendlyDetail})` : ''}`
          
          // Manejar estados especiales con información adicional
          if (status === 'in_process') {
            console.log(colors.cyan(`   🔄 PAGO EN PROCESO - Mercado Pago está analizando el pago`));
            message = `${friendly} - ${curr} ${amountFmt}${method ? ` - método ${method}` : ''} | 🔄 Análisis en curso - Esperar confirmación`;
          }
          
          if (status === 'in_mediation') {
            console.log(colors.yellow(`   ⚠️ PAGO EN MEDIACIÓN - Disputa iniciada por el comprador`));
            console.log(colors.yellow(`      💡 Acción requerida: Revisar el caso en el panel de Mercado Pago`));
            
            // Agregar información útil al mensaje de la notificación
            const payerEmail = paymentData.payer?.email || metadata.customer_email || 'Cliente';
            message = `${friendly} - ${curr} ${amountFmt}${method ? ` - método ${method}` : ''} | ⚠️ Disputa iniciada - Revisar en panel MP`;
            
            // Si hay información adicional sobre la disputa, agregarla
            if (paymentData.dispute) {
              const disputeInfo = paymentData.dispute;
              if (disputeInfo.reason) {
                message += ` | Motivo: ${disputeInfo.reason}`;
              }
            }
          }
          
          if (status === 'charged_back') {
            console.log(colors.red(`   ❌ CHARGEBACK - El banco revirtió el pago`));
            message = `${friendly} - ${curr} ${amountFmt}${method ? ` - método ${method}` : ''} | ❌ Pago revertido por banco`;
          }
          
          if (status === 'refunded') {
            const refundAmount = paymentData.transaction_amount || amount;
            console.log(colors.green(`   ✅ REEMBOLSO COMPLETADO - ${curr} ${refundAmount}`));
            message = `${friendly} - ${curr} ${formatMoney(refundAmount)}${method ? ` - método ${method}` : ''} | ✅ Reembolso completado`;
          }
          
          if (status === 'partially_refunded') {
            const refundAmount = paymentData.transaction_amount || amount;
            console.log(colors.yellow(`   ⚠️ REEMBOLSO PARCIAL - ${curr} ${refundAmount}`));
            message = `${friendly} - ${curr} ${formatMoney(refundAmount)}${method ? ` - método ${method}` : ''} | ⚠️ Reembolso parcial realizado`;
          }
          
          if (status === 'authorized') {
            console.log(colors.cyan(`   🔐 PAGO AUTORIZADO - Requiere captura posterior`));
            message = `${friendly} - ${curr} ${amountFmt}${method ? ` - método ${method}` : ''} | 🔐 Autorizado - Requiere captura`;
          }
          
          if (status === 'pending') {
            // Si es pending con detalles específicos, agregar información detallada
            const pendingTypes: Record<string, string> = {
              'pending_contingency': 'en revisión automática',
              'pending_review_manual': 'requiere revisión manual',
              'pending_waiting_payment': 'esperando confirmación de pago',
              'pending_waiting_transfer': 'esperando transferencia',
              'pending_capture': 'pendiente de captura'
            };
            const pendingType = pendingTypes[detail] || friendlyDetail || detail;
            
            // Agregar información de cuotas si aplica
            const installmentsInfo = paymentData.installments && paymentData.installments > 1 
              ? ` - ${paymentData.installments} cuotas` 
              : '';
            
            message = `${friendly} - ${curr} ${amountFmt}${method ? ` - método ${method}` : ''}${installmentsInfo} | ⏳ ${pendingType}`;
          }

          await AdminNotification.create({
            type: 'order',
            status: 'unread',
            message,
            order_id: finalOrderId,
            payment_id: paymentId?.toString?.(),
            customer_email: paymentData.payer?.email || metadata.customer_email || undefined,
            total: amount,
            currency: curr || undefined
          });
          console.log(colors.green(`   📬 Notificación creada: ${message}`));
        } else {
          console.log(colors.yellow(`   ⏭️  Estado repetido (${status}), no se crea notificación nueva`));
        }
      } catch (nErr) {
        console.log(colors.yellow('⚠️ No se pudo crear notificación admin (webhook)'), nErr);
      }

    } catch (error) {
      await session.abortTransaction();
      console.error(colors.red("   ❌ Error procesando orden:"), error);
    } finally {
      session.endSession();
      // 🔒 Limpiar estado de procesamiento
      processingWebhooks.delete(webhookKey);
      processedWebhooks.set(webhookKey, Date.now());
      
      // Limpiar entradas antiguas del Map (más de 5 minutos)
      const fiveMinutesAgo = Date.now() - 300000;
      for (const [key, timestamp] of processedWebhooks.entries()) {
        if (timestamp < fiveMinutesAgo) {
          processedWebhooks.delete(key);
        }
      }
    }

  } catch (error: any) {
    console.error(colors.red("❌ Error en webhook:"), error);
    // 🔒 Limpiar estado de procesamiento incluso en caso de error
    if (webhookKey) {
      processingWebhooks.delete(webhookKey);
    }
  }
});

export default router;

