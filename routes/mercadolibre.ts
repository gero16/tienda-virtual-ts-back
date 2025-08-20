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
// -------------------- HANDLERS --------------------
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

async function handleItemNotification(resourceUrl: string, accessToken: string) {
  const fullUrl = `https://api.mercadolibre.com${resourceUrl}`;
  const { data: item } = await axios.get(fullUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  await Producto.updateOne(
    { ml_id: item.id },
    {
      ml_id: item.id,
      title: item.title,
      price: item.price,
      available_quantity: item.available_quantity,
      status: item.status,
      main_image: item.pictures?.[0]?.url || null,
    },
    { upsert: true }
  );

  console.log(`✅ Item ${item.id} actualizado en DB`);
}

async function handleOrderNotification(resourceUrl: string, accessToken: string) {
  const fullUrl = `https://api.mercadolibre.com${resourceUrl}`;
  const { data: order } = await axios.get(fullUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  console.log(`🛒 Pedido recibido: ${order.id}`);
  // ⚡️ Aquí podrías guardarlo en la DB si querés
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
    const { data: itemDetail } = await axios.get(
      `https://api.mercadolibre.com/items/${itemId}`,
      { headers: { Authorization: `Bearer ${token.access_token}` } }
    );

    // --- Producto ---
    let producto = await Producto.findOneAndUpdate(
      { ml_id: itemDetail.id },
      {
        ml_id: itemDetail.id,
        title: itemDetail.title,
        price: itemDetail.price,
        available_quantity: itemDetail.available_quantity,
        status: itemDetail.status,
        main_image: itemDetail.thumbnail,
      },
      { upsert: true, new: true }
    );

    // --- Variantes ---
    if (itemDetail.variations?.length > 0 && producto) {
  const varianteIds: string[] = [];

  for (const variante of itemDetail.variations) {
    // 👇 NUEVO: evitar variantes sin id
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
        image: variante.picture_ids?.[0]
          ? `https://http2.mlstatic.com/D_${variante.picture_ids[0]}-O.jpg`
          : null,
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

  }
}

router.get("/productos", async (req: Request, res: Response) => {
  try {
    // Traer todos los productos y hacer populate de variantes
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
});
// -------------------- CRON --------------------
cron.schedule("0 */3 * * *", async () => {
  try {
    console.log("⏰ Ejecutando sincronización automática con Mercado Libre... ⚡️");
    await forceUpdateProductos()
  } catch (err: any) {
    console.error("❌ Error en sincronización automática:", err.message);
  }
});

export default router;
