import { Router, Request, Response } from "express";
import mercadopago from "mercadopago";
import colors from "colors";
import mongoose from "mongoose";
import ProductoModel from "../models/Producto";
import Orden from "../models/Orden";
import CuponModel from "../models/Cupon";
import { getCurrentToken, updateStockInMercadoLibre, propagateStockToGroup } from "./mercadolibre";

const router = Router();

/**
 * Webhook para recibir notificaciones de MercadoPago
 * Se llama cuando hay cambios en el estado de un pago
 */
router.post("/mercadopago", async (req: Request, res: Response) => {
  try {
    // Responder inmediatamente a MercadoPago (requisito de la API)
    res.status(200).send("OK");

    const { type, data } = req.body;

    console.log(colors.blue("\n🔔 Webhook de MercadoPago recibido"));
    console.log(colors.blue(`   Type: ${type}`));
    console.log(colors.blue(`   Data: ${JSON.stringify(data, null, 2)}`));

    // Solo procesar notificaciones de pagos
    if (type !== "payment") {
      console.log(colors.yellow("   ⚠️  No es una notificación de pago, ignorando"));
      return;
    }

    const paymentId = data.id;

    if (!paymentId) {
      console.log(colors.red("   ❌ No se recibió payment ID"));
      return;
    }

    // Obtener información completa del pago
    console.log(colors.yellow(`   📋 Consultando pago ${paymentId}...`));
    
    const payment = await mercadopago.payment.findById(paymentId);
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

    // Solo procesar pagos aprobados
    if (paymentData.status !== "approved") {
      console.log(colors.yellow(`   ⚠️  Pago no aprobado (${paymentData.status}), no se procesa`));
      return;
    }

    // Verificar si ya procesamos este pago
    const ordenExistente = await Orden.findOne({ payment_id: paymentId.toString() });
    
    if (ordenExistente) {
      console.log(colors.yellow(`   ⚠️  Pago ya procesado anteriormente`));
      return;
    }

    console.log(colors.green("   ✅ Pago aprobado, procesando orden..."));

    // Iniciar transacción de MongoDB
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Obtener items de la metadata
      const metadata = paymentData.metadata || paymentData.additional_info?.items || [];
      
      if (!metadata || metadata.length === 0) {
        console.log(colors.red("   ❌ No se encontraron items en la metadata"));
        await session.abortTransaction();
        return;
      }

      // Actualizar stock de los productos EN TU BD
      console.log(colors.yellow("   📦 Actualizando stock en BD local..."));
      
      for (const item of metadata) {
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

      // 🔥 IMPORTANTE: Actualizar stock EN MERCADOLIBRE de tus clientes
      console.log(colors.yellow("   🛍️  Actualizando stock en MercadoLibre..."));
      
      try {
        const token = await getCurrentToken();
        
        if (token) {
          console.log(colors.blue("      🔑 Token de MercadoLibre obtenido"));
          
          for (const item of metadata) {
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

      // Crear registro de la orden
      const nuevaOrden = new Orden({
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
          address: paymentData.payer?.address?.street_name || ""
        },
        
        items: metadata.map((item: any) => ({
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
      });

      await nuevaOrden.save({ session });

      // Confirmar transacción
      await session.commitTransaction();
      
      console.log(colors.green("   ✅ Orden procesada exitosamente"));
      console.log(colors.green(`   📦 Orden ID: ${nuevaOrden.orden_id}`));

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

