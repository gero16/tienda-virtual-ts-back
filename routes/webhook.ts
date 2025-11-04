import { Router, Request, Response } from "express";
import mercadopago from "mercadopago";
import colors from "colors";
import mongoose from "mongoose";
import ProductoModel from "../models/Producto";
import Orden from "../models/Orden";
import CuponModel from "../models/Cupon";
import { getCurrentToken, updateStockInMercadoLibre, propagateStockToGroup } from "./mercadolibre";
import AdminNotification from "../models/AdminNotification";
import { ClienteService } from "../services/clienteService";

const router = Router();

/**
 * Webhook para recibir notificaciones de MercadoPago
 * Se llama cuando hay cambios en el estado de un pago
 */
router.post("/mercadopago", async (req: Request, res: Response) => {
  try {
    // Responder inmediatamente a MercadoPago (requisito de la API)
    res.status(200).send("OK");

    const body: any = req.body || {};
    const query: any = (req as any).query || {};

    // Compatibilidad con diferentes formatos de MP (type/topic en body o query)
    const rawType = body.type || query.type || body.topic || query.topic || body.action;
    const rawData = body.data || {};
    let paymentId: string | undefined = rawData.id || body.id || query.id;

    // A veces viene como 'resource': 'https://api.mercadopago.com/v1/payments/1234567890'
    if (!paymentId && (body.resource || query.resource)) {
      const resource = String(body.resource || query.resource);
      const match = resource.match(/payments\/(\d+)/);
      if (match && match[1]) paymentId = match[1];
    }

    console.log(colors.blue("\n🔔 Webhook de MercadoPago recibido"));
    console.log(colors.blue(`   Type/Topic: ${rawType}`));
    console.log(colors.blue(`   PaymentId: ${paymentId}`));
    // Log limitado del cuerpo para diagnóstico
    if (!rawType || !paymentId) {
      console.log(colors.yellow("   ℹ️  Payload parcial recibido (body/query):"));
      console.log(colors.yellow(`   body: ${JSON.stringify(body).slice(0, 500)}${JSON.stringify(body).length > 500 ? '…' : ''}`));
      console.log(colors.yellow(`   query: ${JSON.stringify(query)}`));
    }

    // Si viene un type/topic explícito y no es pago, salir
    if (rawType && rawType !== "payment") {
      console.log(colors.yellow("   ⚠️  Notificación no es de pago, ignorando"));
      return;
    }

    if (!paymentId) {
      console.log(colors.red("   ❌ No se pudo determinar el payment ID"));
      return;
    }

    if (!paymentId) {
      console.log(colors.red("   ❌ No se recibió payment ID"));
      return;
    }

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
    console.log(colors.cyan(`   💵 Monto: $${paymentData.transaction_amount} ${paymentData.currency_id}`));
    console.log(colors.cyan(`   🆔 External Reference: ${paymentData.external_reference}`));
    console.log(colors.cyan(`   🧪 Live Mode: ${paymentData.live_mode}`));

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
    const ordenExistente = await Orden.findOne({
      $or: [
        { payment_id: paymentId.toString() },
        { external_reference: paymentData.external_reference }
      ]
    });

    console.log(colors.green("   ✅ Registrando/actualizando orden..."));

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

      // Si es approved, actualizar stock en BD
      if (paymentData.status === 'approved') {
        console.log(colors.yellow("   📦 Actualizando stock en BD local..."));
        for (const item of itemsFromMetadata) {
          const producto = await ProductoModel.findOne({ ml_id: item.id }).session(session);
          if (producto) {
            const nuevoStock = producto.available_quantity - item.quantity;
            await ProductoModel.updateOne(
              { ml_id: item.id },
              { $set: { available_quantity: Math.max(0, nuevoStock) } },
              { session }
            );
            console.log(colors.green(`      ✅ BD Local - ${item.title}: ${producto.available_quantity} → ${nuevoStock}`));
          }
        }
      }

      // 🔥 IMPORTANTE: Actualizar stock EN MERCADOLIBRE solo si approved
      if (paymentData.status === 'approved') {
        console.log(colors.yellow("   🛍️  Actualizando stock en MercadoLibre..."));
      
      try {
        const token = await getCurrentToken();
        
        if (token) {
          console.log(colors.blue("      🔑 Token de MercadoLibre obtenido"));
          
          for (const item of itemsFromMetadata) {
            const producto = await ProductoModel.findOne({ ml_id: item.id });
            
            if (producto) {
              const nuevoStockML = Math.max(0, producto.available_quantity);
              
              try {
                await updateStockInMercadoLibre(
                  producto.ml_id, 
                  nuevoStockML, 
                  token.access_token
                );
                // 🆕 Propagar al grupo (catálogo/GTIN)
                await propagateStockToGroup(producto.ml_id, nuevoStockML, token.access_token);
                console.log(colors.green(`      ✅ MercadoLibre - ${item.title}: Stock propagado a grupo con ${nuevoStockML}`));
              } catch (mlError: any) {
                console.log(colors.red(`      ❌ Error actualizando en ML para ${item.title}: ${mlError.message}`));
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
        // Usar $set para actualizar solo los campos necesarios
        await Orden.updateOne({ _id: ordenExistente._id }, { $set: baseOrden }, { session });
        finalOrderId = ordenExistente.orden_id;
        console.log(colors.green("   ♻️ Orden actualizada"));
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

      // Notificación admin con mensaje claro (evitar duplicados)
      try {
        // Verificar si ya existe una notificación para este payment_id con este estado
        const existingNotification = await AdminNotification.findOne({
          payment_id: paymentId?.toString?.(),
          message: { $exists: true }
        });

        // Solo crear notificación si no existe o si el estado cambió significativamente
        const shouldCreateNotification = !existingNotification || 
          (existingNotification.message && 
           !existingNotification.message.includes(paymentData.status));

        if (shouldCreateNotification) {
          const status = String(paymentData.status || '').toLowerCase()
          
          // Si el pago fue aprobado, eliminar notificaciones anteriores de "Orden iniciada" para evitar duplicados
          if (status === 'approved' && paymentId) {
            try {
              // Buscar y eliminar notificaciones "Orden iniciada" que puedan estar asociadas
              // por payment_id, order_id, o por el email del cliente (en caso de que no coincidan los IDs)
              const customerEmail = paymentData.payer?.email || metadata.customer_email;
              const deleteConditions: any[] = [
                { payment_id: paymentId?.toString?.() },
                { order_id: finalOrderId }
              ];
              
              // Si hay external_reference, también buscar por él
              if (paymentData.external_reference) {
                // Buscar órdenes con este external_reference y obtener sus order_id
                const ordenesConExternalRef = await Orden.find({ 
                  external_reference: paymentData.external_reference 
                }).select('orden_id').lean();
                if (ordenesConExternalRef.length > 0) {
                  deleteConditions.push({
                    order_id: { $in: ordenesConExternalRef.map(o => o.orden_id) }
                  });
                }
              }
              
              // Si hay email del cliente, también buscar por él (para casos donde los IDs no coincidan)
              if (customerEmail) {
                deleteConditions.push({
                  customer_email: customerEmail,
                  message: { $regex: /Orden iniciada/i }
                });
              }
              
              await AdminNotification.deleteMany({
                $or: deleteConditions,
                message: { $regex: /Orden iniciada/i }
              });
              console.log(colors.cyan(`   🗑️ Notificaciones "Orden iniciada" eliminadas para payment_id ${paymentId}`));
            } catch (delErr) {
              console.log(colors.yellow(`   ⚠️ No se pudieron eliminar notificaciones anteriores: ${delErr}`));
            }
          }
          
          const statusMap: Record<string,string> = {
            approved: 'Pago aprobado',
            pending: 'Pago pendiente',
            rejected: 'Pago rechazado',
            cancelled: 'Pago cancelado',
            refunded: 'Pago reembolsado'
          }
          const friendly = statusMap[status] || `Pago ${status}`
          const method = paymentData.payment_method_id ? String(paymentData.payment_method_id).toUpperCase() : (paymentData.payment_type_id || '')
          const amount = Number(paymentData.transaction_amount || 0)
          const curr = paymentData.currency_id || ''
          const detail = String(paymentData.status_detail || '')
          const detailMap: Record<string,string> = {
            accredited: 'acreditado',
            pending_contingency: 'en revisión',
            pending_review_manual: 'en revisión manual',
            cc_rejected_other_reason: 'motivo desconocido',
            cc_rejected_bad_filled_security_code: 'CVV incorrecto',
            cc_rejected_bad_filled_date: 'fecha inválida',
            cc_rejected_bad_filled_card_number: 'número inválido',
            cc_rejected_insufficient_amount: 'fondos insuficientes',
            cc_rejected_high_risk: 'rechazado por riesgo alto'
          }
          const friendlyDetail = detailMap[detail] || detail
          const message = `${friendly} - ${curr} ${amount}${method ? ` - método ${method}` : ''}${friendlyDetail ? ` (${friendlyDetail})` : ''}`

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
          console.log(colors.yellow(`   ⏭️  Notificación ya existe para payment_id ${paymentId}, omitiendo`));
        }
      } catch (nErr) {
        console.log(colors.yellow('⚠️ No se pudo crear notificación admin (webhook)'), nErr);
      }

    } catch (error) {
      await session.abortTransaction();
      console.error(colors.red("   ❌ Error procesando orden:"), error);
    } finally {
      session.endSession();
    }

  } catch (error: any) {
    console.error(colors.red("❌ Error en webhook:"), error);
  }
});

export default router;

