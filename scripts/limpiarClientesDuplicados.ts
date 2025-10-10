import 'dotenv/config';
import mongoose from 'mongoose';
import colors from 'colors';
import Cliente from '../models/Cliente';

/**
 * Script para limpiar clientes duplicados por email
 * Mantiene solo el cliente más reciente y elimina los demás
 */

const conectarDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_CNN as string);
    console.log(colors.green('✅ Conectado a MongoDB'));
  } catch (error) {
    console.error(colors.red('❌ Error conectando a MongoDB:'), error);
    process.exit(1);
  }
};

const limpiarDuplicados = async () => {
  try {
    console.log(colors.yellow('\n🔍 Buscando clientes duplicados...'));

    // Agregar clientes con sus emails
    const pipeline = [
      {
        $group: {
          _id: "$email",
          count: { $sum: 1 },
          documentos: { $push: "$$ROOT" }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ];

    const duplicados = await Cliente.aggregate(pipeline);

    if (duplicados.length === 0) {
      console.log(colors.green('\n✅ No se encontraron clientes duplicados'));
      return;
    }

    console.log(colors.yellow(`\n⚠️  Se encontraron ${duplicados.length} emails con duplicados:`));
    
    let totalEliminados = 0;
    let totalMantenidos = 0;

    for (const grupo of duplicados) {
      const email = grupo._id;
      const documentos = grupo.documentos;
      
      console.log(colors.cyan(`\n📧 Email: ${email}`));
      console.log(colors.cyan(`   Total de registros: ${documentos.length}`));

      // Ordenar por fecha de creación (más reciente primero)
      documentos.sort((a: any, b: any) => {
        const fechaA = a.createdAt || a.fecha_registro || new Date(0);
        const fechaB = b.createdAt || b.fecha_registro || new Date(0);
        return new Date(fechaB).getTime() - new Date(fechaA).getTime();
      });

      // El primero es el más reciente (lo mantenemos)
      const mantener = documentos[0];
      const eliminar = documentos.slice(1);

      console.log(colors.green(`   ✅ Manteniendo: ${mantener._id}`));
      console.log(colors.green(`      Nombre: ${mantener.nombre} ${mantener.apellido}`));
      console.log(colors.green(`      Fecha: ${mantener.createdAt || mantener.fecha_registro}`));
      console.log(colors.green(`      Órdenes: ${mantener.numero_ordenes || 0}`));
      console.log(colors.green(`      Total gastado: $${mantener.total_gastado || 0}`));

      // Consolidar datos del cliente a mantener
      let datosActualizados: any = {};
      let necesitaActualizar = false;

      // Sumar estadísticas de todos los duplicados
      for (const doc of eliminar) {
        if (doc.numero_ordenes > 0 || doc.total_gastado > 0) {
          datosActualizados.numero_ordenes = (mantener.numero_ordenes || 0) + (doc.numero_ordenes || 0);
          datosActualizados.total_gastado = (mantener.total_gastado || 0) + (doc.total_gastado || 0);
          datosActualizados.total_compras = (mantener.total_compras || 0) + (doc.total_compras || 0);
          necesitaActualizar = true;
        }

        console.log(colors.red(`   ❌ Eliminando: ${doc._id}`));
        console.log(colors.red(`      Nombre: ${doc.nombre} ${doc.apellido}`));
        console.log(colors.red(`      Fecha: ${doc.createdAt || doc.fecha_registro}`));
        console.log(colors.red(`      Órdenes: ${doc.numero_ordenes || 0}`));
        console.log(colors.red(`      Total gastado: $${doc.total_gastado || 0}`));
      }

      // Actualizar el cliente que mantenemos si es necesario
      if (necesitaActualizar) {
        await Cliente.updateOne({ _id: mantener._id }, { $set: datosActualizados });
        console.log(colors.green(`   📊 Estadísticas consolidadas:`));
        console.log(colors.green(`      Órdenes totales: ${datosActualizados.numero_ordenes}`));
        console.log(colors.green(`      Total gastado: $${datosActualizados.total_gastado}`));
      }

      // Eliminar los duplicados
      const idsAEliminar = eliminar.map((doc: any) => doc._id);
      const resultado = await Cliente.deleteMany({ _id: { $in: idsAEliminar } });

      totalEliminados += resultado.deletedCount || 0;
      totalMantenidos += 1;
    }

    console.log(colors.green(`\n✅ Limpieza completada:`));
    console.log(colors.green(`   📧 Emails únicos mantenidos: ${totalMantenidos}`));
    console.log(colors.green(`   🗑️  Duplicados eliminados: ${totalEliminados}`));
    
  } catch (error) {
    console.error(colors.red('❌ Error limpiando duplicados:'), error);
    throw error;
  }
};

const verificarIndice = async () => {
  try {
    console.log(colors.yellow('\n🔍 Verificando índice único en email...'));
    
    const indices = await Cliente.collection.getIndexes();
    const tieneIndiceUnico = Object.values(indices).some((index: any) => 
      index.key && index.key.email === 1 && index.unique === true
    );

    if (tieneIndiceUnico) {
      console.log(colors.green('✅ El índice único en email ya existe'));
    } else {
      console.log(colors.yellow('⚠️  El índice único no existe, creándolo...'));
      await Cliente.collection.createIndex({ email: 1 }, { unique: true });
      console.log(colors.green('✅ Índice único creado exitosamente'));
    }
  } catch (error: any) {
    if (error.code === 11000) {
      console.log(colors.red('❌ No se pudo crear el índice único porque aún hay duplicados'));
      console.log(colors.yellow('   Ejecuta este script nuevamente para limpiar duplicados'));
    } else {
      console.error(colors.red('❌ Error verificando/creando índice:'), error);
    }
  }
};

const mostrarEstadisticas = async () => {
  try {
    const total = await Cliente.countDocuments();
    const totalActivos = await Cliente.countDocuments({ activo: true });
    const conOrdenes = await Cliente.countDocuments({ numero_ordenes: { $gt: 0 } });

    console.log(colors.cyan('\n📊 Estadísticas de clientes:'));
    console.log(colors.cyan(`   Total de clientes: ${total}`));
    console.log(colors.cyan(`   Clientes activos: ${totalActivos}`));
    console.log(colors.cyan(`   Clientes con órdenes: ${conOrdenes}`));
  } catch (error) {
    console.error(colors.red('❌ Error obteniendo estadísticas:'), error);
  }
};

const main = async () => {
  try {
    console.log(colors.blue('\n=========================================='));
    console.log(colors.blue('  🧹 Limpieza de Clientes Duplicados'));
    console.log(colors.blue('==========================================\n'));

    await conectarDB();
    
    // Mostrar estadísticas iniciales
    console.log(colors.yellow('\n📊 Estadísticas ANTES de la limpieza:'));
    await mostrarEstadisticas();

    // Limpiar duplicados
    await limpiarDuplicados();

    // Verificar/crear índice único
    await verificarIndice();

    // Mostrar estadísticas finales
    console.log(colors.yellow('\n📊 Estadísticas DESPUÉS de la limpieza:'));
    await mostrarEstadisticas();

    console.log(colors.green('\n✅ Proceso completado exitosamente'));
    console.log(colors.blue('\n==========================================\n'));

    process.exit(0);
  } catch (error) {
    console.error(colors.red('\n❌ Error en el proceso:'), error);
    process.exit(1);
  }
};

// Ejecutar el script
main();

