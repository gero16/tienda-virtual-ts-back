import { Router, Request, Response } from "express";
import mercadopago from "mercadopago";
import colors from "colors";
import mongoose from "mongoose";
import ProductoModel from "../models/Producto";
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

    // ========== PASO 1: VALIDAR PRECIOS ==========
    console.log(colors.yellow("💰 Validando precios desde la base de datos..."));
    
    let totalCalculado = 0;
    const itemsValidados = [];

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

      const precioReal = producto.price;
      const subtotal = precioReal * item.cantidad;
      totalCalculado += subtotal;

      console.log(colors.blue(`   ✅ ${item.name}`));
      console.log(colors.blue(`      Precio: $${precioReal} USD x ${item.cantidad} = $${subtotal} USD`));

      // Limitar descripción a 256 caracteres (requisito de MercadoPago)
      const description = (producto.description || producto.title).substring(0, 256);
      
      itemsValidados.push({
        id: producto.ml_id,
        title: producto.title.substring(0, 255), // También limitar título por seguridad
        description: description,
        picture_url: producto.images && producto.images[0] ? producto.images[0].url : undefined,
        quantity: item.cantidad,
        unit_price: precioReal,
        currency_id: "USD" as const // USD para clientes con cuentas internacionales
      });
    }

    console.log(colors.cyan(`💰 Total calculado: $${totalCalculado} USD`));

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
    console.log(colors.cyan(`💵 Total final: $${totalFinal} USD`));

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
      metadata: {
        customer_email: customerData?.email,
        customer_name: customerData?.name,
        cupon_codigo: cupon_codigo || null,
        cupon_descuento: descuentoCupon,
        items_count: cartItems.length
      }
    };

    const response = await mercadopago.preferences.create(preference as any);

    console.log(colors.green("✅ Preferencia creada exitosamente"));
    console.log(colors.green(`   Preference ID: ${response.body.id}`));
    console.log(colors.green(`   Total: $${totalFinal} USD`));
    
    // 🔍 VERIFICAR QUÉ MONEDA DEVOLVIÓ MERCADOPAGO
    const itemsEnRespuesta = response.body.items || [];
    if (itemsEnRespuesta.length > 0) {
      const monedaReal = itemsEnRespuesta[0].currency_id;
      console.log(colors.cyan(`   💱 Moneda REAL en respuesta de MP: ${monedaReal}`));
      
      if (monedaReal !== "USD") {
        console.log(colors.yellow(`   ⚠️  ADVERTENCIA: Solicitaste USD pero MP devolvió ${monedaReal}`));
        console.log(colors.yellow(`   ⚠️  Tu cuenta puede no soportar USD, verifica en el panel de MercadoPago`));
      }
    }

    return res.json({
      preferenceId: response.body.id,
      init_point: response.body.init_point,
      sandbox_init_point: response.body.sandbox_init_point,
      external_reference: external_reference,
      total: totalFinal,
      currency: "USD",
      currency_real: itemsEnRespuesta[0]?.currency_id || "USD", // Moneda real que devolvió MP
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

