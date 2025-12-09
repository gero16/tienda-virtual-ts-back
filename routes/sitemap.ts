import { Router, Request, Response } from "express";
import Producto from "../models/Producto";

const router = Router();

// Endpoint para generar sitemap.xml dinámicamente
router.get("/sitemap.xml", async (req: Request, res: Response) => {
  try {
    const baseUrl = "https://www.poppyshopuy.com";
    
    // Obtener todos los productos activos con imágenes para SEO
    // Ordenados por fecha de actualización (más recientes primero) para mejor indexación
    const productos = await Producto.find({ 
      status: { $ne: 'paused' }, // Excluir productos pausados
      available_quantity: { $gt: 0 } // Solo productos con stock
    })
    .select('ml_id title last_updated images description')
    .sort({ last_updated: -1 }) // Productos más recientes primero
    .lean(); // Usar lean() para mejor rendimiento con muchos productos
    
    console.log(`📊 Total de productos encontrados para sitemap: ${productos.length}`);

    // Construir el XML del sitemap con soporte para imágenes
    let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n';
    sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n';

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

    // URLs de productos individuales con imágenes
    for (const producto of productos) {
      const productId = producto.ml_id || producto._id;
      const lastmod = producto.last_updated 
        ? new Date(producto.last_updated).toISOString().split('T')[0] 
        : new Date().toISOString().split('T')[0];

      // Escapar caracteres especiales XML en título y descripción
      const escapeXml = (str: string) => {
        if (!str) return '';
        return str
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');
      };

      const productTitle = escapeXml(producto.title || '');
      const productDescription = escapeXml(
        producto.description 
          ? producto.description.substring(0, 200).replace(/\n/g, ' ').trim()
          : productTitle
      );

      sitemap += '  <url>\n';
      sitemap += `    <loc>${baseUrl}/producto/${productId}</loc>\n`;
      sitemap += `    <lastmod>${lastmod}</lastmod>\n`;
      sitemap += '    <changefreq>weekly</changefreq>\n';
      sitemap += '    <priority>0.8</priority>\n';
      
      // Agregar imágenes del producto (hasta 5 imágenes principales)
      if (producto.images && producto.images.length > 0) {
        const imagesToInclude = producto.images.slice(0, 5); // Google recomienda máximo 5 imágenes por URL
        for (const image of imagesToInclude) {
          if (image.url) {
            sitemap += '    <image:image>\n';
            sitemap += `      <image:loc>${escapeXml(image.url)}</image:loc>\n`;
            sitemap += `      <image:title>${productTitle}</image:title>\n`;
            if (productDescription) {
              sitemap += `      <image:caption>${productDescription}</image:caption>\n`;
            }
            sitemap += '    </image:image>\n';
          }
        }
      }
      
      sitemap += '  </url>\n';
    }

    sitemap += '</urlset>';

    // Establecer el tipo de contenido como XML
    res.header('Content-Type', 'application/xml');
    res.send(sitemap);

    // Log detallado para monitoreo
    const totalUrls = 4 + productos.length; // 4 páginas principales + productos
    console.log(`✅ Sitemap generado exitosamente:`);
    console.log(`   📄 Total de URLs: ${totalUrls}`);
    console.log(`   🛍️  Productos incluidos: ${productos.length}`);
    console.log(`   📏 Tamaño aproximado: ${Math.round(sitemap.length / 1024)} KB`);
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
  const baseUrl = "https://www.poppyshopuy.com";
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

