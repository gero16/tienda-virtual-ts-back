import { Router, Request, Response } from 'express';
import { UsuarioService } from '../services/usuarioService';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

// GET /api/usuarios - Obtener todos los usuarios con paginación y filtros
router.get('/', authenticate, authorize('admin'), async (req: Request, res: Response) => {
  try {
    const {
      pagina = 1,
      limite = 10,
      activo,
      rol,
      busqueda
    } = req.query;

    const filtros: any = {};
    if (activo !== undefined) filtros.activo = activo === 'true';
    if (rol) filtros.rol = rol as string;
    if (busqueda) filtros.busqueda = busqueda as string;

    const resultado = await UsuarioService.obtenerUsuarios(
      parseInt(pagina as string),
      parseInt(limite as string),
      filtros
    );

    res.json({
      success: true,
      data: resultado
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// GET /api/usuarios/estadisticas - Obtener estadísticas de usuarios
router.get('/estadisticas', authenticate, authorize('admin'), async (req: Request, res: Response) => {
  try {
    const estadisticas = await UsuarioService.obtenerEstadisticas();
    
    res.json({
      success: true,
      data: estadisticas
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// GET /api/usuarios/:id - Obtener usuario por ID
router.get('/:id', authenticate, authorize('admin'), async (req: Request, res: Response) => {
  try {
    const usuario = await UsuarioService.obtenerUsuarioPorId(req.params.id);
    
    if (!usuario) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    res.json({
      success: true,
      data: usuario
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// PUT /api/usuarios/:id - Actualizar usuario
router.put('/:id', authenticate, authorize('admin'), async (req: Request, res: Response) => {
  try {
    const usuario = await UsuarioService.actualizarUsuario(req.params.id, req.body);
    
    if (!usuario) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    res.json({
      success: true,
      data: usuario
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// DELETE /api/usuarios/:id - Eliminar usuario (desactivar)
router.delete('/:id', authenticate, authorize('admin'), async (req: Request, res: Response) => {
  try {
    const resultado = await UsuarioService.eliminarUsuario(req.params.id);
    
    if (!resultado) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Usuario desactivado correctamente'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

export default router;
