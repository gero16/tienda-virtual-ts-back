import mongoose from 'mongoose';
import Cliente from '../models/Cliente';
import Orden from '../models/Orden';
import 'dotenv/config';

// Script para migrar datos de clientes desde las órdenes existentes
async function migrarClientes() {
  try {
    // Conectar a la base de datos
    await mongoose.connect(process.env.MONGODB_CNN as string);
    console.log('✅ Conectado a la base de datos');

    // Obtener todas las órdenes que tienen datos de cliente
    const ordenes = await Orden.find({
      'customer.email': { $exists: true, $ne: null }
    });

    console.log(`📊 Encontradas ${ordenes.length} órdenes con datos de cliente`);

    let clientesCreados = 0;
    let clientesActualizados = 0;
    let errores = 0;

    for (const orden of ordenes) {
      try {
        const { customer } = orden;
        
        // Buscar si ya existe un cliente con este email
        let cliente = await Cliente.findOne({ 
          email: customer.email.toLowerCase() 
        });

        if (cliente) {
          // Actualizar estadísticas del cliente existente
          cliente.total_compras += 1;
          cliente.total_gastado += orden.total;
          cliente.numero_ordenes += 1;
          cliente.ultima_actividad = new Date();
          
          // Actualizar dirección si es más reciente
          if (orden.date_created > cliente.fecha_registro) {
            cliente.direccion = {
              calle: customer.address,
              numero: '1', // Valor por defecto
              codigo_postal: '00000', // Valor por defecto
              ciudad: customer.city,
              departamento: customer.state,
              pais: 'Uruguay'
            };
          }
          
          await cliente.save();
          clientesActualizados++;
        } else {
          // Crear nuevo cliente
          const [nombre, ...apellidos] = customer.name.split(' ');
          const apellido = apellidos.join(' ') || 'Sin apellido';

          const nuevoCliente = new Cliente({
            nombre: nombre || 'Sin nombre',
            apellido: apellido,
            email: customer.email.toLowerCase(),
            telefono: customer.phone,
            direccion: {
              calle: customer.address,
              numero: '1', // Valor por defecto
              codigo_postal: '00000', // Valor por defecto
              ciudad: customer.city,
              departamento: customer.state,
              pais: 'Uruguay'
            },
            total_compras: 1,
            total_gastado: orden.total,
            numero_ordenes: 1,
            fecha_registro: orden.date_created,
            ultima_actividad: orden.date_created
          });

          await nuevoCliente.save();
          clientesCreados++;
        }
      } catch (error: any) {
        console.error(`❌ Error procesando orden ${orden.orden_id}:`, error.message);
        errores++;
      }
    }

    console.log('\n📈 Resumen de la migración:');
    console.log(`✅ Clientes creados: ${clientesCreados}`);
    console.log(`🔄 Clientes actualizados: ${clientesActualizados}`);
    console.log(`❌ Errores: ${errores}`);
    console.log(`📊 Total procesado: ${clientesCreados + clientesActualizados + errores}`);

  } catch (error: any) {
    console.error('❌ Error en la migración:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Desconectado de la base de datos');
  }
}

// Ejecutar la migración
migrarClientes();
