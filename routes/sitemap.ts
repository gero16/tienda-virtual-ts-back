import { Router, Request, Response } from "express";
import Producto from "../models/Producto";

const router = Router();

// Endpoint para generar sitemap.xml dinámicamente
router.get("/sitemap.xml", async (req: Request, res: Response) => {
  try {
    const baseUrl = "https://mercado-libre-roan.vercel.app";
    
    // Obtener todos los productos activos
    const productos = await Producto.find({ 
      status: { $ne: 'paused' }, // Excluir productos pausados
      available_quantity: { $gt: 0 } // Solo productos con stock
    }).select('ml_id title updatedAt');

    // Construir el XML del sitemap
    let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n';
    sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    // URL principal (homepage)
    sitemap += '  <url>\n';
    sitemap += `    <loc>${baseUrl}/</loc>\n`;
    sitemap += '    <changefreq>daily</changefreq>\n';
    sitemap += '    <priority>1.0</priority>\n';
    sitemap += '  </url>\n';

    // Página de tienda
    sitemap += '  <url>\n';
    sitemap += `    <loc>${baseUrl}/tienda-ml</loc>\n`;
    sitemap += '    <changefreq>daily</changefreq>\n';
    sitemap += '    <priority>0.9</priority>\n';
    sitemap += '  </url>\n';

    // Página de contacto
    sitemap += '  <url>\n';
    sitemap += `    <loc>${baseUrl}/contacto</loc>\n`;
    sitemap += '    <changefreq>monthly</changefreq>\n';
    sitemap += '    <priority>0.6</priority>\n';
    sitemap += '  </url>\n';

    // Página de preguntas frecuentes
    sitemap += '  <url>\n';
    sitemap += `    <loc>${baseUrl}/preguntas-frecuentes</loc>\n`;
    sitemap += '    <changefreq>monthly</changefreq>\n';
    sitemap += '    <priority>0.6</priority>\n';
    sitemap += '  </url>\n';

    // URLs de productos individuales
    for (const producto of productos) {
      const productId = producto.ml_id || producto._id;
      const lastmod = producto.updatedAt 
        ? new Date(producto.updatedAt).toISOString().split('T')[0] 
        : new Date().toISOString().split('T')[0];

      sitemap += '  <url>\n';
      sitemap += `    <loc>${baseUrl}/producto/${productId}</loc>\n`;
      sitemap += `    <lastmod>${lastmod}</lastmod>\n`;
      sitemap += '    <changefreq>weekly</changefreq>\n';
      sitemap += '    <priority>0.8</priority>\n';
      sitemap += '  </url>\n';
    }

    sitemap += '</urlset>';

    // Establecer el tipo de contenido como XML
    res.header('Content-Type', 'application/xml');
    res.send(sitemap);

    console.log(`✅ Sitemap generado con ${productos.length} productos`);
  } catch (error: any) {
    console.error("❌ Error generando sitemap:", error);
    res.status(500).json({ 
      error: "Error al generar sitemap",
      message: error.message 
    });
  }
});

// Endpoint para generar robots.txt
router.get("/robots.txt", (req: Request, res: Response) => {
  const baseUrl = "https://mercado-libre-roan.vercel.app";
  const apiUrl = "https://poppy-shop-production.up.railway.app";

  const robotsTxt = `# Robots.txt para Tienda Virtual
User-agent: *
Allow: /
Allow: /tienda-ml
Allow: /producto/
Allow: /contacto
Allow: /preguntas-frecuentes

# Bloquear rutas administrativas
Disallow: /admin
Disallow: /admin/*

# Bloquear rutas de pago (no indexables)
Disallow: /payment-success
Disallow: /payment-failure
Disallow: /payment-pending
Disallow: /checkout

# Sitemap
Sitemap: ${apiUrl}/api/sitemap.xml
Sitemap: ${baseUrl}/sitemap.xml

# Rastreadores específicos
User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

# Crawl-delay para bots agresivos
User-agent: *
Crawl-delay: 10
`;

  res.header('Content-Type', 'text/plain');
  res.send(robotsTxt);
});

export default router;

