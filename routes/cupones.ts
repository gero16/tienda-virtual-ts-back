import express, { Router, Request, Response } from "express";
import colors from "colors";
import CuponModel from "../models/Cupon";

const router = Router();

// =====================
// Crear un nuevo cupón
// =====================
router.post("/crear", async (req: Request, res: Response) => {
  try {
    const { 
      codigo, 
      descripcion, 
      tipo_descuento, 
      valor_descuento,
      fecha_inicio,
      fecha_fin,
      usos_maximos,
      monto_minimo_compra,
      limite_por_usuario
    } = req.body;

    // Validar datos requeridos
    if (!codigo || !descripcion || !tipo_descuento || valor_descuento === undefined) {
      return res.status(400).json({ 
        error: "Faltan campos requeridos: codigo, descripcion, tipo_descuento, valor_descuento" 
      });
    }

    // Validar valor de descuento
    if (tipo_descuento === 'porcentaje' && (valor_descuento <= 0 || valor_descuento > 100)) {
      return res.status(400).json({ 
        error: "Para descuento por porcentaje, el valor debe estar entre 1 y 100" 
      });
    }

    if (tipo_descuento === 'monto_fijo' && valor_descuento <= 0) {
      return res.status(400).json({ 
        error: "Para monto fijo, el valor debe ser mayor a 0" 
      });
    }

    // Verificar que el código no exista
    const codigoUpperCase = codigo.toUpperCase().trim();
    const cuponExistente = await CuponModel.findOne({ codigo: codigoUpperCase });
    
    if (cuponExistente) {
      return res.status(400).json({ 
        error: `El cupón con código "${codigoUpperCase}" ya existe` 
      });
    }

    // Crear el cupón
    const nuevoCupon = new CuponModel({
      codigo: codigoUpperCase,
      descripcion,
      tipo_descuento,
      valor_descuento,
      fecha_inicio: fecha_inicio ? new Date(fecha_inicio) : new Date(),
      fecha_fin: fecha_fin ? new Date(fecha_fin) : undefined,
      usos_maximos: usos_maximos || undefined,
      monto_minimo_compra: monto_minimo_compra || undefined,
      limite_por_usuario: limite_por_usuario || 1,
      activo: true,
      usos_actuales: 0,
      usuarios_usados: []
    });

    await nuevoCupon.save();

    console.log(colors.green(`✅ Cupón creado: ${codigoUpperCase}`));
    console.log(colors.green(`   Tipo: ${tipo_descuento}`));
    console.log(colors.green(`   Valor: ${valor_descuento}${tipo_descuento === 'porcentaje' ? '%' : ' UYU'}`));

    return res.status(201).json({
      success: true,
      message: "Cupón creado exitosamente",
      cupon: nuevoCupon
    });

  } catch (error: any) {
    console.error(colors.red("❌ Error creando cupón:"), error);
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: error.message 
    });
  }
});

// =====================
// Listar todos los cupones
// =====================
router.get("/listar", async (req: Request, res: Response) => {
  try {
    const cupones = await CuponModel.find().sort({ date_created: -1 });

    console.log(colors.blue(`📋 Cupones encontrados: ${cupones.length}`));

    return res.json({
      success: true,
      count: cupones.length,
      cupones: cupones.map(c => ({
        _id: c._id,
        codigo: c.codigo,
        descripcion: c.descripcion,
        tipo_descuento: c.tipo_descuento,
        valor_descuento: c.valor_descuento,
        activo: c.activo,
        fecha_inicio: c.fecha_inicio,
        fecha_fin: c.fecha_fin,
        usos_maximos: c.usos_maximos,
        usos_actuales: c.usos_actuales,
        monto_minimo_compra: c.monto_minimo_compra,
        limite_por_usuario: c.limite_por_usuario,
        date_created: c.date_created
      }))
    });

  } catch (error: any) {
    console.error(colors.red("❌ Error listando cupones:"), error);
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: error.message 
    });
  }
});

// =====================
// Validar un cupón
// =====================
router.post("/validar", async (req: Request, res: Response) => {
  try {
    const { codigo, monto_compra, email_usuario } = req.body;

    if (!codigo) {
      return res.status(400).json({ 
        error: "Se requiere el código del cupón" 
      });
    }

    const codigoUpperCase = codigo.toUpperCase().trim();
    const cupon = await CuponModel.findOne({ codigo: codigoUpperCase });

    // Validar que el cupón existe
    if (!cupon) {
      return res.status(404).json({ 
        valido: false,
        error: "Cupón no encontrado" 
      });
    }

    // Validar que el cupón está activo
    if (!cupon.activo) {
      return res.status(400).json({ 
        valido: false,
        error: "Este cupón no está activo" 
      });
    }

    // Validar fechas
    const ahora = new Date();
    if (cupon.fecha_inicio && ahora < cupon.fecha_inicio) {
      return res.status(400).json({ 
        valido: false,
        error: "Este cupón aún no es válido" 
      });
    }

    if (cupon.fecha_fin && ahora > cupon.fecha_fin) {
      return res.status(400).json({ 
        valido: false,
        error: "Este cupón ha expirado" 
      });
    }

    // Validar usos máximos
    if (cupon.usos_maximos && cupon.usos_actuales >= cupon.usos_maximos) {
      return res.status(400).json({ 
        valido: false,
        error: "Este cupón ha alcanzado su límite de usos" 
      });
    }

    // Validar monto mínimo
    if (cupon.monto_minimo_compra && monto_compra < cupon.monto_minimo_compra) {
      return res.status(400).json({ 
        valido: false,
        error: `El monto mínimo de compra para este cupón es $${cupon.monto_minimo_compra}` 
      });
    }

    // Validar límite por usuario
    if (email_usuario) {
      const vecesUsado = cupon.usuarios_usados.filter(email => email === email_usuario).length;
      if (vecesUsado >= cupon.limite_por_usuario) {
        return res.status(400).json({ 
          valido: false,
          error: "Ya has usado este cupón el máximo de veces permitidas" 
        });
      }
    }

    // Calcular descuento
    let descuento = 0;
    if (cupon.tipo_descuento === 'porcentaje') {
      descuento = (monto_compra * cupon.valor_descuento) / 100;
    } else {
      descuento = cupon.valor_descuento;
    }

    // Asegurar que el descuento no sea mayor al monto total
    descuento = Math.min(descuento, monto_compra);

    console.log(colors.green(`✅ Cupón validado: ${codigoUpperCase}`));
    console.log(colors.green(`   Descuento: $${descuento}`));

    return res.json({
      valido: true,
      cupon: {
        _id: cupon._id,
        codigo: cupon.codigo,
        descripcion: cupon.descripcion,
        tipo_descuento: cupon.tipo_descuento,
        valor_descuento: cupon.valor_descuento
      },
      descuento: descuento,
      monto_final: monto_compra - descuento
    });

  } catch (error: any) {
    console.error(colors.red("❌ Error validando cupón:"), error);
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: error.message 
    });
  }
});

// =====================
// Aplicar un cupón (registrar uso)
// =====================
router.post("/aplicar", async (req: Request, res: Response) => {
  try {
    const { codigo, email_usuario } = req.body;

    if (!codigo) {
      return res.status(400).json({ 
        error: "Se requiere el código del cupón" 
      });
    }

    const codigoUpperCase = codigo.toUpperCase().trim();
    const cupon = await CuponModel.findOne({ codigo: codigoUpperCase });

    if (!cupon) {
      return res.status(404).json({ 
        error: "Cupón no encontrado" 
      });
    }

    // Incrementar usos
    cupon.usos_actuales += 1;
    
    // Agregar email del usuario si se proporciona
    if (email_usuario) {
      cupon.usuarios_usados.push(email_usuario);
    }

    await cupon.save();

    console.log(colors.green(`✅ Cupón aplicado: ${codigoUpperCase}`));
    console.log(colors.green(`   Usos: ${cupon.usos_actuales}/${cupon.usos_maximos || '∞'}`));

    return res.json({
      success: true,
      message: "Cupón aplicado exitosamente",
      usos_actuales: cupon.usos_actuales,
      usos_maximos: cupon.usos_maximos
    });

  } catch (error: any) {
    console.error(colors.red("❌ Error aplicando cupón:"), error);
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: error.message 
    });
  }
});

// =====================
// Actualizar un cupón
// =====================
router.put("/actualizar/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Si se intenta actualizar el código, convertirlo a mayúsculas
    if (updateData.codigo) {
      updateData.codigo = updateData.codigo.toUpperCase().trim();
    }

    const cupon = await CuponModel.findByIdAndUpdate(
      id,
      { ...updateData, date_updated: new Date() },
      { new: true }
    );

    if (!cupon) {
      return res.status(404).json({ 
        error: "Cupón no encontrado" 
      });
    }

    console.log(colors.green(`✅ Cupón actualizado: ${cupon.codigo}`));

    return res.json({
      success: true,
      message: "Cupón actualizado exitosamente",
      cupon
    });

  } catch (error: any) {
    console.error(colors.red("❌ Error actualizando cupón:"), error);
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: error.message 
    });
  }
});

// =====================
// Activar/Desactivar cupón
// =====================
router.patch("/toggle/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const cupon = await CuponModel.findById(id);

    if (!cupon) {
      return res.status(404).json({ 
        error: "Cupón no encontrado" 
      });
    }

    cupon.activo = !cupon.activo;
    await cupon.save();

    console.log(colors.green(`✅ Cupón ${cupon.activo ? 'activado' : 'desactivado'}: ${cupon.codigo}`));

    return res.json({
      success: true,
      message: `Cupón ${cupon.activo ? 'activado' : 'desactivado'} exitosamente`,
      activo: cupon.activo
    });

  } catch (error: any) {
    console.error(colors.red("❌ Error cambiando estado del cupón:"), error);
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: error.message 
    });
  }
});

// =====================
// Eliminar un cupón
// =====================
router.delete("/eliminar/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const cupon = await CuponModel.findByIdAndDelete(id);

    if (!cupon) {
      return res.status(404).json({ 
        error: "Cupón no encontrado" 
      });
    }

    console.log(colors.green(`✅ Cupón eliminado: ${cupon.codigo}`));

    return res.json({
      success: true,
      message: "Cupón eliminado exitosamente"
    });

  } catch (error: any) {
    console.error(colors.red("❌ Error eliminando cupón:"), error);
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: error.message 
    });
  }
});

// =====================
// Obtener estadísticas de cupones
// =====================
router.get("/estadisticas", async (req: Request, res: Response) => {
  try {
    const totalCupones = await CuponModel.countDocuments();
    const cuponesActivos = await CuponModel.countDocuments({ activo: true });
    const cuponesExpirados = await CuponModel.countDocuments({ 
      fecha_fin: { $lt: new Date() } 
    });

    return res.json({
      success: true,
      estadisticas: {
        total: totalCupones,
        activos: cuponesActivos,
        expirados: cuponesExpirados,
        inactivos: totalCupones - cuponesActivos
      }
    });

  } catch (error: any) {
    console.error(colors.red("❌ Error obteniendo estadísticas:"), error);
    return res.status(500).json({ 
      error: "Error interno del servidor", 
      message: error.message 
    });
  }
});

export default router;

