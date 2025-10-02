import Cliente, { ICliente } from '../models/Cliente';
import { Types } from 'mongoose';

export interface ClienteData {
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
  direccion: {
    calle: string;
    numero: string;
    apartamento?: string;
    codigo_postal: string;
    ciudad: string;
    departamento: string;
    pais?: string;
  };
  fecha_nacimiento?: Date;
  genero?: 'masculino' | 'femenino' | 'otro' | 'prefiero_no_decir';
  preferencias?: {
    notificaciones_email?: boolean;
    notificaciones_sms?: boolean;
    newsletter?: boolean;
    idioma?: string;
  };
  ml_user_id?: string;
  notas_internas?: string;
}

export class ClienteService {
  // Crear un nuevo cliente
  static async crearCliente(clienteData: ClienteData): Promise<ICliente> {
    try {
      // Verificar si el cliente ya existe
      const clienteExistente = await Cliente.findOne({
        $or: [
          { email: clienteData.email.toLowerCase() },
          { telefono: clienteData.telefono }
        ]
      });

      if (clienteExistente) {
        throw new Error('Ya existe un cliente con este email o teléfono');
      }

      const cliente = new Cliente({
        ...clienteData,
        email: clienteData.email.toLowerCase(),
        direccion: {
          ...clienteData.direccion,
          pais: clienteData.direccion.pais || 'Uruguay'
        }
      });

      return await cliente.save();
    } catch (error: any) {
      throw new Error(`Error al crear cliente: ${error.message}`);
    }
  }

  // Buscar cliente por ID
  static async obtenerClientePorId(id: string): Promise<ICliente | null> {
    try {
      if (!Types.ObjectId.isValid(id)) {
        throw new Error('ID de cliente inválido');
      }
      return await Cliente.findById(id);
    } catch (error: any) {
      throw new Error(`Error al obtener cliente: ${error.message}`);
    }
  }

  // Buscar cliente por email
  static async obtenerClientePorEmail(email: string): Promise<ICliente | null> {
    try {
      return await Cliente.findOne({ email: email.toLowerCase() });
    } catch (error: any) {
      throw new Error(`Error al buscar cliente por email: ${error.message}`);
    }
  }

  // Buscar cliente por email o teléfono
  static async buscarCliente(email: string, telefono?: string): Promise<ICliente | null> {
    try {
      const query: any = { email: email.toLowerCase() };
      if (telefono) {
        query.$or = [{ email: email.toLowerCase() }, { telefono }];
      }
      return await Cliente.findOne(query);
    } catch (error: any) {
      throw new Error(`Error al buscar cliente: ${error.message}`);
    }
  }

  // Actualizar cliente
  static async actualizarCliente(id: string, datosActualizacion: Partial<ClienteData>): Promise<ICliente | null> {
    try {
      if (!Types.ObjectId.isValid(id)) {
        throw new Error('ID de cliente inválido');
      }

      // Si se actualiza el email, verificar que no exista otro cliente con ese email
      if (datosActualizacion.email) {
        const clienteExistente = await Cliente.findOne({
          email: datosActualizacion.email.toLowerCase(),
          _id: { $ne: id }
        });

        if (clienteExistente) {
          throw new Error('Ya existe otro cliente con este email');
        }
      }

      const clienteActualizado = await Cliente.findByIdAndUpdate(
        id,
        { 
          ...datosActualizacion,
          ...(datosActualizacion.email && { email: datosActualizacion.email.toLowerCase() })
        },
        { new: true, runValidators: true }
      );

      return clienteActualizado;
    } catch (error: any) {
      throw new Error(`Error al actualizar cliente: ${error.message}`);
    }
  }

  // Eliminar cliente (soft delete)
  static async eliminarCliente(id: string): Promise<boolean> {
    try {
      if (!Types.ObjectId.isValid(id)) {
        throw new Error('ID de cliente inválido');
      }

      const resultado = await Cliente.findByIdAndUpdate(
        id,
        { activo: false },
        { new: true }
      );

      return !!resultado;
    } catch (error: any) {
      throw new Error(`Error al eliminar cliente: ${error.message}`);
    }
  }

  // Obtener todos los clientes con paginación
  static async obtenerClientes(
    pagina: number = 1,
    limite: number = 10,
    filtros: {
      activo?: boolean;
      ciudad?: string;
      departamento?: string;
      busqueda?: string;
    } = {}
  ): Promise<{ clientes: ICliente[]; total: number; paginas: number }> {
    try {
      const skip = (pagina - 1) * limite;
      const query: any = {};

      // Aplicar filtros
      if (filtros.activo !== undefined) {
        query.activo = filtros.activo;
      }

      if (filtros.ciudad) {
        query['direccion.ciudad'] = new RegExp(filtros.ciudad, 'i');
      }

      if (filtros.departamento) {
        query['direccion.departamento'] = new RegExp(filtros.departamento, 'i');
      }

      if (filtros.busqueda) {
        query.$or = [
          { nombre: new RegExp(filtros.busqueda, 'i') },
          { apellido: new RegExp(filtros.busqueda, 'i') },
          { email: new RegExp(filtros.busqueda, 'i') },
          { telefono: new RegExp(filtros.busqueda, 'i') }
        ];
      }

      const [clientes, total] = await Promise.all([
        Cliente.find(query)
          .sort({ fecha_registro: -1 })
          .skip(skip)
          .limit(limite)
          .select('-metodos_pago'), // Excluir métodos de pago por seguridad
        Cliente.countDocuments(query)
      ]);

      const paginas = Math.ceil(total / limite);

      return { clientes, total, paginas };
    } catch (error: any) {
      throw new Error(`Error al obtener clientes: ${error.message}`);
    }
  }

  // Actualizar estadísticas de compra
  static async actualizarEstadisticasCompra(clienteId: string, monto: number): Promise<ICliente | null> {
    try {
      if (!Types.ObjectId.isValid(clienteId)) {
        throw new Error('ID de cliente inválido');
      }

      return await Cliente.findByIdAndUpdate(
        clienteId,
        {
          $inc: {
            total_compras: 1,
            total_gastado: monto,
            numero_ordenes: 1
          },
          $set: {
            ultima_actividad: new Date()
          }
        },
        { new: true }
      );
    } catch (error: any) {
      throw new Error(`Error al actualizar estadísticas: ${error.message}`);
    }
  }

  // Obtener estadísticas de clientes
  static async obtenerEstadisticas(): Promise<{
    totalClientes: number;
    clientesActivos: number;
    clientesInactivos: number;
    totalGastado: number;
    promedioGasto: number;
  }> {
    try {
      const [
        totalClientes,
        clientesActivos,
        clientesInactivos,
        estadisticasGasto
      ] = await Promise.all([
        Cliente.countDocuments(),
        Cliente.countDocuments({ activo: true }),
        Cliente.countDocuments({ activo: false }),
        Cliente.aggregate([
          {
            $group: {
              _id: null,
              totalGastado: { $sum: '$total_gastado' },
              promedioGasto: { $avg: '$total_gastado' }
            }
          }
        ])
      ]);

      const { totalGastado = 0, promedioGasto = 0 } = estadisticasGasto[0] || {};

      return {
        totalClientes,
        clientesActivos,
        clientesInactivos,
        totalGastado,
        promedioGasto: Math.round(promedioGasto * 100) / 100
      };
    } catch (error: any) {
      throw new Error(`Error al obtener estadísticas: ${error.message}`);
    }
  }

  // Crear o actualizar cliente desde datos de orden
  static async crearOActualizarDesdeOrden(datosCliente: {
    name: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    state: string;
  }): Promise<ICliente> {
    try {
      const [nombre, ...apellidos] = datosCliente.name.split(' ');
      const apellido = apellidos.join(' ');

      // Buscar cliente existente
      let cliente = await Cliente.findOne({
        email: datosCliente.email.toLowerCase()
      });

      if (cliente) {
        // Actualizar datos si el cliente existe
        cliente.ultima_actividad = new Date();
        await cliente.save();
        return cliente;
      } else {
        // Crear nuevo cliente
        const nuevoCliente = new Cliente({
          nombre: nombre || 'Sin nombre',
          apellido: apellido || 'Sin apellido',
          email: datosCliente.email.toLowerCase(),
          telefono: datosCliente.phone,
          direccion: {
            calle: datosCliente.address,
            numero: '1', // Valor por defecto si no se puede extraer
            codigo_postal: '00000', // Valor por defecto
            ciudad: datosCliente.city,
            departamento: datosCliente.state,
            pais: 'Uruguay'
          }
        });

        return await nuevoCliente.save();
      }
    } catch (error: any) {
      throw new Error(`Error al crear/actualizar cliente desde orden: ${error.message}`);
    }
  }
}
