// 🧪 VERSIÓN TEMPORAL PARA TESTING CON UYU
// Este archivo es una copia de checkoutPro.ts pero con UYU en lugar de USD
// Usar solo para probar con tarjetas de prueba
// ELIMINAR cuando pases a producción con USD

import { Router, Request, Response } from "express";
import mercadopago from "mercadopago";
import colors from "colors";
import mongoose from "mongoose";
import ProductoModel from "../models/Producto";
import CuponModel from "../models/Cupon";

const router = Router();

const mpAccessToken = process.env.MP_ACCESS_TOKEN;

// Función de validación de cupones (igual que checkoutPro.ts)
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

    if (!cupon) return { valido: false, error: "Cupón no encontrado" };
    if (!cupon.activo) return { valido: false, error: "Este cupón no está activo" };

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
      return { valido: false, error: `El monto mínimo de compra para este cupón es $${cupon.monto_minimo_compra}` };
    }

    if (emailUsuario) {
      const vecesUsado = cupon.usuarios_usados.filter(email => email === emailUsuario).length;
      if (vecesUsado >= cupon.limite_por_usuario) {
        return { valido: false, error: "Ya has usado este cupón el máximo de veces permitidas" };
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

// 🧪 ENDPOINT TEMPORAL PARA TESTING CON UYU
router.post("/test-uyu", async (req: Request, res: Response) => {
  try {
    if (!mpAccessToken) {
      return res.status(500).json({ error: "MercadoPago no está configurado" });
    }

    const { cartItems, customerData, cupon_codigo } = req.body;

    console.log(colors.magenta("\n🧪 [MODO TEST UYU] Iniciando proceso de Checkout Pro..."));

    let totalCalculado = 0;
    const itemsValidados = [];

    for (const item of cartItems) {
      const producto = await ProductoModel.findOne({ ml_id: item.id });
      
      if (!producto) {
        return res.status(400).json({ error: `Producto no encontrado: ${item.name}` });
      }

      const precioReal = producto.price;
      const subtotal = precioReal * item.cantidad;
      totalCalculado += subtotal;

      const description = (producto.description || producto.title).substring(0, 256);
      
      itemsValidados.push({
        id: producto.ml_id,
        title: producto.title.substring(0, 255),
        description: description,
        picture_url: producto.images && producto.images[0] ? producto.images[0].url : undefined,
        quantity: item.cantidad,
        unit_price: precioReal,
        currency_id: "UYU" as const  // 🧪 TEMPORAL: UYU para testing
      });
    }

    let descuentoCupon = 0;
    if (cupon_codigo) {
      const validacionCupon = await validarCuponEnBackend(
        cupon_codigo, 
        totalCalculado, 
        customerData?.email
      );
      
      if (!validacionCupon.valido) {
        return res.status(400).json({ 
          error: `Cupón inválido: ${validacionCupon.error}`,
          cupon_rechazado: true
        });
      }
      
      descuentoCupon = validacionCupon.descuento || 0;
    }

    const totalFinal = totalCalculado - descuentoCupon;
    
    const preference = {
      items: itemsValidados,
      payer: {
        name: customerData?.name || "Cliente",
        email: customerData?.email || "cliente@example.com",
        phone: {
          area_code: "598",
          number: parseInt(customerData?.phone?.replace(/\D/g, '') || "099999999", 10)
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
      external_reference: `TEST-UYU-${Date.now()}`,
      statement_descriptor: "TIENDA TEST",
      metadata: {
        modo_test: "UYU",
        customer_email: customerData?.email,
        cupon_codigo: cupon_codigo || null
      }
    };

    const response = await mercadopago.preferences.create(preference as any);

    console.log(colors.magenta("🧪 [MODO TEST UYU] Preferencia creada"));
    console.log(colors.magenta(`   Total: $${totalFinal} UYU`));

    return res.json({
      preferenceId: response.body.id,
      init_point: response.body.init_point,
      sandbox_init_point: response.body.sandbox_init_point,
      external_reference: preference.external_reference,
      total: totalFinal,
      currency: "UYU",
      modo_test: true
    });

  } catch (error: any) {
    console.error(colors.red("❌ Error creando preferencia TEST UYU:"), error);
    return res.status(500).json({ 
      error: "Error creando la preferencia de pago",
      details: error.message
    });
  }
});

export default router;

