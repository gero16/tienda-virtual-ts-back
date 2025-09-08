import { Router, Request, Response } from "express";
import axios from "axios";
import Token from "../models/Token";
import Notificacion from "../models/Notificacion";
import Producto from "../models/Producto";
import cron from "node-cron";
import { Types } from "mongoose";
import Variante from "../models/Variante";

const router = Router();

const ML_CONFIG = {
  client_id: process.env.ML_CLIENT_ID as string,
  client_secret: process.env.ML_CLIENT_SECRET as string,
  redirect_uri: process.env.ML_REDIRECT_URI as string,
};

// -------------------- HANDLERS --------------------
interface NotificationParams {
  resource: string;
  topic: string;
  _id: string;
  accessToken: string;
}

async function processNotification({ resource, topic, _id, accessToken }: NotificationParams) {
  try {
    switch (topic) {
      case "items":
        await handleItemNotification(resource, accessToken);
        break;
      case "items_prices":
        await handlePriceNotification(resource, accessToken);
        break;
      case "orders":
        await handleOrderNotification(resource, accessToken);
        break;
      default:
        console.log(`⚠️ Topic no manejado: ${topic}`);
    }

    await Notificacion.findOneAndUpdate(
      { notification_id: _id },
      { $set: { processed: true } }
    );

  } catch (error: any) {
    await Notificacion.updateOne({ notification_id: _id }, { error: error.message });
    throw error;
  }
}

async function handlePriceNotification(resourceUrl: string, accessToken: string) {
  try {
    const fullUrl = `https://api.mercadolibre.com${resourceUrl}`;
    const { data: priceInfo } = await axios.get(fullUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const newPrice =
      priceInfo.prices?.presentation?.price || priceInfo.prices?.prices?.[0]?.amount || null;

    const itemId = resourceUrl.split("/")[2];

    console.log("💰 Cambio de precio detectado:", {
      item_id: itemId,
      new_price: newPrice,
      updated_at: new Date(),
    });

    await Producto.updateOne({ ml_id: itemId }, { price: newPrice });
  } catch (error: any) {
    if (error.response?.status === 401) {
      const freshToken = await getCurrentToken();
      if (freshToken) return handlePriceNotification(resourceUrl, freshToken.access_token);
    }
    throw error;
  }
}


// Función auxiliar para detectar cambios específicos en variantes
async function detectVariantChanges(productId: string, newVariations: any[]) {
  const producto = await Producto.findOne({ ml_id: productId }).populate('variantes');
  if (!producto) return { changes: [], summary: "Producto no encontrado" };

  const currentVariants = (producto.variantes as any[]) || [];
  const changes: string[] = [];

  // Comparar cantidad de variantes
  if (currentVariants.length !== newVariations.length) {
    changes.push(`📊 Cantidad de variantes cambió: ${currentVariants.length} → ${newVariations.length}`);
  }

  // Detectar cambios en stock
  for (const newVar of newVariations) {
    const currentVar = currentVariants.find((v: any) => v.id === newVar.id?.toString());
    if (currentVar && currentVar.stock !== newVar.available_quantity) {
      changes.push(`📦 Stock variante ${newVar.id}: ${currentVar.stock} → ${newVar.available_quantity}`);
    }
  }

  return {
    changes,
    summary: changes.length > 0 
      ? `${changes.length} cambios detectados en variantes` 
      : "No se detectaron cambios en variantes"
  };
}

async function handleItemNotification(resourceUrl: string, accessToken: string) {
  try {
    const fullUrl = `https://api.mercadolibre.com${resourceUrl}`;
    const { data: item } = await axios.get(fullUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    console.log(`🔄 Procesando notificación para item: ${item.id}`);

    // Obtener descripción por separado
    let description = "";
    try {
      const descResponse = await axios.get(`https://api.mercadolibre.com/items/${item.id}/description`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      description = descResponse.data.plain_text || "";
    } catch (error) {
      console.log("⚠️ No se pudo obtener la descripción para:", item.id);
    }

    // --- Actualizar/Crear Producto ---
    let producto = await Producto.findOneAndUpdate(
      { ml_id: item.id },
      {
        ml_id: item.id,
        title: item.title,
        price: item.price,
        available_quantity: item.available_quantity,
        status: item.status,
        // Imágenes en mejor calidad
        images: item.pictures?.map((picture: any) => ({
          id: picture.id,
          url: picture.secure_url?.replace('-I.jpg', '-O.jpg') || picture.url,
          max_size: picture.max_size
        })) || [],
        // Información adicional
        description: description,
        sold_quantity: item.sold_quantity || 0,
        warranty: item.warranty || "",
        attributes: item.attributes || [],
        tags: item.tags || [],
        category_id: item.category_id || "",
        condition: item.condition || "",
        listing_type_id: item.listing_type_id || "",
        shipping: item.shipping || {},
        health: item.health || 0,
        // Métricas
        metrics: {
          visits: item.visits || 0,
          reviews: {
            rating_average: item.reviews?.rating_average || 0,
            total: item.reviews?.total || 0
          }
        },
        // Fechas importantes
        date_created: item.date_created ? new Date(item.date_created) : new Date(),
        last_updated: item.last_updated ? new Date(item.last_updated) : new Date()
      },
      { upsert: true, new: true }
    );

    // --- 🚀 DETECCIÓN Y PROCESAMIENTO DE VARIANTES ---
    if (item.variations && item.variations.length > 0) {
      console.log(`🎨 Detectadas ${item.variations.length} variantes para producto ${item.id}`);
      
      // Obtener variantes existentes en la DB para comparar
      const variantesExistentes = await Variante.find({ product_id: producto._id });
      const idsExistentes = variantesExistentes.map(v => v.id);
      const idsNuevas = item.variations.map((v: any) => v.id?.toString()).filter(Boolean);
      
      // Detectar variantes nuevas
      const variantesNuevas = idsNuevas.filter((id: string) => !idsExistentes.includes(id));
      if (variantesNuevas.length > 0) {
        console.log(`✨ Se detectaron ${variantesNuevas.length} variantes NUEVAS:`, variantesNuevas);
      }

      // Detectar variantes eliminadas
      const variantesEliminadas = idsExistentes.filter((id: string) => !idsNuevas.includes(id));
      if (variantesEliminadas.length > 0) {
        console.log(`🗑️ Se detectaron ${variantesEliminadas.length} variantes ELIMINADAS:`, variantesEliminadas);
        await Variante.deleteMany({ id: { $in: variantesEliminadas } });
      }

      const varianteIds: string[] = [];

      // Procesar cada variante
      for (const variante of item.variations) {
        if (!variante.id) continue;

        const color = variante.attribute_combinations?.find(
          (a: any) => a.id === "COLOR"
        )?.value_name || null;

        const size = variante.attribute_combinations?.find(
          (a: any) => a.id === "SIZE"
        )?.value_name || null;

        console.log(`🔧 Procesando variante ${variante.id}: Color=${color}, Talla=${size}, Stock=${variante.available_quantity}`);

        const savedVariante = await Variante.findOneAndUpdate(
          { id: variante.id.toString() },
          {
            id: variante.id.toString(),
            product_id: producto._id,
            color,
            size,
            stock: variante.available_quantity,
            price: variante.price || item.price,
            images: variante.picture_ids?.map((id: string) => ({
              id: id,
              url: `https://http2.mlstatic.com/D_${id}-F.jpg`,
              high_quality: `https://http2.mlstatic.com/D_${id}-O.jpg`
            })) || [],
            attribute_combinations: variante.attribute_combinations?.map((attr: any) => ({
              id: attr.id,
              name: attr.name,
              value_id: attr.value_id,
              value_name: attr.value_name
            })) || []
          },
          { upsert: true, new: true }
        );

        if (savedVariante) {
          varianteIds.push(savedVariante._id.toString());
        }
      }

      // Actualizar referencias de variantes en el producto
      producto.variantes = varianteIds.map(id => new Types.ObjectId(id));
      await producto.save();

      console.log(`✅ Producto ${item.id} actualizado con ${varianteIds.length} variantes`);
    } else {
      console.log(`📦 Producto ${item.id} sin variantes`);
    }

  } catch (error: any) {
    console.error(`❌ Error en handleItemNotification para ${resourceUrl}:`, error.message);
    throw error;
  }
}
async function handleOrderNotification(resourceUrl: string, accessToken: string) {
  try {
    const fullUrl = `https://api.mercadolibre.com${resourceUrl}`;
    const { data: order } = await axios.get(fullUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    console.log(`🛒 Pedido recibido: ${order.id}`);

    // (1) Guardar la orden en DB si tenés un modelo "Order"
    // await new Order(order).save();

    // (2) Identificar qué producto se vendió
    for (const item of order.order_items) {
      const itemId = item.item.id; // ID del producto en ML

      console.log(`📦 Actualizando producto vendido: ${itemId}`);

      // (3) Refrescar el producto en tu DB llamando a handleItemNotification
      await handleItemNotification(`/items/${itemId}`, accessToken);
    }
  } catch (error: any) {
    console.error("❌ Error procesando notificación de orden:", error.response?.data || error.message);
  }
}


// -------------------- TOKEN --------------------
async function getCurrentToken() {
  let token = await Token.findOne().sort({ last_updated: -1 });
  if (token && isTokenExpired(token)) {
    console.log("🔄 Token expirado, refrescando...");
    token = await refreshToken(token);
  }
  return token;
}

function isTokenExpired(token: any) {
  const now = new Date();
  const expiresAt = new Date(token.last_updated.getTime() + token.expires_in * 1000);
  return now > expiresAt;
}

async function refreshToken(oldToken: any) {
  try {
    const response = await axios.post(
      "https://api.mercadolibre.com/oauth/token",
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: ML_CONFIG.client_id,
        client_secret: ML_CONFIG.client_secret,
        refresh_token: oldToken.refresh_token,
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const newToken = new Token({
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token || oldToken.refresh_token,
      expires_in: response.data.expires_in,
      user_id: response.data.user_id,
      scope: response.data.scope,
      last_updated: new Date(),
    });

    await newToken.save();
    console.log("✅ Token refrescado exitosamente");
    return newToken;
  } catch (error: any) {
    console.error("❌ Error refrescando token:", error.response?.data || error.message);
    throw error;
  }
}

// -------------------- AUTENTICACIÓN --------------------
router.get("/auth", (req: Request, res: Response) => {
  if (!ML_CONFIG.client_id || !ML_CONFIG.client_secret || !ML_CONFIG.redirect_uri) {
    return res.status(500).json({ error: "Configuración incompleta de MercadoLibre" });
  }

  const authUrl = `https://auth.mercadolibre.com.uy/authorization?${new URLSearchParams({
    response_type: "code",
    client_id: ML_CONFIG.client_id,
    redirect_uri: ML_CONFIG.redirect_uri,
    scope: "read_items write_items offline_access",
  }).toString()}`;

  res.redirect(authUrl);
});

router.get("/auth/callback", async (req: Request, res: Response) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send("Código de autorización no proporcionado");

    const response = await axios.post(
      "https://api.mercadolibre.com/oauth/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: ML_CONFIG.client_id,
        client_secret: ML_CONFIG.client_secret,
        code: code as string,
        redirect_uri: ML_CONFIG.redirect_uri,
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const data = response.data;
    const token = new Token({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      user_id: data.user_id,
      scope: data.scope,
    });

    await token.save();
    res.send("✅ Autenticación con Mercado Libre completada.");
  } catch (error: any) {
    console.error("❌ Error en callback ML:", error.response?.data || error.message);
    res.status(500).json({ error: "Error en autenticación con ML" });
  }
});

// -------------------- WEBHOOK --------------------
router.post("/notificaciones", async (req: Request, res: Response) => {
  try {
    const { resource, topic, user_id, _id } = req.body;
    if (!resource || !topic) return res.status(400).send("Payload inválido");

    const existing = await Notificacion.findOne({ notification_id: _id });
    if (existing) return res.status(200).send("Notificación ya procesada");

    const notificacion = new Notificacion({
      notification_id: _id,
      topic,
      resource,
      user_id,
      processed: false,
    });
    await notificacion.save();

    const token = await getCurrentToken();
    if (!token) return res.status(401).send("No autenticado");

    processNotification({ resource, topic, _id, accessToken: token.access_token })
        .catch((err) => console.error("❌ Error procesando notificación:", err));

    res.status(200).send("✅ Notificación recibida");
  } catch (error) {
    console.error("Error en /notificaciones:", error);
    res.status(500).send("Error interno");
  }
});

// -------------------- STATUS --------------------
router.get("/status", async (req: Request, res: Response) => {
  try {
    const token = await getCurrentToken();
    const lastNotifications = await Notificacion.find().sort({ createdAt: -1 }).limit(5);

    res.json({
      authenticated: !!token?.access_token,
      token_expires: token
        ? new Date(token.last_updated.getTime() + token.expires_in * 1000)
        : null,
      last_notifications: lastNotifications.map((n) => ({
        id: n.notification_id,
        topic: n.topic,
        received_at: n.createdAt,
        processed: n.processed,
      })),
    });
  } catch (error) {
    console.error("Error obteniendo estado:", error);
    res.status(500).json({ error: "Error obteniendo estado del sistema" });
  }
});

async function forceUpdateProductos() {
  const token = await getCurrentToken();
  if (!token) throw new Error("No autenticado");

  const itemsResponse = await axios.get(
    `https://api.mercadolibre.com/users/${token.user_id}/items/search`,
    { headers: { Authorization: `Bearer ${token.access_token}` } }
  );

  for (const itemId of itemsResponse.data.results) {
    try {
      const { data: itemDetail } = await axios.get(
        `https://api.mercadolibre.com/items/${itemId}`,
        { headers: { Authorization: `Bearer ${token.access_token}` } }
      );

      // Obtener descripción por separado
      let description = "";
      try {
        const descResponse = await axios.get(
          `https://api.mercadolibre.com/items/${itemId}/description`,
          { headers: { Authorization: `Bearer ${token.access_token}` } }
        );
        description = descResponse.data.plain_text || "";
      } catch (error) {
        console.log("⚠️ No se pudo obtener la descripción para:", itemId);
      }

      // --- Producto ---
      let producto = await Producto.findOneAndUpdate(
        { ml_id: itemDetail.id },
        {
          ml_id: itemDetail.id,
          title: itemDetail.title,
          price: itemDetail.price,
          available_quantity: itemDetail.available_quantity,
          status: itemDetail.status,
          // Imágenes en mejor calidad
          images: itemDetail.pictures?.map((picture: any) => ({
            id: picture.id,
            url: picture.secure_url?.replace('-I.jpg', '-O.jpg') || picture.url,
            max_size: picture.max_size
          })) || [],
          // Información adicional
          description: description,
          sold_quantity: itemDetail.sold_quantity || 0,
          warranty: itemDetail.warranty || "",
          attributes: itemDetail.attributes || [],
          tags: itemDetail.tags || [],
          category_id: itemDetail.category_id || "",
          condition: itemDetail.condition || "",
          listing_type_id: itemDetail.listing_type_id || "",
          shipping: itemDetail.shipping || {},
          health: itemDetail.health || 0,
          // Métricas
          metrics: {
            visits: itemDetail.visits || 0,
            reviews: {
              rating_average: itemDetail.reviews?.rating_average || 0,
              total: itemDetail.reviews?.total || 0
            }
          },
          // Fechas importantes
          date_created: itemDetail.date_created ? new Date(itemDetail.date_created) : new Date(),
          last_updated: itemDetail.last_updated ? new Date(itemDetail.last_updated) : new Date()
        },
        { upsert: true, new: true }
      );

      // --- Variantes ---
      if (itemDetail.variations?.length > 0 && producto) {
        const varianteIds: string[] = [];

        for (const variante of itemDetail.variations) {
          if (!variante.id) continue;

          const color = variante.attribute_combinations.find(
            (a: any) => a.id === "COLOR"
          )?.value_name || null;

          const size = variante.attribute_combinations.find(
            (a: any) => a.id === "SIZE"
          )?.value_name || null;

          const savedVariante = await Variante.findOneAndUpdate(
            { id: variante.id.toString() },
            {
              id: variante.id.toString(),
              product_id: producto._id,
              color,
              size,
              stock: variante.available_quantity,
              price: variante.price || itemDetail.price,
              images: variante.picture_ids?.map((id: string) => ({
                id: id,
                url: `https://http2.mlstatic.com/D_${id}-F.jpg`,
                high_quality: `https://http2.mlstatic.com/D_${id}-O.jpg`
              })) || [],
              attribute_combinations: variante.attribute_combinations?.map((attr: any) => ({
                id: attr.id,
                name: attr.name,
                value_id: attr.value_id,
                value_name: attr.value_name
              })) || []
            },
            { upsert: true, new: true }
          );

          if (savedVariante) {
            varianteIds.push(savedVariante._id.toString());
          }
        }

        producto.variantes = varianteIds.map(id => new Types.ObjectId(id));
        await producto.save();
      }

      console.log(`✅ Producto ${itemId} sincronizado correctamente`);
      
      // Pequeña pausa para no saturar la API
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.error(`❌ Error procesando producto ${itemId}:`, error);
    }
  }
}

router.get("/productos", async (req: Request, res: Response) => {
  try {
    const productos = await Producto.find().populate("variantes");
    res.json(productos);
  } catch (err: any) {
    res.status(500).send("❌ Error al obtener productos: " + err.message);
  }
});

router.get("/sync/force", async (req: Request, res: Response) => {
  try {
    await forceUpdateProductos();
    res.send("✅ Sincronización forzada completada");
  } catch (err: any) {
    res.status(500).send("❌ Error en sincronización: " + err.message);
  }
});

router.get('/productos/:id', async (req: Request, res: Response)  => {
  try {
    const producto = await Producto.findById(req.params.id).populate('variantes');
    res.json(producto);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener el producto' });
  }

// -------------------- NUEVOS ENDPOINTS PARA PRODUCTOS BASE --------------------

// Endpoint para obtener solo productos base (con variantes)
router.get("/productos-base", async (req: Request, res: Response) => {
  try {
    const productosBase = await Producto.find({
      es_producto_base: true,
      variantes: { $exists: true, $ne: [] }
    }).populate("variantes");
    
    res.json({
      message: "Productos base obtenidos exitosamente",
      count: productosBase.length,
      productos: productosBase
    });
  } catch (err: any) {
    res.status(500).send("❌ Error al obtener productos base: " + err.message);
  }
});

// Endpoint para obtener solo variantes individuales
router.get("/variantes", async (req: Request, res: Response) => {
  try {
    const variantes = await Variante.find().populate("product_id");
    res.json({
      message: "Variantes obtenidas exitosamente",
      count: variantes.length,
      variantes: variantes
    });
  } catch (err: any) {
    res.status(500).send("❌ Error al obtener variantes: " + err.message);
  }
});

// Endpoint para obtener productos sin variantes (productos simples)
router.get("/productos-simples", async (req: Request, res: Response) => {
  try {
    const productosSimples = await Producto.find({
      es_producto_base: true,
      variantes: { $exists: true, $size: 0 }
    });
    
    res.json({
      message: "Productos simples obtenidos exitosamente",
      count: productosSimples.length,
      productos: productosSimples
    });
  } catch (err: any) {
    res.status(500).send("❌ Error al obtener productos simples: " + err.message);
  }
});

// Endpoint para obtener estadísticas de productos
router.get("/productos/estadisticas", async (req: Request, res: Response) => {
  try {
    const totalProductos = await Producto.countDocuments();
    const productosBase = await Producto.countDocuments({ es_producto_base: true });
    const productosConVariantes = await Producto.countDocuments({
      es_producto_base: true,
      variantes: { $exists: true, $ne: [] }
    });
    const productosSimples = await Producto.countDocuments({
      es_producto_base: true,
      variantes: { $exists: true, $size: 0 }
    });
    const totalVariantes = await Variante.countDocuments();
    
    res.json({
      message: "Estadísticas de productos obtenidas exitosamente",
      estadisticas: {
        total_productos: totalProductos,
        productos_base: productosBase,
        productos_con_variantes: productosConVariantes,
        productos_simples: productosSimples,
        total_variantes: totalVariantes
      }
    });
  } catch (err: any) {
    res.status(500).send("❌ Error al obtener estadísticas: " + err.message);
  }
});

// Función para detectar y limpiar productos eliminados de MercadoLibre
async function detectAndCleanupDeletedProducts() {
  try {
    console.log("🧹 Iniciando limpieza de productos eliminados...");
    
    const token = await getCurrentToken();
    if (!token) throw new Error("No autenticado");

    // Obtener productos de MercadoLibre
    const itemsResponse = await axios.get(
      `https://api.mercadolibre.com/users/${token.user_id}/items/search`,
      { headers: { Authorization: `Bearer ${token.access_token}` } }
    );
    
    const mlProductIds = itemsResponse.data.results || [];
    console.log(`📊 Productos en MercadoLibre: ${mlProductIds.length}`);

    // Obtener productos de la base de datos
    const dbProducts = await Producto.find({});
    console.log(`📊 Productos en base de datos: ${dbProducts.length}`);

    // Encontrar productos eliminados (en DB pero no en ML)
    const dbProductIds = dbProducts.map(p => p.ml_id);
    const deletedProductIds = dbProductIds.filter(id => !mlProductIds.includes(id));

    if (deletedProductIds.length === 0) {
      console.log("✅ No se encontraron productos eliminados");
      return {
        message: "No se encontraron productos eliminados",
        deleted_count: 0,
        deleted_products: []
      };
    }

    console.log(`🗑️ Productos eliminados detectados: ${deletedProductIds.length}`);
    console.log(`📋 IDs eliminados: ${deletedProductIds.join(', ')}`);

    // Obtener información de los productos antes de eliminarlos
    const deletedProducts = await Producto.find({ ml_id: { $in: deletedProductIds } });
    const deletedProductsInfo = deletedProducts.map(p => ({
      ml_id: p.ml_id,
      title: p.title,
      _id: p._id
    }));

    // Eliminar productos de la base de datos
    const deleteResult = await Producto.deleteMany({ ml_id: { $in: deletedProductIds } });
    
    // También eliminar variantes asociadas
    const deletedProductObjectIds = deletedProducts.map(p => p._id);
    const variantesResult = await Variante.deleteMany({ 
      product_id: { $in: deletedProductObjectIds } 
    });

    console.log(`✅ Limpieza completada:`);
    console.log(`   • Productos eliminados: ${deleteResult.deletedCount}`);
    console.log(`   • Variantes eliminadas: ${variantesResult.deletedCount}`);

    return {
      message: "Limpieza completada exitosamente",
      deleted_count: deleteResult.deletedCount,
      deleted_products: deletedProductsInfo,
      deleted_variantes: variantesResult.deletedCount
    };

  } catch (error: any) {
    console.error("❌ Error en limpieza de productos:", error.message);
    throw error;
  }
}

// Endpoint manual para limpiar productos eliminados
router.post("/sync/cleanup", async (req: Request, res: Response) => {
  try {
    console.log("🧹 Iniciando limpieza manual de productos eliminados...");
    
    const result = await detectAndCleanupDeletedProducts();
    
    res.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    console.error("❌ Error en limpieza manual:", err.message);
    res.status(500).json({ 
      success: false,
      error: "Error en limpieza de productos eliminados: " + err.message 
    });
  }
});

// Endpoint para simular limpieza (solo mostrar qué se eliminaría)
router.get("/sync/cleanup/preview", async (req: Request, res: Response) => {
  try {
    console.log("👀 Generando preview de limpieza...");
    
    const token = await getCurrentToken();
    if (!token) throw new Error("No autenticado");

    // Obtener productos de MercadoLibre
    const itemsResponse = await axios.get(
      `https://api.mercadolibre.com/users/${token.user_id}/items/search`,
      { headers: { Authorization: `Bearer ${token.access_token}` } }
    );
    
    const mlProductIds = itemsResponse.data.results || [];

    // Obtener productos de la base de datos
    const dbProducts = await Producto.find({});
    const dbProductIds = dbProducts.map(p => p.ml_id);
    
    // Encontrar productos que se eliminarían
    const deletedProductIds = dbProductIds.filter(id => !mlProductIds.includes(id));
    const deletedProducts = await Producto.find({ ml_id: { $in: deletedProductIds } });
    
    const deletedProductsInfo = deletedProducts.map(p => ({
      ml_id: p.ml_id,
      title: p.title,
      _id: p._id,
      variantes_count: 0 // Se puede calcular si es necesario
    }));

    res.json({
      message: "Preview de limpieza generado",
      would_delete_count: deletedProductIds.length,
      would_delete_products: deletedProductsInfo,
      ml_products_count: mlProductIds.length,
      db_products_count: dbProducts.length,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    console.error("❌ Error en preview de limpieza:", err.message);
    res.status(500).json({ 
      error: "Error generando preview de limpieza: " + err.message 
    });
  }
});


});

// -------------------- CRON --------------------
cron.schedule("0 */3 * * *", async () => {
  try {
    console.log("⏰ Ejecutando sincronización automática con Mercado Libre... ⚡️");
    await forceUpdateProductos();
  } catch (err: any) {
    console.error("❌ Error en sincronización automática:", err.message);
  }
});

export default router;