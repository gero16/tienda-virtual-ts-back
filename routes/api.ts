import mercadopago from "mercadopago";
import express, { Router, Request, Response } from "express";
import colors from "colors";
import mongoose from "mongoose"; // 🆕 Para transacciones atómicas
import axios from "axios";
import ProductoModel from "../models/Producto";
import Orden from "../models/Orden"; // 🆕 Importar el modelo de Orden
import { getCurrentToken, updateStockInMercadoLibre, getCurrentStockFromMercadoLibre, propagateStockToGroup } from "./mercadolibre"; // 🆕 Importar funciones de ML
import { ClienteService } from "../services/clienteService"; // 🆕 Importar servicio de clientes
import AdminNotification from "../models/AdminNotification";
import Variante from "../models/Variante"; // 🆕 Importar el modelo de Variante
import CuponModel from "../models/Cupon"; // 🆕 Importar modelo de Cupón
import Usuario from "../models/Usuario";

const SUPER_ADMIN_EMAIL = "geronicola1696@gmail.com";

const router = Router();

// =====================
// Función de validación de cupones en backend
// =====================
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

    // Validar existencia
    if (!cupon) {
      return { valido: false, error: "Cupón no encontrado" };
    }

    // Validar estado activo
    if (!cupon.activo) {
      return { valido: false, error: "Este cupón no está activo" };
    }

    // Validar fechas
    const ahora = new Date();
    if (cupon.fecha_inicio && ahora < cupon.fecha_inicio) {
      return { valido: false, error: "Este cupón aún no es válido" };
    }

    if (cupon.fecha_fin && ahora > cupon.fecha_fin) {
      return { valido: false, error: "Este cupón ha expirado" };
    }

    // Validar usos máximos
    if (cupon.usos_maximos && cupon.usos_actuales >= cupon.usos_maximos) {
      return { valido: false, error: "Este cupón ha alcanzado su límite de usos" };
    }

    // Validar monto mínimo
    if (cupon.monto_minimo_compra && montoCompra < cupon.monto_minimo_compra) {
      return { 
        valido: false, 
        error: `El monto mínimo de compra para este cupón es $${cupon.monto_minimo_compra}` 
      };
    }

    // Validar límite por usuario
    if (emailUsuario) {
      const vecesUsado = cupon.usuarios_usados.filter(email => email === emailUsuario).length;
      if (vecesUsado >= cupon.limite_por_usuario) {
        return { 
          valido: false, 
          error: "Ya has usado este cupón el máximo de veces permitidas" 
        };
      }
    }

    // Validaciones especiales para cupón POPPYWEB
    if (codigoUpperCase === 'POPPYWEB' && emailUsuario) {
      // Verificar que el usuario esté registrado en el sistema de autenticación
      try {
        const usuario = await Usuario.findOne({ 
          email: emailUsuario.toLowerCase(),
          activo: true 
        });
        
        if (!usuario) {
          return { 
            valido: false, 
            error: "Este cupón solo es válido para usuarios registrados. Por favor regístrate primero." 
          };
        }

        // Verificar que sea su primera compra (buscar órdenes aprobadas anteriores)
        const ordenesAnteriores = await Orden.countDocuments({
          'customer.email': emailUsuario.toLowerCase(),
          status: 'approved'
        });

        if (ordenesAnteriores > 0) {
          return { 
            valido: false, 
            error: "Este cupón solo es válido para la primera compra de usuarios registrados." 
          };
        }
      } catch (error: any) {
        console.error(colors.red("Error validando usuario para cupón POPPYWEB:"), error);
        return { 
          valido: false, 
          error: "Error al validar los requisitos del cupón. Por favor intenta de nuevo." 
        };
      }
    }

    // Calcular descuento
    let descuento = 0;
    if (cupon.tipo_descuento === 'porcentaje') {
      descuento = (montoCompra * cupon.valor_descuento) / 100;
    } else {
      descuento = cupon.valor_descuento;
    }

    // Asegurar que el descuento no sea mayor al monto total
    descuento = Math.min(descuento, montoCompra);
    descuento = Math.round(descuento * 100) / 100; // Redondear a 2 decimales

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
// Funciones auxiliares de transformación
// =====================
const transformCustomerData = (customer: any) => {
  if (!customer) {
    return {
      name: "Cliente",
      email: "test@example.com",
      phone: "099999999",
      address: "Dirección no especificada",
      city: "Ciudad",
      state: "Estado"
    };
  }

  // Si phone es un objeto, extraer el número
  let phone = customer.phone;
  if (typeof phone === "object" && phone.number) {
    phone = phone.number;
  }

  // Si address es un objeto, crear una dirección string
  let address = customer.address;
  if (typeof address === "object" && address.street_name) {
    address = `${address.street_name} ${address.street_number || ""}`.trim();
  }

  return {
    name: customer.name || "Cliente",
    email: customer.email || "test@example.com",
    phone: phone || "099999999",
    address: address || "Dirección no especificada",
    city: customer.city || "Ciudad",
    state: customer.state || "Estado"
  };
};

const transformItemsData = async (items: any) => {
  if (!items || !Array.isArray(items)) {
    return [];
  }

  const transformedItems = [];
  
  for (const item of items) {
    let mlId = item.id?.toString();
    
    console.log(`🔍 Debug item:`, {
      id: item.id,
      title: item.title,
      name: item.name,
      variant_id: item.variant_id
    });
    
    // Si el item.id no es un ml_id, buscar en la base de datos
    if (item.id && !item.id.toString().startsWith('MLA')) {
      console.log(`🔍 Buscando ml_id para item ${item.id}`);
      try {
        // Buscar como producto principal
        const producto = await ProductoModel.findOne({ _id: item.id });
        console.log(`🔍 Producto encontrado:`, producto ? { _id: producto._id, ml_id: producto.ml_id } : 'No encontrado');
        if (producto && producto.ml_id) {
          mlId = producto.ml_id;
          console.log(`✅ ml_id encontrado en producto: ${mlId}`);
        } else {
          // Buscar como variante
          const variante = await Variante.findOne({ _id: item.id });
          console.log(`🔍 Variante encontrada:`, variante ? { _id: variante._id, id: variante.id } : 'No encontrada');
          if (variante && variante.id) {
            mlId = variante.id;
            console.log(`✅ ml_id encontrado en variante: ${mlId}`);
          }
        }
      } catch (dbError: any) {
        console.log(`⚠️ Error buscando ml_id para item ${item.id}:`, dbError.message);
      }
    }

    transformedItems.push({
      product_id: mlId || item.id?.toString() || `item-${Date.now()}-${Math.random()}`,
      product_name: item.title || item.name || `Producto ${transformedItems.length + 1}`,
      variant_id: item.variant_id || undefined,
      color: item.color || undefined,
      size: item.size || undefined,
      quantity: item.quantity || item.cantidad || 1,
      unit_price: item.unit_price || item.price || 0,
      total_price: (item.quantity || item.cantidad || 1) * (item.unit_price || item.price || 0)
    });
  }
  
  return transformedItems;
};

// =====================
// Tipos auxiliares (compatibles con MercadoPago)
// =====================
interface Producto {
  _id: string;
  id: string;
  name: string;
  price: number;
  image?: string;
  category: string;
  stock: number;
  cantidad: number;
}

// Usar los tipos correctos de MercadoPago
interface PreferenceItem {
  id?: string;
  title: string;
  quantity: number;
  unit_price: number;
  currency_id?: "ARS" | "BRL" | "CLP" | "MXN" | "COP" | "PEN" | "UYU" | "VES" | "USD" | "EUR";
}

interface PreferenceCreateRequest {
  purpose?: "wallet_purchase";
  items: PreferenceItem[];
  back_urls?: {
    success: string;
    failure: string;
    pending: string;
  };
  auto_return?: "approved";
}

// =====================
// Configurar credenciales con validación
// =====================
const mpAccessToken = process.env.MP_ACCESS_TOKEN;

if (!mpAccessToken) {
  console.error(colors.red("ERROR: MP_ACCESS_TOKEN environment variable is not set"));
  console.error(colors.red("Por favor, verifica tu archivo .env"));
} else {
  try {
    mercadopago.configure({
      access_token: mpAccessToken,
    });
    console.log(colors.green("✅ MercadoPago configurado correctamente"));
  } catch (error) {
    console.error(colors.red("❌ Error configurando MercadoPago:"), error);
  }
}

// =====================
// Crear preferencia
// =====================
// =====================
// Crear preferencia (sin datos del payer - son opcionales)
// =====================
router.post("/create_preference", async (req: Request, res: Response) => {
  try {
    if (!mpAccessToken) {
      return res.status(500).json({ 
        error: "MercadoPago no está configurado. MP_ACCESS_TOKEN no encontrado." 
      });
    }

    const { items, back_urls, external_reference } = req.body;

    // Validar que hay items
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ 
        error: "Se requiere un array de items" 
      });
    }

    // Procesar y validar items
    const formattedItems = items.map((item: any, index: number) => {
      const quantityNum = typeof item.quantity === 'string' ? parseFloat(item.quantity) : Number(item.quantity);
      const priceNum = typeof item.unit_price === 'string' ? parseFloat(item.unit_price) : Number(item.unit_price);
      
      if (isNaN(quantityNum) || isNaN(priceNum) || quantityNum <= 0 || priceNum <= 0) {
        throw new Error(`Item ${index + 1} tiene quantity o unit_price inválidos`);
      }

      return {
        id: item.id || `item-${Date.now()}-${index}`,
        title: item.title.toString().substring(0, 255),
        quantity: quantityNum,
        unit_price: priceNum,
        currency_id: "USD" as const, // 💵 Dólares estadounidenses
      };
    });

    // Crear la preferencia SIN datos del payer (son opcionales)
    const preference: any = {
      items: formattedItems,
      back_urls: back_urls || {
        success: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/failure`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/pending`,
      },
      auto_return: "approved",
      external_reference: external_reference || `ORDER-${Date.now()}`,
    };

    console.log("✅ Creando preferencia con items:", formattedItems.length);

    const response = await mercadopago.preferences.create(preference);
    
    return res.json({ 
      id: response.body.id,
      init_point: response.body.init_point
    });

  } catch (error: any) {
    console.error(colors.red("Error creando preferencia:"), error);
    
    if (error.response && error.response.body) {
      console.error(colors.red("Detalles del error MP:"), JSON.stringify(error.response.body, null, 2));
    }
    
    return res.status(500).json({ 
      error: "Error interno del servidor creando la preferencia",
      details: error.message
    });
  }
});

// =====================
// Crear preferencia con múltiples items
// =====================
router.post("/create_preference_multi", async (req: Request, res: Response) => {
  try {
    if (!mpAccessToken) {
      return res.status(500).json({ 
        error: "MercadoPago no está configurado" 
      });
    }

    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ 
        error: "Se requiere un array de items" 
      });
    }

    // Validar y formatear items - CORREGIDO AQUÍ
    const formattedItems = items.map((item: any, index: number) => {
      const quantityNum = typeof item.quantity === 'string' ? parseFloat(item.quantity) : Number(item.quantity);
      const priceNum = typeof item.unit_price === 'string' ? parseFloat(item.unit_price) : Number(item.unit_price);
      
      if (isNaN(quantityNum) || isNaN(priceNum) || quantityNum <= 0 || priceNum <= 0) {
        throw new Error(`Item ${index + 1} tiene quantity o price inválidos`);
      }

      return {
        id: item.id || `item-${Date.now()}-${index}`,
        title: item.title.toString().substring(0, 255),
        quantity: quantityNum, // Asegurar número
        unit_price: priceNum,  // Asegurar número
        currency_id: "USD" as const, // 💵 Dólares estadounidenses
      };
    });

    const preference = {
      items: formattedItems,
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/failure`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/pending`,
      },
      auto_return: "approved" as const,
    };

    const response = await mercadopago.preferences.create(preference);
    
    return res.json({ 
      preferenceId: response.body.id,
      init_point: response.body.init_point
    });

  } catch (error: any) {
    console.error(colors.red("Error creando preferencia múltiple:"), error);
    return res.status(500).json({ 
      error: "Error creando preferencia con múltiples items",
      details: error.message 
    });
  }
});

// =====================
// Crear preferencia desde carrito de compras
// =====================
router.post("/create_preference_cart", async (req: Request, res: Response) => {
  try {
    if (!mpAccessToken) {
      return res.status(500).json({ 
        error: "MercadoPago no está configurado" 
      });
    }

    const { cartItems } = req.body;

    if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ 
        error: "Se requiere un array de cartItems" 
      });
    }

    // Procesar items del carrito - CORREGIDO AQUÍ
    const formattedItems = cartItems.map((item: any, index: number) => {
      // Asegurar que quantity y price sean números
      const quantityNum = typeof item.cantidad === 'string' ? parseFloat(item.cantidad) : Number(item.cantidad);
      const priceNum = typeof item.price === 'string' ? parseFloat(item.price) : Number(item.price);
      
      if (isNaN(quantityNum) || isNaN(priceNum) || quantityNum <= 0 || priceNum <= 0) {
        throw new Error(`Item ${index + 1} tiene cantidad o precio inválidos`);
      }

      return {
        id: item.id || item._id || `item-${Date.now()}-${index}`,
        title: item.name || item.title || `Producto ${index + 1}`,
        quantity: quantityNum,
        unit_price: priceNum,
        currency_id: "USD" as const, // 💵 Dólares estadounidenses
      };
    });

    const preference = {
      items: formattedItems,
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/failure`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/pending`,
      },
      auto_return: "approved" as const,
    };

    const response = await mercadopago.preferences.create(preference);
    
    return res.json({ 
      preferenceId: response.body.id,
      init_point: response.body.init_point,
      sandbox_init_point: response.body.sandbox_init_point
    });

  } catch (error: any) {
    console.error(colors.red("Error creando preferencia desde carrito:"), error);
    return res.status(500).json({ 
      error: "Error creando preferencia desde carrito",
      details: error.message 
    });
  }
});

// =====================
// Webhook para recibir notificaciones de pago
// =====================
router.post("/webhook", async (req: Request, res: Response) => {
  try {
    const { type, data } = req.body;
    
    if (type === "payment") {
      const paymentId = data.id;
      console.log(colors.blue(`📦 Recibido webhook para payment ID: ${paymentId}`));
      
      return res.status(200).json({ received: true });
    }
    
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error(colors.red("Error en webhook:"), error);
    return res.status(500).json({ error: "Error procesando webhook" });
  }
});

// =====================
// Obtener información de un pago
// =====================
router.get("/payment/:id", async (req: Request, res: Response) => {
  try {
    if (!mpAccessToken) {
      return res.status(500).json({ 
        error: "MercadoPago no configurado" 
      });
    }

    const paymentId = req.params.id;
    
    // CONVERTIR EL ID A NÚMERO - SOLUCIÓN DEL ERROR
    const paymentIdNumber = Number(paymentId);
    
    if (isNaN(paymentIdNumber)) {
      return res.status(400).json({ 
        error: "ID de pago inválido, debe ser un número" 
      });
    }

    const payment = await mercadopago.payment.findById(paymentIdNumber);
    
    return res.json({
      status: payment.body.status,
      status_detail: payment.body.status_detail,
      payment_method: payment.body.payment_method_id,
      amount: payment.body.transaction_amount,
      date_created: payment.body.date_created,
      date_approved: payment.body.date_approved
    });
  } catch (error: any) {
    console.error(colors.red("Error obteniendo pago:"), error);
    return res.status(500).json({ 
      error: "Error obteniendo información del pago",
      details: error.message 
    });
  }
});

// =====================
// Métricas de performance (frontend)
// =====================
router.post("/metrics/perf", async (req: Request, res: Response) => {
  try {
    const { page, lcp, cls, measures, userAgent, url, ts } = req.body || {};
    console.log("\n📊 Métrica frontend recibida");
    if (page) console.log("   page:", page);
    if (typeof lcp === 'number') console.log("   LCP:", Math.round(lcp), "ms");
    if (typeof cls === 'number') console.log("   CLS:", cls);
    if (Array.isArray(measures)) {
      for (const m of measures) {
        if (m && typeof m.name === 'string' && typeof m.duration === 'number') {
          console.log(`   ${m.name}: ${Math.round(m.duration)}ms`);
        }
      }
    }
    if (userAgent) console.log("   UA:", String(userAgent).slice(0, 200));
    if (url) console.log("   URL:", url);
    if (ts) console.log("   ts:", ts);
    return res.status(204).send();
  } catch (e) {
    console.error("Error registrando métricas:", e);
    return res.status(500).json({ error: "Error registrando métricas" });
  }
});

// =====================
// Rutas de prueba
// =====================
router.get("/", (req: Request, res: Response) => {
  res.json({ 
    message: "API de MercadoPago funcionando",
    configured: !!mpAccessToken,
    timestamp: new Date().toISOString()
  });
});

router.get("/productos", async (req: Request, res: Response) => {
  try {
    const registros: Producto[] = await ProductoModel.find().lean();
    const registrosOrdenados = registros.sort((a, b) =>
      a.id > b.id ? 1 : a.id < b.id ? -1 : 0
    );

    let msg: string = "Registros Encontrados";
    if (!registros.length) msg = "No existen registros";

    console.log(colors.bgRed(JSON.stringify(registrosOrdenados)));

    return res.status(200).json({ msg, registros: registrosOrdenados });
  } catch (error) {
    console.error(error);
    let msg: string = "Error en la Consulta";
    return res.status(500).json({ msg });
  }
});

// =====================
// Obtener todas las órdenes
// =====================
router.get("/orders", async (req: Request, res: Response) => {
  try {
    const orders = await Orden.find()
      .sort({ date_created: -1 })
      .limit(50);
    
    return res.json({
      success: true,
      count: orders.length,
      orders
    });
  } catch (error: any) {
    console.error(colors.red("❌ Error obteniendo órdenes:"), error);
    return res.status(500).json({ 
      error: "Error obteniendo órdenes", 
      message: error.message 
    });
  }
});
// =====================
// Notificaciones Admin (listar y marcar leídas)
// =====================
import { authenticate, authorize } from '../middleware/auth'
router.get("/admin/notifications", authenticate, authorize("admin"), async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const skip = (page - 1) * pageSize;
    // @ts-ignore
    const user = (req.user || {}) as { id?: string, email?: string };
    const filter = user?.id
      ? { $or: [ { admin_id: user.id }, { admin_id: { $exists: false } } ] }
      : {};
    const [items, total] = await Promise.all([
      AdminNotification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize),
      AdminNotification.countDocuments(filter as any)
    ]);

    return res.json({ success: true, page, pageSize, total, items });
  } catch (error: any) {
    console.error(colors.red("❌ Error listando notificaciones:"), error);
    return res.status(500).json({ error: "Error listando notificaciones", message: error.message });
  }
});

router.patch("/admin/notifications/:id/read", authenticate, authorize("admin"), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    // Solo permitir marcar si es del admin o está sin asignar
    // @ts-ignore
    const user = (req.user || {}) as { id?: string };
    const notif = await AdminNotification.findById(id);
    if (!notif) return res.status(404).json({ error: "Notificación no encontrada" });
    if (notif.admin_id && user?.id && notif.admin_id !== user.id) {
      return res.status(403).json({ error: "Prohibido" });
    }
    const updated = await AdminNotification.findByIdAndUpdate(id, { status: "read", admin_id: notif.admin_id || user?.id, admin_email: (req as any).user?.email }, { new: true });
    if (!updated) return res.status(404).json({ error: "Notificación no encontrada" });
    return res.json({ success: true, item: updated });
  } catch (error: any) {
    console.error(colors.red("❌ Error marcando notificación como leída:"), error);
    return res.status(500).json({ error: "Error marcando como leída", message: error.message });
  }
});

router.delete("/admin/notifications/:id", authenticate, authorize("admin"), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    // @ts-ignore
    const user = (req.user || {}) as { email?: string; id?: string };
    if (!user?.email || user.email.toLowerCase() !== SUPER_ADMIN_EMAIL.toLowerCase()) {
      return res.status(403).json({ error: "Prohibido" });
    }
    const notif = await AdminNotification.findById(id);
    if (!notif) {
      return res.status(404).json({ error: "Notificación no encontrada" });
    }
    await AdminNotification.findByIdAndDelete(id);
    return res.json({ success: true, id });
  } catch (error: any) {
    console.error(colors.red("❌ Error eliminando notificación:"), error);
    return res.status(500).json({ error: "Error eliminando notificación", message: error.message });
  }
});

// =====================
// Obtener una orden específica
// =====================
router.get("/orders/:id", async (req: Request, res: Response) => {
  try {
    const order = await Orden.findOne({ 
      $or: [
        { orden_id: req.params.id },
        { payment_id: req.params.id },
        { external_reference: req.params.id }
      ]
    });
    
    if (!order) {
      return res.status(404).json({ 
        error: "Orden no encontrada" 
      });
    }
    
    return res.json({
      success: true,
      order
    });
  } catch (error: any) {
    console.error(colors.red("❌ Error obteniendo orden:"), error);
    return res.status(500).json({ 
      error: "Error obteniendo orden", 
      message: error.message 
    });
  }
});

// =====================
// Procesar pagos con Payment Brick
// =====================
router.post("/process_payment", async (req: Request, res: Response) => {
  // 🔒 Iniciar sesión de MongoDB para transacciones atómicas
  const session = await mongoose.startSession();
  
  try {
    if (!mpAccessToken) {
      return res.status(500).json({ 
        error: "MercadoPago no está configurado. MP_ACCESS_TOKEN no encontrado." 
      });
    }

    const { 
      transaction_amount, 
      token, 
      description, 
      installments, 
      payment_method_id, 
      payer,
      // 🆕 Nuevos campos para guardar la orden
      items,
      customer,
      external_reference,
      // 🆕 Información de cupón aplicado
      cupon_codigo,
      cupon_descuento
    } = req.body;

    // Validar datos requeridos
    if (!transaction_amount || !token || !payment_method_id) {
      // Registrar intento de orden aunque falten datos
      try {
        const ordenIntento = new Orden({
          orden_id: `ORD-${Date.now()}`,
          external_reference: external_reference || `ORDER-${Date.now()}`,
          numero_orden: `ORD-${Date.now()}`,
          payment_id: 'N/A',
          payment_status: 'cancelled',
          payment_status_detail: 'missing_required_fields',
          transaction_amount: Number(transaction_amount || 0),
          payment_method_id: String(payment_method_id || ''),
          installments: Number(installments || 1),
          customer: transformCustomerData(customer),
          items: Array.isArray(items) ? items.map((it: any, index: number) => ({
            product_id: (it.product_id || it.id || `item-${index}`).toString(),
            product_name: (it.product_name || it.title || it.name || `Producto ${index + 1}`).toString(),
            quantity: Number(it.quantity || it.cantidad || 1),
            unit_price: Number(it.unit_price || it.price || 0),
            total_price: Number(it.quantity || it.cantidad || 1) * Number(it.unit_price || it.price || 0)
          })) : [],
          subtotal: Number(transaction_amount || 0),
          descuento_cupon: 0,
          total: Number(transaction_amount || 0),
          currency: 'UYU',
          date_created: new Date(),
          status: 'cancelled',
          notes: 'Intento de pago inválido: faltan datos requeridos'
        });
        await ordenIntento.save();
        await AdminNotification.create({ type: 'order', status: 'unread', message: `Orden fallida (datos faltantes) - $${transaction_amount || 0}`, order_id: ordenIntento.orden_id, customer_email: ordenIntento.customer.email, total: ordenIntento.total, currency: ordenIntento.currency });
      } catch {}
      return res.status(400).json({ 
        error: "Faltan datos requeridos: transaction_amount, token, payment_method_id" 
      });
    }

    console.log(colors.blue("💳 Procesando pago con Payment Brick..."));
    console.log(colors.blue(`💰 Monto: $${transaction_amount}`));
    console.log(colors.blue(`💳 Método: ${payment_method_id}`));

    // 🔒 PASO 1: INICIAR TRANSACCIÓN Y VERIFICAR/RESERVAR STOCK
    console.log(colors.yellow("🔒 Iniciando transacción para reservar stock..."));
    session.startTransaction();
    
    // Transformar items antes de validar stock
    const transformedItems = await transformItemsData(items);
    
    if (!transformedItems || transformedItems.length === 0) {
      await session.abortTransaction();
      // Registrar intento con items crudos
      try {
        const ordenIntento = new Orden({
          orden_id: `ORD-${Date.now()}`,
          external_reference: external_reference || `ORDER-${Date.now()}`,
          numero_orden: `ORD-${Date.now()}`,
          payment_id: 'N/A',
          payment_status: 'cancelled',
          payment_status_detail: 'invalid_items',
          transaction_amount: Number(transaction_amount || 0),
          payment_method_id: String(payment_method_id || ''),
          installments: Number(installments || 1),
          customer: transformCustomerData(customer),
          items: Array.isArray(items) ? items.map((it: any, index: number) => ({
            product_id: (it.product_id || it.id || `item-${index}`).toString(),
            product_name: (it.product_name || it.title || it.name || `Producto ${index + 1}`).toString(),
            quantity: Number(it.quantity || it.cantidad || 1),
            unit_price: Number(it.unit_price || it.price || 0),
            total_price: Number(it.quantity || it.cantidad || 1) * Number(it.unit_price || it.price || 0)
          })) : [],
          subtotal: Number(transaction_amount || 0),
          descuento_cupon: 0,
          total: Number(transaction_amount || 0),
          currency: 'UYU',
          date_created: new Date(),
          status: 'cancelled',
          notes: 'No hay items válidos en la orden'
        });
        await ordenIntento.save();
        await AdminNotification.create({ type: 'order', status: 'unread', message: `Orden fallida (items inválidos) - $${transaction_amount || 0}`, order_id: ordenIntento.orden_id, customer_email: ordenIntento.customer.email, total: ordenIntento.total, currency: ordenIntento.currency });
      } catch {}
      return res.status(400).json({ 
        error: "No hay items válidos en la orden" 
      });
    }

    // 🔒 PASO 2: VALIDAR PRECIOS Y CALCULAR TOTAL REAL
    console.log(colors.yellow("💰 Validando precios desde la base de datos..."));
    let totalCalculado = 0;
    const itemsValidados = [];
    
    try {
      for (const item of transformedItems) {
        // Obtener producto REAL de la base de datos
        const productoReal = await ProductoModel.findOne({ ml_id: item.product_id });
        
        if (!productoReal) {
          throw new Error(`Producto no encontrado: ${item.product_name}`);
        }
        
        // Usar PRECIO REAL de la base de datos (no el del frontend)
        const precioReal = productoReal.price;
        const subtotalItem = precioReal * item.quantity;
        totalCalculado += subtotalItem;
        
        console.log(colors.blue(`   Producto: ${item.product_name}`));
        console.log(colors.blue(`   Precio en frontend: $${item.unit_price}`));
        console.log(colors.blue(`   Precio REAL en DB: $${precioReal}`));
        console.log(colors.blue(`   Subtotal: $${subtotalItem}`));
        
        // Guardar item con precio validado
        itemsValidados.push({
          ...item,
          unit_price: precioReal, // PRECIO REAL
          total_price: subtotalItem,
          precio_validado: true
        });
      }
      
      console.log(colors.cyan(`💰 Total calculado desde DB (sin descuentos): $${totalCalculado}`));
      console.log(colors.blue(`ℹ️  Validación de total final se hará después de aplicar cupón (si existe)...`));
      
    } catch (validacionError: any) {
      console.log(colors.red("❌ Error validando precios, abortando transacción..."));
      await session.abortTransaction();
      session.endSession();
      // Guardar intento
      try {
        const ordenIntento = new Orden({
          orden_id: `ORD-${Date.now()}`,
          external_reference: external_reference || `ORDER-${Date.now()}`,
          numero_orden: `ORD-${Date.now()}`,
          payment_id: 'N/A',
          payment_status: 'cancelled',
          payment_status_detail: 'price_validation_error',
          transaction_amount: Number(transaction_amount || 0),
          payment_method_id: String(payment_method_id || ''),
          installments: Number(installments || 1),
          customer: transformCustomerData(customer),
          items: transformedItems,
          subtotal: Number(transaction_amount || 0),
          descuento_cupon: 0,
          total: Number(transaction_amount || 0),
          currency: 'UYU',
          date_created: new Date(),
          status: 'cancelled',
          notes: `Error al validar precios: ${validacionError.message}`
        });
        await ordenIntento.save();
        await AdminNotification.create({ type: 'order', status: 'unread', message: `Orden fallida (precios) - $${transaction_amount || 0}`, order_id: ordenIntento.orden_id, customer_email: ordenIntento.customer.email, total: ordenIntento.total, currency: ordenIntento.currency });
      } catch {}
      return res.status(400).json({ 
        error: "Error al validar precios", 
        details: validacionError.message 
      });
    }

    // 🆕 VALIDAR CUPÓN SI SE ENVIÓ
    let descuentoCuponValidado = 0;
    let cuponValidado: any = null;
    
    if (cupon_codigo) {
      console.log(colors.yellow(`🎟️ Validando cupón: ${cupon_codigo}...`));
      
      const emailCliente = customer?.email || payer?.email;
      const validacionCupon = await validarCuponEnBackend(
        cupon_codigo, 
        totalCalculado, 
        emailCliente
      );
      
      if (!validacionCupon.valido) {
        console.log(colors.red(`❌ Cupón inválido: ${validacionCupon.error}`));
        await session.abortTransaction();
        session.endSession();
        // Guardar intento
        try {
          const ordenIntento = new Orden({
            orden_id: `ORD-${Date.now()}`,
            external_reference: external_reference || `ORDER-${Date.now()}`,
            numero_orden: `ORD-${Date.now()}`,
            payment_id: 'N/A',
            payment_status: 'cancelled',
            payment_status_detail: 'coupon_invalid',
            transaction_amount: Number(transaction_amount || 0),
            payment_method_id: String(payment_method_id || ''),
            installments: Number(installments || 1),
            customer: transformCustomerData(customer),
            items: transformedItems,
            subtotal: Number(transaction_amount || 0),
            descuento_cupon: 0,
            total: Number(transaction_amount || 0),
            currency: 'UYU',
            date_created: new Date(),
            status: 'cancelled',
            notes: `Cupón inválido: ${validacionCupon.error}`
          });
          await ordenIntento.save();
          await AdminNotification.create({ type: 'order', status: 'unread', message: `Orden fallida (cupón) - $${transaction_amount || 0}`, order_id: ordenIntento.orden_id, customer_email: ordenIntento.customer.email, total: ordenIntento.total, currency: ordenIntento.currency });
        } catch {}
        return res.status(400).json({ 
          error: `Cupón inválido: ${validacionCupon.error}`,
          cupon_rechazado: true
        });
      }
      
      descuentoCuponValidado = validacionCupon.descuento || 0;
      cuponValidado = validacionCupon.cupon;
      
      console.log(colors.green(`✅ Cupón validado: ${cupon_codigo}`));
      console.log(colors.green(`   Tipo: ${cuponValidado.tipo_descuento}`));
      console.log(colors.green(`   Valor: ${cuponValidado.valor_descuento}${cuponValidado.tipo_descuento === 'porcentaje' ? '%' : ' USD'}`));
      console.log(colors.green(`   Descuento aplicado: $${descuentoCuponValidado}`));
      
      // Aplicar descuento del cupón al total
      totalCalculado -= descuentoCuponValidado;
      totalCalculado = Math.round(totalCalculado * 100) / 100; // Redondear
      
      console.log(colors.cyan(`💰 Total después de cupón: $${totalCalculado}`));
    }
    
    // 🆕 VALIDAR TOTAL FINAL (incluyendo cupón si aplica)
    console.log(colors.yellow("⚖️ Validando total final..."));
    console.log(colors.cyan(`   Total calculado (con descuentos y cupón): $${totalCalculado}`));
    console.log(colors.cyan(`   Total recibido del frontend: $${transaction_amount}`));
    
    const diferenciaFinal = Math.abs(totalCalculado - Number(transaction_amount));
    if (diferenciaFinal > 0.10) {
      console.log(colors.red(`❌ FRAUDE DETECTADO: Diferencia de $${diferenciaFinal}`));
      await session.abortTransaction();
      session.endSession();
      // Guardar intento
      try {
        const ordenIntento = new Orden({
          orden_id: `ORD-${Date.now()}`,
          external_reference: external_reference || `ORDER-${Date.now()}`,
          numero_orden: `ORD-${Date.now()}`,
          payment_id: 'N/A',
          payment_status: 'cancelled',
          payment_status_detail: 'amount_mismatch',
          transaction_amount: Number(transaction_amount || 0),
          payment_method_id: String(payment_method_id || ''),
          installments: Number(installments || 1),
          customer: transformCustomerData(customer),
          items: transformedItems,
          subtotal: totalCalculado,
          descuento_cupon: 0,
          total: Number(transaction_amount || 0),
          currency: 'UYU',
          date_created: new Date(),
          status: 'cancelled',
          notes: `Diferencia de montos: esperado ${totalCalculado}, recibido ${transaction_amount}`
        });
        await ordenIntento.save();
        await AdminNotification.create({ type: 'order', status: 'unread', message: `Orden fallida (monto) - $${transaction_amount || 0}`, order_id: ordenIntento.orden_id, customer_email: ordenIntento.customer.email, total: ordenIntento.total, currency: ordenIntento.currency });
      } catch {}
      return res.status(400).json({ 
        error: "El monto final no coincide con el total esperado",
        total_esperado: totalCalculado,
        total_recibido: transaction_amount,
        diferencia: diferenciaFinal,
        incluye_cupon: !!cupon_codigo
      });
    }
    
    console.log(colors.green("✅ Total final validado correctamente"));
    console.log(colors.green(`   Diferencia aceptable: $${diferenciaFinal.toFixed(2)}`));
    
    // 🔒 PASO 3: VERIFICAR Y RESERVAR STOCK ATÓMICAMENTE
    console.log(colors.yellow("📦 Verificando y reservando stock..."));
    const stockReservations: Array<{ product_id: string; cantidad: number; stockAnterior: number }> = [];
    
    try {
      for (const item of itemsValidados) {
        console.log(colors.blue(`   Verificando stock para: ${item.product_name}`));
        
        // Buscar el producto y verificar stock en una operación atómica
        const producto = await ProductoModel.findOneAndUpdate(
          { 
            ml_id: item.product_id,
            available_quantity: { $gte: item.quantity } // Solo actualizar si hay stock suficiente
          },
          { 
            $inc: { available_quantity: -item.quantity } // Reducir stock atómicamente
          },
          { 
            session, // Usar la sesión de transacción
            new: true // Devolver el documento actualizado
          }
        );
        
        if (!producto) {
          // No hay stock suficiente o producto no existe
          console.log(colors.red(`   ❌ Stock insuficiente para: ${item.product_name}`));
          throw new Error(`Stock insuficiente para el producto: ${item.product_name}. Por favor actualiza tu carrito.`);
        }
        
        console.log(colors.green(`   ✅ Stock reservado: ${item.quantity} unidades de ${item.product_name}`));
        console.log(colors.green(`      Stock anterior: ${producto.available_quantity + item.quantity} → Nuevo: ${producto.available_quantity}`));
        
        // Guardar info de la reserva para posible rollback
        stockReservations.push({
          product_id: item.product_id,
          cantidad: item.quantity,
          stockAnterior: producto.available_quantity + item.quantity
        });
      }
      
      console.log(colors.green("✅ Stock reservado exitosamente para todos los productos"));
      
    } catch (stockError: any) {
      // Si falla la reserva de stock, abortar transacción
      console.log(colors.red("❌ Error reservando stock, abortando transacción..."));
      await session.abortTransaction();
      session.endSession();
      
      return res.status(400).json({ 
        error: "Error al verificar stock", 
        details: stockError.message 
      });
    }

    // 🔒 PASO 4: PROCESAR EL PAGO (Precios validados, Stock ya reservado)
    console.log(colors.yellow("💳 Procesando pago con MercadoPago..."));
    console.log(colors.green("   ✅ Usando precios validados desde la base de datos"));
    
    // Crear el objeto de pago para MercadoPago
    // NOTA: Para pagos con token, la moneda se determina automáticamente por tu cuenta de MercadoPago
    // NO se debe enviar currency_id aquí (solo en preferencias de checkout)
    const paymentData = {
      transaction_amount: Number(transaction_amount),
      token: token,
      description: description || "Pago desde tienda virtual",
      installments: Number(installments) || 1,
      payment_method_id: payment_method_id,
      payer: {
        email: payer?.email || customer?.email || "test@example.com",
        identification: payer?.identification || {
          type: "CI",  // Uruguay usa CI (Cédula de Identidad)
          number: "12345678"
        }
      }
    };

    // Mostrar datos del pago antes de enviarlo
    console.log(colors.blue("📤 Datos del pago a enviar:"));
    console.log(colors.blue(`   Monto: ${paymentData.transaction_amount}`));
    console.log(colors.blue(`   Moneda: Determinada por tu cuenta de MercadoPago (UYU por defecto en Uruguay)`));
    console.log(colors.blue(`   Token: ${paymentData.token}`));
    console.log(colors.blue(`   Método de pago: ${paymentData.payment_method_id}`));
    console.log(colors.blue(`   Email: ${paymentData.payer.email}`));
    
    // Procesar el pago con MercadoPago
    let response;
    try {
      response = await mercadopago.payment.save(paymentData);
    } catch (paymentError: any) {
      // Si el pago falla, hacer rollback del stock
      console.log(colors.red("❌ Error procesando pago, haciendo rollback de stock..."));
      console.log(colors.red("❌ Error completo de MercadoPago:"));
      console.log(colors.red(JSON.stringify(paymentError, null, 2)));
      
      // Intentar obtener más detalles del error
      if (paymentError.response) {
        console.log(colors.red("❌ Response del error:"));
        console.log(colors.red(JSON.stringify(paymentError.response, null, 2)));
      }
      
      if (paymentError.cause) {
        console.log(colors.red("❌ Causa del error:"));
        console.log(colors.red(JSON.stringify(paymentError.cause, null, 2)));
      }
      
      await session.abortTransaction();
      session.endSession();
      // Guardar intento rechazado
      try {
        const ordenIntento = new Orden({
          orden_id: `ORD-${Date.now()}`,
          external_reference: external_reference || `ORDER-${Date.now()}`,
          numero_orden: `ORD-${Date.now()}`,
          payment_id: 'N/A',
          payment_status: 'rejected',
          payment_status_detail: 'payment_error',
          transaction_amount: Number(transaction_amount || 0),
          payment_method_id: String(payment_method_id || ''),
          installments: Number(installments || 1),
          customer: transformCustomerData(customer),
          items: itemsValidados.length ? itemsValidados : transformedItems,
          subtotal: totalCalculado || Number(transaction_amount || 0),
          descuento_cupon: descuentoCuponValidado || 0,
          total: Number(transaction_amount || 0),
          currency: 'UYU',
          date_created: new Date(),
          status: 'rejected',
          notes: `Error MP: ${paymentError?.message || 'desconocido'}`,
          mp_error: paymentError?.response || paymentError?.cause || paymentError
        });
        await ordenIntento.save();
        await AdminNotification.create({ type: 'order', status: 'unread', message: `Orden rechazada (MP) - $${transaction_amount || 0}`, order_id: ordenIntento.orden_id, customer_email: ordenIntento.customer.email, total: ordenIntento.total, currency: ordenIntento.currency });
      } catch {}
      return res.status(500).json({ 
        error: "Error procesando el pago", 
        details: paymentError.message,
        mp_error: paymentError.cause || paymentError.response || paymentError
      });
    }
    
    console.log(colors.green("✅ Pago procesado exitosamente:"));
    console.log(colors.green(`   ID: ${response.body.id}`));
    console.log(colors.green(`   Status: ${response.body.status}`));
    console.log(colors.green(`   Status Detail: ${response.body.status_detail}`));
    
    // 🔒 PASO 5: DECIDIR SI HACER COMMIT O ABORT
    const ALLOW_PENDING_AS_APPROVED = String(process.env.ALLOW_PENDING_AS_APPROVED || '').toLowerCase() === 'true'
    const ALLOW_REJECTED_IN_DEV = String(process.env.ALLOW_REJECTED_IN_DEV || '').toLowerCase() === 'true'
    const isSandbox = response.body.live_mode === false

    console.log("RESPUESTA DE MERCADO LIBREEEEEEEE!!!!!!", response.body.status);

    if (response.body.status === 'rejected' || response.body.status === 'cancelled') {
      if (ALLOW_REJECTED_IN_DEV && (process.env.NODE_ENV !== 'production' || isSandbox)) {
        console.log(colors.yellow("⚠️ Modo DEV: tratando pago rechazado como pendiente para pruebas"))
        // Continuar flujo como si fuera 'pending'
      } else {
        // ❌ PAGO RECHAZADO: Hacer rollback del stock
        console.log(colors.red("❌ Pago rechazado/cancelado, haciendo rollback de stock..."));
        await session.abortTransaction();
        session.endSession();
        // Guardar orden rechazada
        try {
          const ordenIntento = new Orden({
            orden_id: `ORD-${Date.now()}`,
            external_reference: external_reference || `ORDER-${Date.now()}`,
            numero_orden: `ORD-${Date.now()}`,
            payment_id: response.body.id?.toString?.() || 'N/A',
            payment_status: response.body.status,
            payment_status_detail: response.body.status_detail,
            transaction_amount: Number(transaction_amount || 0),
            payment_method_id: String(payment_method_id || ''),
            installments: Number(installments || 1),
            customer: transformCustomerData(customer),
            items: itemsValidados.length ? itemsValidados : transformedItems,
            subtotal: totalCalculado || Number(transaction_amount || 0),
            descuento_cupon: descuentoCuponValidado || 0,
            total: Number(transaction_amount || 0),
            currency: 'UYU',
            date_created: new Date(),
            status: 'rejected',
          notes: 'Pago rechazado/cancelado',
          mp_error: response.body
          });
          await ordenIntento.save();
          await AdminNotification.create({ type: 'order', status: 'unread', message: `Orden rechazada - $${transaction_amount || 0}`, order_id: ordenIntento.orden_id, customer_email: ordenIntento.customer.email, total: ordenIntento.total, currency: ordenIntento.currency });
        } catch {}
        return res.json({
          id: response.body.id,
          status: response.body.status,
          status_detail: response.body.status_detail,
          message: "Pago no aprobado, stock restaurado"
        });
      }
    }
    
    // ✅ PAGO APROBADO o PENDIENTE: Confirmar la transacción
    console.log(colors.green("✅ Confirmando transacción de stock..."));

    // 🆕 GUARDAR LA ORDEN EN LA BASE DE DATOS
    try {
      const ordenData = {
        orden_id: `ORD-${Date.now()}`,
        external_reference: external_reference || `ORDER-${Date.now()}`,
        numero_orden: `ORD-${Date.now()}`, // 🆕 Agregar numero_orden
        
        // Información del pago
        payment_id: response.body.id.toString(),
        payment_status: response.body.status,
        payment_status_detail: response.body.status_detail,
        transaction_amount: response.body.transaction_amount,
        payment_method_id: response.body.payment_method_id,
        installments: response.body.installments,
        
        // Información del cliente
        customer: transformCustomerData(customer),
        
        // Productos comprados - USAR LOS ITEMS VALIDADOS (con precios reales)
        items: itemsValidados,
        
        // Totales
        subtotal: transaction_amount + (descuentoCuponValidado || 0), // Subtotal antes de cupón
        descuento_cupon: descuentoCuponValidado || 0,
        cupon_aplicado: cuponValidado ? {
          codigo: cuponValidado.codigo,
          descripcion: cuponValidado.descripcion,
          tipo: cuponValidado.tipo_descuento,
          valor: cuponValidado.valor_descuento,
          descuento_total: descuentoCuponValidado
        } : undefined,
        total: transaction_amount,
        currency: 'UYU',
        date_created: new Date(),
        date_approved: response.body.date_approved ? new Date(response.body.date_approved) : undefined,
        status: 'approved'
      };

      const nuevaOrden = new Orden(ordenData);
      await nuevaOrden.save();
      
      console.log(colors.green("💾 Orden guardada en la base de datos:"));
      // 🆕 Crear notificación para admin (siempre que llegue aquí)
      try {
        await AdminNotification.create({
          type: "order",
          status: "unread",
          message: `Nueva orden ${ordenData.orden_id} - ${response.body.status.toUpperCase()} - $${transaction_amount}`,
          order_id: ordenData.orden_id,
          payment_id: response.body.id?.toString?.() || undefined,
          customer_email: (customer?.email || payer?.email) as string,
          total: Number(transaction_amount),
          currency: 'UYU'
        });
      } catch (notifError) {
        console.error(colors.red("❌ Error creando notificación admin:"), notifError);
      }
      
      // 🆕 CREAR O ACTUALIZAR CLIENTE
      try {
        const customerData = transformCustomerData(customer);
        const cliente = await ClienteService.crearOActualizarDesdeOrden(customerData);
        
        // Actualizar estadísticas del cliente si el pago fue aprobado
        if (response.body.status === "approved") {
          await ClienteService.actualizarEstadisticasCompra(cliente._id.toString(), transaction_amount);
        }
        
        console.log(colors.green("👤 Cliente procesado exitosamente:"));
      console.log(colors.green(`   Cliente ID: ${cliente._id}`));
      console.log(colors.green(`   Email: ${cliente.email}`));
      console.log(colors.green(`   Nombre: ${cliente.nombre} ${cliente.apellido}`));
    } catch (clienteError) {
      console.error(colors.red("❌ Error procesando cliente:"), clienteError);
      // No fallar el pago por error de cliente, solo loggear
    }
    console.log(colors.green(`   Orden ID: ${nuevaOrden.orden_id}`));
    console.log(colors.green(`   Payment ID: ${nuevaOrden.payment_id}`));
    
  } catch (dbError) {
    console.error(colors.red("❌ Error guardando orden en la DB:"), dbError);
    // No fallar el pago por error de DB, solo loggear
  }

  // 🆕 REGISTRAR USO DEL CUPÓN SI PAGO FUE APROBADO
  if (response.body.status === 'approved' && cuponValidado) {
    try {
      const emailCliente = customer?.email || payer?.email;
      
      console.log(colors.yellow(`🎟️ Registrando uso del cupón ${cuponValidado.codigo}...`));
      
      const cupon = await CuponModel.findById(cuponValidado._id);
      if (cupon) {
        // Incrementar usos
        cupon.usos_actuales += 1;
        
        // Agregar email del usuario
        if (emailCliente) {
          cupon.usuarios_usados.push(emailCliente);
        }
        
        await cupon.save();
        
        console.log(colors.green(`✅ Uso de cupón registrado:`));
        console.log(colors.green(`   Cupón: ${cupon.codigo}`));
        console.log(colors.green(`   Usos: ${cupon.usos_actuales}/${cupon.usos_maximos || '∞'}`));
        console.log(colors.green(`   Usuario: ${emailCliente}`));
      }
    } catch (cuponError) {
      console.error(colors.red("❌ Error registrando uso de cupón:"), cuponError);
      // No fallar el pago por esto, solo loggear
    }
  }

    // ✅ ACTUALIZAR STOCK EN MERCADOLIBRE - USAR ITEMS TRANSFORMADOS
    if (response.body.status === 'approved' || response.body.status === 'rejected' || response.body.status === 'pending') {
      console.log(colors.green("✅ Procesando actualización de stock en MercadoLibre..."));
      console.log(colors.blue(`   Status del pago: ${response.body.status}`));
      
      try {
        const token = await getCurrentToken();
        if (token) {
          console.log(colors.blue("   🔑 Token de ML obtenido, actualizando stock..."));
          
          // 🔧 USAR itemsValidados (con precios validados)
          for (const item of itemsValidados) {
            try {
              // 🔧 OBTENER STOCK ACTUAL DESDE MERCADOLIBRE
              const currentStock = await getCurrentStockFromMercadoLibre(item.product_id, token.access_token);
              
              // 🔧 CALCULAR NUEVO STOCK RESTANDO LA CANTIDAD COMPRADA
              const newStock = Math.max(0, currentStock - item.quantity);
              
            console.log(colors.blue(`   📦 Producto: ${item.product_name}`));
              console.log(colors.blue(`   📊 Stock actual: ${currentStock} → Nuevo stock: ${newStock} (restando ${item.quantity})`));
            
            await updateStockInMercadoLibre(item.product_id, newStock, token.access_token);
            // 🆕 Propagar al grupo (catálogo/GTIN)
            await propagateStockToGroup(item.product_id, newStock, token.access_token);
            console.log(colors.green(`   ✅ Stock actualizado para ${item.product_name}`));
            } catch (itemError) {
              console.error(colors.red(`❌ Error procesando item ${item.product_name}:`), itemError);
              // Continuar con el siguiente item en caso de error
            }
          }
          
          console.log(colors.green("✅ Todos los stocks actualizados en MercadoLibre"));
        } else {
          console.log(colors.red("❌ No se pudo obtener token de MercadoLibre"));
        }
      } catch (stockError) {
        console.error(colors.red("❌ Error actualizando stock en ML:"), stockError);
      }
    } else {
      console.log(colors.yellow(`⚠️ Status de pago no reconocido: ${response.body.status}`));
    }

    // 🔒 PASO 6: CONFIRMAR TRANSACCIÓN (Todo salió bien)
    await session.commitTransaction();
    session.endSession();
    console.log(colors.green("✅ Transacción confirmada - Stock actualizado permanentemente"));

    return res.json({
      id: response.body.id,
      status: response.body.status,
      status_detail: response.body.status_detail,
      transaction_amount: response.body.transaction_amount,
      payment_method_id: response.body.payment_method_id,
      installments: response.body.installments,
      date_approved: response.body.date_approved,
      date_created: response.body.date_created,
      stock_reservado: true, // Indicador de que el stock fue manejado correctamente
      precios_validados: true, // Indicador de que los precios fueron validados desde DB
      total_validado: totalCalculado
    });

  } catch (error: any) {
    console.error(colors.red("❌ Error procesando pago:"), error);
    
    // 🔒 IMPORTANTE: Abortar transacción en caso de error
    try {
      await session.abortTransaction();
      session.endSession();
      console.log(colors.yellow("🔄 Transacción abortada - Stock restaurado"));
    } catch (abortError) {
      console.error(colors.red("❌ Error abortando transacción:"), abortError);
    }
    
    // Manejar errores específicos de MercadoPago
    if (error.response && error.response.data) {
      return res.status(400).json({ 
        error: "Error de MercadoPago", 
        details: error.response.data 
      });
    }
    
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: error.message 
    });
  }
});

// =====================
// Obtener información de producto (BD + MercadoLibre)
// =====================
router.get("/producto/:id/info", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // Buscar producto en BD por ml_id o _id
    let productoBD = await ProductoModel.findOne({ 
      $or: [
        { ml_id: id },
        { _id: id }
      ]
    }).lean();
    
    if (!productoBD) {
      return res.status(404).json({ 
        error: "Producto no encontrado en la base de datos" 
      });
    }
    
    // Obtener información de MercadoLibre
    let infoML: any = null;
    let errorML: string | null = null;
    
    try {
      const token = await getCurrentToken();
      if (!token) {
        errorML = "No se pudo obtener token de MercadoLibre";
      } else {
        const mlId = productoBD.ml_id;
        
        // Obtener información completa del producto desde ML
        const response = await axios.get(
          `https://api.mercadolibre.com/items/${mlId}`,
          {
            headers: { Authorization: `Bearer ${token.access_token}` }
          }
        );
        
        const mlData = response.data;
        
        // Extraer información importante de ML
        infoML = {
          ml_id: mlData.id,
          title: mlData.title,
          price: mlData.price,
          available_quantity: mlData.available_quantity, // Stock en ML
          sold_quantity: mlData.sold_quantity,
          status: mlData.status,
          condition: mlData.condition,
          permalink: mlData.permalink,
          category_id: mlData.category_id,
          listing_type_id: mlData.listing_type_id,
          health: mlData.health,
          shipping: {
            mode: mlData.shipping?.mode,
            free_shipping: mlData.shipping?.free_shipping,
            logistic_type: mlData.shipping?.logistic_type
          },
          date_created: mlData.date_created,
          last_updated: mlData.last_updated
        };
      }
    } catch (mlError: any) {
      console.error(colors.red("❌ Error obteniendo info de ML:"), mlError);
      errorML = mlError.response?.data?.message || mlError.message || "Error desconocido";
    }
    
    // Preparar respuesta con información importante
    const respuesta = {
      producto_bd: {
        _id: productoBD._id,
        ml_id: productoBD.ml_id,
        title: productoBD.title,
        price: productoBD.price,
        available_quantity: productoBD.available_quantity, // Stock en BD
        status: productoBD.status,
        seller_sku: productoBD.seller_sku,
        catalog_product_id: productoBD.catalog_product_id,
        es_catalogo: productoBD.es_catalogo,
        tipo_venta: productoBD.tipo_venta,
        stock_fisico: productoBD.stock_fisico,
        last_updated: productoBD.last_updated
      },
      producto_ml: infoML,
      comparacion_stock: {
        stock_bd: productoBD.available_quantity,
        stock_ml: infoML?.available_quantity ?? null,
        diferencia: infoML?.available_quantity !== null 
          ? (productoBD.available_quantity - infoML.available_quantity)
          : null,
        sincronizado: infoML?.available_quantity !== null 
          ? (productoBD.available_quantity === infoML.available_quantity)
          : null
      },
      error_ml: errorML
    };
    
    return res.json(respuesta);
    
  } catch (error: any) {
    console.error(colors.red("❌ Error obteniendo info de producto:"), error);
    return res.status(500).json({ 
      error: "Error obteniendo información del producto", 
      details: error.message 
    });
  }
});

// =====================
// Health check endpoint
// =====================
router.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "OK",
    mercadopago: mpAccessToken ? "configured" : "not_configured",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development"
  });
});

export default router;
// =====================
// Endpoint de prueba para actualizar stock
// =====================
router.post("/test/update-stock", async (req: Request, res: Response) => {
  try {
    const { product_id, new_stock } = req.body;
    
    if (!product_id || new_stock === undefined) {
      return res.status(400).json({ 
        error: "Se requiere product_id y new_stock" 
      });
    }

    console.log(colors.blue("🧪 Probando actualización de stock..."));
    console.log(colors.blue(`📦 Producto ID: ${product_id}`));
    console.log(colors.blue(`📊 Nuevo stock: ${new_stock}`));

    const token = await getCurrentToken();
    if (!token) {
      return res.status(500).json({ 
        error: "No se pudo obtener token de MercadoLibre" 
      });
    }

    const result = await updateStockInMercadoLibre(product_id, new_stock, token.access_token);
    
    console.log(colors.green("✅ Stock actualizado exitosamente en MercadoLibre"));
    
    return res.json({
      success: true,
      message: "Stock actualizado exitosamente",
      product_id,
      new_stock,
      mercadolibre_response: result
    });

  } catch (error: any) {
    console.error(colors.red("❌ Error en prueba de stock:"), error);
    return res.status(500).json({ 
      error: "Error actualizando stock", 
      details: error.message 
    });
  }
});

