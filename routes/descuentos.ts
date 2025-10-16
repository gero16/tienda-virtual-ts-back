import express, { Router, Request, Response } from "express";
import colors from "colors";
import ProductoModel from "../models/Producto";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();

// =====================
// Aplicar descuento a productos específicos
// =====================
router.post("/aplicar", authenticate, authorize("admin"), async (req: Request, res: Response) => {
  try {
    const { product_ids, porcentaje, fecha_inicio, fecha_fin } = req.body;

    // Validar datos
    if (!product_ids || !Array.isArray(product_ids) || product_ids.length === 0) {
      return res.status(400).json({ 
        error: "Se requiere un array de product_ids" 
      });
    }

    if (!porcentaje || porcentaje <= 0 || porcentaje > 100) {
      return res.status(400).json({ 
        error: "El porcentaje debe estar entre 1 y 100" 
      });
    }

    console.log(colors.blue(`💰 Aplicando descuento del ${porcentaje}% a ${product_ids.length} productos...`));

    const resultados = [];

    for (const product_id of product_ids) {
      try {
        // Buscar el producto
        const producto = await ProductoModel.findOne({ ml_id: product_id });

        if (!producto) {
          resultados.push({
            product_id,
            success: false,
            error: "Producto no encontrado"
          });
          continue;
        }

        // Guardar precio original si no existe
        const precio_original = producto.descuento?.precio_original || producto.price;

        // Calcular nuevo precio con descuento
        const nuevo_precio = precio_original * (1 - porcentaje / 100);

        // Actualizar producto
        producto.descuento = {
          activo: true,
          porcentaje: porcentaje,
          precio_original: precio_original,
          fecha_inicio: fecha_inicio ? new Date(fecha_inicio) : new Date(),
          fecha_fin: fecha_fin ? new Date(fecha_fin) : undefined
        };
        producto.price = Math.round(nuevo_precio * 100) / 100; // Redondear a 2 decimales

        await producto.save();

        console.log(colors.green(`✅ Descuento aplicado a: ${producto.title}`));
        console.log(colors.green(`   Precio original: $${precio_original}`));
        console.log(colors.green(`   Precio con descuento: $${producto.price}`));

        resultados.push({
          product_id,
          success: true,
          title: producto.title,
          precio_original: precio_original,
          precio_descuento: producto.price,
          porcentaje: porcentaje
        });

      } catch (error: any) {
        console.error(colors.red(`❌ Error procesando producto ${product_id}:`), error.message);
        resultados.push({
          product_id,
          success: false,
          error: error.message
        });
      }
    }

    const exitosos = resultados.filter(r => r.success).length;
    const fallidos = resultados.filter(r => !r.success).length;

    console.log(colors.green(`✅ Descuentos aplicados: ${exitosos} exitosos, ${fallidos} fallidos`));

    return res.json({
      success: true,
      message: `Descuentos aplicados: ${exitosos} exitosos, ${fallidos} fallidos`,
      resultados
    });

  } catch (error: any) {
    console.error(colors.red("❌ Error aplicando descuentos:"), error);
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: error.message 
    });
  }
});

// =====================
// Quitar descuento de productos específicos
// =====================
router.post("/quitar", authenticate, authorize("admin"), async (req: Request, res: Response) => {
  try {
    const { product_ids } = req.body;

    if (!product_ids || !Array.isArray(product_ids) || product_ids.length === 0) {
      return res.status(400).json({ 
        error: "Se requiere un array de product_ids" 
      });
    }

    console.log(colors.blue(`🔄 Quitando descuentos de ${product_ids.length} productos...`));

    const resultados = [];

    for (const product_id of product_ids) {
      try {
        const producto = await ProductoModel.findOne({ ml_id: product_id });

        if (!producto) {
          resultados.push({
            product_id,
            success: false,
            error: "Producto no encontrado"
          });
          continue;
        }

        // Restaurar precio original si existe
        if (producto.descuento?.precio_original) {
          producto.price = producto.descuento.precio_original;
        }

        // Desactivar descuento
        producto.descuento = {
          activo: false,
          porcentaje: 0,
          precio_original: undefined,
          fecha_inicio: undefined,
          fecha_fin: undefined
        };

        await producto.save();

        console.log(colors.green(`✅ Descuento removido de: ${producto.title}`));

        resultados.push({
          product_id,
          success: true,
          title: producto.title,
          precio_restaurado: producto.price
        });

      } catch (error: any) {
        console.error(colors.red(`❌ Error procesando producto ${product_id}:`), error.message);
        resultados.push({
          product_id,
          success: false,
          error: error.message
        });
      }
    }

    const exitosos = resultados.filter(r => r.success).length;
    const fallidos = resultados.filter(r => !r.success).length;

    console.log(colors.green(`✅ Descuentos removidos: ${exitosos} exitosos, ${fallidos} fallidos`));

    return res.json({
      success: true,
      message: `Descuentos removidos: ${exitosos} exitosos, ${fallidos} fallidos`,
      resultados
    });

  } catch (error: any) {
    console.error(colors.red("❌ Error quitando descuentos:"), error);
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: error.message 
    });
  }
});

// =====================
// Listar productos con descuento
// =====================
router.get("/listar", async (req: Request, res: Response) => {
  try {
    const productos = await ProductoModel.find({ 
      "descuento.activo": true 
    }).select('ml_id title price descuento images main_image available_quantity status');

    console.log(colors.blue(`📋 Productos con descuento encontrados: ${productos.length}`));

    return res.json({
      success: true,
      count: productos.length,
      productos: productos.map(p => ({
        ml_id: p.ml_id,
        title: p.title,
        precio_original: p.descuento?.precio_original,
        precio_descuento: p.price,
        porcentaje: p.descuento?.porcentaje,
        ahorro: p.descuento?.precio_original ? p.descuento.precio_original - p.price : 0,
        fecha_inicio: p.descuento?.fecha_inicio,
        fecha_fin: p.descuento?.fecha_fin,
        image: p.images && p.images.length > 0 ? p.images[0].url : '',
        available_quantity: p.available_quantity,
        status: p.status
      }))
    });

  } catch (error: any) {
    console.error(colors.red("❌ Error listando productos con descuento:"), error);
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: error.message 
    });
  }
});

// =====================
// Obtener información de descuento de un producto específico
// =====================
router.get("/producto/:ml_id", async (req: Request, res: Response) => {
  try {
    const { ml_id } = req.params;

    const producto = await ProductoModel.findOne({ ml_id });

    if (!producto) {
      return res.status(404).json({ 
        error: "Producto no encontrado" 
      });
    }

    return res.json({
      success: true,
      ml_id: producto.ml_id,
      title: producto.title,
      tiene_descuento: producto.descuento?.activo || false,
      descuento: producto.descuento?.activo ? {
        porcentaje: producto.descuento.porcentaje,
        precio_original: producto.descuento.precio_original,
        precio_descuento: producto.price,
        ahorro: producto.descuento.precio_original ? producto.descuento.precio_original - producto.price : 0,
        fecha_inicio: producto.descuento.fecha_inicio,
        fecha_fin: producto.descuento.fecha_fin
      } : null
    });

  } catch (error: any) {
    console.error(colors.red("❌ Error obteniendo descuento del producto:"), error);
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: error.message 
    });
  }
});

// =====================
// Actualizar porcentaje de descuento
// =====================
router.put("/actualizar", authenticate, authorize("admin"), async (req: Request, res: Response) => {
  try {
    const { product_ids, porcentaje } = req.body;

    if (!product_ids || !Array.isArray(product_ids) || product_ids.length === 0) {
      return res.status(400).json({ 
        error: "Se requiere un array de product_ids" 
      });
    }

    if (!porcentaje || porcentaje <= 0 || porcentaje > 100) {
      return res.status(400).json({ 
        error: "El porcentaje debe estar entre 1 y 100" 
      });
    }

    console.log(colors.blue(`🔄 Actualizando descuento a ${porcentaje}% para ${product_ids.length} productos...`));

    const resultados = [];

    for (const product_id of product_ids) {
      try {
        const producto = await ProductoModel.findOne({ ml_id: product_id });

        if (!producto || !producto.descuento?.activo) {
          resultados.push({
            product_id,
            success: false,
            error: "Producto no encontrado o sin descuento activo"
          });
          continue;
        }

        // Usar el precio original guardado
        const precio_original = producto.descuento.precio_original || producto.price;

        // Calcular nuevo precio con el nuevo porcentaje
        const nuevo_precio = precio_original * (1 - porcentaje / 100);

        producto.descuento.porcentaje = porcentaje;
        producto.price = Math.round(nuevo_precio * 100) / 100;

        await producto.save();

        console.log(colors.green(`✅ Descuento actualizado para: ${producto.title}`));

        resultados.push({
          product_id,
          success: true,
          title: producto.title,
          nuevo_porcentaje: porcentaje,
          precio_descuento: producto.price
        });

      } catch (error: any) {
        console.error(colors.red(`❌ Error procesando producto ${product_id}:`), error.message);
        resultados.push({
          product_id,
          success: false,
          error: error.message
        });
      }
    }

    return res.json({
      success: true,
      resultados
    });

  } catch (error: any) {
    console.error(colors.red("❌ Error actualizando descuentos:"), error);
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: error.message 
    });
  }
});

// =====================
// 🔧 REPARAR descuentos con precio_original incorrecto
// =====================
router.post("/reparar", async (req: Request, res: Response) => {
  try {
    console.log(colors.blue(`🔧 Iniciando reparación de descuentos...`));

    // Buscar todos los productos con descuento activo
    const productos = await ProductoModel.find({ 
      "descuento.activo": true 
    });

    console.log(colors.blue(`📦 Encontrados ${productos.length} productos con descuento activo`));

    const resultados = [];
    let reparados = 0;
    let yaCorrectos = 0;

    for (const producto of productos) {
      try {
        const descuento = producto.descuento;
        if (!descuento || !descuento.activo) continue;

        const precioActual = producto.price;
        const precioOriginal = descuento.precio_original || precioActual;
        const porcentaje = descuento.porcentaje;

        // 🔍 Calcular qué precio debería tener con el descuento
        const precioEsperado = Math.round(precioOriginal * (1 - porcentaje / 100) * 100) / 100;

        // 🚨 Detectar si el precio original está mal (es igual al precio con descuento)
        const diferencia = Math.abs(precioOriginal - precioActual);
        
        if (diferencia < 0.01) {
          // El precio_original es igual al precio actual, necesita reparación
          console.log(colors.yellow(`⚠️ PROBLEMA DETECTADO: ${producto.title}`));
          console.log(colors.yellow(`   Precio original: $${precioOriginal} = Precio actual: $${precioActual}`));
          console.log(colors.yellow(`   Porcentaje: ${porcentaje}%`));
          
          // 🔧 Recalcular precio original usando el porcentaje
          // Si precio_actual = precio_original * (1 - porcentaje/100)
          // Entonces: precio_original = precio_actual / (1 - porcentaje/100)
          const precioOriginalCorrecto = Math.round((precioActual / (1 - porcentaje / 100)) * 100) / 100;
          const precioConDescuentoCorrecto = Math.round(precioOriginalCorrecto * (1 - porcentaje / 100) * 100) / 100;
          
          console.log(colors.green(`✅ CORRECCIÓN: Precio original: $${precioOriginalCorrecto} → Precio con descuento: $${precioConDescuentoCorrecto}`));
          
          // Actualizar el producto
          if (producto.descuento) {
            producto.descuento.precio_original = precioOriginalCorrecto;
            producto.price = precioConDescuentoCorrecto;
            await producto.save();
          }
          
          reparados++;
          resultados.push({
            ml_id: producto.ml_id,
            title: producto.title,
            reparado: true,
            precio_original_viejo: precioOriginal,
            precio_original_nuevo: precioOriginalCorrecto,
            precio_con_descuento: precioConDescuentoCorrecto,
            porcentaje: porcentaje
          });
        } else {
          // El descuento está correcto
          yaCorrectos++;
          console.log(colors.green(`✅ OK: ${producto.title} - Precio original: $${precioOriginal}, Con descuento: $${precioActual}`));
          
          resultados.push({
            ml_id: producto.ml_id,
            title: producto.title,
            reparado: false,
            mensaje: 'Descuento ya estaba correcto'
          });
        }

      } catch (error: any) {
        console.error(colors.red(`❌ Error procesando producto ${producto.ml_id}:`), error.message);
        resultados.push({
          ml_id: producto.ml_id,
          reparado: false,
          error: error.message
        });
      }
    }

    console.log(colors.green(`\n✅ Reparación completada:`));
    console.log(colors.green(`   🔧 Productos reparados: ${reparados}`));
    console.log(colors.green(`   ✓ Productos ya correctos: ${yaCorrectos}`));
    console.log(colors.green(`   📊 Total procesados: ${productos.length}`));

    return res.json({
      success: true,
      message: `Reparación completada: ${reparados} productos reparados, ${yaCorrectos} ya correctos`,
      total_procesados: productos.length,
      reparados: reparados,
      ya_correctos: yaCorrectos,
      resultados: resultados
    });

  } catch (error: any) {
    console.error(colors.red("❌ Error reparando descuentos:"), error);
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: error.message 
    });
  }
});

export default router;
