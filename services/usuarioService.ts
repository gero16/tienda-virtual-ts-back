import Usuario, { IUsuario } from '../models/Usuario';

export class UsuarioService {
  // Obtener todos los usuarios con paginación
  static async obtenerUsuarios(
    pagina: number = 1,
    limite: number = 10,
    filtros: {
      activo?: boolean;
      rol?: string;
      busqueda?: string;
    } = {}
  ): Promise<{ usuarios: IUsuario[]; total: number; paginas: number }> {
    try {
      const skip = (pagina - 1) * limite;
      const query: any = {};

      // Aplicar filtros
      if (filtros.activo !== undefined) {
        query.activo = filtros.activo;
      }

      if (filtros.rol) {
        query.rol = filtros.rol;
      }

      if (filtros.busqueda) {
        query.$or = [
          { nombre: new RegExp(filtros.busqueda, 'i') },
          { email: new RegExp(filtros.busqueda, 'i') }
        ];
      }

      const [usuarios, total] = await Promise.all([
        Usuario.find(query)
          .select('-password') // Excluir password por seguridad
          .sort({ date_created: -1 })
          .skip(skip)
          .limit(limite)
          .lean<IUsuario[]>(),
        Usuario.countDocuments(query)
      ]);

      const paginas = Math.ceil(total / limite);

      return { usuarios, total, paginas };
    } catch (error: any) {
      throw new Error(`Error al obtener usuarios: ${error.message}`);
    }
  }

  // Obtener estadísticas de usuarios
  static async obtenerEstadisticas(): Promise<{
    totalUsuarios: number;
    usuariosActivos: number;
    usuariosInactivos: number;
    usuariosPorRol: {
      admin: number;
      manager: number;
      editor: number;
      user: number;
    };
  }> {
    try {
      const [total, activos, inactivos, porRol] = await Promise.all([
        Usuario.countDocuments(),
        Usuario.countDocuments({ activo: true }),
        Usuario.countDocuments({ activo: false }),
        Usuario.aggregate([
          {
            $group: {
              _id: '$rol',
              count: { $sum: 1 }
            }
          }
        ])
      ]);

      const usuariosPorRol = {
        admin: 0,
        manager: 0,
        editor: 0,
        user: 0
      };

      porRol.forEach((item: any) => {
        if (item._id in usuariosPorRol) {
          usuariosPorRol[item._id as keyof typeof usuariosPorRol] = item.count;
        }
      });

      return {
        totalUsuarios: total,
        usuariosActivos: activos,
        usuariosInactivos: inactivos,
        usuariosPorRol
      };
    } catch (error: any) {
      throw new Error(`Error al obtener estadísticas: ${error.message}`);
    }
  }

  // Buscar usuario por ID
  static async obtenerUsuarioPorId(id: string): Promise<IUsuario | null> {
    try {
      const usuario = await Usuario.findById(id).select('-password').lean<IUsuario>();
      return usuario;
    } catch (error: any) {
      throw new Error(`Error al obtener usuario: ${error.message}`);
    }
  }

  // Buscar usuario por email
  static async obtenerUsuarioPorEmail(email: string): Promise<IUsuario | null> {
    try {
      const usuario = await Usuario.findOne({ email: email.toLowerCase() }).select('-password').lean<IUsuario>();
      return usuario;
    } catch (error: any) {
      throw new Error(`Error al obtener usuario: ${error.message}`);
    }
  }

  // Actualizar usuario
  static async actualizarUsuario(id: string, datos: Partial<IUsuario>): Promise<IUsuario | null> {
    try {
      // No permitir actualizar password directamente (usar ruta específica)
      const { password, ...datosActualizacion } = datos as any;
      const usuario = await Usuario.findByIdAndUpdate(
        id,
        { ...datosActualizacion, date_updated: new Date() },
        { new: true }
      ).select('-password').lean<IUsuario>();
      return usuario;
    } catch (error: any) {
      throw new Error(`Error al actualizar usuario: ${error.message}`);
    }
  }

  // Eliminar usuario (soft delete - desactivar)
  static async eliminarUsuario(id: string): Promise<boolean> {
    try {
      const resultado = await Usuario.findByIdAndUpdate(
        id,
        { activo: false, date_updated: new Date() },
        { new: true }
      ).lean();
      return !!resultado;
    } catch (error: any) {
      throw new Error(`Error al eliminar usuario: ${error.message}`);
    }
  }
}
