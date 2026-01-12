import { Router, Request, Response } from "express";
import { authenticate, authorize, authorizeDestacados } from "../middleware/auth";
import axios from "axios";
import { logger } from "../utils/logger";
import Token from "../models/Token";
import Notificacion from "../models/Notificacion";
import Producto from "../models/Producto";
import AdminNotification from "../models/AdminNotification";
import cron from "node-cron";
import { Types } from "mongoose";
import Variante from "../models/Variante";
import { sendPriceInvalidEmail } from "../services/emailService";
import { buildAccentInsensitiveRegex } from "../utils/text";

const router = Router();

const ML_CONFIG = {
  client_id: process.env.ML_CLIENT_ID as string,
  client_secret: process.env.ML_CLIENT_SECRET as string,
  redirect_uri: process.env.ML_REDIRECT_URI as string,
};

// -------------------- 🔧 HELPERS ÚTILES --------------------

// Deduplicar items por ID (más robusto que Set simple)
function deduplicateItems(items: any[]) {
  const map = new Map();
  for (const item of items) {
    const id = typeof item === 'string' ? item : item.id;
    if (!map.has(id)) {
      map.set(id, item);
    }
  }
  return Array.from(map.values());
}

// Extraer campos de identidad de producto de ML
function extractIdentityFields(item: any) {
  try {
    const tags: string[] = Array.isArray(item?.tags) ? item.tags : [];
    const esCatalogo = tags.includes('catalog_listing');
    const sellerSku: string = item?.seller_custom_field || '';
    const attrs = Array.isArray(item?.attributes) ? item.attributes : [];
    const catalogFromAttr = attrs.find((a: any) =>
      (a?.id || '').toString().toUpperCase() === 'CATALOG_PRODUCT_ID'
    )?.value_id;
    const catalogId: string | null = item?.catalog_product_id || catalogFromAttr || null;
    return { catalog_product_id: catalogId, es_catalogo: esCatalogo, seller_sku: sellerSku };
  } catch {
    return { catalog_product_id: null, es_catalogo: false, seller_sku: '' };
  }
}

// 🔧 Validar y corregir permalink para asegurar que apunte al producto correcto
function getCorrectPermalink(itemDetail: any): string {
  const mlId = itemDetail.id; // Ej: "MLU693479306" o "MLU-693479306"
  
  // SIEMPRE construir el permalink manualmente para evitar enlaces a otros vendedores
  // Normalizar el ID para asegurar que tenga el formato correcto con guion
  // MLU693479306 → MLU-693479306
  const normalizedId = mlId.includes('-') ? mlId : mlId.replace(/^([A-Z]{3})(\d+)/, '$1-$2');
  
  // Construir permalink estándar que SIEMPRE apunta al producto específico del vendedor
  const correctPermalink = `https://articulo.mercadolibre.com.uy/${normalizedId}`;
  
  // Log si el permalink de la API es diferente (para debugging)
  // Comentado para reducir logs en producción
  // const apiPermalink = itemDetail.permalink;
  // if (apiPermalink && !apiPermalink.includes(mlId.replace('-', ''))) {
  //   console.log(`⚠️ Permalink de API incorrecto detectado para ${mlId}`);
  //   console.log(`   API devolvió: ${apiPermalink}`);
  //   console.log(`   Usando permalink construido: ${correctPermalink}`);
  // }
  
  return correctPermalink;
}

// Reintentos automáticos con pausa incremental
async function retryRequest(fn: () => Promise<any>, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const delay = (i + 1) * 1000;
      console.warn(`⏳ Reintento ${i + 1}/${maxRetries} después de error: ${err.message}`);
      await new Promise(r => setTimeout(r, delay));
      if (i === maxRetries - 1) throw err;
    }
  }
}

// Guardar resultados parciales (opcional, solo si existe la carpeta logs)
function savePartial(items: any[], name: string) {
  try {
    const fs = require('fs');
    const path = require('path');
    const logsDir = path.join(__dirname, '..', 'logs');
    
    // Crear carpeta logs si no existe
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    const filePath = path.join(logsDir, `sync-${name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(items, null, 2));
    console.log(`💾 Guardado parcial (${name}): ${items.length} items -> ${filePath}`);
  } catch (error) {
    console.log(`⚠️ No se pudo guardar parcial ${name}:`, error);
  }
}

interface PriceValidationContext {
  source: string;
  ml_id: string;
  metadata?: Record<string, any>;
}

async function createPriceInvalidAdminNotification(params: {
  ml_id: string;
  title?: string | null;
  reason: string | null;
  rawPrice: any;
  fallbackPrice: number | null;
  source: string;
}) {
  try {
    const { ml_id, title, reason, rawPrice, fallbackPrice, source } = params;

    const exists = await AdminNotification.findOne({
      type: "system",
      status: "unread",
      product_ml_id: ml_id,
      message: /Precio inválido/
    }).lean();

    if (exists) return;

    const humanRaw =
      rawPrice === null || typeof rawPrice === "undefined"
        ? "null"
        : Number.isNaN(Number(rawPrice))
          ? String(rawPrice)
          : `${rawPrice}`;

    const badge =
      reason === "price_zero"
        ? "🟡 PRECIO = 0"
        : reason === "price_negative"
          ? "🔴 PRECIO NEGATIVO"
          : "⛔ PRECIO INVÁLIDO";

    const messageParts = [
      badge,
      `Precio inválido detectado en ${title ? `"${title}"` : ml_id}`,
      `Motivo: ${reason ?? "desconocido"}`,
      `Valor recibido: ${humanRaw}`,
      `Origen: ${source}`,
    ];
    if (typeof fallbackPrice === "number" && fallbackPrice > 0) {
      messageParts.push(`Se mantuvo precio anterior: ${fallbackPrice}`);
    }

    await AdminNotification.create({
      type: "system",
      status: "unread",
      message: messageParts.join(" | "),
      product_ml_id: ml_id,
    });

    void sendPriceInvalidEmail({
      ml_id,
      title,
      reason,
      rawPrice,
      fallbackPrice,
      source,
    });
  } catch (error: any) {
    console.error("❌ Error creando notificación de precio inválido:", error.message || error);
  }
}

function evaluatePriceForUpdate(rawPrice: any, existingProduct: any, context: PriceValidationContext) {
  const now = new Date();
  const numeric = typeof rawPrice === 'number' ? rawPrice : Number(rawPrice);
  let reason: string | null = null;

  if (typeof numeric !== 'number' || Number.isNaN(numeric)) {
    reason = 'not_a_number';
  } else if (!Number.isFinite(numeric)) {
    reason = 'not_finite';
  } else if (numeric === 0) {
    reason = 'price_zero';
  } else if (numeric < 0) {
    reason = 'price_negative';
  }

  const override = existingProduct?.price_override;
  const overrideActive = override?.active === true;
  if (overrideActive) {
    const overrideValue =
      typeof override?.value === 'number' && override.value > 0
        ? override.value
        : (typeof existingProduct?.price === 'number' && existingProduct.price > 0
            ? existingProduct.price
            : null);

    const fields: any = {
      price_invalid: false,
      price_invalid_reason: null,
      price_invalid_at: null,
      hidden_by_price_issue: false,
    };

    if (overrideValue !== null) {
      fields.price = overrideValue;
      fields.last_valid_price = overrideValue;
    }

    const mlSnapshot = typeof numeric === 'number' && Number.isFinite(numeric) && numeric > 0 ? numeric : null;
    if (mlSnapshot !== null) {
      fields.price_override = {
        ...override,
        ml_price_last: mlSnapshot,
        ml_price_last_at: now,
      };
    } else if (override) {
      fields.price_override = {
        ...override,
      };
    }

    return {
      price: overrideValue ?? existingProduct?.price ?? 0,
      fields,
      isInvalid: false,
      reason: null,
    };
  }

  const isInvalid = !!reason;
  const fallback = typeof existingProduct?.last_valid_price === 'number' && existingProduct.last_valid_price > 0
    ? existingProduct.last_valid_price
    : (typeof existingProduct?.price === 'number' && existingProduct.price > 0 ? existingProduct.price : 0);

  const priceToPersist = isInvalid ? fallback : numeric;

  const fields: any = {
    price: priceToPersist,
    price_invalid: isInvalid,
    price_invalid_reason: isInvalid ? reason : null,
    price_invalid_at: isInvalid ? now : null,
    hidden_by_price_issue: isInvalid ? true : false,
  };

  if (!isInvalid && Number.isFinite(numeric)) {
    fields.last_valid_price = numeric;
  }
  if (!isInvalid) {
    fields.price_invalid_at = null;
  }

  if (isInvalid) {
    console.warn(`⚠️ [ML price guard] ${context.source} detectó precio inválido para ${context.ml_id}`, {
      rawPrice,
      fallback,
      reason,
      metadata: context.metadata || null,
    });

    const alreadyInvalid = existingProduct?.price_invalid === true;
    if (!alreadyInvalid) {
      void createPriceInvalidAdminNotification({
        ml_id: context.ml_id,
        title: (existingProduct?.title as string | undefined) ?? (context.metadata?.title as string | undefined) ?? null,
        reason,
        rawPrice,
        fallbackPrice: fallback > 0 ? fallback : null,
        source: context.source,
      });
    }
  }

  return {
    price: priceToPersist,
    fields,
    isInvalid,
    reason,
  };
}

const PROMOTION_TYPES = new Set([
  "deal_price",
  "promotion",
  "promotion_pack",
  "promotion_campaign",
  "campaign",
  "deal",
  "offer",
]);

function toPositiveNumber(value: any): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(numeric)) return null;
  if (numeric <= 0) return null;
  return numeric;
}

function extractActivePriceFromPricePayload(priceInfo: any) {
  const result: {
    price: number | null;
    originalPrice: number | null;
    entry: any;
    source: string;
  } = {
    price: null,
    originalPrice: null,
    entry: null,
    source: "unknown",
  };

  if (!priceInfo) return result;

  const pricesNode = priceInfo?.prices ?? priceInfo;
  const entries = Array.isArray(pricesNode?.prices)
    ? pricesNode.prices.filter((entry: any) => entry && typeof entry === "object")
    : [];

  const normalizeStatus = (status: any) => String(status ?? "").toLowerCase();
  const normalizeType = (type: any) => String(type ?? "").toLowerCase();

  const activeEntries = entries.filter(
    (entry: any) => normalizeStatus(entry?.status) === "active"
  );

  const prioritizedEntry =
    activeEntries.find((entry: any) =>
      PROMOTION_TYPES.has(normalizeType(entry?.type))
    ) || null;

  const fallbackActiveEntry =
    activeEntries.find((entry: any) => toPositiveNumber(entry?.amount) !== null) ||
    null;

  const chosenEntry = prioritizedEntry || fallbackActiveEntry || null;

  if (chosenEntry) {
    const amount = toPositiveNumber(chosenEntry.amount);
    if (amount !== null) {
      result.price = amount;
      result.entry = chosenEntry;
      result.source = "prices.prices.active";
    }

    const regular = toPositiveNumber(chosenEntry.regular_amount);
    if (regular !== null) {
      result.originalPrice = regular;
    }
  }

  const presentationNode = pricesNode?.presentation;
  if (result.price === null && presentationNode) {
    const presentationPrice = toPositiveNumber(presentationNode.price);
    if (presentationPrice !== null) {
      result.price = presentationPrice;
      result.source = "presentation";
    }
    const presentationOriginal =
      toPositiveNumber(presentationNode.original_amount) ??
      toPositiveNumber((presentationNode as any).originalPrice) ??
      toPositiveNumber(priceInfo?.original_price);
    if (presentationOriginal !== null) {
      result.originalPrice = presentationOriginal;
    }
  }

  if (result.price === null) {
    const basePrice =
      toPositiveNumber(pricesNode?.base_price) ??
      toPositiveNumber(priceInfo?.base_price);
    if (basePrice !== null) {
      result.price = basePrice;
      result.source = "base_price";
    }
  }

  if (result.price === null) {
    const fallbackPrice = toPositiveNumber(priceInfo?.price);
    if (fallbackPrice !== null) {
      result.price = fallbackPrice;
      result.source = "price";
    }
  }

  if (result.originalPrice === null) {
    const referenceEntry = Array.isArray(pricesNode?.reference_prices)
      ? pricesNode.reference_prices.find(
          (ref: any) =>
            normalizeType(ref?.type) === "standard" &&
            toPositiveNumber(ref?.amount) !== null
        )
      : null;
    if (referenceEntry) {
      const refAmount = toPositiveNumber(referenceEntry.amount);
      if (refAmount !== null) {
        result.originalPrice = refAmount;
      }
    }
  }

  if (result.originalPrice === null) {
    const directOriginal =
      toPositiveNumber(priceInfo?.original_price) ??
      toPositiveNumber(priceInfo?.prices?.original_price);
    if (directOriginal !== null) {
      result.originalPrice = directOriginal;
    }
  }

  return result;
}

function collectDealIds(entry: any): string[] | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const ids = new Set<string>();
  const add = (value: any) => {
    if (typeof value === "number" || typeof value === "string") {
      const str = String(value).trim();
      if (str) ids.add(str);
    }
  };

  add(entry.id);
  add((entry as any).deal_id);
  add((entry as any).dealId);
  add((entry as any).promotion_id);
  add((entry as any).promotionId);

  const metadata = entry.metadata;
  if (metadata && typeof metadata === "object") {
    add(metadata.deal_id);
    add(metadata.promotion_id);
    add(metadata.promotion_reference_id);
  }

  return ids.size > 0 ? Array.from(ids) : undefined;
}

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
        // console.log(`⚠️ Topic no manejado: ${topic}`); // Comentado para reducir logs
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

    const itemId = resourceUrl.split("/")[2];

    const extracted = extractActivePriceFromPricePayload(priceInfo);
    let newPrice = extracted.price;
    let mlOriginalPrice = extracted.originalPrice;

    if (newPrice === null || typeof newPrice === "undefined") {
      try {
        const { data: itemDetail } = await axios.get(
          `https://api.mercadolibre.com/items/${itemId}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const detailPrice = toPositiveNumber(itemDetail?.price);
        if (detailPrice !== null) {
          newPrice = detailPrice;
        }
        const detailOriginal = toPositiveNumber(itemDetail?.original_price);
        if (detailOriginal !== null) {
          mlOriginalPrice = detailOriginal;
        }
      } catch (detailError: any) {
        console.warn(
          `⚠️ No se pudo obtener detalle del item ${itemId} para confirmar precio:`,
          detailError.message || detailError
        );
      }
    }

    console.log("💰 Cambio de precio detectado:", {
      item_id: itemId,
      new_price: newPrice,
      ml_original_price: mlOriginalPrice,
      price_source: extracted.source,
      promotion_type: extracted.entry?.type ?? null,
      updated_at: new Date(),
    });

    const existingProduct = await Producto.findOne({ ml_id: itemId }).lean();
    const priceEvaluation = evaluatePriceForUpdate(newPrice, existingProduct, {
      source: 'price_notification',
      ml_id: itemId,
      metadata: {
        resourceUrl,
        title: existingProduct?.title,
        priceSource: extracted.source,
        promotionType: extracted.entry?.type ?? null,
        promotionId:
          extracted.entry?.promotion_id ??
          extracted.entry?.metadata?.promotion_id ??
          null,
        presentationPrice: priceInfo?.prices?.presentation?.price ?? null,
      },
    });

    const updateOps: any = { $set: priceEvaluation.fields };

    if (!priceEvaluation.isInvalid) {
      const discountActive =
        typeof mlOriginalPrice === "number" && mlOriginalPrice > priceEvaluation.price;

      if (discountActive) {
        const descuentoML: any = {
          original_price: mlOriginalPrice,
        };
        const dealIds = collectDealIds(extracted.entry);
        if (dealIds && dealIds.length > 0) {
          descuentoML.deal_ids = dealIds;
        }
        updateOps.$set.descuento_ml = descuentoML;
      } else if (
        existingProduct?.descuento_ml &&
        typeof mlOriginalPrice === "number" &&
        mlOriginalPrice <= priceEvaluation.price
      ) {
        updateOps.$unset = { ...(updateOps.$unset ?? {}), descuento_ml: "" };
      }
    }

    await Producto.updateOne({ ml_id: itemId }, updateOps);
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

// Función para calcular tiempos de entrega
function calculateDeliveryTimes(productType: string, mlHandlingTime: number | undefined) {
  const handlingTime = mlHandlingTime || 3;
  
  if (productType === "dropshipping") {
    const diasPreparacion = handlingTime;
    const diasEnvio = 7; // Default para envío internacional
    const total = diasPreparacion + diasEnvio;
    return {
      total,
      texto: `${diasPreparacion} días de preparación + ${diasEnvio} días de envío = ${total} días total`
    };
  } else {
    const diasPreparacion = handlingTime;
    const diasEnvio = 3; // Default para envío local
    const total = diasPreparacion + diasEnvio;
    return {
      total,
      texto: `${diasPreparacion} días de preparación + ${diasEnvio} días de envío = ${total} días total`
    };
  }
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
    logger.debug("⚠️ No se pudo obtener la descripción", { itemId: item.id });
  }

    // 🔍 Verificar si el producto existe y tiene descuento activo
    const productoExistente = await Producto.findOne({ ml_id: item.id });
    let precioActualizado = item.price;
    let descuentoActualizado = productoExistente?.descuento;
    
    // 🏷️ Si tiene descuento activo, recalcular precio con descuento usando el nuevo precio de ML
    if (productoExistente?.descuento?.activo) {
      console.log(`🏷️ Producto ${item.id} tiene descuento activo (${productoExistente.descuento.porcentaje}%), preservando descuento...`);
      // Actualizar precio_original con el nuevo precio de ML
      descuentoActualizado = {
        ...productoExistente.descuento,
        precio_original: item.price
      };
      // Recalcular precio con descuento
      precioActualizado = Math.round(item.price * (1 - productoExistente.descuento.porcentaje / 100) * 100) / 100;
      console.log(`   Precio ML: $${item.price} → Precio con descuento: $${precioActualizado}`);
    }

    // --- Detectar descuento nativo de MercadoLibre ---
    const descuentoML = item.original_price && item.original_price !== item.price
      ? {
          original_price: item.original_price,
          deal_ids: item.deal_ids || []
        }
      : undefined;
    
    // Si hay descuento ML, el precio rebajado de ML (item.price) debe ser el precio final
    // Solo si NO hay descuento manual, usar directamente el precio rebajado de ML
    if (descuentoML && !productoExistente?.descuento?.activo) {
      // item.price ya viene rebajado de ML, usar ese precio directamente
      precioActualizado = item.price;
    }
    
    const priceEvaluation = evaluatePriceForUpdate(precioActualizado, productoExistente, {
      source: 'item_notification',
      ml_id: item.id,
      metadata: { topic: 'items', title: item.title },
    });
    precioActualizado = priceEvaluation.price;

    // Si hay descuento ML y NO hay descuento manual, forzar el precio rebajado de ML
    if (descuentoML && !productoExistente?.descuento?.activo) {
      // Asegurar que el precio guardado sea el rebajado de ML, no el original
      priceEvaluation.fields.price = item.price;
      priceEvaluation.fields.last_valid_price = item.price;
      precioActualizado = item.price;
      console.log(`💰 Descuento ML detectado para ${item.id}: Precio original $${item.original_price} → Precio rebajado $${item.price}`);
    }

    // --- Actualizar/Crear Producto ---
    const identity = extractIdentityFields(item);
    let producto = await Producto.findOneAndUpdate(
    { ml_id: item.id },
    {
      ml_id: item.id,
      title: item.title,
      ...priceEvaluation.fields,
      descuento: descuentoActualizado,
      descuento_ml: descuentoML, // ✅ NUEVO: Descuento nativo de ML
      available_quantity: item.available_quantity,
      status: item.status,
      permalink: getCorrectPermalink(item), // ✅ AGREGADO: URL validada de la publicación
        catalog_product_id: identity.catalog_product_id,
        es_catalogo: identity.es_catalogo,
        seller_sku: identity.seller_sku,
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

        // 🆕 CALCULAR INFORMACIÓN DE DROPSHIPPING PARA LA VARIANTE
        // Usar la misma información ya calculada para el producto
        const manufacturingTime = item.sale_terms?.find((term: any) => 
          term.id === "MANUFACTURING_TIME"
        );
        
        let handlingTime = 3; // Default para stock físico
        
        if (manufacturingTime?.value_struct?.number) {
          handlingTime = manufacturingTime.value_struct.number;
        }
        
        const varianteProductType = handlingTime > 10 ? "dropshipping" : "stock_fisico";
        const varianteDeliveryTimes = calculateDeliveryTimes(varianteProductType, handlingTime);
        
        const varianteUpdateData: any = {
          id: variante.id.toString(),
          product_id: producto._id,
          color,
          size,
          stock: variante.available_quantity,
          price: variante.price || precioActualizado,
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
          })) || [],
          // 🚀 CAMPOS DE DROPSHIPPING PARA VARIANTE
          tipo_venta: varianteProductType,
          tiempo_entrega_total: varianteDeliveryTimes.total,
          tiempo_entrega_texto: varianteDeliveryTimes.texto
        };
        
        if (varianteProductType === "dropshipping") {
          varianteUpdateData.dropshipping = {
            dias_preparacion: handlingTime,
            dias_envio_estimado: 7,
            proveedor: "Proveedor externo",
            pais_origen: "Estados Unidos",
            requiere_confirmacion: true,
            costo_importacion: 0,
            tiempo_configurado_en_ml: handlingTime > 3
          };
        } else {
          varianteUpdateData.stock_fisico = {
            cantidad_disponible: variante.available_quantity || 0,
            ubicacion: "Almacén local",
            reorder_point: Math.max(1, Math.floor((variante.available_quantity || 0) * 0.2)),
            ultima_actualizacion_stock: new Date()
          };
        }

        const savedVariante = await Variante.findOneAndUpdate(
          { id: variante.id.toString() },
          varianteUpdateData,
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

    // --- 🚀 LÓGICA DE DROPSHIPPING (APLICADA A TODOS LOS PRODUCTOS) ---
    const manufacturingTime = item.sale_terms?.find((term: any) => 
      term.id === "MANUFACTURING_TIME"
    );
    
    let handlingTime = 3; // Default para stock físico
    
    if (manufacturingTime?.value_struct?.number) {
      handlingTime = manufacturingTime.value_struct.number;
    }
    
    const productType = handlingTime > 10 ? "dropshipping" : "stock_fisico";
    const deliveryTimes = calculateDeliveryTimes(productType, handlingTime);
    
    // Actualizar producto con información de dropshipping
    const updateData: any = {
      tipo_venta: productType,
      tiempo_entrega_total: deliveryTimes.total,
      tiempo_entrega_texto: deliveryTimes.texto
    };
    
    if (productType === "dropshipping") {
      updateData.dropshipping = {
        dias_preparacion: handlingTime,
        dias_envio_estimado: 7,
        proveedor: "Proveedor externo",
        pais_origen: "Estados Unidos",
        requiere_confirmacion: true,
        costo_importacion: 0,
        tiempo_configurado_en_ml: handlingTime > 3
      };
    } else {
      updateData.stock_fisico = {
        cantidad_disponible: item.available_quantity || 0,
        ubicacion: "Almacén local",
        reorder_point: Math.max(1, Math.floor((item.available_quantity || 0) * 0.2)),
        ultima_actualizacion_stock: new Date(),
        tiempo_configurado_en_ml: handlingTime > 3
      };
    }
    
    await Producto.findOneAndUpdate(
      { ml_id: item.id },
      { $set: updateData },
      { new: true }
    );
    
    console.log(`🎯 Producto ${item.id} clasificado como: ${productType} (${handlingTime} días)`);
    await Producto.findOneAndUpdate(
      { ml_id: item.id },
      { $set: updateData },
      { new: true }
    );
    

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
      user_id: token?.user_id || null,
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

  console.log(`🔍 Obteniendo TODOS los productos para user_id: ${token.user_id}`);
  
  // Implementar paginación mejorada para obtener todos los productos
  let allItems: string[] = [];
  let offset = 0;
  const limit = 50; // Máximo por página según API de ML
  let hasMore = true;
  let totalPages = 0;
  let errors: string[] = [];
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 3; // Máximo de errores consecutivos antes de parar
  const maxPages = 200; // Aumentar límite de páginas para cuentas grandes

  while (hasMore && totalPages < maxPages) {
    totalPages++;
    console.log(`📄 Obteniendo página ${totalPages} (offset: ${offset}, limit: ${limit})`);
    
    try {
      const itemsResponse = await axios.get(
        `https://api.mercadolibre.com/users/${token.user_id}/items/search?offset=${offset}&limit=${limit}`,
        { headers: { Authorization: `Bearer ${token.access_token}` } }
      );

      const pageResults = itemsResponse.data.results || [];
      console.log(`📊 Productos en página ${totalPages}: ${pageResults.length}`);
      
      if (pageResults.length === 0) {
        hasMore = false;
        console.log(`✅ No hay más productos. Total de páginas procesadas: ${totalPages - 1}`);
      } else {
        allItems = allItems.concat(pageResults);
        offset += limit;
        consecutiveErrors = 0; // Resetear contador de errores consecutivos
        
        // Pausa optimizada para respetar límites de API (300ms por página)
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    } catch (error: any) {
      console.error(`❌ Error obteniendo página ${totalPages}:`, error.message);
      errors.push(`Página ${totalPages}: ${error.message}`);
      consecutiveErrors++;
      
      // Si es un error 400, probablemente hemos llegado al límite de paginación
      if (error.response?.status === 400) {
        console.log(`⚠️ Error 400 en página ${totalPages}, probablemente límite de paginación alcanzado`);
        hasMore = false;
      } else if (consecutiveErrors >= maxConsecutiveErrors) {
        console.log(`⚠️ Demasiados errores consecutivos (${consecutiveErrors}), deteniendo paginación`);
        hasMore = false;
      } else {
        // Para otros errores, continuar con la siguiente página después de una pausa más larga
        offset += limit;
        console.log(`⏳ Pausa extendida debido a error (${consecutiveErrors}/${maxConsecutiveErrors})`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Pausa de 1 segundo en caso de error
      }
    }
  }
  
  console.log(`📊 TOTAL DE PRODUCTOS ENCONTRADOS EN ML: ${allItems.length}`);
  console.log(`📋 Primeros 5 IDs: ${allItems.slice(0, 5).join(', ') || 'Ninguno'}`);
  if (errors.length > 0) {
    console.log(`⚠️ Errores encontrados: ${errors.join(', ')}`);
  }

  let processedCount = 0;
  let errorCount = 0;

  for (const itemId of allItems) {
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
        logger.debug("⚠️ No se pudo obtener la descripción", { itemId });
      }

      const existingProduct = await Producto.findOne({ ml_id: itemDetail.id }).lean();
      const priceEvaluation = evaluatePriceForUpdate(itemDetail.price, existingProduct, {
        source: 'force_sync',
        ml_id: itemDetail.id,
        metadata: { title: itemDetail.title },
      });
      const effectiveProductPrice = priceEvaluation.price;

      // DEBUG: Auditar los valores crudos de la API de Mercado Libre para este producto específico
      if (itemDetail.id === 'MLU693479060') {
        console.log('[DEBUG] Detalle API ML:', {
          price: itemDetail.price,
          original_price: itemDetail.original_price,
          title: itemDetail.title,
        });
      }

      /*
       * ⚠️ NOTA IMPORTANTE SOBRE LA API DE MERCADO LIBRE ⚠️
       * La API pública REST de Mercado Libre NO siempre expone el precio rebajado/promocional en el campo 'original_price',
       * aunque la web muestre descuentos, ofertas o deals. Esto sucede sobre todo para cuentas estándar o países donde la API
       * está limitada. Más info: https://developers.mercadolibre.com.ar/es_ar/items-y-busqueda-de-ofertas
       *
       * Si en los logs ves:
       *   [DEBUG][ML_API] id=MLUxxxxxx price=XXX original=null ...
       * es porque la API no da el precio oferta, sólo el base.
       *
       * Si 'original_price' comienza a venir distinto de null, el sistema automáticamente tomará ese precio como rebajado.
       * Puedes monitorear los 'null' para saber si la API cambia en el futuro.
       */
      if(itemDetail.original_price === null) {
        console.log(`[ALERTA ML] Producto id=${itemDetail.id} no expone original_price, solo price base (${itemDetail.price})`);
      }

      // FORZAR el precio SIEMPRE al rebajado de ML si existe descuento ML
      if (itemDetail.original_price && itemDetail.original_price > itemDetail.price) {
        priceEvaluation.fields.price = itemDetail.price;
        priceEvaluation.fields.last_valid_price = itemDetail.price;
        // LOG ESPECIAL PARA AUDITORÍA AUTOMÁTICA
        if (itemDetail.id === 'MLU693479060') {
          console.log('[SYNC] Grabando PRECIO REBAJADO de ML', {
            ml_id: itemDetail.id,
            precio_ml: itemDetail.price,
            original_ml: itemDetail.original_price,
            precio_grabado: priceEvaluation.fields.price,
            last_valid_price: priceEvaluation.fields.last_valid_price,
          });
        }
      }
      // REFUERZO: aunque el precio en la base sea igual, se fuerza el update.
      if (itemDetail.id === 'MLU693479060') {
        console.log('[SYNC] Post-evaluación (antes de grabar)', {
          ml_id: itemDetail.id,
          precio_ml: itemDetail.price,
          original_ml: itemDetail.original_price,
          fields: priceEvaluation.fields,
        });
      }

      // --- Producto ---
      const identity = extractIdentityFields(itemDetail);
      let producto = await Producto.findOneAndUpdate(
        { ml_id: itemDetail.id },
        {
          ml_id: itemDetail.id,
          title: itemDetail.title,
          ...priceEvaluation.fields,
          available_quantity: itemDetail.available_quantity,
          status: itemDetail.status,
          permalink: getCorrectPermalink(itemDetail), // URL validada de la publicación
          catalog_product_id: identity.catalog_product_id,
          es_catalogo: identity.es_catalogo,
          seller_sku: identity.seller_sku,
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
              price: variante.price || effectiveProductPrice,
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

      // console.log(`✅ Producto ${itemId} sincronizado correctamente`); // Comentado para reducir logs
      
      // --- 🚀 LÓGICA DE DROPSHIPPING ---
      const manufacturingTime = itemDetail.sale_terms?.find((term: any) => 
        term.id === "MANUFACTURING_TIME"
      );
      
      let handlingTime = 3; // Default para stock físico
      
      if (manufacturingTime?.value_struct?.number) {
        handlingTime = manufacturingTime.value_struct.number;
      }
      
      const productType = handlingTime > 10 ? "dropshipping" : "stock_fisico";
      const deliveryTimes = calculateDeliveryTimes(productType, handlingTime);
      
      // Actualizar producto con información de dropshipping
      const updateData: any = {
        tipo_venta: productType,
        tiempo_entrega_total: deliveryTimes.total,
        tiempo_entrega_texto: deliveryTimes.texto
      };
      
      if (productType === "dropshipping") {
        updateData.dropshipping = {
          dias_preparacion: handlingTime,
          dias_envio_estimado: 7,
          proveedor: "Proveedor externo",
          pais_origen: "Estados Unidos",
          requiere_confirmacion: true,
          costo_importacion: 0,
          tiempo_configurado_en_ml: handlingTime > 3
        };
      } else {
        updateData.stock_fisico = {
          cantidad_disponible: itemDetail.available_quantity || 0,
          ubicacion: "Almacén local",
          reorder_point: Math.max(1, Math.floor((itemDetail.available_quantity || 0) * 0.2)),
          ultima_actualizacion_stock: new Date(),
          tiempo_configurado_en_ml: handlingTime > 3
        };
      }
      
      await Producto.findOneAndUpdate(
        { ml_id: itemDetail.id },
        { $set: updateData },
        { new: true }
      );
      
      console.log(`🎯 Producto ${itemId} clasificado como: ${productType} (${handlingTime} días)`);
      
      processedCount++;
      
      // Pausa optimizada para procesamiento individual (100ms por producto)
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`❌ Error procesando producto ${itemId}:`, error);
      errorCount++;
    }
  }
  
  console.log(`🎉 SINCRONIZACIÓN COMPLETADA:`);
  console.log(`✅ Productos procesados exitosamente: ${processedCount}`);
  console.log(`❌ Productos con errores: ${errorCount}`);
  console.log(`📊 Total de productos encontrados en ML: ${allItems.length}`);
  console.log(`📊 Total de productos en base de datos: ${await Producto.countDocuments()}`);
}
// 🚀 Endpoint OPTIMIZADO con paginación para carga rápida
// (ANTIGUO) Duplicado: consolidar en el de más abajo
router.get("/admin/productos", authenticate, authorize("admin"), async (req: Request, res: Response) => {
  try {
    const { limit, skip, page, offset, status, q, fields, categoryIds, destacado, priceInvalid: priceInvalidQuery } = req.query as Record<string, string>;

    // Filtros base (excluye archivados y duplicados apuntados)
    const baseFilter: any = {
      archivado: { $ne: true },
      $or: [ { duplicate_of_ml_id: null }, { duplicate_of_ml_id: { $exists: false } } ]
    };

    // Construir cláusulas dinámicas
    const andClauses: any[] = [ baseFilter ];
    if (status && (status === 'active' || status === 'paused')) {
      andClauses.push({ status });
    }
    if (q && String(q).trim()) {
      const term = String(q).trim();
      const pattern = buildAccentInsensitiveRegex(term);
      const regex = new RegExp(pattern, 'i');
      andClauses.push({ $or: [
        { title: regex },
        { ml_id: regex },
        { seller_sku: regex },
        { 'variantes.color': regex },
        { 'variantes.size': regex },
        { 'variantes.id': regex }
      ]});
    }
    // Filtro por múltiples categorías ML si se proveen (CSV)
    if (categoryIds && String(categoryIds).trim()) {
      const ids = String(categoryIds).split(',').map(s => s.trim()).filter(Boolean);
      if (ids.length > 0) {
        andClauses.push({ category_id: { $in: ids } });
      }
    }
    // Filtro destacado manual
    if (typeof destacado !== 'undefined') {
      const val = String(destacado).toLowerCase();
      if (val === 'true' || val === '1') andClauses.push({ destacado: true });
      if (val === 'false' || val === '0') andClauses.push({ destacado: { $ne: true } });
    }
    if (typeof priceInvalidQuery !== 'undefined') {
      const normalized = String(priceInvalidQuery).toLowerCase();
      if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
        andClauses.push({ price_invalid: true });
      } else if (normalized === 'false' || normalized === '0' || normalized === 'no') {
        andClauses.push({ price_invalid: { $ne: true } });
      }
    }
    const mongoFilter = andClauses.length > 1 ? { $and: andClauses } : baseFilter;

    // Proyección opcional de campos
    let projection: any | undefined = undefined;
    if (fields && String(fields).trim()) {
      projection = {} as any;
      for (const f of String(fields).split(',').map(s => s.trim()).filter(Boolean)) {
        projection[f] = 1;
      }
      // Asegurar que 'variantes' esté disponible para populate si se usa proyección
      if (projection && projection.variantes !== 1) {
        projection.variantes = 1;
      }
    }

    // Paginación si hay limit
    if (limit) {
      const limitNum = parseInt(String(limit)) || 50;
      const skipNum = skip ? parseInt(String(skip)) : 0;
      const offsetNum = offset ? parseInt(String(offset)) : undefined;
      const pageNum = page ? parseInt(String(page)) : 1;
      const actualSkip = page ? (pageNum - 1) * limitNum : ((offsetNum ?? skipNum) || 0);

      // Contar con el mismo filtro aplicado
      const total = await Producto.countDocuments(mongoFilter);

      // Query con proyección opcional
      let query = Producto.find(mongoFilter) as any;
      if (projection) query = query.select(projection);
      
      // Optimizar populate: solo cargar campos necesarios de variantes para mejorar rendimiento
      // Si se especifican campos, intentar optimizar el populate
      const populateOptions: any = { path: "variantes" };
      if (fields && String(fields).trim()) {
        const fieldsStr = String(fields).toLowerCase();
        // Si se solicita información de variantes, cargar solo los campos necesarios
        if (fieldsStr.includes('variantes') || fieldsStr.includes('tipo_venta') || fieldsStr.includes('dropshipping')) {
          // Seleccionar solo campos básicos + los solicitados (incluir _id siempre)
          populateOptions.select = '_id tipo_venta dropshipping';
        }
      }
      
      const productos = await query
        .populate(populateOptions)
        .limit(limitNum)
        .skip(actualSkip)
        .lean();

      return res.json({
        productos,
        pagination: {
          total,
          limit: limitNum,
          skip: actualSkip,
          page: pageNum,
          totalPages: Math.ceil(total / limitNum),
          hasMore: actualSkip + limitNum < total
        }
      });
    }

    // Sin limit: devolver todos con filtro aplicado
    let queryAll = Producto.find(mongoFilter) as any;
    if (projection) queryAll = queryAll.select(projection);
    
    // Optimizar populate: solo cargar campos necesarios de variantes para mejorar rendimiento
    const populateOptionsAll: any = { path: "variantes" };
    if (fields && String(fields).trim()) {
      const fieldsStr = String(fields).toLowerCase();
      // Si se solicita información de variantes, cargar solo los campos necesarios
      if (fieldsStr.includes('variantes') || fieldsStr.includes('tipo_venta') || fieldsStr.includes('dropshipping')) {
        populateOptionsAll.select = '_id tipo_venta dropshipping';
      }
    }
    
    const productos = await queryAll.populate(populateOptionsAll);
    res.json(productos);
  } catch (err: any) {
    res.status(500).send("❌ Error al obtener productos: " + err.message);
  }
});

router.post("/admin/productos/:ml_id/clear-invalid-price", authenticate, authorize("admin"), async (req: Request, res: Response) => {
  try {
    const { ml_id } = req.params;
    const producto = await Producto.findOne({ ml_id });
    if (!producto) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    const fallback = typeof producto.last_valid_price === 'number' && producto.last_valid_price > 0
      ? producto.last_valid_price
      : (typeof producto.price === 'number' && producto.price > 0 ? producto.price : null);

    producto.price_invalid = false;
    producto.price_invalid_reason = null;
    producto.price_invalid_at = null;
    producto.hidden_by_price_issue = false;
    if (fallback && fallback > 0) {
      producto.price = fallback;
    }

    await producto.save();

    return res.json({ success: true, producto });
  } catch (error: any) {
    return res.status(500).json({ error: "Error limpiando bandera de precio inválido", message: error.message });
  }
});

router.put("/admin/productos/:ml_id/price-override", authenticate, authorize("admin"), async (req: Request, res: Response) => {
  try {
    const { ml_id } = req.params;
    const { value, reason, active, syncWithMl } = req.body as {
      value?: number | string;
      reason?: string;
      active?: boolean;
      syncWithMl?: boolean;
    };

    const producto = await Producto.findOne({ ml_id });
    if (!producto) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    // @ts-ignore
    const user = req.user as { email?: string; id?: string } | undefined;
    const now = new Date();
    const normalizedActive = typeof active === "boolean" ? active : true;

    if (normalizedActive) {
      const parsedValue =
        typeof value === "number" ? value : Number(typeof value === "string" ? value.replace(',', '.') : value);
      if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
        return res.status(400).json({ error: "El valor ingresado debe ser un número mayor a 0" });
      }

      const normalizedReason = typeof reason === "string" && reason.trim() ? reason.trim() : null;
      producto.price = parsedValue;
      producto.last_valid_price = parsedValue;
      producto.price_invalid = false;
      producto.price_invalid_reason = null;
      producto.price_invalid_at = null;
      producto.hidden_by_price_issue = false;
      producto.price_override = {
        active: true,
        value: parsedValue,
        reason: normalizedReason,
        updated_at: now,
        updated_by: (user?.email || user?.id || "admin").toString(),
        ml_price_last: producto.price_override?.ml_price_last ?? undefined,
        ml_price_last_at: producto.price_override?.ml_price_last_at ?? undefined,
      } as any;
    } else {
      const currentOverride = producto.price_override;
      const shouldSync = syncWithMl === true;
      if (shouldSync && typeof currentOverride?.ml_price_last === "number" && currentOverride.ml_price_last > 0) {
        producto.price = currentOverride.ml_price_last;
        producto.last_valid_price = currentOverride.ml_price_last;
        producto.price_invalid = false;
        producto.price_invalid_reason = null;
        producto.price_invalid_at = null;
        producto.hidden_by_price_issue = false;
      } else {
        producto.hidden_by_price_issue = false;
      }
      producto.price_override = undefined;
    }

    await producto.save();

    const refreshed = await Producto.findOne({ ml_id }).populate('variantes').lean();
    return res.json({
      success: true,
      producto: refreshed,
      override_active: refreshed?.price_override?.active === true,
    });
  } catch (error: any) {
    console.error("❌ Error aplicando override de precio:", error);
    return res.status(500).json({ error: "Error aplicando override de precio", message: error.message });
  }
});

// =====================
// 🆕 Productos por categoría ML (endpoint específico)
// GET /ml/categories/:categoryIds/productos?limit=120&offset=0&fields=ml_id,title,price,...&status=active
// GET /ml/categories/productos?categoryIds=MLU1055,MLU12953&limit=120
// Si no se pasa limit, devuelve todos los productos de las categorías (cuidado con payloads grandes)
// =====================
router.get(["/categories/:categoryIds/productos", "/categories/productos"], async (req: Request, res: Response) => {
  try {
    const categoryIdsParam = (req.params.categoryIds as string) || (req.query.categoryIds as string) || "";
    const fields = (req.query.fields as string) || "";
    const status = (req.query.status as string) || undefined;
    const priceInvalidQuery = (req.query.priceInvalid as string) || undefined;
    const limitStr = (req.query.limit as string) || "";
    const offsetStr = (req.query.offset as string) || "0";

    const categoryIds = String(categoryIdsParam)
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (categoryIds.length === 0) {
      return res.status(400).json({ error: "categoryIds requerido (param o query)" });
    }

    // Filtro base coherente con tienda (excluir archivados y duplicados apuntados)
    const baseFilter: any = {
      archivado: { $ne: true },
      $or: [ { duplicate_of_ml_id: null }, { duplicate_of_ml_id: { $exists: false } } ],
      hidden_by_price_issue: { $ne: true },
      category_id: { $in: categoryIds }
    };
    if (status && status !== 'all') {
      baseFilter.status = status;
    }

    // Proyección opcional de campos
    let projection: any | undefined = undefined;
    if (fields && String(fields).trim()) {
      projection = {} as any;
      for (const f of String(fields).split(',').map(s => s.trim()).filter(Boolean)) {
        projection[f] = 1;
      }
      if (projection && projection.variantes !== 1) {
        projection.variantes = 1;
      }
    }

    const hasPagination = !!limitStr;
    if (hasPagination) {
      const limit = Math.min(parseInt(limitStr) || 50, 1000);
      const offset = Math.max(parseInt(offsetStr) || 0, 0);
      const [items, total] = await Promise.all([
        (projection
          ? Producto.find(baseFilter).select(projection)
          : Producto.find(baseFilter))
          .populate('variantes')
          .sort({ _id: 1 })
          .skip(offset)
          .limit(limit)
          .lean(),
        Producto.countDocuments(baseFilter)
      ]);
      return res.json({ total, limit, offset, items });
    }

    // Sin paginación: devolver todos (usar con cuidado)
    const items = await (projection
      ? Producto.find(baseFilter).select(projection)
      : Producto.find(baseFilter))
      .populate('variantes')
      .sort({ _id: 1 })
      .lean();
    return res.json({ total: items.length, items });
  } catch (err: any) {
    return res.status(500).json({ error: "Error obteniendo productos por categoría", message: err.message });
  }
});

// 🧹 Consolidación de duplicados por catalog_product_id dejando 1 canónica
router.post("/maintenance/consolidate-duplicates", async (req: Request, res: Response) => {
  try {
    const { dry_run, type } = req.query as any;
    const useType = (type || 'catalog').toString().toLowerCase(); // 'catalog' | 'gtin' | 'both'

    const buildScore = (p: any) => (
      (p.status === 'active' ? 1_000_000 : p.status === 'paused' ? 100_000 : 0) +
      (Number(p.sold_quantity) || 0) * 1_000 +
      (Number(p.health) || 0) * 10 -
      (Number(p.price) || 0)
    );

    const allActions: any[] = [];
    let totalGroups = 0;

    async function consolidateByCatalog() {
      const groups = await Producto.aggregate([
        { $match: { catalog_product_id: { $ne: null } } },
        { $group: { _id: "$catalog_product_id", ids: { $push: "$ml_id" } } },
        { $project: { _id: 1, ids: 1, count: { $size: "$ids" } } },
        { $match: { count: { $gt: 1 } } }
      ]);
      totalGroups += groups.length;
      for (const g of groups) {
        const products = await Producto.find({ ml_id: { $in: g.ids } }).lean();
        const sorted = products.sort((a: any, b: any) => buildScore(b) - buildScore(a));
        const canonical = sorted[0]?.ml_id;
        const toArchive = sorted.slice(1).map((p: any) => p.ml_id);
        if (!canonical || toArchive.length === 0) continue;
        allActions.push({ strategy: 'catalog', group_id: g._id, canonical, archived: toArchive });
        if (!dry_run || String(dry_run).toLowerCase() !== 'true') {
          await Producto.updateMany({ ml_id: { $in: toArchive } }, { $set: { archivado: true, duplicate_of_ml_id: canonical } });
        }
      }
    }

    async function consolidateByGTIN() {
      // Agrupar por valor GTIN/EAN/GTIN14/UPC
      const groups = await Producto.aggregate([
        { $unwind: "$attributes" },
        { $match: { "attributes.id": { $in: ["GTIN", "EAN", "GTIN14", "UPC"] }, "attributes.value_name": { $ne: null } } },
        { $group: { _id: "$attributes.value_name", ids: { $addToSet: "$ml_id" }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } }
      ]);
      totalGroups += groups.length;
      for (const g of groups) {
        const products = await Producto.find({ ml_id: { $in: g.ids } }).lean();
        const sorted = products.sort((a: any, b: any) => buildScore(b) - buildScore(a));
        const canonical = sorted[0]?.ml_id;
        const toArchive = sorted.slice(1).map((p: any) => p.ml_id);
        if (!canonical || toArchive.length === 0) continue;
        allActions.push({ strategy: 'gtin', group_id: g._id, canonical, archived: toArchive });
        if (!dry_run || String(dry_run).toLowerCase() !== 'true') {
          await Producto.updateMany({ ml_id: { $in: toArchive } }, { $set: { archivado: true, duplicate_of_ml_id: canonical } });
        }
      }
    }

    if (useType === 'catalog' || useType === 'both') {
      await consolidateByCatalog();
    }
    if (useType === 'gtin' || useType === 'both') {
      await consolidateByGTIN();
    }

    return res.json({
      dry_run: String(dry_run).toLowerCase() === 'true',
      type: useType,
      groups_processed: totalGroups,
      actions: allActions
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Error consolidando duplicados: " + err.message });
  }
});

// 📊 Censo por estado: cuenta por estado y totales ML vs DB
router.get("/sync/census", async (req: Request, res: Response) => {
  try {
    const token = await getCurrentToken();
    if (!token) return res.status(401).json({ error: "No autenticado" });

    // Estados ampliados
    const states = [
      'active','paused','closed','under_review','inactive','not_yet_active',
      'payment_required','stopped','deleted','suspended','blocked'
    ];

    const counts: Record<string, number> = {};
    for (const st of states) {
      try {
        const resp = await axios.get(
          `https://api.mercadolibre.com/users/${token.user_id}/items/search?status=${st}&limit=1`,
          { headers: { Authorization: `Bearer ${token.access_token}` } }
        );
        counts[st] = Number(resp.data?.paging?.total || 0);
      } catch {
        counts[st] = 0;
      }
      await new Promise(r => setTimeout(r, 100));
    }

    const dbCount = await Producto.countDocuments();
    const dbByStatus = await Producto.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
    const mlTotal = Object.values(counts).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);

    return res.json({
      ml_counts_by_status: counts,
      ml_total_estimated: mlTotal,
      db_total: dbCount,
      db_by_status: dbByStatus,
      gap_estimated: Math.max(0, mlTotal - dbCount),
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Error en census: " + err.message });
  }
});

// 🔎 Reporte de duplicados (catálogo y GTIN/EAN)
router.get("/diagnostics/duplicates", async (req: Request, res: Response) => {
  try {
    const { limit, summary, includeProducts, type, fields } = req.query as Record<string, string>;
    const limitNum = Math.max(1, Math.min(parseInt(limit || "50") || 50, 500));
    const wantSummary = String(summary).toLowerCase() === "true";
    const wantProducts = String(includeProducts).toLowerCase() === "true";
    const which: Array<'catalog'|'gtin'> = type === 'catalog' ? ['catalog'] : type === 'gtin' ? ['gtin'] : ['catalog','gtin'];
    const projection: any = {};
    if (fields) {
      for (const f of fields.split(",").map(s => s.trim()).filter(Boolean)) {
        projection[f] = 1;
      }
    }

    // Por catálogo
    const byCatalog = which.includes('catalog')
      ? await Producto.aggregate([
          { $match: { catalog_product_id: { $ne: null } } },
          { $group: { _id: "$catalog_product_id", count: { $sum: 1 }, ids: { $addToSet: "$ml_id" } } },
          { $match: { count: { $gt: 1 } } },
          { $sort: { count: -1 } },
          { $limit: limitNum }
        ])
      : [];

    // Por GTIN/EAN/UPC
    const byGtin = which.includes('gtin')
      ? await Producto.aggregate([
          { $unwind: "$attributes" },
          { $match: { "attributes.id": { $in: ["GTIN", "EAN", "GTIN14", "UPC"] } } },
          { $group: { _id: "$attributes.value_name", count: { $sum: 1 }, ids: { $addToSet: "$ml_id" } } },
          { $match: { _id: { $ne: null }, count: { $gt: 1 } } },
          { $sort: { count: -1 } },
          { $limit: limitNum }
        ])
      : [];

    // Summary rápido
    if (wantSummary) {
      const sumExcess = (arr: any[]) => arr.reduce((acc, g) => acc + Math.max(0, (Number(g.count)||0) - 1), 0);
      return res.json({
        summary: {
          groups_catalog: byCatalog.length,
          groups_gtin: byGtin.length,
          excess_catalog: sumExcess(byCatalog),
          excess_gtin: sumExcess(byGtin),
          sample_catalog: byCatalog.slice(0, 5),
          sample_gtin: byGtin.slice(0, 5)
        },
        timestamp: new Date().toISOString()
      });
    }

    // Incluir metadata de productos opcional
    let products: any[] = [];
    if (wantProducts) {
      const allIds = new Set<string>();
      for (const g of byCatalog) (g.ids || []).forEach((id: string) => allIds.add(id));
      for (const g of byGtin) (g.ids || []).forEach((id: string) => allIds.add(id));

      const defaultFields = {
        ml_id: 1,
        title: 1,
        status: 1,
        sold_quantity: 1,
        health: 1,
        listing_type_id: 1,
        permalink: 1,
        price: 1,
        available_quantity: 1,
        images: 1,
        tags: 1,
        es_catalogo: 1,
        catalog_product_id: 1
      } as any;
      const proj = Object.keys(projection).length ? projection : defaultFields;
      products = await Producto.find({ ml_id: { $in: Array.from(allIds) } }, proj).lean();

      // Sugerencia de canónica por grupo (si tenemos productos)
      const productById = new Map(products.map(p => [p.ml_id, p]));
      const chooseCanonical = (ids: string[]) => {
        const ranked = ids
          .map(id => productById.get(id))
          .filter(Boolean)
          .sort((a: any, b: any) => {
            const score = (x: any) => (
              (x.status === 'active' ? 1000 : x.status === 'paused' ? 100 : 0) +
              (Number(x.sold_quantity)||0) * 5 +
              (Number(x.health)||0)
            );
            return score(b) - score(a);
          });
        return ranked[0]?.ml_id || ids[0];
      };
      for (const g of byCatalog) g.suggested_canonical = chooseCanonical(g.ids || []);
      for (const g of byGtin) g.suggested_canonical = chooseCanonical(g.ids || []);
    }

    return res.json({
      duplicates: {
        by_catalog_product_id: byCatalog,
        by_gtin: byGtin
      },
      products,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Error en duplicates: " + err.message });
  }
});

// 🚀 ENDPOINTS OPTIMIZADOS PARA HOMEPAGE - Solo datos esenciales
// ================================================================

// Endpoint para productos más vendidos (bestsellers)
router.get("/productos/bestsellers", async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 12;
    
    const productos = await Producto.find({
      status: { $ne: 'paused' },
      sold_quantity: { $gt: 0 },
      hidden_by_price_issue: { $ne: true },
    })
    .select('ml_id title price sold_quantity main_image images status metrics descuento permalink') // Solo campos necesarios
    .sort({ sold_quantity: -1 })
    .limit(limit)
    .lean();
    
    res.setHeader('Cache-Control', 'public, max-age=300'); // Cache 5 minutos
    res.json(productos);
  } catch (err: any) {
    res.status(500).json({ error: "Error al obtener bestsellers: " + err.message });
  }
});

// Endpoint para productos destacados (featured) - MEJORADO con selección manual
router.get("/productos/featured", async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 12;
    
    // 🆕 PRIMERO: Buscar productos marcados manualmente como destacados
    const productosDestacadosManuales = await Producto.find({
      destacado: true,
      status: { $ne: 'paused' },
      available_quantity: { $gt: 0 },
      hidden_by_price_issue: { $ne: true },
    })
    .select('ml_id title price main_image images status metrics health descuento available_quantity permalink categoria variantes')
    .populate('variantes')
    .limit(limit)
    .lean();
    
    // Si hay suficientes productos destacados manuales, usarlos
    if (productosDestacadosManuales.length >= limit) {
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.json(productosDestacadosManuales);
    }
    
    // Si no hay suficientes, completar con sistema automático
    const productosRestantes = limit - productosDestacadosManuales.length;
    
    const productos = await Producto.find({
      destacado: { $ne: true }, // Excluir los ya destacados manualmente
      status: { $ne: 'paused' },
      available_quantity: { $gt: 0 },
      hidden_by_price_issue: { $ne: true },
    })
    .select('ml_id title price main_image images status metrics health descuento available_quantity permalink categoria variantes')
    .populate('variantes')
    .lean();
    
    // Calcular score en backend para productos automáticos
    const productosConScore = productos.map(p => {
      const visitas = p.metrics?.visits || 0;
      const rating = p.metrics?.reviews.rating_average || 0;
      const totalReseñas = p.metrics?.reviews.total || 0;
      const health = p.health || 0;
      
      const score = (visitas * 0.3) + (rating * 10) + (totalReseñas * 3) + (health * 5);
      
      return { ...p, score };
    });
    
    // Ordenar y tomar los mejores
    const productosAutomaticos = productosConScore
      .sort((a, b) => b.score - a.score)
      .slice(0, productosRestantes);
    
    // Combinar productos destacados manuales con automáticos
    const featured = [...productosDestacadosManuales, ...productosAutomaticos];
    
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(featured);
  } catch (err: any) {
    res.status(500).json({ error: "Error al obtener featured: " + err.message });
  }
});

// Endpoint ligero para categorías de portada con imagen representativa
router.get("/home/categories", async (req: Request, res: Response) => {
  try {
    const kind = ((req.query.kind as string) || 'main').toLowerCase();

    const mainGroups = [
      { id: 'electronica', name: 'Electrónica', icon: '📱', description: 'Tecnología y dispositivos', mlCategories: [
        'MLU163646','MLU163764','MLU163765','MLU163771','MLU168248','MLU3697'
      ]},
      { id: 'gaming', name: 'Gaming', icon: '🎮', description: 'Consolas y juegos', mlCategories: [
        'MLU6344','MLU443628','MLU448172','MLU443741','MLU10858'
      ]},
      { id: 'hogar', name: 'Hogar', icon: '🏠', description: 'Decoración y muebles', mlCategories: [
        'MLU12201','MLU7969','MLU40398','MLU205198','MLU43687'
      ]},
      { id: 'deportes', name: 'Deportes', icon: '🏋️', description: 'Ropa y equipos deportivos', mlCategories: [
        'MLU165701','MLU165785','MLU413593'
      ]}
    ];

    const secondaryGroups = [
      { id: 'cocina', name: 'Cocina', icon: '🍳', description: 'Electrodomésticos y utensilios', mlCategories: [
        'MLU442710','MLU196263','MLU416585','MLU414038','MLU442747','MLU442751','MLU455144','MLU74887','MLU74925','MLU412348'
      ]},
      { id: 'bebes-ninos', name: 'Bebés y Niños', icon: '👶', description: 'Todo para los más pequeños', mlCategories: [
        'MLU178390','MLU443005','MLU412585','MLU187852','MLU443022','MLU443133','MLU1889','MLU40629','MLU457852','MLU429242'
      ]},
      { id: 'accesorios', name: 'Accesorios', icon: '🎒', description: 'Mochilas y complementos', mlCategories: [
        'MLU190994','MLU442981','MLU187975','MLU26538','MLU158838','MLU434789'
      ]},
      { id: 'drones-foto', name: 'Drones y Fotografía', icon: '🚁', description: 'Tecnología audiovisual', mlCategories: [
        'MLU178089','MLU413447','MLU413635','MLU430406','MLU413444','MLU414123','MLU1042'
      ]}
    ];

    const groups = kind === 'secondary' ? secondaryGroups : mainGroups;

    // Consultas en paralelo, eligiendo un producto representativo por grupo
    const results = await Promise.all(groups.map(async (g) => {
      const p = await Producto.findOne({
        category_id: { $in: g.mlCategories },
        status: { $ne: 'paused' },
        hidden_by_price_issue: { $ne: true },
        $or: [ { 'images.0': { $exists: true } }, { main_image: { $exists: true, $ne: null } } ]
      })
      .select('images main_image sold_quantity health')
      .sort({ sold_quantity: -1, health: -1 })
      .lean();

      const image = (p?.images && p.images[0]?.url) || (p as any)?.main_image || '/img/portada4.jpg';
      return { id: g.id, name: g.name, icon: g.icon, description: g.description, image };
    }));

    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.json({ kind, categories: results });
  } catch (err: any) {
    return res.status(500).json({ error: 'Error al obtener categorías: ' + err.message });
  }
});

// 🆕 Endpoint para marcar/desmarcar producto como destacado (protegido)
router.put("/productos/:id/destacado", authenticate, authorizeDestacados, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { destacado } = req.body;
    
    // Validar que destacado sea un booleano
    if (typeof destacado !== 'boolean') {
      return res.status(400).json({ 
        error: "El campo 'destacado' debe ser un booleano (true o false)" 
      });
    }
    
    // Buscar el producto por _id o ml_id
    let producto = await Producto.findById(id);
    
    if (!producto) {
      // Si no se encuentra por _id, buscar por ml_id
      producto = await Producto.findOne({ ml_id: id });
    }
    
    if (!producto) {
      return res.status(404).json({ 
        error: "Producto no encontrado" 
      });
    }
    
    // Actualizar el campo destacado
    producto.destacado = destacado;
    await producto.save();
    
    res.json({ 
      message: `Producto ${destacado ? 'marcado como destacado' : 'desmarcado como destacado'} exitosamente`,
      producto: {
        _id: producto._id,
        ml_id: producto.ml_id,
        title: producto.title,
        destacado: producto.destacado
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: "Error al actualizar producto: " + err.message });
  }
});

// 🆕 Categorías distintas con conteo (rápido para nav)
router.get("/categories/distinct", async (req: Request, res: Response) => {
  try {
    const onlyActive = (req.query.onlyActive as string | undefined) !== 'false';
    const requireImage = (req.query.requireImage as string | undefined) !== 'false';
    const onlyInStock = (req.query.onlyInStock as string | undefined) === 'true';

    const andClauses: any[] = [];
    andClauses.push({ archivado: { $ne: true } });
    // Excluir registros marcados como duplicados de otra canónica
    andClauses.push({ $or: [ { duplicate_of_ml_id: null }, { duplicate_of_ml_id: { $exists: false } } ] });
    if (onlyActive) andClauses.push({ status: { $ne: 'paused' } });
    if (requireImage) andClauses.push({ $or: [ { 'images.0.url': { $exists: true } }, { main_image: { $exists: true, $ne: null } } ] });
    if (onlyInStock) andClauses.push({ available_quantity: { $gt: 0 } });

    const match: any = andClauses.length ? { $and: andClauses } : {};

    const results = await Producto.aggregate([
      { $match: match },
      // Normalizar clave de agrupación por catálogo si existe, si no por ml_id
      { $addFields: {
          status_rank: {
            $switch: {
              branches: [
                { case: { $eq: ["$status", "active"] }, then: 2 },
                { case: { $eq: ["$status", "paused"] }, then: 1 },
              ],
              default: 0
            }
          },
          groupKey: { $ifNull: ["$catalog_product_id", "$ml_id"] }
        }
      },
      // Ordenar para elegir canónica por grupo (activos primero, luego ventas, health, y precio más bajo)
      { $sort: { status_rank: -1, sold_quantity: -1, health: -1, price: 1 } },
      // Elegir un documento representativo por catálogo (o ml_id)
      { $group: { _id: "$groupKey", doc: { $first: "$$ROOT" } } },
      // Contar por categoría del documento representativo
      { $group: { _id: "$doc.category_id", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).exec();

    const categories = results
      .filter((r: any) => r._id && typeof r._id === 'string')
      .map((r: any) => ({ category_id: r._id as string, count: r.count as number }));

    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.json({ categories });
  } catch (err: any) {
    return res.status(500).json({ error: 'Error al obtener categorías: ' + err.message });
  }
});
// Endpoint para productos con descuento
router.get("/productos/discounted", async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 8;
    
    const productos = await Producto.find({
      'descuento.activo': true,
      status: 'active',
      available_quantity: { $gt: 0 },
      hidden_by_price_issue: { $ne: true },
      $or: [
        { 'images.0.url': { $exists: true } },
        { main_image: { $exists: true, $ne: null } }
      ]
    })
    .select('ml_id title price main_image images descuento available_quantity status permalink')
    .limit(limit)
    .lean();
    
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(productos);
  } catch (err: any) {
    res.status(500).json({ error: "Error al obtener discounted: " + err.message });
  }
});

// Endpoint para obtener un producto específico por ID
router.get("/productos/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const producto = await Producto.findOne({ ml_id: id }).populate("variantes");
    
    if (!producto || producto.hidden_by_price_issue) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }
    
    res.json(producto);
  } catch (err: any) {
    res.status(500).json({ error: "Error al obtener producto: " + err.message });
  }
});

// 🔍 Endpoint de DEBUG para analizar shipping de productos
router.get("/debug-shipping", async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const productos = await Producto.find().limit(limit).lean();
    
    const shippingInfo = productos.map(p => ({
      ml_id: p.ml_id,
      title: p.title?.substring(0, 50),
      shipping: p.shipping,
      logistic_type: p.shipping?.logistic_type,
      shipping_mode: p.shipping?.mode,
      shipping_tags: p.shipping?.tags,
      tags: p.tags, // Tags generales del producto
      dropshipping: p.dropshipping,
      dias_preparacion: p.dias_preparacion,
      dias_envio_estimado: p.dias_envio_estimado,
      available_quantity: p.available_quantity
    }));
    
    // Agrupar por logistic_type
    const logisticTypes = productos.reduce((acc: any, p) => {
      const type = p.shipping?.logistic_type || 'sin_logistic_type';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
    
    // Buscar tags únicos en shipping
    const shippingTags = new Set<string>();
    productos.forEach(p => {
      p.shipping?.tags?.forEach((tag: string) => shippingTags.add(tag));
    });
    
    const stats = {
      total: productos.length,
      con_shipping: productos.filter(p => p.shipping && Object.keys(p.shipping).length > 0).length,
      con_logistic_type: productos.filter(p => p.shipping?.logistic_type).length,
      logistic_types: logisticTypes,
      shipping_tags_unicos: Array.from(shippingTags),
      flex: productos.filter(p => p.shipping?.logistic_type === 'fulfillment').length,
      xd_drop_off: productos.filter(p => p.shipping?.logistic_type === 'xd_drop_off').length,
      con_dropshipping: productos.filter(p => p.dropshipping).length,
      con_dias_preparacion: productos.filter(p => p.dias_preparacion).length,
      con_stock: productos.filter(p => p.available_quantity > 0).length
    };
    
    res.json({ stats, productos: shippingInfo });
  } catch (err: any) {
    res.status(500).send("❌ Error: " + err.message);
  }
});

// Endpoint simple para obtener categorías básicas
router.get("/categorias-simples", async (req: Request, res: Response) => {
  try {
    console.log("🔍 Obteniendo categorías simples...");
    
    // Obtener todos los productos con category_id
    const productos = await Producto.find(
      { category_id: { $exists: true, $ne: "" } },
      { category_id: 1, title: 1 }
    );
    
    console.log(`📊 Productos encontrados: ${productos.length}`);
    
    // Agrupar por category_id y contar
    const categoriasMap = new Map<string, { count: number; sample_titles: string[] }>();
    
    productos.forEach(producto => {
      if (producto.category_id) {
        if (!categoriasMap.has(producto.category_id)) {
          categoriasMap.set(producto.category_id, { count: 0, sample_titles: [] });
        }
        const categoria = categoriasMap.get(producto.category_id)!;
        categoria.count++;
        if (categoria.sample_titles.length < 2) {
          categoria.sample_titles.push(producto.title);
        }
      }
    });
    
    // Convertir a array
    const categorias = Array.from(categoriasMap.entries()).map(([categoryId, info]) => ({
      id: categoryId,
      count: info.count,
      sample_titles: info.sample_titles
    }));
    
    // Ordenar por cantidad de productos
    categorias.sort((a, b) => b.count - a.count);
    
    console.log(`📊 Categorías encontradas: ${categorias.length}`);
    
    res.json({
      message: "Categorías obtenidas exitosamente",
      total_categories: categorias.length,
      total_products: productos.length,
      categories: categorias,
      timestamp: new Date().toISOString()
    });
    
  } catch (err: any) {
    console.error("❌ Error obteniendo categorías simples:", err);
    res.status(500).json({ error: "Error obteniendo categorías: " + err.message });
  }
});

// Función para sincronización avanzada optimizada (más rápida)
async function advancedSyncProductos() {
  const token = await getCurrentToken();
  if (!token) throw new Error("No autenticado");

  console.log(`🚀 Iniciando sincronización avanzada optimizada para user_id: ${token.user_id}`);
  
  let allItems: string[] = [];
  let totalProcessed = 0;
  let totalErrors = 0;
  const strategies = [];

  // Solo usar las estrategias más efectivas y rápidas
  console.log("📋 Estrategia 1: Paginación con límite 25 (más páginas)");
  try {
    const strategy1 = await paginateWithLimitOptimized(token, 25, 40); // Máximo 40 páginas
    allItems = [...new Set([...allItems, ...strategy1.items])];
    totalProcessed += strategy1.processed;
    totalErrors += strategy1.errors;
    strategies.push({ name: "Paginación 25", items: strategy1.items.length, processed: strategy1.processed, errors: strategy1.errors });
  } catch (error) {
    console.error("❌ Error en estrategia 1:", error);
  }

  console.log("📋 Estrategia 2: Paginación con límite 50 (actual)");
  try {
    const strategy2 = await paginateWithLimitOptimized(token, 50, 30); // Máximo 30 páginas
    allItems = [...new Set([...allItems, ...strategy2.items])];
    totalProcessed += strategy2.processed;
    totalErrors += strategy2.errors;
    strategies.push({ name: "Paginación 50", items: strategy2.items.length, processed: strategy2.processed, errors: strategy2.errors });
  } catch (error) {
    console.error("❌ Error en estrategia 2:", error);
  }

  console.log("📋 Estrategia 3: Sincronización por estados principales");
  try {
    const strategy3 = await syncByStatusOptimized(token);
    allItems = [...new Set([...allItems, ...strategy3.items])];
    totalProcessed += strategy3.processed;
    totalErrors += strategy3.errors;
    strategies.push({ name: "Por Estados", items: strategy3.items.length, processed: strategy3.processed, errors: strategy3.errors });
  } catch (error) {
    console.error("❌ Error en estrategia 3:", error);
  }

  console.log(`🎉 SINCRONIZACIÓN AVANZADA COMPLETADA:`);
  console.log(`📊 Total de productos únicos encontrados: ${allItems.length}`);
  console.log(`📊 Total procesados: ${totalProcessed}`);
  console.log(`📊 Total errores: ${totalErrors}`);
  console.log(`📊 Estrategias ejecutadas: ${strategies.length}`);

  return {
    totalItems: allItems.length,
    totalProcessed,
    totalErrors,
    strategies,
    items: allItems
  };
}

// Función auxiliar optimizada para paginación con límite específico
async function paginateWithLimitOptimized(token: any, limit: number, maxPages: number) {
  let allItems: string[] = [];
  let offset = 0;
  let hasMore = true;
  let totalPages = 0;
  let processed = 0;
  let errors = 0;

  while (hasMore && totalPages < maxPages) {
    totalPages++;
    console.log(`📄 Límite ${limit} - Página ${totalPages}/${maxPages} (offset: ${offset})`);
    
    try {
      const itemsResponse = await axios.get(
        `https://api.mercadolibre.com/users/${token.user_id}/items/search?offset=${offset}&limit=${limit}`,
        { headers: { Authorization: `Bearer ${token.access_token}` } }
      );

      const pageResults = itemsResponse.data.results || [];
     // console.log(`📊 Límite ${limit} - Productos en página ${totalPages}: ${pageResults.length}`);
      
      if (pageResults.length === 0) {
        hasMore = false;
        console.log(`✅ Límite ${limit} - No hay más productos. Páginas procesadas: ${totalPages - 1}`);
      } else {
        allItems = allItems.concat(pageResults);
        offset += limit;
        processed += pageResults.length;
        
        // Pausa más corta para ser más rápido
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error: any) {
      console.error(`❌ Límite ${limit} - Error en página ${totalPages}:`, error.message);
      errors++;
      
      if (error.response?.status === 400) {
        hasMore = false;
        console.log(`⚠️ Límite ${limit} - Error 400, deteniendo paginación`);
      } else {
        offset += limit;
      }
    }
  }

  return { items: allItems, processed, errors };
}

// Función optimizada para sincronización por estados
async function syncByStatusOptimized(token: any) {
  const statuses = ['active', 'paused']; // Solo los estados más importantes
  let allItems: string[] = [];
  let processed = 0;
  let errors = 0;

  for (const status of statuses) {
    console.log(`📋 Sincronizando productos con estado: ${status}`);
    try {
      const response = await axios.get(
        `https://api.mercadolibre.com/users/${token.user_id}/items/search?status=${status}&limit=50`,
        { headers: { Authorization: `Bearer ${token.access_token}` } }
      );
      
      const results = response.data.results || [];
      allItems = allItems.concat(results);
      processed += results.length;
      console.log(`📊 Estado ${status}: ${results.length} productos encontrados`);
      
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`❌ Error sincronizando estado ${status}:`, error);
      errors++;
    }
  }

  return { items: allItems, processed, errors };
}

// Función auxiliar para paginación con límite específico
async function paginateWithLimit(token: any, limit: number) {
  let allItems: string[] = [];
  let offset = 0;
  let hasMore = true;
  let totalPages = 0;
  let processed = 0;
  let errors = 0;

  while (hasMore) {
    totalPages++;
    console.log(`📄 Límite ${limit} - Página ${totalPages} (offset: ${offset})`);
    
    try {
      const itemsResponse = await axios.get(
        `https://api.mercadolibre.com/users/${token.user_id}/items/search?offset=${offset}&limit=${limit}`,
        { headers: { Authorization: `Bearer ${token.access_token}` } }
      );

      const pageResults = itemsResponse.data.results || [];
      //console.log(`📊 Límite ${limit} - Productos en página ${totalPages}: ${pageResults.length}`);
      
      if (pageResults.length === 0) {
        hasMore = false;
        console.log(`✅ Límite ${limit} - No hay más productos. Páginas procesadas: ${totalPages - 1}`);
      } else {
        allItems = allItems.concat(pageResults);
        offset += limit;
        processed += pageResults.length;
        
        // Pausa optimizada
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (error: any) {
      console.error(`❌ Límite ${limit} - Error en página ${totalPages}:`, error.message);
      errors++;
      
      if (error.response?.status === 400) {
        hasMore = false;
        console.log(`⚠️ Límite ${limit} - Error 400, deteniendo paginación`);
      } else {
        offset += limit;
        if (totalPages > 30) { // Límite de seguridad
          hasMore = false;
        }
      }
    }
  }

  return { items: allItems, processed, errors };
}

// Función para sincronización por estados
async function syncByStatus(token: any) {
  const statuses = ['active', 'paused', 'closed', 'under_review'];
  let allItems: string[] = [];
  let processed = 0;
  let errors = 0;

  for (const status of statuses) {
    console.log(`📋 Sincronizando productos con estado: ${status}`);
    try {
      const response = await axios.get(
        `https://api.mercadolibre.com/users/${token.user_id}/items/search?status=${status}&limit=50`,
        { headers: { Authorization: `Bearer ${token.access_token}` } }
      );
      
      const results = response.data.results || [];
      allItems = allItems.concat(results);
      processed += results.length;
      console.log(`📊 Estado ${status}: ${results.length} productos encontrados`);
      
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.error(`❌ Error sincronizando estado ${status}:`, error);
      errors++;
    }
  }

  return { items: allItems, processed, errors };
}

// Función para sincronización por fechas
async function syncByDate(token: any) {
  let allItems: string[] = [];
  let processed = 0;
  let errors = 0;

  // Obtener productos de los últimos 2 años por trimestres
  const currentDate = new Date();
  const quarters = [];
  
  for (let i = 0; i < 8; i++) {
    const startDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - (i * 3), 1);
    const endDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - (i * 3) + 3, 0);
    quarters.push({
      start: startDate.toISOString().split('T')[0],
      end: endDate.toISOString().split('T')[0]
    });
  }

  for (const quarter of quarters) {
    console.log(`📋 Sincronizando productos del ${quarter.start} al ${quarter.end}`);
    try {
      const response = await axios.get(
        `https://api.mercadolibre.com/users/${token.user_id}/items/search?date_created_from=${quarter.start}&date_created_to=${quarter.end}&limit=50`,
        { headers: { Authorization: `Bearer ${token.access_token}` } }
      );
      
      const results = response.data.results || [];
      allItems = allItems.concat(results);
      processed += results.length;
      console.log(`📊 Período ${quarter.start}: ${results.length} productos encontrados`);
      
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.error(`❌ Error sincronizando período ${quarter.start}:`, error);
      errors++;
    }
  }

  return { items: allItems, processed, errors };
}

// Endpoint simple y rápido para detectar productos
router.get("/sync/discover-simple", async (req: Request, res: Response) => {
  try {
    console.log("🔍 Iniciando detección simple de productos...");
    
    const token = await getCurrentToken();
    if (!token) throw new Error("No autenticado");

    let allItems: string[] = [];
    const results = [];

    // Solo probar con límite 25 y máximo 20 páginas
    console.log("📋 Probando con límite 25 (máximo 20 páginas)...");
    let offset = 0;
    let pageCount = 0;
    let itemsFound = 0;
    
    while (pageCount < 20) {
      pageCount++;
      try {
        const itemsResponse = await axios.get(
          `https://api.mercadolibre.com/users/${token.user_id}/items/search?offset=${offset}&limit=25`,
          { headers: { Authorization: `Bearer ${token.access_token}` } }
        );

        const pageResults = itemsResponse.data.results || [];
        
        if (pageResults.length === 0) {
          break;
        } else {
          allItems = [...new Set([...allItems, ...pageResults])];
          itemsFound += pageResults.length;
          offset += 25;
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error: any) {
        console.log(`⚠️ Error en página ${pageCount}:`, error.message);
        break;
      }
    }
    
    results.push({
      limit: 25,
      pages: pageCount,
      items_found: itemsFound,
      total_unique: allItems.length
    });

    const currentDbCount = await Producto.countDocuments();
    
    res.json({
      message: "✅ Detección simple completada",
      results: results,
      discovery: {
        total_items_found: allItems.length,
        current_database: currentDbCount,
        difference: allItems.length - currentDbCount
      },
      recommendation: allItems.length > currentDbCount ? 
        `Se encontraron ${allItems.length - currentDbCount} productos adicionales. Ejecuta /ml/sync/force para sincronizarlos.` :
        "La detección está completa.",
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    console.error("❌ Error en detección simple:", err);
    res.status(500).json({ 
      error: "Error en detección: " + err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Endpoint para solo detectar productos (sin procesarlos)
router.get("/sync/discover-only", async (req: Request, res: Response) => {
  try {
    console.log("🔍 Iniciando detección de productos (sin procesar)...");
    
    const result = await advancedSyncProductos();
    
    res.json({
      message: "✅ Detección de productos completada",
      strategies: result.strategies,
      discovery: {
        total_items_found: result.totalItems,
        total_processed: result.totalProcessed,
        total_errors: result.totalErrors
      },
      current_database: {
        total_products: await Producto.countDocuments()
      },
      recommendation: result.totalItems > await Producto.countDocuments() ? 
        "Se encontraron más productos. Ejecuta /ml/sync/force-advanced para sincronizarlos." :
        "La detección está completa.",
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    console.error("❌ Error en detección de productos:", err);
    res.status(500).json({ 
      error: "Error en detección: " + err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Endpoint para verificar el total real de productos en MercadoLibre
router.get("/sync/check-total", async (req: Request, res: Response) => {
  try {
    const token = await getCurrentToken();
    if (!token) throw new Error("No autenticado");

    console.log(`🔍 Verificando total real de productos para user_id: ${token.user_id}`);
    
    // Método 1: Usar el endpoint de búsqueda con diferentes límites
    let totalFromSearch = 0;
    try {
      const searchResponse = await axios.get(
        `https://api.mercadolibre.com/users/${token.user_id}/items/search?limit=1`,
        { headers: { Authorization: `Bearer ${token.access_token}` } }
      );
      totalFromSearch = searchResponse.data.paging?.total || 0;
      console.log(`📊 Total desde búsqueda: ${totalFromSearch}`);
    } catch (error) {
      console.log(`⚠️ Error obteniendo total desde búsqueda:`, error);
    }

    // Método 2: Contar productos en la base de datos
    const dbCount = await Producto.countDocuments();
    console.log(`📊 Total en base de datos: ${dbCount}`);

    // Método 3: Intentar obtener más páginas con diferentes offsets
    let maxProductsFound = 0;
    const testOffsets = [0, 1000, 2000, 3000, 4000, 5000];
    
    for (const offset of testOffsets) {
      try {
        const testResponse = await axios.get(
          `https://api.mercadolibre.com/users/${token.user_id}/items/search?offset=${offset}&limit=50`,
          { headers: { Authorization: `Bearer ${token.access_token}` } }
        );
        const results = testResponse.data.results || [];
        if (results.length > 0) {
          maxProductsFound = Math.max(maxProductsFound, offset + results.length);
          console.log(`📊 Offset ${offset}: ${results.length} productos encontrados`);
        } else {
          console.log(`📊 Offset ${offset}: Sin productos`);
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error: any) {
        console.log(`⚠️ Error en offset ${offset}:`, error.message);
        break;
      }
    }

    res.json({
      message: "Verificación de total completada",
      user_id: token.user_id,
      totals: {
        from_search_api: totalFromSearch,
        from_database: dbCount,
        max_found_with_pagination: maxProductsFound
      },
      recommendation: totalFromSearch > dbCount ? 
        "Hay más productos en ML que en la DB. Ejecuta /ml/sync/force para sincronizar todos." :
        "La sincronización parece estar completa.",
      timestamp: new Date().toISOString()
    });
    
  } catch (err: any) {
    console.error("❌ Error verificando total:", err);
    res.status(500).json({ error: "Error verificando total: " + err.message });
  }
});

// Endpoint para obtener categorías con nombres legibles para el frontend
router.get("/categorias-frontend", async (req: Request, res: Response) => {
  try {
    console.log("🔍 Obteniendo categorías para frontend...");
    
    // Obtener todos los productos con category_id
    const productos = await Producto.find(
      { category_id: { $exists: true, $ne: "" } },
      { category_id: 1, title: 1 }
    );
    
    console.log(`📊 Productos encontrados: ${productos.length}`);
    
    // Agrupar por category_id y contar
    const categoriasMap = new Map<string, { count: number; sample_titles: string[] }>();
    
    productos.forEach(producto => {
      if (producto.category_id) {
        if (!categoriasMap.has(producto.category_id)) {
          categoriasMap.set(producto.category_id, { count: 0, sample_titles: [] });
        }
        const categoria = categoriasMap.get(producto.category_id)!;
        categoria.count++;
        if (categoria.sample_titles.length < 2) {
          categoria.sample_titles.push(producto.title);
        }
      }
    });
    
    // Mapeo de categorías a nombres legibles
    const mapeoCategorias: Record<string, string> = {
      'MLU176854': 'Figuras y Coleccionables',
      'MLU163764': 'Fundas para Tablets',
      'MLU442981': 'Estuches Pokémon',
      'MLU190994': 'Mochilas',
      'MLU178089': 'Drones',
      'MLU455859': 'Varitas de Magia',
      'MLU12201': 'Colchonetas',
      'MLU163646': 'E-readers Kindle',
      'MLU165701': 'Botellas Deportivas',
      'MLU168248': 'Altavoces Bluetooth',
      'MLU443628': 'Sim Racing',
      'MLU409415': 'Asistentes Virtuales',
      'MLU3697': 'Auriculares',
      'MLU7969': 'Almohadas',
      'MLU448172': 'Accesorios Sim Racing',
      'MLU1042': 'Lentes de Cámara',
      'MLU443005': 'Juguetes VTech',
      'MLU6344': 'Consolas de Videojuegos',
      'MLU117113': 'Smartwatches',
    };
    
    // Convertir a array con nombres legibles
    const categorias = Array.from(categoriasMap.entries()).map(([categoryId, info]) => ({
      id: categoryId,
      name: mapeoCategorias[categoryId] || `Categoría ${categoryId}`,
      count: info.count,
      sample_titles: info.sample_titles
    }));
    
    // Ordenar por cantidad de productos
    categorias.sort((a, b) => b.count - a.count);
    
    console.log(`📊 Categorías encontradas: ${categorias.length}`);
    
    res.json({
      message: "Categorías para frontend obtenidas exitosamente",
      total_categories: categorias.length,
      total_products: productos.length,
      categories: categorias,
      timestamp: new Date().toISOString()
    });
    
  } catch (err: any) {
    console.error("❌ Error obteniendo categorías para frontend:", err);
    res.status(500).json({ error: "Error obteniendo categorías: " + err.message });
  }
});

router.get("/sync/force", async (req: Request, res: Response) => {
  try {
    console.log("🚀 Iniciando sincronización forzada...");
    
    // Ejecutar en background para no bloquear la respuesta
    forceUpdateProductos().then(() => {
      console.log("✅ Sincronización completada exitosamente");
    }).catch((error) => {
      console.error("❌ Error en sincronización:", error);
    });
    
    res.send("🔄 Sincronización iniciada en background. Revisa los logs del servidor para ver el progreso.");
  } catch (err: any) {
    console.error("❌ Error iniciando sincronización:", err);
    res.status(500).send("❌ Error iniciando sincronización: " + err.message);
  }
});

// Endpoint de sincronización síncrona para debugging
router.get("/sync/force-sync", async (req: Request, res: Response) => {
  try {
    console.log("🚀 Iniciando sincronización síncrona...");
    
    await forceUpdateProductos();
    
    const totalProducts = await Producto.countDocuments();
    
    res.json({
      message: "✅ Sincronización completada exitosamente",
      total_products: totalProducts,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    console.error("❌ Error en sincronización síncrona:", err);
    res.status(500).json({ 
      error: "Error en sincronización: " + err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Endpoint para sincronización avanzada (ejecuta en background)
router.get("/sync/force-advanced", async (req: Request, res: Response) => {
  try {
    logger.info("🚀 Iniciando sincronización avanzada en background...");
    
    // Ejecutar en background para evitar timeout
    advancedSyncProductos().then(async (result) => {
      logger.info("✅ Sincronización avanzada completada en background");
      logger.info(`📊 Productos encontrados: ${result.totalItems}`);
    }).catch((error) => {
      logger.error("❌ Error en sincronización avanzada", { error: error?.message || error });
    });
    
    res.json({
      message: "🔄 Sincronización avanzada iniciada en background. Revisa los logs del servidor para ver el progreso.",
      status: "running",
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    logger.error("❌ Error iniciando sincronización avanzada", { error: err?.message || err });
    res.status(500).json({ 
      error: "Error iniciando sincronización avanzada: " + err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Endpoint para sincronización robusta (nueva función mejorada)
router.get("/sync/force-robust", async (req: Request, res: Response) => {
  try {
    logger.info("🚀 Iniciando sincronización robusta en background...");
    
    // Ejecutar en background para evitar timeout
    robustSyncProductos().then(async (result) => {
      logger.info("✅ Sincronización robusta completada en background");
      logger.info(`📊 Productos únicos encontrados: ${result.totalItems}`);
      logger.info(`📊 Estrategias ejecutadas: ${result.strategies.length}`);
    }).catch((error) => {
      logger.error("❌ Error en sincronización robusta", { error: error?.message || error });
    });
    
    res.json({
      message: "🔄 Sincronización robusta iniciada en background. Esta función usa múltiples estrategias para asegurar que se obtengan todos los productos. Revisa los logs del servidor para ver el progreso.",
      status: "running",
      strategies: [
        "Paginación estándar (límite 50)",
        "Paginación con límite 25",
        "Sincronización por estados",
        "Sincronización por fechas (últimos 2 años)"
      ],
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    logger.error("❌ Error iniciando sincronización robusta", { error: err?.message || err });
    res.status(500).json({ 
      error: "Error iniciando sincronización robusta: " + err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 🆕 Endpoint extendido: combina todas las estrategias disponibles
router.get("/sync/force-extended", async (req: Request, res: Response) => {
  try {
    logger.info("🚀 Iniciando sincronización EXTENDIDA en background...");
    robustSyncExtended().then(async (result) => {
      logger.info("✅ Sincronización EXTENDIDA completada en background");
      logger.info(`📊 Productos únicos encontrados: ${result.totalItems}`);
      logger.info(`📊 Estrategias ejecutadas: ${result.strategies.length}`);
    }).catch((error) => {
      logger.error("❌ Error en sincronización EXTENDIDA", { error: error?.message || error });
    });
    res.json({
      message: "🔄 Sincronización EXTENDIDA iniciada en background. Se ejecutan todas las estrategias para capturar el máximo posible.",
      status: "running",
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    logger.error("❌ Error iniciando sincronización EXTENDIDA", { error: err?.message || err });
    res.status(500).json({ 
      error: "Error iniciando sincronización EXTENDIDA: " + err.message,
      timestamp: new Date().toISOString()
    });
  }
});
// 🆕 Diagnóstico del gap: compara IDs vistos en ML vs DB y clasifica faltantes
router.get("/sync/diagnose-gap", async (req: Request, res: Response) => {
  try {
    const token = await getCurrentToken();
    if (!token) return res.status(401).json({ error: "No autenticado" });

    console.log("🔍 Diagnóstico de gap iniciado...");

    // 1) Obtener IDs desde varias fuentes (rápido): búsqueda pública + paginación 50
    const publicRes = await syncViaPublicSearch(token);
    const paginate50 = await paginateWithLimitRobust(token, 50, 40);
    const mlIdSet = new Set<string>([...publicRes.items, ...paginate50.items]);

    // 2) IDs en DB
    const dbProducts = await Producto.find({}, 'ml_id').lean();
    const dbIdSet = new Set<string>((dbProducts || []).map((p: any) => p.ml_id));

    // 3) Faltantes = ML - DB
    const missingIds = Array.from(mlIdSet).filter(id => !dbIdSet.has(id));

    // 4) Clasificar faltantes con /items?ids= (lotes de 20)
    const classify: Record<string, number> = { ok: 0, not_found: 0, forbidden: 0, other_error: 0 };
    const samples: any[] = [];
    const chunk = <T>(arr: T[], size: number) => arr.reduce((acc: T[][], _, i) => (i % size ? acc : [...acc, arr.slice(i, i + size)]), [] as T[][]);
    const chunks = chunk(missingIds.slice(0, 400), 20); // limitar a 400 para diagnóstico rápido

    for (const group of chunks) {
      try {
        const url = `https://api.mercadolibre.com/items?ids=${group.join(',')}`;
        const { data } = await axios.get(url, { headers: { Authorization: `Bearer ${token.access_token}` } });
        for (const item of data) {
          if (item.code === 200 && item.body?.id) {
            classify.ok++;
            if (samples.length < 10) samples.push({ id: item.body.id, status: item.body.status });
          } else if (item.code === 404) {
            classify.not_found++;
          } else if (item.code === 401 || item.code === 403) {
            classify.forbidden++;
          } else {
            classify.other_error++;
          }
        }
        await new Promise(r => setTimeout(r, 150));
      } catch (e: any) {
        console.log('⚠️ Error clasificando lote:', e?.message);
      }
    }

    return res.json({
      message: "Diagnóstico completado",
      counts: {
        ml_seen: mlIdSet.size,
        db_seen: dbIdSet.size,
        missing: missingIds.length,
        classify,
      },
      samples,
      suggestion: missingIds.length > 0 ? "Ejecuta /ml/sync/backfill-missing para intentar completar faltantes" : "Sin faltantes detectados",
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("❌ Error en diagnose-gap:", err);
    return res.status(500).json({ error: "Error en diagnose-gap: " + err.message });
  }
});

// 🆕 Backfill de IDs faltantes: intenta guardar sólo los que faltan según diagnóstico rápido
router.post("/sync/backfill-missing", async (req: Request, res: Response) => {
  try {
    const token = await getCurrentToken();
    if (!token) return res.status(401).json({ error: "No autenticado" });

    // 1) Armar set ML (público + paginate 50)
    const publicRes = await syncViaPublicSearch(token);
    const paginate50 = await paginateWithLimitRobust(token, 50, 40);
    const mlIdSet = new Set<string>([...publicRes.items, ...paginate50.items]);

    // 2) Set DB
    const dbProducts = await Producto.find({}, 'ml_id').lean();
    const dbIdSet = new Set<string>((dbProducts || []).map((p: any) => p.ml_id));

    // 3) Faltantes
    const missingIds = Array.from(mlIdSet).filter(id => !dbIdSet.has(id));
    if (missingIds.length === 0) return res.json({ message: 'No hay faltantes para backfill' });

    let ok = 0; let errors = 0; const errorSamples: any[] = [];
    for (const id of missingIds) {
      try {
        const { data: itemDetail } = await axios.get(
          `https://api.mercadolibre.com/items/${id}`,
          { headers: { Authorization: `Bearer ${token.access_token}` } }
        );

        const existingProduct = await Producto.findOne({ ml_id: itemDetail.id }).lean();
        const priceEvaluation = evaluatePriceForUpdate(itemDetail.price, existingProduct, {
          source: 'backfill_missing',
          ml_id: itemDetail.id,
          metadata: { title: itemDetail.title },
        });

        // Guardar mínimo en DB
        const identity = extractIdentityFields(itemDetail);
        await Producto.findOneAndUpdate(
          { ml_id: itemDetail.id },
          {
            ml_id: itemDetail.id,
            title: itemDetail.title,
            ...priceEvaluation.fields,
            available_quantity: itemDetail.available_quantity,
            status: itemDetail.status,
            permalink: getCorrectPermalink(itemDetail),
            catalog_product_id: identity.catalog_product_id,
            es_catalogo: identity.es_catalogo,
            seller_sku: identity.seller_sku,
            images: itemDetail.pictures?.map((p: any) => ({ id: p.id, url: p.secure_url?.replace('-I.jpg', '-O.jpg') || p.url, max_size: p.max_size })) || [],
            category_id: itemDetail.category_id || "",
          },
          { upsert: true, new: true }
        );
        ok++;
        await new Promise(r => setTimeout(r, 60));
      } catch (e: any) {
        errors++;
        if (errorSamples.length < 10) errorSamples.push({ id, error: e?.response?.status || e?.message });
      }
    }

    return res.json({
      message: 'Backfill completado',
      tried: missingIds.length,
      ok,
      errors,
      errorSamples,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("❌ Error en backfill-missing:", err);
    return res.status(500).json({ error: "Error en backfill-missing: " + err.message });
  }
});

// 🆕 Diagnóstico extendido: usa TODAS las estrategias para listar IDs ML y comparar con DB
router.get("/sync/diagnose-gap-extended", async (req: Request, res: Response) => {
  try {
    const token = await getCurrentToken();
    if (!token) return res.status(401).json({ error: "No autenticado" });

    console.log("🔍 Diagnóstico EXTENDIDO de gap iniciado...");
    let allItems: string[] = [];
    const s1 = await paginateWithLimitRobust(token, 50, 60);
    const s2 = await paginateWithLimitRobust(token, 25, 80);
    const s3 = await syncByStatusRobust(token);
    const s4 = await syncByStatusAndDateRobust(token);
    const s5 = await syncActiveByPriceRanges(token);
    const s6 = await syncByCategoriesRobust(token);
    const s7 = await syncByOrderingRobust(token);
    const s8 = await syncViaPublicSearch(token);
    allItems = allItems.concat(s1.items, s2.items, s3.items, s4.items, s5.items, s6.items, s7.items, s8.items);
    const mlIdSet = new Set<string>(
      deduplicateItems(allItems).map((it: any) => (typeof it === 'string' ? it : it?.id)).filter(Boolean)
    );

    const dbProducts = await Producto.find({}, 'ml_id').lean();
    const dbIdSet = new Set<string>((dbProducts || []).map((p: any) => p.ml_id));
    const missingIds = Array.from(mlIdSet).filter(id => !dbIdSet.has(id));

    return res.json({
      message: "Diagnóstico EXTENDIDO completado",
      counts: { ml_seen: mlIdSet.size, db_seen: dbIdSet.size, missing: missingIds.length },
      suggestion: missingIds.length > 0 ? "Ejecuta POST /ml/sync/backfill-missing-extended" : "Sin faltantes detectados",
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("❌ Error en diagnose-gap-extended:", err);
    return res.status(500).json({ error: "Error en diagnose-gap-extended: " + err.message });
  }
});

// 🆕 Backfill extendido: intenta completar IDs faltantes encontrados por diagnóstico extendido
router.post("/sync/backfill-missing-extended", async (req: Request, res: Response) => {
  try {
    const token = await getCurrentToken();
    if (!token) return res.status(401).json({ error: "No autenticado" });

    let allItems: string[] = [];
    const s1 = await paginateWithLimitRobust(token, 50, 60);
    const s2 = await paginateWithLimitRobust(token, 25, 80);
    const s3 = await syncByStatusRobust(token);
    const s4 = await syncByStatusAndDateRobust(token);
    const s5 = await syncActiveByPriceRanges(token);
    const s6 = await syncByCategoriesRobust(token);
    const s7 = await syncByOrderingRobust(token);
    const s8 = await syncViaPublicSearch(token);
    allItems = allItems.concat(s1.items, s2.items, s3.items, s4.items, s5.items, s6.items, s7.items, s8.items);
    const mlIdSet = new Set<string>(
      deduplicateItems(allItems).map((it: any) => (typeof it === 'string' ? it : it?.id)).filter(Boolean)
    );

    const dbProducts = await Producto.find({}, 'ml_id').lean();
    const dbIdSet = new Set<string>((dbProducts || []).map((p: any) => p.ml_id));
    const missingIds = Array.from(mlIdSet).filter(id => !dbIdSet.has(id));
    if (missingIds.length === 0) return res.json({ message: 'No hay faltantes para backfill (extended)' });

    let ok = 0; let errors = 0; const errorSamples: any[] = [];
    for (const id of missingIds) {
      try {
        const { data: itemDetail } = await axios.get(
          `https://api.mercadolibre.com/items/${id}`,
          { headers: { Authorization: `Bearer ${token.access_token}` } }
        );
        const existingProduct = await Producto.findOne({ ml_id: itemDetail.id }).lean();
        const priceEvaluation = evaluatePriceForUpdate(itemDetail.price, existingProduct, {
          source: 'backfill_missing_extended',
          ml_id: itemDetail.id,
          metadata: { title: itemDetail.title },
        });
        const identity = extractIdentityFields(itemDetail);
        await Producto.findOneAndUpdate(
          { ml_id: itemDetail.id },
          {
            ml_id: itemDetail.id,
            title: itemDetail.title,
            ...priceEvaluation.fields,
            available_quantity: itemDetail.available_quantity,
            status: itemDetail.status,
            permalink: getCorrectPermalink(itemDetail),
            catalog_product_id: identity.catalog_product_id,
            es_catalogo: identity.es_catalogo,
            seller_sku: identity.seller_sku,
            images: itemDetail.pictures?.map((p: any) => ({ id: p.id, url: p.secure_url?.replace('-I.jpg', '-O.jpg') || p.url, max_size: p.max_size })) || [],
            category_id: itemDetail.category_id || "",
          },
          { upsert: true, new: true }
        );
        ok++;
        await new Promise(r => setTimeout(r, 60));
      } catch (e: any) {
        errors++;
        if (errorSamples.length < 10) errorSamples.push({ id, error: e?.response?.status || e?.message });
      }
    }

    return res.json({ message: 'Backfill (extended) completado', tried: missingIds.length, ok, errors, errorSamples, timestamp: new Date().toISOString() });
  } catch (err: any) {
    console.error("❌ Error en backfill-missing-extended:", err);
    return res.status(500).json({ error: "Error en backfill-missing-extended: " + err.message });
  }
});

// 🧠 Función extendida que agrega estrategias adicionales a la robusta
async function robustSyncExtended() {
  const token = await getCurrentToken();
  if (!token) throw new Error("No autenticado");

  logger.info(`🚀 Iniciando sincronización EXTENDIDA para user_id: ${token.user_id}`);

  let allItems: string[] = [];
  const strategies: Array<{ name: string; items: number; processed: number; errors: number }> = [];
  let totalProcessed = 0;
  let totalErrors = 0;

  // 1) Paginación múltiple 25/50/100
  for (const cfg of [{ l: 25, p: 60 }, { l: 50, p: 60 }, { l: 100, p: 40 }]) {
    try {
      const s = await paginateWithLimitRobust(token, cfg.l, cfg.p);
      savePartial(s.items, `extended-paginate-${cfg.l}`);
      allItems = allItems.concat(s.items);
      totalProcessed += s.processed; totalErrors += s.errors;
      strategies.push({ name: `Paginate ${cfg.l}`, items: s.items.length, processed: s.processed, errors: s.errors });
      logger.info(`📊 Paginate ${cfg.l}: ${s.items.length} únicos`);
    } catch (e: any) { logger.error(`❌ Error paginate ${cfg.l}`, { error: e?.message || e }); }
  }

  // 2) Por estados (active/paused/closed/under_review)
  try {
    const s = await syncByStatusRobust(token);
    savePartial(s.items, "extended-status");
    allItems = allItems.concat(s.items);
    totalProcessed += s.processed; totalErrors += s.errors;
    strategies.push({ name: "Status", items: s.items.length, processed: s.processed, errors: s.errors });
  } catch (e: any) { logger.error("❌ Error status", { error: e?.message || e }); }

  // 3) Estado + fecha (últimos 90 días por día y 3–24 meses por mes)
  try {
    const s = await syncByStatusAndDateRobust(token);
    savePartial(s.items, "extended-status-date");
    allItems = allItems.concat(s.items);
    totalProcessed += s.processed; totalErrors += s.errors || 0;
    strategies.push({ name: "Status+Date", items: s.items.length, processed: s.processed, errors: s.errors || 0 });
  } catch (e: any) { logger.error("❌ Error status+date", { error: e?.message || e }); }

  // 4) Activos por rangos de precio
  try {
    const s = await syncActiveByPriceRanges(token);
    savePartial(s.items, "extended-price-ranges");
    allItems = allItems.concat(s.items);
    totalProcessed += s.processed; totalErrors += s.errors;
    strategies.push({ name: "Active by Price", items: s.items.length, processed: s.processed, errors: s.errors });
  } catch (e: any) { logger.error("❌ Error price ranges", { error: e?.message || e }); }

  // 5) Por categorías
  try {
    const s = await syncByCategoriesRobust(token);
    savePartial(s.items, "extended-categories");
    allItems = allItems.concat(s.items);
    totalProcessed += s.processed; totalErrors += s.errors;
    strategies.push({ name: "Categories", items: s.items.length, processed: s.processed, errors: s.errors });
  } catch (e: any) { logger.error("❌ Error categories", { error: e?.message || e }); }

  // 6) Por ordenamiento (price_asc/price_desc)
  try {
    const s = await syncByOrderingRobust(token);
    savePartial(s.items, "extended-ordering");
    allItems = allItems.concat(s.items);
    totalProcessed += s.processed; totalErrors += s.errors;
    strategies.push({ name: "Ordering", items: s.items.length, processed: s.processed, errors: s.errors });
  } catch (e: any) { logger.error("❌ Error ordering", { error: e?.message || e }); }

  // 7) Búsqueda pública por seller_id (sin autenticación)
  try {
    const s = await syncViaPublicSearch(token);
    savePartial(s.items, "extended-public-search");
    allItems = allItems.concat(s.items);
    totalProcessed += s.processed; totalErrors += s.errors;
    strategies.push({ name: "Public Search", items: s.items.length, processed: s.processed, errors: s.errors });
  } catch (e: any) { logger.error("❌ Error public search", { error: e?.message || e }); }

  // Deduplicar y procesar
  const uniqueItems = deduplicateItems(allItems);
  savePartial(uniqueItems, "extended-final-merged");
  logger.info(`🎯 EXTENDED: únicos=${uniqueItems.length}, procesados=${totalProcessed}, errores=${totalErrors}`);

  let processedCount = 0;
  let errorCount = 0;
  const processingErrors: string[] = [];
  for (const itemId of uniqueItems) {
    try {
      const { data: itemDetail } = await axios.get(
        `https://api.mercadolibre.com/items/${itemId}`,
        { headers: { Authorization: `Bearer ${token.access_token}` } }
      );
      let description = "";
      try {
        const descResponse = await axios.get(
          `https://api.mercadolibre.com/items/${itemId}/description`,
          { headers: { Authorization: `Bearer ${token.access_token}` } }
        );
        description = descResponse.data.plain_text || "";
      } catch {}
      const existingProduct = await Producto.findOne({ ml_id: itemDetail.id }).lean();
      const priceEvaluation = evaluatePriceForUpdate(itemDetail.price, existingProduct, {
        source: 'robust_sync_extended',
        ml_id: itemDetail.id,
        metadata: { title: itemDetail.title },
      });
      const effectiveProductPrice = priceEvaluation.price;

      let producto = await Producto.findOneAndUpdate(
        { ml_id: itemDetail.id },
        {
          ml_id: itemDetail.id,
          title: itemDetail.title,
          ...priceEvaluation.fields,
          available_quantity: itemDetail.available_quantity,
          status: itemDetail.status,
          permalink: getCorrectPermalink(itemDetail),
          images: itemDetail.pictures?.map((picture: any) => ({
            id: picture.id,
            url: picture.secure_url?.replace('-I.jpg', '-O.jpg') || picture.url,
            max_size: picture.max_size
          })) || [],
          description,
          sold_quantity: itemDetail.sold_quantity || 0,
          warranty: itemDetail.warranty || "",
          attributes: itemDetail.attributes || [],
          tags: itemDetail.tags || [],
          category_id: itemDetail.category_id || "",
          condition: itemDetail.condition || "",
          listing_type_id: itemDetail.listing_type_id || "",
          shipping: itemDetail.shipping || {},
          health: itemDetail.health || 0,
          metrics: {
            visits: itemDetail.visits || 0,
            reviews: { rating_average: itemDetail.reviews?.rating_average || 0, total: itemDetail.reviews?.total || 0 }
          },
          date_created: itemDetail.date_created ? new Date(itemDetail.date_created) : new Date(),
          last_updated: itemDetail.last_updated ? new Date(itemDetail.last_updated) : new Date()
        },
        { upsert: true, new: true }
      );
      if (itemDetail.variations?.length > 0 && producto) {
        const varianteIds: string[] = [];
        for (const variante of itemDetail.variations) {
          if (!variante.id) continue;
          const color = variante.attribute_combinations.find((a: any) => a.id === "COLOR")?.value_name || null;
          const size = variante.attribute_combinations.find((a: any) => a.id === "SIZE")?.value_name || null;
          const savedVariante = await Variante.findOneAndUpdate(
            { id: variante.id.toString() },
            {
              id: variante.id.toString(),
              product_id: producto._id,
              color,
              size,
              stock: variante.available_quantity,
              price: variante.price || effectiveProductPrice,
              images: variante.picture_ids?.map((id: string) => ({ id, url: `https://http2.mlstatic.com/D_${id}-F.jpg`, high_quality: `https://http2.mlstatic.com/D_${id}-O.jpg` })) || [],
              attribute_combinations: variante.attribute_combinations?.map((attr: any) => ({ id: attr.id, name: attr.name, value_id: attr.value_id, value_name: attr.value_name })) || []
            },
            { upsert: true, new: true }
          );
          if (savedVariante) varianteIds.push(savedVariante._id.toString());
        }
        producto.variantes = varianteIds.map(id => new Types.ObjectId(id));
        await producto.save();
      }
      processedCount++;
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error: any) {
      processingErrors.push(`${itemId}: ${error.message}`);
      errorCount++;
    }
  }

  logger.info(`🎉 EXTENDED COMPLETADO: ok=${processedCount}, errores=${errorCount}, únicos=${uniqueItems.length}`);
  return { totalItems: uniqueItems.length, totalProcessed: processedCount, totalErrors: errorCount, strategies, items: uniqueItems, processingErrors };
}

// Función mejorada para sincronización robusta con múltiples estrategias
async function robustSyncProductos() {
  const token = await getCurrentToken();
  if (!token) throw new Error("No autenticado");

  logger.info(`🚀 Iniciando sincronización robusta para user_id: ${token.user_id}`);
  
  let allItems: string[] = [];
  const strategies = [];
  let totalProcessed = 0;
  let totalErrors = 0;

  // Estrategia 1: Paginación estándar con límite 50
  logger.info("📋 Estrategia 1: Paginación estándar (límite 50)");
  try {
    const strategy1 = await paginateWithLimitRobust(token, 50, 40);
    savePartial(strategy1.items, "strategy1-paginate50");
    allItems = allItems.concat(strategy1.items);
    totalProcessed += strategy1.processed;
    totalErrors += strategy1.errors;
    strategies.push({ 
      name: "Paginación Estándar", 
      items: strategy1.items.length, 
      processed: strategy1.processed, 
      errors: strategy1.errors 
    });
    logger.info(`📊 Estrategia 1: ${strategy1.items.length} productos únicos`);
  } catch (error) {
    logger.error("❌ Error en estrategia 1", { error: (error as any)?.message || error });
  }

  // Estrategia 2: Paginación con límite 25 (más páginas)
  logger.info("📋 Estrategia 2: Paginación con límite 25");
  try {
    const strategy2 = await paginateWithLimitRobust(token, 25, 50);
    savePartial(strategy2.items, "strategy2-paginate25");
    allItems = allItems.concat(strategy2.items);
    totalProcessed += strategy2.processed;
    totalErrors += strategy2.errors;
    strategies.push({ 
      name: "Paginación 25", 
      items: strategy2.items.length, 
      processed: strategy2.processed, 
      errors: strategy2.errors 
    });
    logger.info(`📊 Estrategia 2: ${strategy2.items.length} productos únicos`);
  } catch (error) {
    logger.error("❌ Error en estrategia 2", { error: (error as any)?.message || error });
  }

  // Estrategia 3: Sincronización por estados
  logger.info("📋 Estrategia 3: Sincronización por estados");
  try {
    const strategy3 = await syncByStatusRobust(token);
    savePartial(strategy3.items, "strategy3-status");
    allItems = allItems.concat(strategy3.items);
    totalProcessed += strategy3.processed;
    totalErrors += strategy3.errors;
    strategies.push({ 
      name: "Por Estados", 
      items: strategy3.items.length, 
      processed: strategy3.processed, 
      errors: strategy3.errors 
    });
    logger.info(`📊 Estrategia 3: ${strategy3.items.length} productos únicos`);
  } catch (error) {
    logger.error("❌ Error en estrategia 3", { error: (error as any)?.message || error });
  }

  // Estrategia 4: API de búsqueda PÚBLICA (sin autenticación, sin límite de offset)
  logger.info("📋 Estrategia 4: Búsqueda pública por seller_id");
  try {
    const strategy4 = await syncViaPublicSearch(token);
    savePartial(strategy4.items, "strategy4-public-search");
    allItems = allItems.concat(strategy4.items);
    totalProcessed += strategy4.processed;
    totalErrors += strategy4.errors;
    strategies.push({ 
      name: "Búsqueda Pública", 
      items: strategy4.items.length, 
      processed: strategy4.processed, 
      errors: strategy4.errors 
    });
    logger.info(`📊 Estrategia 4: ${strategy4.items.length} productos únicos`);
  } catch (error) {
    logger.error("❌ Error en estrategia 4", { error: (error as any)?.message || error });
  }

  // Deduplicar TODOS los productos de todas las estrategias
  const uniqueItems = deduplicateItems(allItems);
  savePartial(uniqueItems, "final-merged");

  logger.info("🎉 DETECCIÓN ROBUSTA COMPLETADA");
  logger.info(`📊 Total de productos únicos encontrados: ${uniqueItems.length}`);
  logger.info(`📊 Total procesados (con duplicados): ${totalProcessed}`);
  logger.info(`📊 Total errores: ${totalErrors}`);
  logger.info(`📊 Estrategias ejecutadas: ${strategies.length}`);

  // 🚀 PROCESAR TODOS LOS PRODUCTOS ENCONTRADOS
  logger.info(`🔄 Iniciando procesamiento de ${uniqueItems.length} productos únicos...`);
  
  let processedCount = 0;
  let errorCount = 0;
  const processingErrors: string[] = [];

  for (const itemId of uniqueItems) {
    try {
      // Esto es lo que más “spamea”: lo pasamos a debug (apagado por defecto).
      logger.debug(`🔄 Procesando producto ${processedCount + 1}/${uniqueItems.length}: ${itemId}`);
      
      const { data: itemDetail } = await axios.get(
        `https://api.mercadolibre.com/items/${itemId}`,
        { headers: { Authorization: `Bearer ${token.access_token}` } }
      );

      // DEBUG UNIVERSAL: Mostrar info de todos los productos para rastrear bug de precios incluso en Railway
      logger.debug(`[DEBUG][ML_API] id=${itemDetail.id} price=${itemDetail.price} original=${itemDetail.original_price} title="${itemDetail.title}"`);

      // Obtener descripción por separado
      let description = "";
      try {
        const descResponse = await axios.get(
          `https://api.mercadolibre.com/items/${itemId}/description`,
          { headers: { Authorization: `Bearer ${token.access_token}` } }
        );
        description = descResponse.data.plain_text || "";
      } catch (error) {
        logger.debug("⚠️ No se pudo obtener la descripción", { itemId });
      }

      const existingProduct = await Producto.findOne({ ml_id: itemDetail.id }).lean();
      
      // Detectar descuento nativo de MercadoLibre
      const descuentoML = itemDetail.original_price && itemDetail.original_price !== itemDetail.price
        ? {
            original_price: itemDetail.original_price,
            deal_ids: itemDetail.deal_ids || []
          }
        : undefined;
      
      // Si hay descuento ML, itemDetail.price ya viene rebajado de ML
      // Asegurarse de que se use ese precio rebajado
      let precioParaGuardar = itemDetail.price;
      if (descuentoML && existingProduct?.descuento?.activo) {
        // Si hay descuento ML Y descuento manual, calcular descuento manual sobre precio rebajado de ML
        const porcentajeManual = existingProduct.descuento.porcentaje || 0;
        precioParaGuardar = Math.round(itemDetail.price * (1 - porcentajeManual / 100) * 100) / 100;
      }
      
      const priceEvaluation = evaluatePriceForUpdate(precioParaGuardar, existingProduct, {
        source: 'robust_sync',
        ml_id: itemDetail.id,
        metadata: { title: itemDetail.title },
      });
      let effectiveProductPrice = priceEvaluation.price;
      
      // FORZAR el precio SIEMPRE al rebajado de ML si existe descuento ML
      if (itemDetail.original_price && itemDetail.original_price > itemDetail.price) {
        priceEvaluation.fields.price = itemDetail.price;
        priceEvaluation.fields.last_valid_price = itemDetail.price;
        // LOG ESPECIAL PARA AUDITORÍA AUTOMÁTICA
        if (itemDetail.id === 'MLU693479060') {
          logger.info("[SYNC] Grabando PRECIO REBAJADO de ML", {
            ml_id: itemDetail.id,
            precio_ml: itemDetail.price,
            original_ml: itemDetail.original_price,
            precio_grabado: priceEvaluation.fields.price,
            last_valid_price: priceEvaluation.fields.last_valid_price,
          });
        }
      }
      // REFUERZO: aunque el precio en la base sea igual, se fuerza el update.
      if (itemDetail.id === 'MLU693479060') {
        logger.info("[SYNC] Post-evaluación (antes de grabar)", {
          ml_id: itemDetail.id,
          precio_ml: itemDetail.price,
          original_ml: itemDetail.original_price,
          fields: priceEvaluation.fields,
        });
      }

      // --- Producto ---
      const identity = extractIdentityFields(itemDetail);
      let producto = await Producto.findOneAndUpdate(
        { ml_id: itemDetail.id },
        {
          ml_id: itemDetail.id,
          title: itemDetail.title,
          ...priceEvaluation.fields,
          descuento_ml: descuentoML, // ✅ Guardar descuento nativo de ML
          available_quantity: itemDetail.available_quantity,
          status: itemDetail.status,
          permalink: getCorrectPermalink(itemDetail), // URL validada de la publicación
          catalog_product_id: identity.catalog_product_id,
          es_catalogo: identity.es_catalogo,
          seller_sku: identity.seller_sku,
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
              price: variante.price || effectiveProductPrice,
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

      // --- 🚀 LÓGICA DE DROPSHIPPING ---
      const manufacturingTime = itemDetail.sale_terms?.find((term: any) => 
        term.id === "MANUFACTURING_TIME"
      );
      
      let handlingTime = 3; // Default para stock físico
      
      if (manufacturingTime?.value_struct?.number) {
        handlingTime = manufacturingTime.value_struct.number;
      }
      
      const productType = handlingTime > 10 ? "dropshipping" : "stock_fisico";
      const deliveryTimes = calculateDeliveryTimes(productType, handlingTime);
      
      // Actualizar producto con información de dropshipping
      const updateData: any = {
        tipo_venta: productType,
        tiempo_entrega_total: deliveryTimes.total,
        tiempo_entrega_texto: deliveryTimes.texto
      };
      
      if (productType === "dropshipping") {
        updateData.dropshipping = {
          dias_preparacion: handlingTime,
          dias_envio_estimado: 7,
          proveedor: "Proveedor externo",
          pais_origen: "Estados Unidos",
          requiere_confirmacion: true,
          costo_importacion: 0,
          tiempo_configurado_en_ml: handlingTime > 3
        };
      } else {
        updateData.stock_fisico = {
          cantidad_disponible: itemDetail.available_quantity || 0,
          ubicacion: "Almacén local",
          reorder_point: Math.max(1, Math.floor((itemDetail.available_quantity || 0) * 0.2)),
          ultima_actualizacion_stock: new Date(),
          tiempo_configurado_en_ml: handlingTime > 3
        };
      }
      
      await Producto.findOneAndUpdate(
        { ml_id: itemDetail.id },
        { $set: updateData },
        { new: true }
      );
      
      // console.log(`✅ Producto ${itemId} sincronizado correctamente`); // Comentado para reducir logs
      
      processedCount++;
      
      // Pausa entre productos
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error: any) {
      console.error(`❌ Error procesando producto ${itemId}:`, error.message);
      processingErrors.push(`${itemId}: ${error.message}`);
      errorCount++;
    }
  }
  
  console.log(`🎉 PROCESAMIENTO COMPLETADO:`);
  console.log(`✅ Productos procesados exitosamente: ${processedCount}`);
  console.log(`❌ Productos con errores: ${errorCount}`);
  console.log(`📊 Total de productos únicos encontrados: ${uniqueItems.length}`);
  console.log(`📊 Total de productos en base de datos: ${await Producto.countDocuments()}`);

  return {
    totalItems: uniqueItems.length,
    totalProcessed: processedCount,
    totalErrors: errorCount,
    strategies,
    items: uniqueItems,
    processingErrors
  };
}
// Función auxiliar robusta para paginación con reintentos automáticos
async function paginateWithLimitRobust(token: any, limit: number, maxPages: number) {
  let allItems: string[] = [];
  let offset = 0;
  let hasMore = true;
  let totalPages = 0;
  let processed = 0;
  let errors = 0;
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 3;

  while (hasMore && totalPages < maxPages) {
    totalPages++;
    console.log(`📄 Límite ${limit} - Página ${totalPages}/${maxPages} (offset: ${offset})`);
    
    try {
      // Usar retryRequest para reintentos automáticos
      const itemsResponse = await retryRequest(() => 
        axios.get(
          `https://api.mercadolibre.com/users/${token.user_id}/items/search?offset=${offset}&limit=${limit}`,
          { headers: { Authorization: `Bearer ${token.access_token}` } }
        )
      );

      const pageResults = itemsResponse.data.results || [];
      //console.log(`📊 Límite ${limit} - Productos en página ${totalPages}: ${pageResults.length}`);
      
      if (pageResults.length === 0) {
        hasMore = false;
        console.log(`✅ Límite ${limit} - No hay más productos. Total: ${allItems.length}`);
      } else {
        allItems = allItems.concat(pageResults);
        offset += limit;
        processed += pageResults.length;
        consecutiveErrors = 0;
        
        // Pausa adaptativa basada en el límite
        const pauseTime = limit <= 25 ? 200 : 300;
        await new Promise(resolve => setTimeout(resolve, pauseTime));
      }
    } catch (error: any) {
      console.error(`❌ Límite ${limit} - Error en página ${totalPages}:`, error.message);
      errors++;
      consecutiveErrors++;
      
      if (error.response?.status === 400) {
        hasMore = false;
        console.log(`⚠️ Límite ${limit} - API rechazó offset ${offset}, capturados: ${allItems.length}`);
      } else if (consecutiveErrors >= maxConsecutiveErrors) {
        hasMore = false;
        console.log(`⚠️ Límite ${limit} - Demasiados errores consecutivos, deteniendo`);
      } else {
        offset += limit;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  // Deduplicar antes de retornar
  return { items: deduplicateItems(allItems), processed, errors };
}

// Función robusta para sincronización por estados con reintentos
async function syncByStatusRobust(token: any) {
  const statuses = ['active', 'paused', 'closed', 'under_review'];
  let allItems: string[] = [];
  let processed = 0;
  let errors = 0;

  for (const status of statuses) {
    console.log(`📋 Sincronizando productos con estado: ${status}`);
    try {
      let offset = 0;
      let hasMore = true;
      let statusProcessed = 0;
      
      while (hasMore) {
        try {
          // Usar retryRequest para reintentos automáticos
          const response = await retryRequest(() =>
            axios.get(
              `https://api.mercadolibre.com/users/${token.user_id}/items/search?status=${status}&offset=${offset}&limit=50`,
              { headers: { Authorization: `Bearer ${token.access_token}` } }
            )
          );
          
          const results = response.data.results || [];
          if (results.length === 0) {
            hasMore = false;
          } else {
            allItems = allItems.concat(results);
            processed += results.length;
            statusProcessed += results.length;
            offset += 50;
          }
          
          await new Promise(resolve => setTimeout(resolve, 300));
        } catch (error: any) {
          if (error.response?.status === 400) {
            console.log(`⚠️ Estado ${status} - API rechazó offset ${offset}, capturados: ${statusProcessed}`);
            hasMore = false;
          } else {
            throw error;
          }
        }
      }
      
      console.log(`📊 Estado ${status}: ${statusProcessed} productos`);
    } catch (error) {
      console.error(`❌ Error sincronizando estado ${status}:`, error);
      errors++;
    }
  }

  // Deduplicar antes de retornar
  return { items: deduplicateItems(allItems), processed, errors };
}

// Función para sincronizar usando API de búsqueda PÚBLICA (puede tener límites diferentes)
async function syncViaPublicSearch(token: any) {
  let allItems: string[] = [];
  let processed = 0;
  let errors = 0;

  console.log("🔍 Usando API de búsqueda pública (sin límite de offset?)...");
  
  try {
    let offset = 0;
    let hasMore = true;
    const limit = 50;
    let totalPages = 0;
    
    // Usar el endpoint de búsqueda pública por seller_id
    // Este endpoint NO requiere autenticación y puede tener límites diferentes
    while (hasMore && totalPages < 100) {
      totalPages++;
      
      try {
        // NO usar token, es endpoint público
        const response = await axios.get(
          `https://api.mercadolibre.com/sites/MLU/search?seller_id=${token.user_id}&offset=${offset}&limit=${limit}`
        );
        
        const results = response.data.results || [];
        console.log(`📄 Búsqueda pública - Página ${totalPages}, offset ${offset}: ${results.length} productos`);
        
        if (results.length === 0) {
          hasMore = false;
        } else {
          // Los resultados son objetos, extraer solo los IDs
          const ids = results.map((item: any) => item.id);
          allItems = allItems.concat(ids);
          processed += results.length;
          offset += limit;
        }
        
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (error: any) {
        if (error.response?.status === 400) {
          console.log(`⚠️ Búsqueda pública - Offset ${offset} rechazado`);
          hasMore = false;
        } else {
          throw error;
        }
      }
    }
    
    console.log(`📊 Búsqueda pública capturó: ${allItems.length} productos`);
  } catch (error: any) {
    console.error(`❌ Error en búsqueda pública:`, error.message);
    errors++;
  }

  return { items: deduplicateItems(allItems), processed, errors };
}

// Función para sincronizar productos ACTIVOS divididos por RANGOS DE PRECIO
async function syncActiveByPriceRanges(token: any) {
  let allItems: string[] = [];
  let processed = 0;
  let errors = 0;

  // Dividir en rangos de precio UYU (aunque el vendedor piense en USD, ML almacena en UYU)
  // Conversión aprox: 1 USD = 40 UYU
  // Con 1542 activos, dividir en rangos más granulares
  const priceRanges = [
    { min: 0, max: 200, name: "0-200" },          // ~0-5 USD
    { min: 200, max: 400, name: "200-400" },      // ~5-10 USD
    { min: 400, max: 800, name: "400-800" },      // ~10-20 USD
    { min: 800, max: 1200, name: "800-1200" },    // ~20-30 USD
    { min: 1200, max: 1600, name: "1200-1600" },  // ~30-40 USD
    { min: 1600, max: 2000, name: "1600-2000" },  // ~40-50 USD
    { min: 2000, max: 3000, name: "2000-3000" },  // ~50-75 USD
    { min: 3000, max: 4000, name: "3000-4000" },  // ~75-100 USD
    { min: 4000, max: 6000, name: "4000-6000" },  // ~100-150 USD
    { min: 6000, max: 10000, name: "6000-10000" },// ~150-250 USD
    { min: 10000, max: 999999, name: "10000+" }   // >250 USD
  ];

  for (const range of priceRanges) {
    console.log(`📋 Sincronizando activos rango ${range.name} UYU`);
    try {
      let offset = 0;
      let hasMore = true;
      let rangeProcessed = 0;
      
      while (hasMore) {
        try {
          const response = await retryRequest(() =>
            axios.get(
              `https://api.mercadolibre.com/users/${token.user_id}/items/search?status=active&price=${range.min}-${range.max}&offset=${offset}&limit=50`,
              { headers: { Authorization: `Bearer ${token.access_token}` } }
            )
          );
          
          const results = response.data.results || [];
          if (results.length === 0) {
            hasMore = false;
          } else {
            allItems = allItems.concat(results);
            processed += results.length;
            rangeProcessed += results.length;
            offset += 50;
          }
          
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error: any) {
          if (error.response?.status === 400) {
            console.log(`⚠️ Rango ${range.name} - Offset ${offset}, capturados: ${rangeProcessed}`);
            hasMore = false;
          } else {
            throw error;
          }
        }
      }
      
      if (rangeProcessed > 0) {
        console.log(`📊 Rango ${range.name}: ${rangeProcessed} productos`);
      }
    } catch (error) {
      console.error(`❌ Error sincronizando rango ${range.name}:`, error);
      errors++;
    }
  }

  console.log(`📊 Total capturado por rangos de precio: ${processed} productos`);
  return { items: deduplicateItems(allItems), processed, errors };
}

// Función para sincronizar combinando ESTADO + FECHA (optimizada)
async function syncByStatusAndDateRobust(token: any) {
  let allItems: string[] = [];
  let processed = 0;
  let errors = 0;

  const statuses = ['active', 'paused'];
  const currentDate = new Date();
  
  // PARTE 1: Últimos 90 días POR DÍA (productos recientes muy densos)
  console.log(`📋 Sincronizando últimos 90 días por día + estado...`);
  const recentDays = [];
  for (let i = 0; i < 90; i++) {
    const date = new Date(currentDate);
    date.setDate(date.getDate() - i);
    recentDays.push(date.toISOString().split('T')[0]);
  }
  
  for (const status of statuses) {
    for (const day of recentDays) {
      try {
        let offset = 0;
        let hasMore = true;
        let dayProcessed = 0;
        
        while (hasMore) {
          try {
            // Usar retryRequest para reintentos automáticos
            const response = await retryRequest(() =>
              axios.get(
                `https://api.mercadolibre.com/users/${token.user_id}/items/search?status=${status}&date_created_from=${day}&date_created_to=${day}&offset=${offset}&limit=50`,
                { headers: { Authorization: `Bearer ${token.access_token}` } }
              )
            );
            
            const results = response.data.results || [];
            if (results.length === 0) {
              hasMore = false;
            } else {
              allItems = allItems.concat(results);
              processed += results.length;
              dayProcessed += results.length;
              offset += 50;
            }
            
            await new Promise(resolve => setTimeout(resolve, 150));
          } catch (error: any) {
            if (error.response?.status === 400) {
              console.log(`⚠️ ${status}/${day} - Offset ${offset}, capturados: ${dayProcessed}`);
              hasMore = false;
            } else {
              throw error;
            }
          }
        }
        
        if (dayProcessed > 0) {
          console.log(`📊 ${status}/${day}: ${dayProcessed} productos`);
        }
      } catch (error) {
        // Continuar si falla un día específico
      }
    }
  }

  // PARTE 2: De 90 días a 2 años atrás POR MES (productos antiguos menos densos)
  console.log(`📋 Sincronizando productos antiguos (90 días a 2 años) por mes + estado...`);
  const olderMonths = [];
  for (let i = 3; i < 24; i++) { // Meses 3-24 (salteando los primeros 3 meses ya cubiertos por días)
    const startDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
    const endDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - i + 1, 0);
    olderMonths.push({
      start: startDate.toISOString().split('T')[0],
      end: endDate.toISOString().split('T')[0]
    });
  }
  
  for (const status of statuses) {
    for (const month of olderMonths) {
      try {
        let offset = 0;
        let hasMore = true;
        let monthProcessed = 0;
        
        while (hasMore) {
          try {
            // Usar retryRequest para reintentos automáticos
            const response = await retryRequest(() =>
              axios.get(
                `https://api.mercadolibre.com/users/${token.user_id}/items/search?status=${status}&date_created_from=${month.start}&date_created_to=${month.end}&offset=${offset}&limit=50`,
                { headers: { Authorization: `Bearer ${token.access_token}` } }
              )
            );
            
            const results = response.data.results || [];
            if (results.length === 0) {
              hasMore = false;
            } else {
              allItems = allItems.concat(results);
              processed += results.length;
              monthProcessed += results.length;
              offset += 50;
            }
            
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch (error: any) {
            if (error.response?.status === 400) {
              console.log(`⚠️ ${status}/${month.start} - Offset ${offset}, capturados: ${monthProcessed}`);
              hasMore = false;
            } else {
              throw error;
            }
          }
        }
        
        if (monthProcessed > 0) {
          console.log(`📊 ${status}/${month.start}: ${monthProcessed} productos`);
        }
      } catch (error) {
        // Continuar si falla un mes específico
      }
    }
  }

  console.log(`📊 Total capturado con estado+fecha: ${processed} productos`);
  
  // Deduplicar antes de retornar
  return { items: deduplicateItems(allItems), processed, errors: 0 };
}

// Función robusta para sincronización por categorías (SIN límite artificial)
async function syncByCategoriesRobust(token: any) {
  let allItems: string[] = [];
  let processed = 0;
  let errors = 0;

  console.log("📋 Obteniendo categorías únicas de productos...");
  
  try {
    // Primero obtenemos una muestra de productos para identificar categorías
    const sampleResponse = await axios.get(
      `https://api.mercadolibre.com/users/${token.user_id}/items/search?limit=100`,
      { headers: { Authorization: `Bearer ${token.access_token}` } }
    );
    
    const sampleItems = sampleResponse.data.results || [];
    const categories = new Set<string>();
    
    // Obtener categorías de la muestra
    for (const itemId of sampleItems.slice(0, 50)) {
      try {
        const itemResponse = await axios.get(
          `https://api.mercadolibre.com/items/${itemId}`,
          { headers: { Authorization: `Bearer ${token.access_token}` } }
        );
        if (itemResponse.data.category_id) {
          categories.add(itemResponse.data.category_id);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        // Continuar si falla un item
      }
    }
    
    console.log(`📊 Categorías encontradas: ${categories.size}`);
    
    // Sincronizar por cada categoría (SIN límite de offset)
    for (const categoryId of Array.from(categories)) {
      console.log(`📋 Sincronizando categoría: ${categoryId}`);
      try {
        let offset = 0;
        let hasMore = true;
        let categoryProcessed = 0;
        
        while (hasMore) {
          try {
            const response = await axios.get(
              `https://api.mercadolibre.com/users/${token.user_id}/items/search?category=${categoryId}&offset=${offset}&limit=50`,
              { headers: { Authorization: `Bearer ${token.access_token}` } }
            );
            
            const results = response.data.results || [];
            if (results.length === 0) {
              hasMore = false;
            } else {
              allItems = allItems.concat(results);
              processed += results.length;
              categoryProcessed += results.length;
              offset += 50;
            }
            
            await new Promise(resolve => setTimeout(resolve, 300));
          } catch (error: any) {
            if (error.response?.status === 400) {
              console.log(`⚠️ Categoría ${categoryId} - API rechazó offset ${offset}, capturados: ${categoryProcessed}`);
              hasMore = false;
            } else {
              throw error;
            }
          }
        }
        
        if (categoryProcessed > 0) {
          console.log(`📊 Categoría ${categoryId}: ${categoryProcessed} productos`);
        }
      } catch (error) {
        console.error(`❌ Error sincronizando categoría ${categoryId}:`, error);
        errors++;
      }
    }
  } catch (error) {
    console.error("❌ Error obteniendo categorías:", error);
    errors++;
  }

  return { items: allItems, processed, errors };
}

// Función robusta para sincronización con diferentes ordenamientos (SIN límite artificial)
async function syncByOrderingRobust(token: any) {
  let allItems: string[] = [];
  let processed = 0;
  let errors = 0;

  // Diferentes tipos de ordenamiento que pueden devolver resultados en distintos órdenes
  const sortOptions = ['price_asc', 'price_desc'];
  
  for (const sort of sortOptions) {
    console.log(`📋 Sincronizando con orden: ${sort}`);
    try {
      let offset = 0;
      let hasMore = true;
      let sortProcessed = 0;
      
      while (hasMore) {
        try {
          const response = await axios.get(
            `https://api.mercadolibre.com/users/${token.user_id}/items/search?sort=${sort}&offset=${offset}&limit=50`,
            { headers: { Authorization: `Bearer ${token.access_token}` } }
          );
          
          const results = response.data.results || [];
          if (results.length === 0) {
            hasMore = false;
          } else {
            allItems = allItems.concat(results);
            processed += results.length;
            sortProcessed += results.length;
            offset += 50;
          }
          
          await new Promise(resolve => setTimeout(resolve, 300));
        } catch (error: any) {
          if (error.response?.status === 400) {
            console.log(`⚠️ Orden ${sort} - API rechazó offset ${offset}, capturados: ${sortProcessed}`);
            hasMore = false;
          } else {
            throw error;
          }
        }
      }
      
      console.log(`📊 Orden ${sort}: ${sortProcessed} productos`);
    } catch (error) {
      console.error(`❌ Error sincronizando con orden ${sort}:`, error);
      errors++;
    }
  }

  return { items: allItems, processed, errors };
}

// Endpoint para sincronización con múltiples límites
router.get("/sync/force-multi-limit", async (req: Request, res: Response) => {
  try {
    console.log("🚀 Iniciando sincronización con múltiples límites...");
    
    const token = await getCurrentToken();
    if (!token) throw new Error("No autenticado");

    let allItems: string[] = [];
    const limits = [25, 50, 100];
    const results = [];

    for (const limit of limits) {
      console.log(`📋 Probando con límite ${limit}...`);
      
      let offset = 0;
      let hasMore = true;
      let pageCount = 0;
      let itemsFound = 0;
      
      while (hasMore && pageCount < 50) { // Límite de seguridad
        pageCount++;
        try {
          const itemsResponse = await axios.get(
            `https://api.mercadolibre.com/users/${token.user_id}/items/search?offset=${offset}&limit=${limit}`,
            { headers: { Authorization: `Bearer ${token.access_token}` } }
          );

          const pageResults = itemsResponse.data.results || [];
          
          if (pageResults.length === 0) {
            hasMore = false;
          } else {
            allItems = [...new Set([...allItems, ...pageResults])];
            itemsFound += pageResults.length;
            offset += limit;
          }
          
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error: any) {
          console.log(`⚠️ Error con límite ${limit} en página ${pageCount}:`, error.message);
          hasMore = false;
        }
      }
      
      results.push({
        limit: limit,
        pages: pageCount,
        items_found: itemsFound,
        total_unique: allItems.length
      });
      
      console.log(`✅ Límite ${limit}: ${itemsFound} productos encontrados, ${allItems.length} únicos total`);
    }

    res.json({
      message: "✅ Sincronización con múltiples límites completada",
      results: results,
      total_unique_items: allItems.length,
      current_database: await Producto.countDocuments(),
      recommendation: allItems.length > await Producto.countDocuments() ? 
        "Se encontraron más productos. Ejecuta /ml/sync/force para sincronizarlos." :
        "La detección está completa.",
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    console.error("❌ Error en sincronización multi-límite:", err);
    res.status(500).json({ 
      error: "Error en sincronización: " + err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Endpoint de sincronización limitada para debugging
router.get("/sync/force-limited", async (req: Request, res: Response) => {
  try {
    console.log("🚀 Iniciando sincronización limitada (primeros 10 productos)...");
    
    const token = await getCurrentToken();
    if (!token) throw new Error("No autenticado");

    // Obtener solo los primeros 10 productos
    const itemsResponse = await axios.get(
      `https://api.mercadolibre.com/users/${token.user_id}/items/search?offset=0&limit=10`,
      { headers: { Authorization: `Bearer ${token.access_token}` } }
    );

    const items = itemsResponse.data.results || [];
    console.log(`📊 Productos a procesar: ${items.length}`);

    let processedCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    for (const itemId of items) {
      try {
        logger.debug(`🔄 Procesando producto ${processedCount + 1}/${items.length}: ${itemId}`);
        
        const { data: itemDetail } = await axios.get(
          `https://api.mercadolibre.com/items/${itemId}`,
          { headers: { Authorization: `Bearer ${token.access_token}` } }
        );

        // Obtener descripción
        let description = "";
        try {
          const descResponse = await axios.get(
            `https://api.mercadolibre.com/items/${itemId}/description`,
            { headers: { Authorization: `Bearer ${token.access_token}` } }
          );
          description = descResponse.data.plain_text || "";
        } catch (error) {
          logger.debug("⚠️ No se pudo obtener la descripción", { itemId });
        }

        const existingProduct = await Producto.findOne({ ml_id: itemDetail.id }).lean();
        
        // Detectar descuento nativo de MercadoLibre
        const descuentoML = itemDetail.original_price && itemDetail.original_price !== itemDetail.price
          ? {
              original_price: itemDetail.original_price,
              deal_ids: itemDetail.deal_ids || []
            }
          : undefined;
        
        // Si hay descuento ML, itemDetail.price ya viene rebajado de ML
        // Asegurarse de que se use ese precio rebajado
        let precioParaGuardar = itemDetail.price;
        if (descuentoML && existingProduct?.descuento?.activo) {
          // Si hay descuento ML Y descuento manual, calcular descuento manual sobre precio rebajado de ML
          const porcentajeManual = existingProduct.descuento.porcentaje || 0;
          precioParaGuardar = Math.round(itemDetail.price * (1 - porcentajeManual / 100) * 100) / 100;
        }
        
        const priceEvaluation = evaluatePriceForUpdate(precioParaGuardar, existingProduct, {
          source: 'force_limited',
          ml_id: itemDetail.id,
          metadata: { title: itemDetail.title },
        });
        
        // FORZAR el precio SIEMPRE al rebajado de ML si existe descuento ML
        if (itemDetail.original_price && itemDetail.original_price > itemDetail.price) {
          priceEvaluation.fields.price = itemDetail.price;
          priceEvaluation.fields.last_valid_price = itemDetail.price;
          // LOG ESPECIAL PARA AUDITORÍA AUTOMÁTICA
          if (itemDetail.id === 'MLU693479060') {
            console.log('[SYNC] Grabando PRECIO REBAJADO de ML', {
              ml_id: itemDetail.id,
              precio_ml: itemDetail.price,
              original_ml: itemDetail.original_price,
              precio_grabado: priceEvaluation.fields.price,
              last_valid_price: priceEvaluation.fields.last_valid_price,
            });
          }
        }
        // REFUERZO: aunque el precio en la base sea igual, se fuerza el update.
        if (itemDetail.id === 'MLU693479060') {
          console.log('[SYNC] Post-evaluación (antes de grabar)', {
            ml_id: itemDetail.id,
            precio_ml: itemDetail.price,
            original_ml: itemDetail.original_price,
            fields: priceEvaluation.fields,
          });
        }

        // Guardar producto
        await Producto.findOneAndUpdate(
          { ml_id: itemDetail.id },
          {
            ml_id: itemDetail.id,
            title: itemDetail.title,
            ...priceEvaluation.fields,
            descuento_ml: descuentoML, // ✅ Guardar descuento nativo de ML
            available_quantity: itemDetail.available_quantity,
            status: itemDetail.status,
            images: itemDetail.pictures?.map((picture: any) => ({
              id: picture.id,
              url: picture.secure_url?.replace('-I.jpg', '-O.jpg') || picture.url,
              max_size: picture.max_size
            })) || [],
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
            metrics: {
              visits: itemDetail.visits || 0,
              reviews: {
                rating_average: itemDetail.reviews?.rating_average || 0,
                total: itemDetail.reviews?.total || 0
              }
            },
            date_created: itemDetail.date_created ? new Date(itemDetail.date_created) : new Date(),
            last_updated: itemDetail.last_updated ? new Date(itemDetail.last_updated) : new Date()
          },
          { upsert: true, new: true }
        );

        processedCount++;
        // console.log(`✅ Producto ${itemId} sincronizado correctamente`); // Comentado para reducir logs
        
        // Pausa entre productos
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error: any) {
        console.error(`❌ Error procesando producto ${itemId}:`, error.message);
        errors.push(`${itemId}: ${error.message}`);
        errorCount++;
      }
    }
    
    const totalProducts = await Producto.countDocuments();
    
    res.json({
      message: "✅ Sincronización limitada completada",
      processed_count: processedCount,
      error_count: errorCount,
      total_products_in_db: totalProducts,
      errors: errors,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    console.error("❌ Error en sincronización limitada:", err);
    res.status(500).json({ 
      error: "Error en sincronización: " + err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Endpoint para verificar el estado de la sincronización
router.get("/sync/status", async (req: Request, res: Response) => {
  try {
    const totalProducts = await Producto.countDocuments();
    const productsWithMLId = await Producto.countDocuments({ ml_id: { $exists: true } });
    const productsActive = await Producto.countDocuments({ status: "active" });
    const productsPaused = await Producto.countDocuments({ status: "paused" });
    const productsClosed = await Producto.countDocuments({ status: "closed" });
    
    // Obtener estadísticas de dropshipping
    const dropshippingProducts = await Producto.countDocuments({ tipo_venta: "dropshipping" });
    const stockFisicoProducts = await Producto.countDocuments({ tipo_venta: "stock_fisico" });
    
    res.json({
      message: "Estado de la sincronización",
      database: {
        total_products: totalProducts,
        products_with_ml_id: productsWithMLId,
        products_without_ml_id: totalProducts - productsWithMLId,
        by_status: {
          active: productsActive,
          paused: productsPaused,
          closed: productsClosed
        },
        by_type: {
          dropshipping: dropshippingProducts,
          stock_fisico: stockFisicoProducts
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(500).json({ error: "Error obteniendo estado: " + err.message });
  }
});
// Endpoint para obtener todas las categorías únicas de los productos
router.get("/categorias", async (req: Request, res: Response) => {
  try {
    console.log("🔍 Obteniendo categorías de productos...");
    
    // Obtener todos los productos con category_id
    const productos = await Producto.find(
      { category_id: { $exists: true, $ne: "" } },
      { category_id: 1, title: 1, _id: 1 }
    );
    
    console.log(`📊 Productos encontrados: ${productos.length}`);
    
    // Agrupar por category_id y contar
    const categoriasMap = new Map<string, { count: number; sample_titles: string[] }>();
    
    productos.forEach(producto => {
      if (producto.category_id) {
        if (!categoriasMap.has(producto.category_id)) {
          categoriasMap.set(producto.category_id, { count: 0, sample_titles: [] });
        }
        const categoria = categoriasMap.get(producto.category_id)!;
        categoria.count++;
        if (categoria.sample_titles.length < 3) {
          categoria.sample_titles.push(producto.title);
        }
      }
    });
    
    // Convertir a array y obtener información detallada de cada categoría
    const categorias = Array.from(categoriasMap.entries()).map(([categoryId, info]) => ({
      id: categoryId,
      count: info.count,
      sample_titles: info.sample_titles
    }));
    
    console.log(`📊 Categorías encontradas: ${categorias.length}`);
    
    // Obtener información detallada de cada categoría desde la API de ML
    const categoriasConDetalle = await Promise.all(
      categorias.map(async (categoria) => {
        try {
          const response = await axios.get(`https://api.mercadolibre.com/categories/${categoria.id}`);
          return {
            id: categoria.id,
            name: response.data.name,
            count: categoria.count,
            sample_titles: categoria.sample_titles,
            path_from_root: response.data.path_from_root?.map((p: any) => p.name) || [],
            picture: response.data.picture,
            permalink: response.data.permalink
          };
        } catch (error) {
          console.log(`⚠️ Error obteniendo detalles de categoría ${categoria.id}:`, error);
          return {
            id: categoria.id,
            name: `Categoría ${categoria.id}`,
            count: categoria.count,
            sample_titles: categoria.sample_titles,
            path_from_root: [],
            picture: null,
            permalink: null
          };
        }
      })
    );
    
    // Ordenar por cantidad de productos
    categoriasConDetalle.sort((a, b) => b.count - a.count);
    
    res.json({
      message: "Categorías obtenidas exitosamente",
      total_categories: categoriasConDetalle.length,
      total_products: productos.length,
      categories: categoriasConDetalle,
      timestamp: new Date().toISOString()
    });
    
  } catch (err: any) {
    console.error("❌ Error obteniendo categorías:", err);
    res.status(500).json({ error: "Error obteniendo categorías: " + err.message });
  }
});

// Endpoint para debuggear la sincronización con paginación
router.get("/sync/debug", async (req: Request, res: Response) => {
  try {
    const token = await getCurrentToken();
    if (!token) throw new Error("No autenticado");

    console.log(`🔍 DEBUG: Obteniendo productos para user_id: ${token.user_id}`);
    
    // Implementar paginación para obtener todos los productos
    let allItems: string[] = [];
    let offset = 0;
    const limit = 50;
    let hasMore = true;
    let totalPages = 0;
    let errors: string[] = [];

    while (hasMore) {
      totalPages++;
      console.log(`📄 DEBUG: Obteniendo página ${totalPages} (offset: ${offset}, limit: ${limit})`);
      
      try {
        const itemsResponse = await axios.get(
          `https://api.mercadolibre.com/users/${token.user_id}/items/search?offset=${offset}&limit=${limit}`,
          { headers: { Authorization: `Bearer ${token.access_token}` } }
        );

        const pageResults = itemsResponse.data.results || [];
        console.log(`📊 DEBUG: Productos en página ${totalPages}: ${pageResults.length}`);
        
        if (pageResults.length === 0) {
          hasMore = false;
          console.log(`✅ DEBUG: No hay más productos. Total de páginas procesadas: ${totalPages - 1}`);
        } else {
          allItems = allItems.concat(pageResults);
          offset += limit;
          
          // Pausa optimizada para respetar límites de API (200ms por página)
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } catch (error: any) {
        console.error(`❌ DEBUG: Error en página ${totalPages}:`, error.message);
        errors.push(`Página ${totalPages}: ${error.message}`);
        hasMore = false;
      }
    }
    
    console.log(`📊 DEBUG: TOTAL DE PRODUCTOS ENCONTRADOS EN ML: ${allItems.length}`);
    console.log(`📋 DEBUG: Primeros 5 IDs: ${allItems.slice(0, 5).join(', ') || 'Ninguno'}`);

    res.json({
      message: "Debug de sincronización completado",
      user_id: token.user_id,
      total_pages: totalPages,
      total_items_found: allItems.length,
      first_5_items: allItems.slice(0, 5),
      errors: errors,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    console.error("❌ DEBUG: Error en debug:", err);
    res.status(500).json({ error: "Error en debug: " + err.message });
  }
});


// Función para detectar y limpiar productos eliminados de MercadoLibre
async function detectAndCleanupDeletedProducts(confirm: boolean = false) {
  try {
    console.log("🧹 Iniciando limpieza de productos eliminados...");
    
    const token = await getCurrentToken();
    if (!token) throw new Error("No autenticado");

    // Obtener TODOS los productos de MercadoLibre (paginando para evitar límite de 50)
    const mlProductIds: string[] = [];
    const fetchAllIdsViaAuth = async () => {
      let offset = 0;
      const limit = 50;
      while (true) {
        const url = `https://api.mercadolibre.com/users/${token.user_id}/items/search?offset=${offset}&limit=${limit}`;
        const { data } = await axios.get(url, { headers: { Authorization: `Bearer ${token.access_token}` } });
        const results: string[] = data?.results || [];
        if (!results.length) break;
        mlProductIds.push(...results);
        offset += limit;
        await new Promise(r => setTimeout(r, 150));
      }
    };

    const fetchAllIdsViaPublic = async () => {
      let offset = 0;
      const limit = 50;
      while (true) {
        const url = `https://api.mercadolibre.com/sites/MLU/search?seller_id=${token.user_id}&offset=${offset}&limit=${limit}`;
        const { data } = await axios.get(url);
        const results = Array.isArray(data?.results) ? data.results : [];
        const ids = results.map((r: any) => r.id).filter(Boolean);
        if (!ids.length) break;
        mlProductIds.push(...ids);
        offset += limit;
        await new Promise(r => setTimeout(r, 150));
      }
    };

    try {
      await fetchAllIdsViaAuth();
    } catch (e: any) {
      const status = e?.response?.status;
      const details = e?.response?.data || e?.message;
      console.warn(`⚠️ Auth items/search falló (${status}). Detalles:`, details);
      // Fallback a búsqueda pública si hay error típico de autenticación/parámetros
      if (status === 400 || status === 401 || status === 403) {
        try {
          await fetchAllIdsViaPublic();
        } catch (pubErr: any) {
          const pubStatus = pubErr?.response?.status;
          const pubDetails = pubErr?.response?.data || pubErr?.message;
          console.warn(`⚠️ Búsqueda pública falló (${pubStatus}). Detalles:`, pubDetails);
          // No relanzar aquí: permitimos continuar para usar el fallback por item
        }
      } else {
        // Si es otro error no relacionado, continuamos para intentar fallback por item
        console.warn(`⚠️ Error no esperado en items/search:`, details);
      }
    }
    console.log(`📊 Productos en MercadoLibre (paginado): ${mlProductIds.length}`);

    // Fallback final: si no logramos recolectar IDs (403 o 0 resultados), validar existencia por cada ml_id en DB
    if (mlProductIds.length === 0) {
      console.warn("⚠️ No se obtuvieron IDs desde ML. Activando verificación individual por ml_id (fallback)");
      const dbAll = await Producto.find({}, { ml_id: 1 }).lean();
      const existingIds: string[] = [];
      for (const doc of dbAll) {
        const id = doc.ml_id;
        if (!id) continue;
        try {
          await axios.get(`https://api.mercadolibre.com/items/${id}`, {
            headers: { Authorization: `Bearer ${token.access_token}` }
          });
          existingIds.push(id);
          await new Promise(r => setTimeout(r, 120)); // throttling
        } catch (e: any) {
          const status = e?.response?.status;
          // 404 confirma que no existe → lo dejaremos fuera de existingIds
          if (status !== 404 && status !== 400 && status !== 401 && status !== 403) {
            console.warn(`⚠️ Error verificando ${id}:`, e?.response?.data || e?.message);
          }
        }
      }
      mlProductIds.push(...existingIds);
      console.log(`📊 Verificación individual completada. IDs existentes: ${mlProductIds.length}`);
    }

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

    // Si no está confirmado, devolver preview y abortar borrado
    if (!confirm) {
      console.log("⚠️ Modo PREVIEW: no se eliminarán registros sin confirm=true");
      return {
        message: "Preview de limpieza (no se eliminaron registros)",
        would_delete_count: deletedProductsInfo.length,
        would_delete_products: deletedProductsInfo
      };
    }

    // Eliminar productos de la base de datos (confirmado)
    const deleteResult = await Producto.deleteMany({ ml_id: { $in: deletedProductIds } });
    const deletedProductObjectIds = deletedProducts.map(p => p._id);
    const variantesResult = await Variante.deleteMany({ product_id: { $in: deletedProductObjectIds } });

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
    console.error("❌ Error en limpieza de productos:", error?.response?.data || error.message);
    // Propagar información más rica para el cliente
    const status = error?.response?.status;
    const data = error?.response?.data;
    const err = new Error(status ? `ML API ${status}: ${JSON.stringify(data)}` : error.message);
    throw err;
  }
}

// Endpoint manual para limpiar productos eliminados
router.post("/sync/cleanup", async (req: Request, res: Response) => {
  try {
    console.log("🧹 Iniciando limpieza manual de productos eliminados...");
    const confirm = ((req.query.confirm as string) || (req.body?.confirm as string) || "false").toLowerCase() === "true";
    const result = await detectAndCleanupDeletedProducts(confirm);
    
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

router.get('/productos/:id', async (req: Request, res: Response)  => {
  try {
    const producto = await Producto.findById(req.params.id).populate('variantes');
    res.json(producto);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener el producto' });
  }
});

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

// -------------------- DETECTAR PRODUCTOS DUPLICADOS --------------------
router.get("/productos/duplicados", async (req: Request, res: Response) => {
  try {
    // field: ml_id | mlu | permalink | title
    const rawField = (req.query.field as string) || "ml_id";
    const field = rawField.toLowerCase() === "mlu" ? "ml_id" : rawField.toLowerCase();
    const minCount = parseInt((req.query.minCount as string) || (req.query.min_count as string) || "2", 10) || 2;
    const limit = Math.min(parseInt((req.query.limit as string) || "200", 10) || 200, 1000);
    const includeDocs = ((req.query.includeDocs as string) || (req.query.include_docs as string) || "false").toLowerCase() === "true";

    // Validar campo soportado
    const allowedFields = new Set(["ml_id", "permalink", "title"]);
    if (!allowedFields.has(field)) {
      return res.status(400).json({
        error: "Campo no soportado",
        allowed_fields: Array.from(allowedFields),
      });
    }

    // Filtro base: que el campo exista y no esté vacío
    const matchStage: any = {};
    matchStage[field] = { $nin: [null, ""] };

    // Normalización por campo para agrupar correctamente
    let addFieldsStage: any = {};
    if (field === "ml_id") {
      // Normalizar ml_id: quitar guiones y mayúsculas (MLU693... == MLU-693...)
      addFieldsStage = {
        groupKey: {
          $toUpper: {
            $replaceAll: { input: "$ml_id", find: "-", replacement: "" }
          }
        }
      };
    } else if (field === "permalink") {
      // Normalizar permalink: minúsculas y sin query string
      addFieldsStage = {
        groupKey: {
          $toLower: {
            $arrayElemAt: [ { $split: [ "$permalink", "?" ] }, 0 ]
          }
        }
      };
    } else if (field === "title") {
      // Normalizar title: trim + minúsculas
      addFieldsStage = {
        groupKey: {
          $toLower: { $trim: { input: "$title" } }
        }
      };
    }

    const pipeline: any[] = [
      { $match: matchStage },
      { $addFields: addFieldsStage },
      {
        $group: {
          _id: "$groupKey",
          count: { $sum: 1 },
          ids: { $push: "$_id" },
          ml_ids: { $push: "$ml_id" },
          titles: { $push: "$title" },
          permalinks: { $push: "$permalink" }
        }
      },
      { $match: { count: { $gte: minCount } } },
      { $sort: { count: -1 } },
      { $limit: limit },
      {
        $project: includeDocs ? {
          _id: 0,
          key: "$_id",
          count: 1,
          ids: 1,
          ml_ids: 1,
          titles: { $slice: ["$titles", 5] },
          permalinks: { $slice: ["$permalinks", 5] },
          field: { $literal: field }
        } : {
          _id: 0,
          key: "$_id",
          count: 1,
          sample: {
            ml_ids: { $slice: ["$ml_ids", 5] },
            titles: { $slice: ["$titles", 5] },
            permalinks: { $slice: ["$permalinks", 3] }
          },
          field: { $literal: field }
        }
      }
    ];

    const results = await Producto.aggregate(pipeline);

    return res.json({
      success: true,
      field,
      minCount,
      totalGroups: results.length,
      results
    });
  } catch (err: any) {
    console.error("❌ Error detectando duplicados:", err.message);
    return res.status(500).json({ error: "Error detectando duplicados", details: err.message });
  }
});

// -------------------- RESUMEN COMPLETO DE DUPLICADOS (BD completa) --------------------
router.get("/productos/duplicados/resumen", async (req: Request, res: Response) => {
  try {
    // Cargar todos los productos con los campos relevantes
    const productos = await Producto.find({}, {
      _id: 1,
      ml_id: 1,
      permalink: 1,
      title: 1
    }).lean();

    // Utilidades inline (mismas reglas de normalización del script)
    const normalizeMlu = (v?: string) => (v ? v.toUpperCase().replace(/-/g, '').trim() : '');
    const normalizePermalink = (v?: string) => (v ? (v.split('?')[0] || '').trim().toLowerCase() : '');
    const normalizeTitle = (v?: string) => (v ? v.trim().toLowerCase().replace(/\s+/g, ' ') : '');

    const buildGroups = (field: 'ml_id' | 'permalink' | 'title') => {
      const groups = new Map<string, { count: number; ids: any[]; ml_ids: string[]; titles: string[]; permalinks: string[] }>();
      for (const p of productos) {
        let key = '';
        if (field === 'ml_id') key = normalizeMlu(p.ml_id);
        if (field === 'permalink') key = normalizePermalink(p.permalink);
        if (field === 'title') key = normalizeTitle(p.title);
        if (!key) continue;
        if (!groups.has(key)) {
          groups.set(key, { count: 0, ids: [], ml_ids: [], titles: [], permalinks: [] });
        }
        const g = groups.get(key)!;
        g.count += 1;
        g.ids.push(p._id);
        if (p.ml_id) g.ml_ids.push(p.ml_id);
        if (p.title) g.titles.push(p.title);
        if (p.permalink) g.permalinks.push(p.permalink);
      }
      return Array.from(groups.entries())
        .filter(([, v]) => v.count >= 2)
        .map(([key, v]) => ({ key, ...v }))
        .sort((a, b) => b.count - a.count);
    };

    const dupMlu = buildGroups('ml_id');
    const dupPermalink = buildGroups('permalink');
    const dupTitle = buildGroups('title');

    const resumen = {
      total_productos: productos.length,
      duplicados: {
        ml_id: {
          grupos: dupMlu.length,
          total_items_en_grupos: dupMlu.reduce((acc, g) => acc + g.count, 0),
          top5: dupMlu.slice(0, 5)
        },
        permalink: {
          grupos: dupPermalink.length,
          total_items_en_grupos: dupPermalink.reduce((acc, g) => acc + g.count, 0),
          top5: dupPermalink.slice(0, 5)
        },
        title: {
          grupos: dupTitle.length,
          total_items_en_grupos: dupTitle.reduce((acc, g) => acc + g.count, 0),
          top5: dupTitle.slice(0, 5)
        }
      }
    };

    return res.json({
      success: true,
      resumen,
      detalles: {
        ml_id: dupMlu,
        permalink: dupPermalink,
        title: dupTitle
      }
    });
  } catch (err: any) {
    console.error("❌ Error generando resumen de duplicados:", err.message);
    return res.status(500).json({ error: "Error generando resumen de duplicados", details: err.message });
  }
});

// -------------------- DIAGNÓSTICO DE POSIBLES VARIANTES EN DUPLICADOS POR TÍTULO --------------------
router.get("/productos/duplicados/title/diagnostico", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt((req.query.limit as string) || "20", 10) || 20, 200);
    const keyFilter = (req.query.key as string) || ""; // analizar un grupo específico si se pasa

    // Cargar base mínima
    const productosBase = await Producto.find({}, {
      _id: 1,
      ml_id: 1,
      permalink: 1,
      title: 1
    }).lean();

    const normalizeTitle = (v?: string) => (v ? v.trim().toLowerCase().replace(/\s+/g, ' ') : '');

    // Agrupar por título normalizado
    const groupsMap = new Map<string, { ids: any[]; ml_ids: string[]; titles: string[]; permalinks: string[] }>();
    for (const p of productosBase) {
      const k = normalizeTitle(p.title);
      if (!k) continue;
      if (!groupsMap.has(k)) groupsMap.set(k, { ids: [], ml_ids: [], titles: [], permalinks: [] });
      const g = groupsMap.get(k)!;
      g.ids.push(p._id);
      if (p.ml_id) g.ml_ids.push(p.ml_id);
      if (p.title) g.titles.push(p.title);
      if (p.permalink) g.permalinks.push(p.permalink);
    }

    let groups = Array.from(groupsMap.entries())
      .map(([key, val]) => ({ key, count: val.ids.length, ...val }))
      .filter(g => g.count >= 2);

    if (keyFilter) {
      groups = groups.filter(g => g.key === keyFilter);
    }

    // Limitar cantidad de grupos a diagnosticar
    groups = groups.sort((a, b) => b.count - a.count).slice(0, limit);

    // Heurísticas de variaciones
    const attributeNameRegex = /(color|tamaño|tamano|size|capacidad|memoria|almacenamiento|gb|pulgadas|inches)/i;

    const diagnostics: any[] = [];
    for (const group of groups) {
      const docs = await Producto.find({ _id: { $in: group.ids } }, {
        _id: 1,
        ml_id: 1,
        title: 1,
        price: 1,
        category_id: 1,
        attributes: 1,
        status: 1,
        available_quantity: 1,
        permalink: 1
      }).lean();

      const categorySet = new Set(docs.map(d => d.category_id || ''));
      const allSameCategory = categorySet.size === 1 && categorySet.has('') === false;

      // Mapear atributos por nombre
      const attributeValuesByName: Record<string, Set<string>> = {};
      for (const d of docs) {
        const attrs = Array.isArray(d.attributes) ? d.attributes : [];
        for (const a of attrs) {
          const name = (a.name || a.id || '').toString();
          const value = (a.value_name || a.value_id || '').toString();
          if (!name || !value) continue;
          if (!attributeValuesByName[name]) attributeValuesByName[name] = new Set<string>();
          attributeValuesByName[name].add(value);
        }
      }

      // Seleccionar atributos candidatos a variación
      const candidateVariationAttrs = Object.keys(attributeValuesByName)
        .filter(n => attributeNameRegex.test(n));

      const variationSignals: Array<{ attribute: string; distinct_values: number }>
        = candidateVariationAttrs
          .map(n => ({ attribute: n, distinct_values: attributeValuesByName[n].size }))
          .filter(x => x.distinct_values >= 2);

      // Señales de precio
      const prices = docs.map(d => Number(d.price || 0)).filter(n => !isNaN(n));
      const minPrice = prices.length ? Math.min(...prices) : 0;
      const maxPrice = prices.length ? Math.max(...prices) : 0;
      const priceRatio = (minPrice > 0) ? (maxPrice / minPrice) : 0;
      const smallPriceSpread = priceRatio > 0 && priceRatio <= 1.8; // dif. de precio moderada sugiere variación

      const likelyVariations = allSameCategory && variationSignals.length > 0;

      diagnostics.push({
        key: group.key,
        count: group.count,
        ids: group.ids,
        ml_ids: group.ml_ids,
        permalinks: group.permalinks,
        category_id: Array.from(categorySet)[0] || null,
        all_same_category: allSameCategory,
        candidate_variation_attributes: variationSignals,
        prices: { min: minPrice, max: maxPrice, ratio: Number(priceRatio.toFixed(2)), small_spread: smallPriceSpread },
        likely_variations: likelyVariations,
        recommendation: likelyVariations
          ? 'Revisar para unificar como variantes (mismo título y categoría; difieren en atributos)'
          : 'Posibles duplicados reales: revisar y consolidar/eliminar los que no correspondan'
      });
    }

    return res.json({
      success: true,
      analyzed_groups: diagnostics.length,
      diagnostics
    });
  } catch (err: any) {
    console.error("❌ Error en diagnóstico de variaciones:", err.message);
    return res.status(500).json({ error: "Error en diagnóstico de variaciones", details: err.message });
  }
});

// Endpoint para productos tipo dropshipping con más de 14 días
router.get("/productos/tipo/dropshipping", async (req: Request, res: Response) => {
  try {
    // Buscar productos base con dropshipping > 10 días
    const productosDropshipping = await Producto.find({
      tipo_venta: "dropshipping",
      "dropshipping.dias_preparacion": { $gt: 10 }
    }).populate("variantes");

    // Buscar variantes con dropshipping > 10 días
    const variantesDropshipping = await Variante.find({
      tipo_venta: "dropshipping",
      "dropshipping.dias_preparacion": { $gt: 10 }
    }).populate("product_id");

    res.json({
      message: "Productos y variantes dropshipping obtenidos exitosamente",
      total_productos: productosDropshipping.length,
      total_variantes: variantesDropshipping.length,
      total_items: productosDropshipping.length + variantesDropshipping.length,
      productos_base: productosDropshipping,
      variantes_individuales: variantesDropshipping
    });
  } catch (err: any) {
    res.status(500).send("❌ Error al obtener productos dropshipping: " + err.message);
  }
});
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

// -------------------- STOCK MANUAL --------------------
// Consultar stock actual (ML y DB)
router.get("/stock/:ml_id", async (req: Request, res: Response) => {
  try {
    const mlId = (req.params.ml_id || "").toString();
    if (!mlId) {
      return res.status(400).json({ error: "Parámetro ml_id es requerido" });
    }

    const token = await getCurrentToken();
    if (!token) {
      return res.status(401).json({ error: "No autenticado en Mercado Libre" });
    }

    // Stock en Mercado Libre
    const mlStock = await getCurrentStockFromMercadoLibre(mlId, token.access_token);

    // Stock en DB local
    const productoDb = await Producto.findOne({ ml_id: mlId }).lean();
    const dbStock = productoDb?.available_quantity ?? null;

    return res.json({
      success: true,
      ml_id: mlId,
      stock_ml: mlStock,
      stock_db: dbStock,
      producto: productoDb ? { _id: productoDb._id, title: productoDb.title } : null,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Error consultando stock", details: err.message });
  }
});

// Fijar stock absoluto
router.post("/stock/set", async (req: Request, res: Response) => {
  try {
    const { ml_id, new_stock, propagate = false, update_db = true } = req.body || {};

    if (!ml_id || typeof new_stock !== "number" || Number.isNaN(new_stock)) {
      return res.status(400).json({ error: "ml_id y new_stock (number) son requeridos" });
    }

    const token = await getCurrentToken();
    if (!token) {
      return res.status(401).json({ error: "No autenticado en Mercado Libre" });
    }

    const safeStock = Math.max(0, Math.floor(new_stock));
    const mlResponse = await updateStockInMercadoLibre(ml_id, safeStock, token.access_token);

    if (update_db) {
      await Producto.updateOne({ ml_id }, { $set: { available_quantity: safeStock } });
    }

    if (propagate) {
      try {
        await propagateStockToGroup(ml_id, safeStock, token.access_token);
      } catch (e: any) {
        // Continuar aunque la propagación falle
      }
    }

    return res.json({
      success: true,
      action: "set",
      ml_id,
      new_stock: safeStock,
      propagated: !!propagate,
      db_updated: !!update_db,
      mercadolibre_response: mlResponse
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Error fijando stock", details: err.message });
  }
});

// Ajustar stock por delta (+/-)
router.post("/stock/adjust", async (req: Request, res: Response) => {
  try {
    const { ml_id, delta, min = 0, propagate = false, update_db = true } = req.body || {};

    if (!ml_id || typeof delta !== "number" || Number.isNaN(delta)) {
      return res.status(400).json({ error: "ml_id y delta (number) son requeridos" });
    }

    const token = await getCurrentToken();
    if (!token) {
      return res.status(401).json({ error: "No autenticado en Mercado Libre" });
    }

    const current = await getCurrentStockFromMercadoLibre(ml_id, token.access_token);
    const target = Math.max(Number(min) || 0, current + Math.trunc(delta));

    const mlResponse = await updateStockInMercadoLibre(ml_id, target, token.access_token);

    if (update_db) {
      await Producto.updateOne({ ml_id }, { $set: { available_quantity: target } });
    }

    if (propagate) {
      try {
        await propagateStockToGroup(ml_id, target, token.access_token);
      } catch (e: any) {
        // Continuar aunque la propagación falle
      }
    }

    return res.json({
      success: true,
      action: "adjust",
      ml_id,
      previous_stock: current,
      new_stock: target,
      delta: Math.trunc(delta),
      propagated: !!propagate,
      db_updated: !!update_db,
      mercadolibre_response: mlResponse
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Error ajustando stock", details: err.message });
  }
});

// -------------------- CRON --------------------
cron.schedule("0 */3 * * *", async () => {
  try {
    console.log("⏰ Ejecutando sincronización automática con Mercado Libre... ⚡️");
    // Usar versión robusta para captar todo el inventario
    try {
      await robustSyncProductos();
    } catch (e) {
      console.warn("⚠️ Fallback a forceUpdateProductos tras error en robustSyncProductos");
      await forceUpdateProductos();
    }
  } catch (err: any) {
    console.error("❌ Error en sincronización automática:", err.message);
  }
});

// =====================
// Función para obtener stock actual de MercadoLibre
// =====================
export async function getCurrentStockFromMercadoLibre(itemId: string, accessToken: string) {
  try {
    console.log(`🔍 Obteniendo stock actual para producto ${itemId} desde MercadoLibre...`);
    
    const response = await axios.get(
      `https://api.mercadolibre.com/items/${itemId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    
    const currentStock = response.data.available_quantity || 0;
    console.log(`📊 Stock actual de ${itemId} en ML: ${currentStock}`);
    return currentStock;
  } catch (error: any) {
    console.error(`❌ Error obteniendo stock de ${itemId} desde MercadoLibre:`, error.response?.data || error.message);
    throw error;
  }
}

// =====================
// Función para actualizar stock en MercadoLibre
// =====================
export async function updateStockInMercadoLibre(itemId: string, newStock: number, accessToken: string) {
  try {
    console.log(`📦 Actualizando stock para producto ${itemId} a ${newStock} en MercadoLibre...`);
    
    const response = await axios.put(
      `https://api.mercadolibre.com/items/${itemId}`,
      {
        available_quantity: newStock,
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    
    console.log(`✅ Stock de ${itemId} actualizado en ML: ${response.data.available_quantity}`);
    return response.data;
  } catch (error: any) {
    console.error(`❌ Error al actualizar stock de ${itemId} en MercadoLibre:`, error.response?.data || error.message);
    throw error;
  }
}

// =====================
// Propagar stock a todas las publicaciones del mismo catálogo/GTIN
// =====================
export async function propagateStockToGroup(mlId: string, newStock: number, accessToken: string) {
  // Buscar el producto base
  const base = await Producto.findOne({ ml_id: mlId }).lean();
  if (!base) return;

  // Resolver grupo: preferir catalog_product_id; fallback por GTIN en attributes
  let groupQuery: any = {};
  if (base.catalog_product_id) {
    groupQuery = { catalog_product_id: base.catalog_product_id };
  } else {
    const gtinValues = (base.attributes || [])
      .filter((a: any) => ['GTIN','EAN','GTIN14','UPC'].includes((a?.id || '').toUpperCase()))
      .map((a: any) => a.value_name)
      .filter(Boolean);
    if (gtinValues.length > 0) {
      groupQuery = { attributes: { $elemMatch: { id: { $in: ['GTIN','EAN','GTIN14','UPC'] }, value_name: { $in: gtinValues } } } };
    } else {
      return; // sin identificador de grupo
    }
  }

  const groupProducts = await Producto.find(groupQuery).lean();
  const idsToUpdate = groupProducts
    .map((p: any) => p.ml_id)
    .filter((id: string) => !!id);

  for (const id of idsToUpdate) {
    try {
      await updateStockInMercadoLibre(id, newStock, accessToken);
      await Producto.updateOne({ ml_id: id }, { $set: { available_quantity: newStock } });
    } catch (e) {
      console.warn(`⚠️ No se pudo propagar stock a ${id}:`, (e as any)?.message);
    }
    await new Promise(r => setTimeout(r, 150));
  }
}

// =====================
// Exportar funciones para uso en otros módulos
// =====================
export { getCurrentToken };

// 🔬 Endpoint para obtener TODOS los IDs sin límite de offset (usando scroll/search_after si existe)
router.get("/debug/all-ids", async (req: Request, res: Response) => {
  try {
    const token = await getCurrentToken();
    if (!token) throw new Error("No autenticado");

    console.log("🔍 Intentando capturar TODOS los IDs de productos...");
    
    const allIds = new Set<string>();
    
    // Probar diferentes enfoques para obtener IDs
    const approaches = [
      { name: "Paginación simple", filter: "" },
      { name: "Active", filter: "status=active" },
      { name: "Paused", filter: "status=paused" },
      { name: "Closed", filter: "status=closed" },
      { name: "Inactive", filter: "status=inactive" },
    ];
    
    for (const approach of approaches) {
      let offset = 0;
      let hasMore = true;
      let count = 0;
      
      console.log(`\n📋 Probando: ${approach.name}`);
      
      while (hasMore && offset < 2000) {
        try {
          const url = `https://api.mercadolibre.com/users/${token.user_id}/items/search?${approach.filter}${approach.filter ? '&' : ''}offset=${offset}&limit=50`;
          const response = await axios.get(url, {
            headers: { Authorization: `Bearer ${token.access_token}` }
          });
          
          const results = response.data.results || [];
          
          if (results.length === 0) {
            hasMore = false;
          } else {
            results.forEach((id: string) => allIds.add(id));
            count += results.length;
            offset += 50;
          }
          
          await new Promise(r => setTimeout(r, 100));
        } catch (error: any) {
          console.log(`   ❌ Error en offset ${offset}: ${error.message}`);
          hasMore = false;
        }
      }
      
      console.log(`   📊 ${approach.name}: ${count} productos, únicos totales: ${allIds.size}`);
    }
    
    res.json({
      total_unique_ids: allIds.size,
      ids: Array.from(allIds),
      message: `Se capturaron ${allIds.size} IDs únicos usando múltiples enfoques`,
      timestamp: new Date().toISOString()
    });
    
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 🔍 Endpoint para diagnosticar limitaciones y obtener información real de ML
router.get("/diagnostico/productos", async (req: Request, res: Response) => {
  try {
    const token = await getCurrentToken();
    if (!token) throw new Error("No autenticado");

    console.log("🔍 Ejecutando diagnóstico completo de productos ML...");

    // 1. Verificar restricciones del vendedor
    let restrictions = null;
    try {
      const restrictionsResponse = await axios.get(
        `https://api.mercadolibre.com/users/${token.user_id}/items/search/restrictions`,
        { headers: { Authorization: `Bearer ${token.access_token}` } }
      );
      restrictions = restrictionsResponse.data;
      console.log("📊 Restricciones:", restrictions);
    } catch (error: any) {
      console.log("⚠️ No se pudieron obtener restricciones:", error.message);
    }

    // 2. Obtener información de paging (total disponible)
    const searchResponse = await axios.get(
      `https://api.mercadolibre.com/users/${token.user_id}/items/search?limit=1`,
      { headers: { Authorization: `Bearer ${token.access_token}` } }
    );

    const paging = searchResponse.data.paging;
    console.log("📊 Paging info:", paging);

    // 3. Obtener conteo por estado
    const statusCounts: any = {};
    const statuses = ['active', 'paused', 'closed', 'under_review', 'inactive'];
    
    for (const status of statuses) {
      try {
        const statusResponse = await axios.get(
          `https://api.mercadolibre.com/users/${token.user_id}/items/search?status=${status}&limit=1`,
          { headers: { Authorization: `Bearer ${token.access_token}` } }
        );
        statusCounts[status] = statusResponse.data.paging?.total || 0;
      } catch (error) {
        statusCounts[status] = 'error';
      }
    }

    // 4. Obtener información del usuario
    const userResponse = await axios.get(
      `https://api.mercadolibre.com/users/${token.user_id}`,
      { headers: { Authorization: `Bearer ${token.access_token}` } }
    );
    
    const userInfo = {
      id: userResponse.data.id,
      nickname: userResponse.data.nickname,
      seller_reputation: userResponse.data.seller_reputation,
      status: userResponse.data.status
    };

    // 5. Productos en nuestra DB
    const dbCount = await Producto.countDocuments();
    const dbByStatus = await Producto.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);

    res.json({
      diagnostico: {
        user_info: userInfo,
        restrictions: restrictions,
        ml_total_reported: paging?.total || "No disponible",
        ml_limit_per_page: paging?.limit || 50,
        ml_offset: paging?.offset || 0,
        status_counts: statusCounts,
        total_by_status: Object.values(statusCounts).reduce((a: any, b: any) => 
          typeof b === 'number' ? a + b : a, 0
        ),
        db_count: dbCount,
        db_by_status: dbByStatus,
        gap: paging?.total ? paging.total - dbCount : 'Desconocido',
        recommendation: generateRecommendation(paging?.total, dbCount, statusCounts)
      },
      timestamp: new Date().toISOString()
    });

  } catch (err: any) {
    console.error("❌ Error en diagnóstico:", err);
    res.status(500).json({ 
      error: "Error ejecutando diagnóstico: " + err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Helper para generar recomendación basada en diagnóstico
function generateRecommendation(mlTotal: number, dbCount: number, statusCounts: any): string {
  if (!mlTotal) return "No se pudo obtener el total de ML. Verifica la autenticación.";
  
  const gap = mlTotal - dbCount;
  const activeInML = statusCounts.active || 0;
  
  if (gap === 0) return "✅ Base de datos sincronizada completamente";
  if (gap < 0) return "⚠️ Tienes MÁS productos en DB que en ML. Considera limpiar productos eliminados.";
  if (gap > 0 && gap < 100) return `⚠️ Faltan ${gap} productos. Ejecuta /ml/sync/force-robust`;
  if (activeInML > 1500) return `⚠️ Tienes ${activeInML} productos activos. La API de ML limita offset a ~1050, por lo que es IMPOSIBLE capturar todos con las herramientas estándar. Considera contactar a ML para soluciones empresariales.`;
  
  return `⚠️ Faltan ${gap} productos. Ejecuta /ml/sync/force-robust para sincronizar.`;
}

// Endpoint temporal para debuggear campos de ML
router.get("/debug/producto/:ml_id", async (req: Request, res: Response) => {
  try {
    const { ml_id } = req.params;
    const token = await getCurrentToken();
    if (!token) throw new Error("No autenticado");

    const { data: item } = await axios.get(
      `https://api.mercadolibre.com/items/${ml_id}`,
      { headers: { Authorization: `Bearer ${token.access_token}` } }
    );

    // 🆕 Traer también el documento en BD para ver archivado/duplicate
    const doc = await Producto.findOne({ ml_id }).lean();

    res.json({
      ml_id: ml_id,
      bd: doc ? {
        archivado: !!doc.archivado,
        duplicate_of_ml_id: doc.duplicate_of_ml_id || null,
        es_catalogo: !!doc.es_catalogo,
        catalog_product_id: doc.catalog_product_id || null
      } : null,
      campos_relevantes: {
        available_quantity: item.available_quantity,
        shipping: item.shipping,
        handling_time: item.shipping?.handling_time,
        attributes: item.attributes?.filter((attr: any) => 
          attr.name?.toLowerCase().includes('tiempo') || 
          attr.name?.toLowerCase().includes('disponibilidad') ||
          attr.name?.toLowerCase().includes('entrega')
        )
      },
      item_completo: item // Para debug completo
    });
  } catch (err: any) {
    res.status(500).json({ error: "Error obteniendo datos del producto: " + err.message });
  }
});



// Endpoint para forzar actualización de un producto específico
router.post("/ml/productos/:ml_id/actualizar", async (req: Request, res: Response) => {
  try {
    const { ml_id } = req.params;
    const token = await getCurrentToken();
    if (!token) throw new Error("No autenticado");

    console.log(`🔄 Forzando actualización del producto ${ml_id}...`);

    // Obtener datos frescos de MercadoLibre
    const { data: item } = await axios.get(
      `https://api.mercadolibre.com/items/${ml_id}`,
      { headers: { Authorization: `Bearer ${token.access_token}` } }
    );

    // Usar la misma lógica que el webhook para actualizar
    await handleItemNotification(`https://api.mercadolibre.com/items/${ml_id}`, token.access_token);

    // Obtener el producto actualizado de la BD
    const productoActualizado = await Producto.findOne({ ml_id: ml_id });

    res.json({
      mensaje: "Producto actualizado exitosamente",
      ml_id: ml_id,
      producto: productoActualizado
    });

  } catch (error: any) {
    console.error(`❌ Error actualizando producto ${req.params.ml_id}:`, error.message);
    res.status(500).json({ 
      error: "Error al actualizar el producto", 
      details: error.message 
    });
  }
});

// =====================
// 🔧 Sincronizar TODOS los productos con descuento ML desde MercadoLibre
// Corrige productos que tienen descuento_ml pero el precio no coincide con ML
// =====================
router.post("/sync/descuentos-ml", async (req: Request, res: Response) => {
  try {
    const token = await getCurrentToken();
    if (!token) throw new Error("No autenticado");

    console.log("🔄 Iniciando sincronización de productos con descuento ML...");

    // Buscar todos los productos que tienen descuento_ml guardado
    const productosConDescuentoML = await Producto.find({
      "descuento_ml.original_price": { $exists: true, $ne: null }
    }).select("ml_id title price descuento_ml");

    console.log(`📦 Encontrados ${productosConDescuentoML.length} productos con descuento ML`);

    const resultados = [];
    let actualizados = 0;
    let sinCambios = 0;
    let errores = 0;

    // Ejecutar en background para evitar timeout
    setTimeout(async () => {
      for (const producto of productosConDescuentoML) {
        try {
          console.log(`🔄 Procesando ${producto.ml_id}: ${producto.title}`);

          // Obtener datos actuales de MercadoLibre
          const { data: item } = await axios.get(
            `https://api.mercadolibre.com/items/${producto.ml_id}`,
            { headers: { Authorization: `Bearer ${token.access_token}` } }
          );

          // Verificar si todavía tiene descuento ML
          const tieneDescuentoML = item.original_price && item.original_price !== item.price;

          if (tieneDescuentoML) {
            // item.price es el precio REBAJADO de ML
            const precioRebajadoML = item.price;
            const precioOriginalML = item.original_price;

            // Verificar si el precio en BD no coincide con el precio rebajado de ML
            const precioActualBD = producto.price;
            const precioOriginalBD = producto.descuento_ml?.original_price;

            // Si el precio en BD es igual al original, necesita actualizarse al rebajado
            // O si el precio rebajado de ML es diferente al precio en BD (y no hay descuento manual)
            const necesitaActualizacion = 
              (precioOriginalBD && Math.abs(precioActualBD - precioOriginalBD) < 0.01) || // Precio BD = precio original
              (producto.descuento?.activo === false && Math.abs(precioActualBD - precioRebajadoML) > 0.01); // Precio BD ≠ precio rebajado ML

            if (necesitaActualizacion) {
              console.log(`  ⚠️ Precio incorrecto detectado:`);
              console.log(`     Precio en BD: $${precioActualBD}`);
              console.log(`     Precio original ML: $${precioOriginalML}`);
              console.log(`     Precio rebajado ML: $${precioRebajadoML}`);

              // Actualizar el producto con el precio rebajado de ML
              await Producto.updateOne(
                { ml_id: producto.ml_id },
                {
                  $set: {
                    price: precioRebajadoML,
                    "descuento_ml.original_price": precioOriginalML,
                    "descuento_ml.deal_ids": item.deal_ids || []
                  }
                }
              );

              console.log(`  ✅ Actualizado: Precio rebajado $${precioRebajadoML} guardado`);
              actualizados++;
              resultados.push({
                ml_id: producto.ml_id,
                title: producto.title,
                actualizado: true,
                precio_anterior: precioActualBD,
                precio_nuevo: precioRebajadoML,
                precio_original: precioOriginalML
              });
            } else {
              sinCambios++;
              resultados.push({
                ml_id: producto.ml_id,
                title: producto.title,
                actualizado: false,
                mensaje: "Precio ya estaba correcto"
              });
            }
          } else {
            // Ya no tiene descuento ML, limpiar el campo
            await Producto.updateOne(
              { ml_id: producto.ml_id },
              { $unset: { descuento_ml: "" } }
            );
            console.log(`  ℹ️ Descuento ML removido para ${producto.ml_id}`);
            resultados.push({
              ml_id: producto.ml_id,
              title: producto.title,
              actualizado: false,
              mensaje: "Ya no tiene descuento ML"
            });
          }

          // Pequeña pausa para no sobrecargar la API de ML
          await new Promise(resolve => setTimeout(resolve, 100));

        } catch (error: any) {
          errores++;
          console.error(`  ❌ Error procesando ${producto.ml_id}:`, error.message);
          resultados.push({
            ml_id: producto.ml_id,
            title: producto.title,
            actualizado: false,
            error: error.message
          });
        }
      }

      console.log("\n✅ Sincronización de descuentos ML completada:");
      console.log(`   ✅ Productos actualizados: ${actualizados}`);
      console.log(`   ✓ Sin cambios: ${sinCambios}`);
      console.log(`   ❌ Errores: ${errores}`);
    }, 100);

    res.json({
      mensaje: "Sincronización de descuentos ML iniciada en background",
      total_productos: productosConDescuentoML.length,
      status: "running",
      nota: "Revisa los logs del servidor para ver el progreso. Los productos se están actualizando en segundo plano."
    });

  } catch (error: any) {
    console.error("❌ Error iniciando sincronización de descuentos ML:", error);
    res.status(500).json({
      error: "Error al iniciar sincronización de descuentos ML",
      details: error.message
    });
  }
});

// -------------------- CORREGIR PERMALINKS VACÍOS --------------------
router.post("/fix-empty-permalinks", async (req: Request, res: Response) => {
  try {
    console.log("🔧 Buscando productos sin permalink...");
    
    // Buscar productos con permalink vacío o null
    const productosSinPermalink = await Producto.find({
      $or: [
        { permalink: "" },
        { permalink: null },
        { permalink: { $exists: false } }
      ]
    });
    
    console.log(`📊 Encontrados ${productosSinPermalink.length} productos sin permalink`);
    
    if (productosSinPermalink.length === 0) {
      return res.json({
        mensaje: "Todos los productos tienen permalink",
        corregidos: 0
      });
    }
    
    const corregidos = [];
    
    for (const producto of productosSinPermalink) {
      const permalinkCorrecto = getCorrectPermalink({ id: producto.ml_id });
      
      await Producto.updateOne(
        { ml_id: producto.ml_id },
        { $set: { permalink: permalinkCorrecto } }
      );
      
      corregidos.push({
        ml_id: producto.ml_id,
        title: producto.title,
        permalink_nuevo: permalinkCorrecto
      });
      
      console.log(`✅ Corregido: ${producto.ml_id} → ${permalinkCorrecto}`);
    }
    
    res.json({
      mensaje: "Permalinks corregidos exitosamente",
      total_corregidos: corregidos.length,
      productos: corregidos
    });
    
  } catch (error: any) {
    console.error("❌ Error corrigiendo permalinks:", error.message);
    res.status(500).json({ 
      error: "Error al corregir permalinks", 
      details: error.message 
    });
  }
});
// -------------------- VALIDAR CONCORDANCIA DB vs ML --------------------
router.get("/validar-concordancia", async (req: Request, res: Response) => {
  try {
    console.log("🔍 Iniciando validación de concordancia DB vs MercadoLibre...");
    
    const token = await getCurrentToken();
    if (!token) {
      return res.status(401).json({ error: "No autenticado con MercadoLibre" });
    }
    
    // Obtener parámetros opcionales
    const limit = parseInt(req.query.limit as string) || 50; // Por defecto verificar 50 productos
    const fullCheck = req.query.full === 'true'; // Si true, verifica todos los productos
    
    // Obtener productos de tu DB
    const productosDB = fullCheck 
      ? await Producto.find({}).lean()
      : await Producto.find({}).limit(limit).lean();
    
    console.log(`📊 Validando ${productosDB.length} productos...`);
    
    const discrepancias: any[] = [];
    const correctos: any[] = [];
    let erroresAPI = 0;
    
    for (const productoDB of productosDB) {
      try {
        // Consultar el mismo producto en la API de ML
        const { data: productoML } = await axios.get(
          `https://api.mercadolibre.com/items/${productoDB.ml_id}`,
          { headers: { Authorization: `Bearer ${token.access_token}` } }
        );
        
        const diferencias: string[] = [];
        
        // 1. Validar PRECIO
        if (Math.abs(productoDB.price - productoML.price) > 0.01) {
          diferencias.push(`Precio: DB=${productoDB.price} vs ML=${productoML.price}`);
        }
        
        // 2. Validar STOCK
        if (productoDB.available_quantity !== productoML.available_quantity) {
          diferencias.push(`Stock: DB=${productoDB.available_quantity} vs ML=${productoML.available_quantity}`);
        }
        
        // 3. Validar STATUS
        if (productoDB.status !== productoML.status) {
          diferencias.push(`Status: DB=${productoDB.status} vs ML=${productoML.status}`);
        }
        
        // 4. Validar TÍTULO
        if (productoDB.title !== productoML.title) {
          diferencias.push(`Título diferente`);
        }
        
        // 5. Validar PERMALINK
        const permalinkCorrecto = getCorrectPermalink(productoML);
        if (productoDB.permalink !== permalinkCorrecto) {
          diferencias.push(`Permalink: DB=${productoDB.permalink} vs Correcto=${permalinkCorrecto}`);
        }
        
        // 6. Validar MANUFACTURING_TIME
        const manufacturingTime = productoML.sale_terms?.find((term: any) => 
          term.id === "MANUFACTURING_TIME"
        );
        const diasML = manufacturingTime?.value_struct?.number || 0;
        const diasDB = productoDB.dropshipping?.dias_preparacion || 0;
        
        if (diasML !== diasDB) {
          diferencias.push(`Días preparación: DB=${diasDB} vs ML=${diasML}`);
        }
        
        // 7. Validar SELLER_ID (que sea tu producto)
        // Comparar convirtiendo ambos a String para evitar problemas de tipos
        if (productoML.seller_id && String(productoML.seller_id) !== String(token.user_id)) {
          diferencias.push(`⚠️ ALERTA: Producto de OTRO vendedor! Seller=${productoML.seller_id} (Tu user_id: ${token.user_id})`);
        }
        
        if (diferencias.length > 0) {
          discrepancias.push({
            ml_id: productoDB.ml_id,
            title: productoDB.title,
            diferencias: diferencias,
            datos_db: {
              precio: productoDB.price,
              stock: productoDB.available_quantity,
              status: productoDB.status,
              dias_preparacion: diasDB
            },
            datos_ml: {
              precio: productoML.price,
              stock: productoML.available_quantity,
              status: productoML.status,
              dias_preparacion: diasML,
              seller_id: productoML.seller_id
            }
          });
        } else {
          correctos.push({
            ml_id: productoDB.ml_id,
            title: productoDB.title
          });
        }
        
        // Pausa para no saturar la API
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error: any) {
        erroresAPI++;
        console.error(`❌ Error consultando ${productoDB.ml_id}:`, error.message);
        
        discrepancias.push({
          ml_id: productoDB.ml_id,
          title: productoDB.title,
          diferencias: [`ERROR API: ${error.message}`],
          error: true
        });
      }
    }
    
    // Generar reporte
    const porcentajeCorrectos = Math.round((correctos.length / productosDB.length) * 100);
    const porcentajeDiscrepancias = Math.round((discrepancias.length / productosDB.length) * 100);
    
    console.log(`\n📊 Validación completada:`);
    console.log(`   ✅ Correctos: ${correctos.length} (${porcentajeCorrectos}%)`);
    console.log(`   ⚠️  Con diferencias: ${discrepancias.length} (${porcentajeDiscrepancias}%)`);
    console.log(`   ❌ Errores API: ${erroresAPI}`);
    
    res.json({
      mensaje: "Validación de concordancia completada",
      total_productos: productosDB.length,
      correctos: correctos.length,
      con_discrepancias: discrepancias.length,
      errores_api: erroresAPI,
      porcentaje_correcto: porcentajeCorrectos,
      discrepancias: discrepancias,
      productos_correctos: fullCheck ? [] : correctos.slice(0, 10), // No enviar todos si es full check
      recomendaciones: {
        sincronizar: discrepancias.length > 0,
        productos_a_revisar: discrepancias.map(d => d.ml_id)
      }
    });
    
  } catch (error: any) {
    console.error("❌ Error en validación de concordancia:", error.message);
    res.status(500).json({ 
      error: "Error al validar concordancia", 
      details: error.message 
    });
  }
});

// -------------------- CORREGIR PERMALINKS --------------------
router.post("/fix-permalinks", async (req: Request, res: Response) => {
  try {
    console.log("🔧 Iniciando corrección de permalinks...");
    
    // Obtener todos los productos
    const productos = await Producto.find({});
    console.log(`📊 Total de productos a verificar: ${productos.length}`);
    
    let corregidos = 0;
    let sinCambios = 0;
    let errores = 0;
    const detalles: any[] = [];
    
    for (const producto of productos) {
      try {
        const permalinkActual = producto.permalink || "";
        const mlId = producto.ml_id;
        
        // Normalizar el ID para asegurar que tenga el formato correcto con guion
        // MLU644321979 → MLU-644321979
        let normalizedId = mlId;
        if (!mlId.includes('-')) {
          normalizedId = mlId.replace(/^([A-Z]{3})(\d+)/, '$1-$2');
        }
        
        const permalinkCorrecto = `https://articulo.mercadolibre.com.uy/${normalizedId}`;
        
        // Verificar si el permalink necesita corrección
        // Un permalink es correcto si es exactamente el formato simple con el ID normalizado
        if (permalinkActual !== permalinkCorrecto) {
          // Actualizar el producto
          await Producto.updateOne(
            { _id: producto._id },
            { $set: { permalink: permalinkCorrecto } }
          );
          
          corregidos++;
          detalles.push({
            ml_id: mlId,
            title: producto.title,
            anterior: permalinkActual,
            nuevo: permalinkCorrecto,
            estado: 'corregido'
          });
          
          if (corregidos <= 10) {
            console.log(`✅ Corregido: ${mlId}`);
            console.log(`   Anterior: ${permalinkActual || '(vacío)'}`);
            console.log(`   Nuevo: ${permalinkCorrecto}`);
          }
        } else {
          sinCambios++;
        }
      } catch (error: any) {
        errores++;
        console.error(`❌ Error procesando ${producto.ml_id}:`, error.message);
        detalles.push({
          ml_id: producto.ml_id,
          title: producto.title,
          estado: 'error',
          error: error.message
        });
      }
    }
    
    console.log(`\n📊 Resumen de corrección:`);
    console.log(`   ✅ Corregidos: ${corregidos}`);
    console.log(`   ℹ️  Sin cambios: ${sinCambios}`);
    console.log(`   ❌ Errores: ${errores}`);
    
    res.json({
      mensaje: "Corrección de permalinks completada",
      total: productos.length,
      corregidos,
      sin_cambios: sinCambios,
      errores,
      detalles: detalles.slice(0, 50) // Mostrar solo los primeros 50 para no saturar la respuesta
    });
    
  } catch (error: any) {
    console.error("❌ Error corrigiendo permalinks:", error.message);
    res.status(500).json({ 
      error: "Error al corregir permalinks", 
      details: error.message 
    });
  }
});

// -------------------- RESET AUTH --------------------
router.post("/reset-auth", async (req: Request, res: Response) => {
  try {
    // Eliminar todos los tokens existentes
    await Token.deleteMany({});
    console.log("🗑️ Tokens eliminados, listo para nueva autenticación");
    
    res.json({ 
      message: "Tokens eliminados exitosamente. Visita /ml/auth para reautenticar.",
      auth_url: `${req.protocol}://${req.get('host')}/ml/auth`
    });
  } catch (error: any) {
    console.error("❌ Error eliminando tokens:", error.message);
    res.status(500).json({ error: "Error eliminando tokens" });
  }
});

// Nota: La exportación del router debe ir al final del archivo

router.put("/productos/:ml_id/destacado", authenticate, authorizeDestacados, async (req: Request, res: Response) => {
  try {
    const ml_id = req.params.ml_id;
    const { destacado } = req.body as { destacado: boolean };
    if (typeof destacado === 'undefined') {
      return res.status(400).json({ error: "Campo 'destacado' requerido" });
    }
    const prod = await Producto.findOneAndUpdate(
      { ml_id },
      { $set: { destacado: !!destacado } },
      { new: true }
    );
    if (!prod) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }
    return res.json({ success: true, ml_id, destacado: prod.destacado === true });
  } catch (err: any) {
    return res.status(500).json({ error: "Error actualizando destacado", message: err.message });
  }
});

// =====================
// 🆕 Crear nuevo producto básico (admin)
// POST /ml/productos
// =====================
router.post("/productos", authenticate, authorize("admin"), async (req: Request, res: Response) => {
  try {
    const {
      ml_id,
      title,
      price,
      available_quantity,
      status,
      category_id,
      main_image,
      images,
      description
    } = req.body as any;

    if (!ml_id || !title || typeof price !== 'number' || typeof available_quantity !== 'number' || !status) {
      return res.status(400).json({ error: "ml_id, title, price, available_quantity y status son requeridos" });
    }
    if (price <= 0) {
      return res.status(400).json({ error: "El precio debe ser mayor a 0" });
    }

    const existente = await Producto.findOne({ ml_id });
    if (existente) {
      return res.status(400).json({ error: "Ya existe un producto con ese ml_id" });
    }

    const doc = await Producto.create({
      ml_id,
      title,
      price,
      available_quantity,
      status,
      last_valid_price: price,
      category_id: category_id || '',
      main_image: main_image || undefined,
      images: Array.isArray(images) ? images : (main_image ? [{ id: 'main', url: main_image, max_size: '' }] : []),
      description: description || '',
      destacado: false
    } as any);

    return res.status(201).json({ success: true, producto: doc });
  } catch (err: any) {
    return res.status(500).json({ error: "Error creando producto", message: err.message });
  }
});

// =====================
// 🆕 Batch destacados (admin)
// PUT /ml/productos/destacado/batch { ml_ids: string[], destacado: boolean }
// =====================
router.put("/productos/destacado/batch", authenticate, authorizeDestacados, async (req: Request, res: Response) => {
  try {
    const { ml_ids, destacado } = req.body as { ml_ids: string[]; destacado: boolean };
    if (!Array.isArray(ml_ids) || typeof destacado === 'undefined') {
      return res.status(400).json({ error: "Se requieren 'ml_ids' (array) y 'destacado' (boolean)" });
    }
    const ids = ml_ids.map((s) => String(s).trim()).filter(Boolean);
    if (ids.length === 0) {
      return res.status(400).json({ error: "Lista de ml_ids vacía" });
    }
    const result = await Producto.updateMany({ ml_id: { $in: ids } }, { $set: { destacado: !!destacado } });
    const matched = (result as any).matchedCount ?? (result as any).n ?? 0;
    const modified = (result as any).modifiedCount ?? (result as any).nModified ?? 0;
    return res.json({ success: true, matched, modified, destacado: !!destacado });
  } catch (err: any) {
    return res.status(500).json({ error: "Error actualizando destacados", message: err.message });
  }
});

// =====================
// 🆕 Productos paginados (para admin)
// GET /ml/productos?limit=250&offset=0&fields=ml_id,title,price,available_quantity,status,images,category_id,shipping,dias_preparacion,dias_envio_estimado,proveedor,pais_origen,destacado
// =====================
// =====================
// ✅ Productos (público)
// - Sin limit/offset: devuelve ARRAY (compatibilidad anterior)
// - Con limit/offset: devuelve { total, items }
// Filtros: status, q, categoryIds, destacado, fields
// =====================
router.get("/productos", async (req: Request, res: Response) => {
  try {
    const { status, q, fields, categoryIds, destacado } = req.query as Record<string, string>;
    const hasLimit = typeof req.query.limit !== 'undefined';
    const hasOffset = typeof req.query.offset !== 'undefined';
    const limit = hasLimit ? Math.min(parseInt(String(req.query.limit || '100')), 1000) : undefined;
    const offset = hasOffset ? Math.max(parseInt(String(req.query.offset || '0')), 0) : undefined;

    // Filtro base (excluir archivados y duplicados apuntados)
    const baseFilter: any = {
      archivado: { $ne: true },
      $or: [ { duplicate_of_ml_id: null }, { duplicate_of_ml_id: { $exists: false } } ],
      hidden_by_price_issue: { $ne: true },
    };
    const andClauses: any[] = [ baseFilter ];
    if (status && (status === 'active' || status === 'paused')) {
      andClauses.push({ status });
    }
    if (q && String(q).trim()) {
      const term = String(q).trim();
      const pattern = buildAccentInsensitiveRegex(term);
      const regex = new RegExp(pattern, 'i');
      andClauses.push({ $or: [
        { title: regex },
        { ml_id: regex },
        { seller_sku: regex },
        { 'variantes.color': regex },
        { 'variantes.size': regex },
        { 'variantes.id': regex }
      ]});
    }
    if (categoryIds && String(categoryIds).trim()) {
      const ids = String(categoryIds).split(',').map(s => s.trim()).filter(Boolean);
      if (ids.length > 0) andClauses.push({ category_id: { $in: ids } });
    }
    if (typeof destacado !== 'undefined') {
      const val = String(destacado).toLowerCase();
      if (val === 'true' || val === '1') andClauses.push({ destacado: true });
      if (val === 'false' || val === '0') andClauses.push({ destacado: { $ne: true } });
    }
    const mongoFilter = andClauses.length > 1 ? { $and: andClauses } : baseFilter;

    // Proyección opcional
    let projection: any | undefined;
    if (fields && String(fields).trim()) {
      projection = {} as any;
      for (const f of String(fields).split(',').map(s => s.trim()).filter(Boolean)) {
        projection[f] = 1;
      }
    }

    if (typeof limit === 'number') {
      const [items, total] = await Promise.all([
        Producto.find(mongoFilter, projection).sort({ _id: 1 }).skip(offset || 0).limit(limit).lean(),
        Producto.countDocuments(mongoFilter)
      ]);
      return res.json({ total, items });
    }

    const items = await Producto.find(mongoFilter, projection).sort({ _id: 1 }).lean();
    return res.json(items);
  } catch (error: any) {
    return res.status(500).json({ error: "Error obteniendo productos", message: error.message });
  }
});

// Sincronización individual de producto ML por ml_id
router.post("/sync-ml-product", async (req, res) => {
  const { publication_id } = req.body;
  if (!publication_id) {
    return res.status(400).json({ error: "Falta publication_id" });
  }
  try {
    // Usar el token más reciente
    const tokenDoc = await Token.findOne().sort({ createdAt: -1 });
    if (!tokenDoc || !tokenDoc.access_token) {
      return res.status(500).json({ error: "No hay token de ML configurado" });
    }
    const accessToken = tokenDoc.access_token;
    // Obtener datos del producto desde la API oficial de Mercado Libre
    const mlResp = await axios.get(`https://api.mercadolibre.com/items/${publication_id}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const mlProducto = mlResp.data;

    // Guardar/actualizar producto en la base local
    let producto = await Producto.findOneAndUpdate(
      { ml_id: mlProducto.id },
      {
        ml_id: mlProducto.id,
        title: mlProducto.title,
        available_quantity: mlProducto.available_quantity,
        price: mlProducto.price,
        status: mlProducto.status,
        permalink: mlProducto.permalink,
        images: mlProducto.pictures?.map((picture: { id: string; secure_url?: string; url?: string }) => ({
          id: picture.id,
          url: picture.secure_url || picture.url,
        })) || [],
      },
      { upsert: true, new: true }
    );
    return res.json({ message: "Producto sincronizado correctamente", data: producto });
  } catch (error) {
    if (error instanceof Error) {
      return res.status(500).json({ error: "Error sincronizando producto ML", detalles: error.message });
    } else {
      return res.status(500).json({ error: "Error sincronizando producto ML", detalles: String(error) });
    }
  }
});

export default router;