import express, { Request, Response } from 'express';
import axios from 'axios';
import sharp from 'sharp';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

const router = express.Router();

// Caché en memoria (en producción, usar Redis o similar)
const imageCache = new Map<string, { buffer: Buffer; contentType: string; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas
const CACHE_DIR = path.join(__dirname, '../cache/images');

// Crear directorio de caché si no existe
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Limpiar caché antiguo periódicamente
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of imageCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      imageCache.delete(key);
      // También eliminar archivo del disco si existe
      const filePath = path.join(CACHE_DIR, `${key}.webp`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }
}, 60 * 60 * 1000); // Cada hora

// Generar hash de la URL para usar como clave de caché
const getCacheKey = (url: string, width: number): string => {
  return crypto.createHash('md5').update(`${url}-${width}`).digest('hex');
};

// 🚀 Endpoint para optimizar imágenes de MercadoLibre
// GET /api/images/optimize?url=...&width=250
router.get('/optimize', async (req: Request, res: Response) => {
  try {
    const { url, width = '250' } = req.query;

    // Validar parámetros
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL es requerida' });
    }

    // Validar que sea una URL de MercadoLibre
    if (!url.includes('mlstatic.com') && !url.includes('mercadolibre')) {
      return res.status(400).json({ error: 'Solo se permiten URLs de MercadoLibre' });
    }

    const targetWidth = parseInt(width as string, 10);
    if (isNaN(targetWidth) || targetWidth < 50 || targetWidth > 2000) {
      return res.status(400).json({ error: 'Width debe ser un número entre 50 y 2000' });
    }

    const cacheKey = getCacheKey(url, targetWidth);
    const cached = imageCache.get(cacheKey);

    // Verificar caché en memoria
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      res.set('Content-Type', cached.contentType);
      res.set('Cache-Control', 'public, max-age=86400'); // 24 horas
      res.set('X-Image-Cache', 'hit');
      return res.send(cached.buffer);
    }

    // Verificar caché en disco
    const cacheFilePath = path.join(CACHE_DIR, `${cacheKey}.webp`);
    if (fs.existsSync(cacheFilePath)) {
      const stats = fs.statSync(cacheFilePath);
      if (Date.now() - stats.mtimeMs < CACHE_TTL) {
        const buffer = fs.readFileSync(cacheFilePath);
        imageCache.set(cacheKey, {
          buffer,
          contentType: 'image/webp',
          timestamp: Date.now()
        });
        res.set('Content-Type', 'image/webp');
        res.set('Cache-Control', 'public, max-age=86400');
        res.set('X-Image-Cache', 'disk');
        return res.send(buffer);
      }
    }

    // Descargar imagen desde MercadoLibre
    console.log(`📥 Descargando imagen: ${url}`);
    const imageResponse = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const imageBuffer = Buffer.from(imageResponse.data, 'binary');

    // Optimizar imagen con Sharp
    console.log(`⚙️ Optimizando imagen a ${targetWidth}px...`);
    const optimizedBuffer = await sharp(imageBuffer)
      .resize(targetWidth, null, {
        withoutEnlargement: true,
        fit: 'inside'
      })
      .webp({
        quality: 85,
        effort: 4 // Balance entre calidad y velocidad
      })
      .toBuffer();

    // Guardar en caché
    imageCache.set(cacheKey, {
      buffer: optimizedBuffer,
      contentType: 'image/webp',
      timestamp: Date.now()
    });

    // Guardar en disco para persistencia
    fs.writeFileSync(cacheFilePath, optimizedBuffer);

    // Enviar imagen optimizada
    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', 'public, max-age=86400'); // 24 horas
    res.set('X-Image-Cache', 'miss');
    res.send(optimizedBuffer);

  } catch (error: any) {
    console.error('❌ Error optimizando imagen:', error.message);
    
    // Si falla, intentar servir la URL original (fallback)
    if (error.response?.status === 404 || error.code === 'ENOTFOUND') {
      return res.status(404).json({ error: 'Imagen no encontrada' });
    }

    // En caso de error, redirigir a la URL original
    const originalUrl = req.query.url as string;
    if (originalUrl) {
      return res.redirect(302, originalUrl);
    }

    res.status(500).json({ error: 'Error al optimizar imagen' });
  }
});

// 🚀 Endpoint para obtener información de la imagen (útil para debugging)
router.get('/info', async (req: Request, res: Response) => {
  try {
    const { url } = req.query;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL es requerida' });
    }

    const response = await axios.head(url, {
      timeout: 5000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    res.json({
      url,
      contentType: response.headers['content-type'],
      contentLength: response.headers['content-length'],
      lastModified: response.headers['last-modified'],
      cacheControl: response.headers['cache-control']
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

