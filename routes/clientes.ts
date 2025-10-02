import { Router, Request, Response } from "express";
import { ClienteService, ClienteData } from "../services/clienteService";

const router = Router();

// Middleware de validación básica
const validarCliente = (req: Request, res: Response, next: any) => {
  const { nombre, apellido, email, telefono, direccion } = req.body;
  
  if (!nombre || !apellido || !email || !telefono || !direccion) {
    return res.status(400).json({
      success: false,
      message: 'Faltan campos requeridos: nombre, apellido, email, telefono, direccion'
    });
  }

  if (!direccion.calle || !direccion.numero || !direccion.ciudad || !direccion.departamento) {
    return res.status(400).json({
      success: false,
      message: 'Faltan campos requeridos en la dirección: calle, numero, ciudad, departamento'
    });
  }

  next();
};

// GET /api/clientes - Obtener todos los clientes con paginación y filtros
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      pagina = 1,
      limite = 10,
      activo,
      ciudad,
      departamento,
      busqueda
    } = req.query;

    const filtros: any = {};
    if (activo !== undefined) filtros.activo = activo === 'true';
    if (ciudad) filtros.ciudad = ciudad as string;
    if (departamento) filtros.departamento = departamento as string;
    if (busqueda) filtros.busqueda = busqueda as string;

    const resultado = await ClienteService.obtenerClientes(
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

// GET /api/clientes/estadisticas - Obtener estadísticas de clientes
router.get('/estadisticas', async (req: Request, res: Response) => {
  try {
    const estadisticas = await ClienteService.obtenerEstadisticas();
    
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

// GET /api/clientes/:id - Obtener cliente por ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const cliente = await ClienteService.obtenerClientePorId(id);

    if (!cliente) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado'
      });
    }

    res.json({
      success: true,
      data: cliente
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// GET /api/clientes/email/:email - Obtener cliente por email
router.get('/email/:email', async (req: Request, res: Response) => {
  try {
    const { email } = req.params;
    const cliente = await ClienteService.obtenerClientePorEmail(email);

    if (!cliente) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado'
      });
    }

    res.json({
      success: true,
      data: cliente
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// POST /api/clientes - Crear nuevo cliente
router.post('/', validarCliente, async (req: Request, res: Response) => {
  try {
    const clienteData: ClienteData = req.body;
    const cliente = await ClienteService.crearCliente(clienteData);

    res.status(201).json({
      success: true,
      message: 'Cliente creado exitosamente',
      data: cliente
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// PUT /api/clientes/:id - Actualizar cliente
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const datosActualizacion = req.body;

    const cliente = await ClienteService.actualizarCliente(id, datosActualizacion);

    if (!cliente) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Cliente actualizado exitosamente',
      data: cliente
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// DELETE /api/clientes/:id - Eliminar cliente (soft delete)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const eliminado = await ClienteService.eliminarCliente(id);

    if (!eliminado) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Cliente eliminado exitosamente'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// POST /api/clientes/buscar - Buscar cliente por email o teléfono
router.post('/buscar', async (req: Request, res: Response) => {
  try {
    const { email, telefono } = req.body;

    if (!email && !telefono) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere email o teléfono para buscar'
      });
    }

    const cliente = await ClienteService.buscarCliente(email, telefono);

    if (!cliente) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado'
      });
    }

    res.json({
      success: true,
      data: cliente
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// POST /api/clientes/desde-orden - Crear o actualizar cliente desde datos de orden
router.post('/desde-orden', async (req: Request, res: Response) => {
  try {
    const datosCliente = req.body;
    const cliente = await ClienteService.crearOActualizarDesdeOrden(datosCliente);

    res.json({
      success: true,
      message: 'Cliente procesado exitosamente',
      data: cliente
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

export default router;
