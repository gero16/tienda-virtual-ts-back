import { Router, Request, Response } from "express";
import mercadopago from "mercadopago";
import colors from "colors";
import mongoose from "mongoose";
import ProductoModel from "../models/Producto";
import Orden from "../models/Orden";
import AdminNotification from "../models/AdminNotification";
import { getCurrentToken } from "./mercadolibre";
import CuponModel from "../models/Cupon";

const router = Router();

const mpAccessToken = process.env.MP_ACCESS_TOKEN;

// Función de validación de cupones
const validarCuponEnBackend = async (
  codigo: string, 
  montoCompra: number, 
  emailUsuario?: string
): Promise<{
  valido: boolean;
  error?: string;
  descuento?: number;
  cupon?: any;
}> => {
  try {
    const codigoUpperCase = codigo.toUpperCase().trim();
    const cupon = await CuponModel.findOne({ codigo: codigoUpperCase });

    if (!cupon) {
      return { valido: false, error: "Cupón no encontrado" };
    }

    if (!cupon.activo) {
      return { valido: false, error: "Este cupón no está activo" };
    }

    const ahora = new Date();
    if (cupon.fecha_inicio && ahora < cupon.fecha_inicio) {
      return { valido: false, error: "Este cupón aún no es válido" };
    }

    if (cupon.fecha_fin && ahora > cupon.fecha_fin) {
      return { valido: false, error: "Este cupón ha expirado" };
    }

    if (cupon.usos_maximos && cupon.usos_actuales >= cupon.usos_maximos) {
      return { valido: false, error: "Este cupón ha alcanzado su límite de usos" };
    }

    if (cupon.monto_minimo_compra && montoCompra < cupon.monto_minimo_compra) {
      return { 
        valido: false, 
        error: `El monto mínimo de compra para este cupón es $${cupon.monto_minimo_compra}` 
      };
    }

    if (emailUsuario) {
      const vecesUsado = cupon.usuarios_usados.filter(email => email === emailUsuario).length;
      if (vecesUsado >= cupon.limite_por_usuario) {
        return { 
          valido: false, 
          error: "Ya has usado este cupón el máximo de veces permitidas" 
        };
      }
    }

    let descuento = 0;
    if (cupon.tipo_descuento === 'porcentaje') {
      descuento = (montoCompra * cupon.valor_descuento) / 100;
    } else {
      descuento = cupon.valor_descuento;
    }

    descuento = Math.min(descuento, montoCompra);
    descuento = Math.round(descuento * 100) / 100;

    return {
      valido: true,
      descuento: descuento,
      cupon: {
        _id: cupon._id,
        codigo: cupon.codigo,
        descripcion: cupon.descripcion,
        tipo_descuento: cupon.tipo_descuento,
        valor_descuento: cupon.valor_descuento
      }
    };

  } catch (error: any) {
    console.error(colors.red("Error validando cupón:"), error);
    return { valido: false, error: "Error al validar el cupón" };
  }
};

// =====================
// Crear preferencia para Checkout Pro con USD
// =====================
router.post("/create-preference-checkout-pro", async (req: Request, res: Response) => {
  try {
    if (!mpAccessToken) {
      return res.status(500).json({ 
        error: "MercadoPago no está configurado" 
      });
    }

    const { cartItems, customerData, cupon_codigo } = req.body;

    console.log(colors.blue("\n🛒 Iniciando proceso de Checkout Pro..."));

    // ========== PASO 1: VALIDAR PRECIOS Y MONEDA ==========
    console.log(colors.yellow("💰 Validando precios desde la base de datos..."));
    
    let totalCalculado = 0;
    const itemsValidados = [];
    const targetCurrency = (process.env.TARGET_CURRENCY || 'USD').toUpperCase(); // 'USD' o 'UYU'
    const rateStr = process.env.EXCHANGE_RATE_UYU_USD || process.env.UYU_TO_USD_RATE || '40';
    const UYU_TO_USD = Math.max(0.0001, Number(rateStr));
    const USD_TO_UYU = UYU_TO_USD; // si UYU_TO_USD = 40 → 1 USD = 40 UYU

    // Obtener token para consultar ML (currency por item)
    let mlToken: any = null;
    try { mlToken = await getCurrentToken(); } catch {}

    for (const item of cartItems) {
      const producto = await ProductoModel.findOne({ ml_id: item.id });
      
      if (!producto) {
        return res.status(400).json({ 
          error: `Producto no encontrado: ${item.name}` 
        });
      }

      if (producto.status === 'paused') {
        return res.status(400).json({ 
          error: `El producto "${producto.title}" no está disponible` 
        });
      }

      if (producto.available_quantity < item.cantidad) {
        return res.status(400).json({ 
          error: `Stock insuficiente para "${producto.title}". Disponible: ${producto.available_quantity}` 
        });
      }

      // Detectar moneda real del item en ML (si es posible)
      let itemCurrency: 'USD' | 'UYU' = 'USD';
      try {
        if (mlToken?.access_token) {
          const r = await fetch(`https://api.mercadolibre.com/items/${producto.ml_id}?attributes=currency_id,price`, {
            headers: { Authorization: `Bearer ${mlToken.access_token}` }
          } as any);
          if (r.ok) {
            const d: any = await r.json();
            if (d?.currency_id === 'UYU' || d?.currency_id === 'USD') {
              itemCurrency = d.currency_id;
            }
          }
        }
      } catch {}

      const precioFuente = producto.price; // precio almacenado (mismo número que ML)
      // Convertir a moneda objetivo
      let unitPriceTarget = precioFuente;
      if (targetCurrency === 'USD') {
        // Si el item está en UYU, convertir a USD
        if (itemCurrency === 'UYU') unitPriceTarget = Math.round((precioFuente / UYU_TO_USD) * 100) / 100;
      } else if (targetCurrency === 'UYU') {
        // Si el item está en USD, convertir a UYU
        if (itemCurrency === 'USD') unitPriceTarget = Math.round((precioFuente * USD_TO_UYU) * 100) / 100;
      }

      const subtotal = unitPriceTarget * item.cantidad;
      totalCalculado += subtotal;

      console.log(colors.blue(`   ✅ ${item.name}`));
      console.log(colors.blue(`      Moneda ML: ${itemCurrency} → Objetivo: ${targetCurrency}`));
      console.log(colors.blue(`      Precio: ${unitPriceTarget} ${targetCurrency} x ${item.cantidad} = ${subtotal} ${targetCurrency}`));

      // Limitar descripción a 256 caracteres (requisito de MercadoPago)
      const description = (producto.description || producto.title).substring(0, 256);
      
      itemsValidados.push({
        id: producto.ml_id,
        title: producto.title.substring(0, 255), // También limitar título por seguridad
        description: description,
        picture_url: producto.images && producto.images[0] ? producto.images[0].url : undefined,
        quantity: item.cantidad,
        unit_price: unitPriceTarget,
        currency_id: targetCurrency as any
      });
    }

    console.log(colors.cyan(`💰 Total calculado: ${totalCalculado} ${targetCurrency}`));

    // ========== PASO 2: VALIDAR CUPÓN ==========
    let descuentoCupon = 0;
    let cuponValidado: any = null;

    if (cupon_codigo) {
      console.log(colors.yellow(`🎟️ Validando cupón: ${cupon_codigo}...`));
      
      const emailCliente = customerData?.email;
      const validacionCupon = await validarCuponEnBackend(
        cupon_codigo, 
        totalCalculado, 
        emailCliente
      );
      
      if (!validacionCupon.valido) {
        return res.status(400).json({ 
          error: `Cupón inválido: ${validacionCupon.error}`,
          cupon_rechazado: true
        });
      }
      
      descuentoCupon = validacionCupon.descuento || 0;
      cuponValidado = validacionCupon.cupon;
      
      console.log(colors.green(`✅ Cupón validado: ${cupon_codigo}`));
      console.log(colors.green(`   Descuento: $${descuentoCupon} USD`));
    }

    // ========== PASO 3: CALCULAR TOTAL FINAL ==========
    const totalFinal = totalCalculado - descuentoCupon;
    console.log(colors.cyan(`💵 Total final: ${totalFinal} ${targetCurrency}`));

    if (totalFinal <= 0) {
      return res.status(400).json({ 
        error: "El total no puede ser menor o igual a cero" 
      });
    }

    // ========== PASO 4: CREAR PREFERENCIA DE MERCADOPAGO ==========
    console.log(colors.yellow("📝 Creando preferencia de MercadoPago..."));

    const external_reference = `ORDER-${Date.now()}`;
    
    const preference = {
      items: itemsValidados,
      payer: {
        name: customerData?.name || "Cliente",
        email: customerData?.email || "cliente@example.com",
        phone: {
          area_code: "598",
          number: parseInt(customerData?.phone?.replace(/\D/g, '') || "099999999", 10) // Convertir a número
        },
        address: {
          street_name: customerData?.address || "Dirección",
          street_number: 1,
          zip_code: "11000"
        }
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'https://mercado-libre-roan.vercel.app'}/payment-success`,
        failure: `${process.env.FRONTEND_URL || 'https://mercado-libre-roan.vercel.app'}/payment-failure`,
        pending: `${process.env.FRONTEND_URL || 'https://mercado-libre-roan.vercel.app'}/payment-pending`
      },
      auto_return: "approved" as const,
      external_reference: external_reference,
      statement_descriptor: "TIENDA VIRTUAL",
      // Enviar notificaciones al webhook específicamente para esta preferencia
      notification_url: process.env.MP_WEBHOOK_URL || 'https://poppy-shop-production.up.railway.app/webhook/mercadopago',
      metadata: {
        customer_email: customerData?.email,
        customer_name: customerData?.name,
        cupon_codigo: cupon_codigo || null,
        cupon_descuento: descuentoCupon,
        items_count: cartItems.length,
        // Incluir items para que el webhook pueda procesarlos
        items: itemsValidados.map(iv => ({
          id: iv.id,
          title: iv.title,
          quantity: iv.quantity,
          unit_price: iv.unit_price
        }))
      }
    };

    const response = await mercadopago.preferences.create(preference as any);

    console.log(colors.green("✅ Preferencia creada exitosamente"));
    console.log(colors.green(`   Preference ID: ${response.body.id}`));
    console.log(colors.green(`   Total: ${totalFinal} ${targetCurrency}`));
    
    // 🔍 VERIFICAR QUÉ MONEDA DEVOLVIÓ MERCADOPAGO
    const itemsEnRespuesta = response.body.items || [];
    if (itemsEnRespuesta.length > 0) {
      const monedaReal = itemsEnRespuesta[0].currency_id;
      console.log(colors.cyan(`   💱 Moneda REAL en respuesta de MP: ${monedaReal}`));
      
      if (monedaReal !== targetCurrency) {
        console.log(colors.yellow(`   ⚠️  ADVERTENCIA: Solicitaste ${targetCurrency} pero MP devolvió ${monedaReal}`));
        console.log(colors.yellow(`   ⚠️  Tu cuenta puede no soportar USD, verifica en el panel de MercadoPago`));
      }
    }

    // 🆕 Crear orden en estado pending (iniciada) para trazabilidad
    try {
      const ordenPending = await Orden.create({
        orden_id: `ORD-${Date.now()}`,
        external_reference,
        numero_orden: `ORD-${Date.now()}`,
        payment_id: response.body.id?.toString?.() || 'N/A',
        payment_status: 'pending',
        payment_status_detail: 'preference_created',
        transaction_amount: totalFinal,
        payment_method_id: 'checkout_pro',
        installments: 1,
        customer: {
          name: customerData?.name || 'Cliente',
          email: customerData?.email || 'cliente@example.com',
          phone: customerData?.phone || '',
          address: customerData?.address || '',
          city: customerData?.city || 'N/A',
          state: customerData?.state || 'N/A'
        },
        items: itemsValidados.map(iv => ({
          product_id: iv.id,
          product_name: iv.title,
          quantity: iv.quantity,
          unit_price: iv.unit_price,
          total_price: iv.quantity * iv.unit_price
        })),
        subtotal: totalFinal,
        descuento_cupon: descuentoCupon,
        cupon_aplicado: cuponValidado ? {
          codigo: cuponValidado.codigo,
          descripcion: cuponValidado.descripcion,
          tipo: cuponValidado.tipo_descuento,
          valor: cuponValidado.valor_descuento,
          descuento_total: descuentoCupon
        } : undefined,
        total: totalFinal,
        currency: targetCurrency,
        status: 'pending',
        notes: `Checkout Pro preference created. pref_id=${response.body.id}`
      });
      console.log(colors.green('💾 Orden pending registrada (preference_created)'));

      // Notificación admin
      try {
        await AdminNotification.create({
          type: 'order',
          status: 'unread',
          message: `Orden iniciada (Checkout Pro) - ${targetCurrency} ${totalFinal} - pref ${response.body.id}`,
          order_id: ordenPending.orden_id,
          payment_id: response.body.id?.toString?.(),
          customer_email: customerData?.email || undefined,
          total: totalFinal,
          currency: targetCurrency
        });
      } catch (nErr) {
        console.log(colors.yellow('⚠️ No se pudo crear notificación admin (pending)'), nErr);
      }
    } catch (ordErr) {
      console.log(colors.yellow('⚠️ No se pudo registrar orden pending'), ordErr);
    }

    return res.json({
      preferenceId: response.body.id,
      init_point: response.body.init_point,
      sandbox_init_point: response.body.sandbox_init_point,
      external_reference: external_reference,
      total: totalFinal,
      currency: targetCurrency,
      currency_real: itemsEnRespuesta[0]?.currency_id || targetCurrency, // Moneda real que devolvió MP
      items: itemsValidados.map(item => ({
        id: item.id,
        title: item.title,
        quantity: item.quantity,
        unit_price: item.unit_price
      }))
    });

  } catch (error: any) {
    console.error(colors.red("❌ Error creando preferencia:"), error);
    return res.status(500).json({ 
      error: "Error creando la preferencia de pago",
      details: error.message
    });
  }
});

export default router;

