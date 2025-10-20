import { Router, Request, Response } from "express";
import Evento from "../models/Evento";
import Producto from "../models/Producto";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();

// Crear evento
router.post("/", authenticate, authorize("admin"), async (req: Request, res: Response) => {
  try {
    const { slug, titulo, descripcion, theme, fecha_inicio, fecha_fin, activo, subtitle, discount_text, discount_percentage } = req.body;
    if (!slug || !titulo) return res.status(400).json({ error: "slug y titulo son requeridos" });
    const existente = await Evento.findOne({ slug: slug.toLowerCase() });
    if (existente) return res.status(400).json({ error: "El slug ya existe" });
    const evento = await Evento.create({ slug: slug.toLowerCase(), titulo, descripcion, theme, fecha_inicio, fecha_fin, activo, subtitle, discount_text, discount_percentage });
    return res.status(201).json({ success: true, evento });
  } catch (e: any) {
    return res.status(500).json({ error: "Error creando evento", message: e.message });
  }
});

// Listar eventos
router.get("/", async (_req: Request, res: Response) => {
  try {
    const eventos = await Evento.find().sort({ createdAt: -1 });
    return res.json({ success: true, eventos });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: "Error listando eventos", message: e.message });
  }
});

// Listar eventos activos (y opcionalmente por fecha)
router.get("/activos", async (_req: Request, res: Response) => {
  const now = new Date()
  const filter: any = {
    activo: true,
    $and: [
      {
        $or: [
          { fecha_inicio: { $exists: false } },
          { fecha_inicio: { $lte: now } }
        ]
      },
      {
        $or: [
          { fecha_fin: { $exists: false } },
          { fecha_fin: { $gte: now } }
        ]
      }
    ]
  }
  const eventos = await Evento.find(filter).sort({ createdAt: -1 })
  return res.json({ success: true, eventos })
})

// Obtener un evento
router.get("/:slug", async (req: Request, res: Response) => {
  try {
    const evento = await Evento.findOne({ slug: req.params.slug.toLowerCase() });
    if (!evento) return res.status(404).json({ error: "Evento no encontrado" });
    return res.json({ success: true, evento });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: "Error obteniendo evento", message: e.message });
  }
});

// Actualizar evento
router.put("/:slug", authenticate, authorize("admin"), async (req: Request, res: Response) => {
  try {
    const update = req.body || {};
    const evento = await Evento.findOneAndUpdate({ slug: req.params.slug.toLowerCase() }, update, { new: true });
    if (!evento) return res.status(404).json({ error: "Evento no encontrado" });
    return res.json({ success: true, evento });
  } catch (e: any) {
    return res.status(500).json({ error: "Error actualizando evento", message: e.message });
  }
});

// Eliminar evento
router.delete("/:slug", authenticate, authorize("admin"), async (req: Request, res: Response) => {
  await Evento.findOneAndDelete({ slug: req.params.slug.toLowerCase() });
  return res.json({ success: true });
});

// Asociar productos a evento (reemplazo total)
router.post("/:slug/productos", authenticate, authorize("admin"), async (req: Request, res: Response) => {
  const { productos_ml_ids } = req.body as { productos_ml_ids: string[] };
  if (!Array.isArray(productos_ml_ids)) return res.status(400).json({ error: "productos_ml_ids debe ser array" });
  const evento = await Evento.findOneAndUpdate(
    { slug: req.params.slug.toLowerCase() },
    { productos_ml_ids },
    { new: true }
  );
  if (!evento) return res.status(404).json({ error: "Evento no encontrado" });
  return res.json({ success: true, evento });
});

// Agregar productos (idempotente)
router.post("/:slug/agregar", authenticate, authorize("admin"), async (req: Request, res: Response) => {
  const { product_ids } = req.body as { product_ids: string[] };
  if (!Array.isArray(product_ids)) return res.status(400).json({ error: "product_ids debe ser array" });
  const evento = await Evento.findOneAndUpdate(
    { slug: req.params.slug.toLowerCase() },
    { $addToSet: { productos_ml_ids: { $each: product_ids } } },
    { new: true }
  );
  if (!evento) return res.status(404).json({ error: "Evento no encontrado" });
  return res.json({ success: true, evento });
});

// Remover productos
router.post("/:slug/remover", authenticate, authorize("admin"), async (req: Request, res: Response) => {
  const { product_ids } = req.body as { product_ids: string[] };
  if (!Array.isArray(product_ids)) return res.status(400).json({ error: "product_ids debe ser array" });
  const evento = await Evento.findOneAndUpdate(
    { slug: req.params.slug.toLowerCase() },
    { $pullAll: { productos_ml_ids: product_ids } },
    { new: true }
  );
  if (!evento) return res.status(404).json({ error: "Evento no encontrado" });
  return res.json({ success: true, evento });
});

// Obtener productos del evento (para frontend)
router.get("/:slug/productos", async (req: Request, res: Response) => {
  try {
    const evento = await Evento.findOne({ slug: req.params.slug.toLowerCase() });
    if (!evento) return res.json({ success: true, productos: [] });
    if (!evento.productos_ml_ids || evento.productos_ml_ids.length === 0) {
      return res.json({ success: true, productos: [] });
    }
    const productos = await Producto.find({ ml_id: { $in: evento.productos_ml_ids } })
      .select("ml_id title price images available_quantity status category_id permalink");
    return res.json({ success: true, productos });
  } catch (e: any) {
    return res.status(500).json({ error: "Error obteniendo productos", message: e.message });
  }
});

export default router;


