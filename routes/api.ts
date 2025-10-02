import mercadopago from "mercadopago";
import express, { Router, Request, Response } from "express";
import colors from "colors";
import ProductoModel from "../models/Producto";
import Orden from "../models/Orden"; // 🆕 Importar el modelo de Orden
import { getCurrentToken, updateStockInMercadoLibre, getCurrentStockFromMercadoLibre } from "./mercadolibre"; // 🆕 Importar funciones de ML
import { ClienteService } from "../services/clienteService"; // 🆕 Importar servicio de clientes
import Variante from "../models/Variante"; // 🆕 Importar el modelo de Variante

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
      external_reference
    } = req.body;

    // Validar datos requeridos
    if (!transaction_amount || !token || !payment_method_id) {
      return res.status(400).json({ 
        error: "Faltan datos requeridos: transaction_amount, token, payment_method_id" 
      });
    }

    console.log(colors.blue("💳 Procesando pago con Payment Brick..."));
    console.log(colors.blue(`💰 Monto: $${transaction_amount}`));
    console.log(colors.blue(`💳 Método: ${payment_method_id}`));

    // Crear el objeto de pago para MercadoPago
    const paymentData = {
      transaction_amount: Number(transaction_amount),
      token: token,
      description: description || "Pago desde tienda virtual",
      installments: Number(installments) || 1,
      payment_method_id: payment_method_id,
      payer: {
        email: payer?.email || "test@example.com",
        identification: payer?.identification || {
          type: "DNI",
          number: "12345678"
        }
      }
    };

    // Procesar el pago con MercadoPago
    const response = await mercadopago.payment.save(paymentData);
    
    console.log(colors.green("✅ Pago procesado exitosamente:"));
    console.log(colors.green(`   ID: ${response.body.id}`));
    console.log(colors.green(`   Status: ${response.body.status}`));
    console.log(colors.green(`   Status Detail: ${response.body.status_detail}`));

    // 🆕 FUNCIONES DE TRANSFORMACIÓN DE DATOS
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

    // 🔧 TRANSFORMAR ITEMS ANTES DE USAR - MOVER FUERA DEL TRY
    const transformedItems = await transformItemsData(items);

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
        
        // Productos comprados - USAR LOS ITEMS TRANSFORMADOS
        items: transformedItems,
        
        // Totales
        subtotal: transaction_amount,
        total: transaction_amount,
        currency: 'UYU',
        
        // Fechas
        date_created: new Date(),
        date_approved: response.body.date_approved ? new Date(response.body.date_approved) : undefined,
        
        // Estado
        status: response.body.status === 'approved' ? 'approved' : 'pending'
      };

      const nuevaOrden = new Orden(ordenData);
      await nuevaOrden.save();
      
      console.log(colors.green("💾 Orden guardada en la base de datos:"));
      
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

    // ✅ ACTUALIZAR STOCK EN MERCADOLIBRE - USAR ITEMS TRANSFORMADOS
    if (response.body.status === 'approved' || response.body.status === 'rejected' || response.body.status === 'pending') {
      console.log(colors.green("✅ Procesando actualización de stock en MercadoLibre..."));
      console.log(colors.blue(`   Status del pago: ${response.body.status}`));
      
      try {
        const token = await getCurrentToken();
        if (token) {
          console.log(colors.blue("   🔑 Token de ML obtenido, actualizando stock..."));
          
          // 🔧 USAR transformedItems EN LUGAR DE items
          for (const item of transformedItems) {
            try {
              // 🔧 OBTENER STOCK ACTUAL DESDE MERCADOLIBRE
              const currentStock = await getCurrentStockFromMercadoLibre(item.product_id, token.access_token);
              
              // 🔧 CALCULAR NUEVO STOCK RESTANDO LA CANTIDAD COMPRADA
              const newStock = Math.max(0, currentStock - item.quantity);
              
            console.log(colors.blue(`   📦 Producto: ${item.product_name}`));
              console.log(colors.blue(`   📊 Stock actual: ${currentStock} → Nuevo stock: ${newStock} (restando ${item.quantity})`));
            
            await updateStockInMercadoLibre(item.product_id, newStock, token.access_token);
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

    return res.json({
      id: response.body.id,
      status: response.body.status,
      status_detail: response.body.status_detail,
      transaction_amount: response.body.transaction_amount,
      payment_method_id: response.body.payment_method_id,
      installments: response.body.installments,
      date_approved: response.body.date_approved,
      date_created: response.body.date_created
    });

  } catch (error: any) {
    console.error(colors.red("❌ Error procesando pago:"), error);
    
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

