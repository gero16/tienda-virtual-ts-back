import mercadopago from "mercadopago";
import express, { Router, Request, Response } from "express";
import colors from "colors";
import ProductoModel from "../models/products-model";

const router = Router();

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
        currency_id: item.currency_id || "UYU",
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
        currency_id: "ARS" as const,
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
        currency_id: "ARS" as const,
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