import { Router, Request, Response } from "express";
import mercadopago from "mercadopago";
import colors from "colors";
import mongoose from "mongoose";
import ProductoModel from "../models/Producto";
import Orden from "../models/Orden";
import CuponModel from "../models/Cupon";
import { getCurrentToken, updateStockInMercadoLibre, propagateStockToGroup } from "./mercadolibre";
import AdminNotification from "../models/AdminNotification";

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
        const rawItems = metadata.items || paymentData.additional_info?.items || [];
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
        console.log(colors.red('   ❌ No se encontraron items en metadata'));
        await session.abortTransaction();
        return;
      }
      
      if (!metadata || metadata.length === 0) {
        console.log(colors.red("   ❌ No se encontraron items en la metadata"));
        await session.abortTransaction();
        return;
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

      // Registrar uso de cupón si existe
      if (paymentData.metadata?.cupon_codigo) {
        const cupon = await CuponModel.findOne({ 
          codigo: paymentData.metadata.cupon_codigo.toUpperCase() 
        }).session(session);

        if (cupon) {
          cupon.usos_actuales += 1;
          
          if (paymentData.payer?.email) {
            cupon.usuarios_usados.push(paymentData.payer.email);
          }

          await cupon.save({ session });
          console.log(colors.green(`   🎟️ Cupón ${cupon.codigo} registrado`));
        }
      }

      // Crear o actualizar registro de la orden
      const baseOrden: any = {
        orden_id: `ORD-${Date.now()}`,
        external_reference: paymentData.external_reference,
        numero_orden: `ORD-${Date.now()}`,
        
        payment_id: paymentId.toString(),
        payment_status: paymentData.status,
        payment_status_detail: paymentData.status_detail,
        transaction_amount: paymentData.transaction_amount,
        payment_method_id: paymentData.payment_method_id,
        
        customer: {
          name: paymentData.payer?.first_name || "Cliente",
          email: paymentData.payer?.email || "cliente@example.com",
          phone: paymentData.payer?.phone?.number || "",
          address: paymentData.payer?.address?.street_name || "",
          city: paymentData.payer?.address?.city?.name || 'N/A',
          state: paymentData.payer?.address?.state?.name || 'N/A'
        },
        
        items: itemsFromMetadata.map((item: any) => ({
          product_id: item.id,
          product_name: item.title,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total_price: item.quantity * item.unit_price
        })),
        
        subtotal: paymentData.transaction_amount,
        total: paymentData.transaction_amount,
        
        cupon: paymentData.metadata?.cupon_codigo ? {
          codigo: paymentData.metadata.cupon_codigo,
          descuento: paymentData.metadata.cupon_descuento || 0
        } : undefined,
        
        date_created: new Date(),
        date_updated: new Date()
      };
      let finalOrderId: string | undefined;
      if (ordenExistente) {
        await Orden.updateOne({ _id: ordenExistente._id }, baseOrden, { session });
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

      // Notificación admin para cualquier estado
      try {
        await AdminNotification.create({
          type: 'order',
          status: 'unread',
          message: `Orden ${paymentData.status.toUpperCase()} - ${paymentData.transaction_amount} ${paymentData.currency_id}`,
          order_id: finalOrderId,
          payment_id: paymentId?.toString?.(),
          customer_email: paymentData.payer?.email || undefined,
          total: Number(paymentData.transaction_amount || 0),
          currency: paymentData.currency_id || undefined
        });
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

