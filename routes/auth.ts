import express, { Router, Request, Response } from "express";
import jwt, { Secret, SignOptions } from "jsonwebtoken";
import bcrypt from "bcryptjs";
import Usuario from "../models/Usuario";
import { authenticate, authorize } from "../middleware/auth";
import { ClienteService } from "../services/clienteService";

const router = Router();

const signToken = (payload: { id: string; email: string; rol: string }) => {
  const secretEnv = process.env.JWT_SECRET;
  if (!secretEnv) {
    throw new Error("JWT_SECRET no definido");
  }
  const secret: Secret = secretEnv as Secret;
  const expiresInValue: SignOptions["expiresIn"] = (process.env.JWT_EXPIRES_IN as any) || "7d";
  return jwt.sign(payload, secret, { expiresIn: expiresInValue } as SignOptions);
};

// POST /auth/login
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as { email: string; password: string };
    if (!email || !password) {
      return res.status(400).json({ error: "Email y password son requeridos" });
    }

    const usuario = await Usuario.findOne({ email: email.toLowerCase() });
    if (!usuario || !usuario.activo) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const ok = await usuario.compararPassword(password);
    if (!ok) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const token = signToken({ id: usuario._id.toString(), email: usuario.email, rol: usuario.rol });
    return res.json({
      token,
      user: { id: usuario._id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol },
    });
  } catch (error: any) {
    return res.status(500).json({ error: "Error en login", message: error.message });
  }
});

// POST /auth/register (clientes/usuarios estándar)
router.post("/register", async (req: Request, res: Response) => {
  try {
    const { 
      nombre, 
      apellido,
      email, 
      password,
      telefono,
      direccion
    } = req.body as { 
      nombre: string; 
      apellido?: string;
      email: string; 
      password: string;
      telefono?: string;
      direccion?: {
        calle?: string;
        numero?: string;
        apartamento?: string;
        codigo_postal?: string;
        ciudad?: string;
        departamento?: string;
        pais?: string;
      };
    };

    // Campos requeridos
    if (!nombre || !email || !password) {
      return res.status(400).json({ error: "nombre, email y password son requeridos" });
    }

    const existente = await Usuario.findOne({ email: email.toLowerCase() });
    if (existente) {
      return res.status(400).json({ error: "El email ya está registrado" });
    }

    // Crear el usuario
    const nuevo = await Usuario.create({ nombre, email: email.toLowerCase(), password, rol: "user" });
    
    // Si se proporcionaron datos adicionales, crear el cliente
    if (apellido || telefono || direccion) {
      try {
        // Separar nombre y apellido si solo se proporcionó nombre
        const nombreCompleto = nombre.split(' ');
        const nombreCliente = nombreCompleto[0] || nombre;
        const apellidoCliente = apellido || nombreCompleto.slice(1).join(' ') || 'Sin apellido';

        // Validar y preparar datos del cliente
        const telefonoCliente = telefono || '099999999'; // Valor por defecto si no se proporciona
        const direccionCliente = direccion || {
          calle: 'Dirección no proporcionada',
          numero: '1',
          codigo_postal: '00000',
          ciudad: 'N/A',
          departamento: 'N/A',
          pais: 'Uruguay'
        };

        // Asegurar que todos los campos requeridos de dirección estén presentes
        const direccionCompleta = {
          calle: direccionCliente.calle || 'Dirección no proporcionada',
          numero: direccionCliente.numero || '1',
          apartamento: direccionCliente.apartamento,
          codigo_postal: direccionCliente.codigo_postal || '00000',
          ciudad: direccionCliente.ciudad || 'N/A',
          departamento: direccionCliente.departamento || 'N/A',
          pais: direccionCliente.pais || 'Uruguay'
        };

        await ClienteService.crearCliente({
          nombre: nombreCliente,
          apellido: apellidoCliente,
          email: email.toLowerCase(),
          telefono: telefonoCliente,
          direccion: direccionCompleta
        });
      } catch (clienteError: any) {
        // Si hay error al crear el cliente, no fallar el registro del usuario
        // Solo loguear el error (en producción usar un logger apropiado)
        console.error('Error al crear cliente durante registro:', clienteError.message);
      }
    }

    const token = signToken({ id: nuevo._id.toString(), email: nuevo.email, rol: nuevo.rol });
    return res.status(201).json({ token, user: { id: nuevo._id, nombre: nuevo.nombre, email: nuevo.email, rol: nuevo.rol } });
  } catch (error: any) {
    return res.status(500).json({ error: "Error registrando usuario", message: error.message });
  }
});

// POST /auth/register-admin
// Política: permitir crear el primer admin si no existe ninguno aún.
router.post("/register-admin", async (req: Request, res: Response) => {
  try {
    const { nombre, email, password } = req.body as { nombre: string; email: string; password: string };
    if (!nombre || !email || !password) {
      return res.status(400).json({ error: "nombre, email y password son requeridos" });
    }

    const adminsCount = await Usuario.countDocuments({ rol: "admin" });
    if (adminsCount > 0) {
      return res.status(403).json({ error: "Ya existe un admin. Usa /auth/create-admin con token." });
    }

    const existente = await Usuario.findOne({ email: email.toLowerCase() });
    if (existente) {
      return res.status(400).json({ error: "El email ya está registrado" });
    }

    const nuevo = await Usuario.create({ nombre, email: email.toLowerCase(), password, rol: "admin" });
    const token = signToken({ id: nuevo._id.toString(), email: nuevo.email, rol: nuevo.rol });
    return res.status(201).json({ token, user: { id: nuevo._id, nombre: nuevo.nombre, email: nuevo.email, rol: nuevo.rol } });
  } catch (error: any) {
    return res.status(500).json({ error: "Error creando primer admin", message: error.message });
  }
});

// POST /auth/create-admin (requiere admin existente)
router.post("/create-admin", authenticate, authorize("admin"), async (req: Request, res: Response) => {
  try {
    const { nombre, email, password } = req.body as { nombre: string; email: string; password: string };
    if (!nombre || !email || !password) {
      return res.status(400).json({ error: "nombre, email y password son requeridos" });
    }

    const existente = await Usuario.findOne({ email: email.toLowerCase() });
    if (existente) {
      return res.status(400).json({ error: "El email ya está registrado" });
    }

    const nuevo = await Usuario.create({ nombre, email: email.toLowerCase(), password, rol: "admin" });
    return res.status(201).json({
      success: true,
      user: { id: nuevo._id, nombre: nuevo.nombre, email: nuevo.email, rol: nuevo.rol },
    });
  } catch (error: any) {
    return res.status(500).json({ error: "Error creando admin", message: error.message });
  }
});

// GET /auth/me
router.get("/me", authenticate, (req: Request, res: Response) => {
  // @ts-ignore
  const user = req.user;
  return res.json({ user });
});

// GET /auth/profile - Obtener perfil del cliente basado en el email del usuario autenticado
router.get("/profile", authenticate, async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const userEmail = req.user?.email;
    if (!userEmail) {
      return res.status(401).json({ error: "Usuario no autenticado" });
    }

    const cliente = await ClienteService.obtenerClientePorEmail(userEmail);
    
    if (!cliente) {
      return res.status(404).json({ 
        error: "Perfil no encontrado",
        message: "No se encontró información de perfil. Puedes completarla ahora." 
      });
    }

    return res.json({ 
      cliente: {
        id: cliente._id,
        nombre: cliente.nombre,
        apellido: cliente.apellido,
        email: cliente.email,
        telefono: cliente.telefono,
        direccion: cliente.direccion,
        fecha_registro: cliente.fecha_registro,
        ultima_actividad: cliente.ultima_actividad
      }
    });
  } catch (error: any) {
    return res.status(500).json({ error: "Error obteniendo perfil", message: error.message });
  }
});

// PUT /auth/profile - Actualizar perfil del cliente
router.put("/profile", authenticate, async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const userEmail = req.user?.email;
    if (!userEmail) {
      return res.status(401).json({ error: "Usuario no autenticado" });
    }

    const {
      nombre,
      apellido,
      telefono,
      direccion
    } = req.body;

    // Buscar cliente por email
    let cliente = await ClienteService.obtenerClientePorEmail(userEmail);

    if (!cliente) {
      // Si no existe el cliente, crear uno nuevo
      const nombreCompleto = nombre?.split(' ') || ['Usuario'];
      const nombreCliente = nombreCompleto[0] || 'Usuario';
      const apellidoCliente = apellido || nombreCompleto.slice(1).join(' ') || 'Sin apellido';

      const direccionCompleta = direccion || {
        calle: 'Dirección no proporcionada',
        numero: '1',
        codigo_postal: '00000',
        ciudad: 'N/A',
        departamento: 'N/A',
        pais: 'Uruguay'
      };

      cliente = await ClienteService.crearCliente({
        nombre: nombreCliente,
        apellido: apellidoCliente,
        email: userEmail,
        telefono: telefono || '099999999',
        direccion: {
          calle: direccionCompleta.calle || 'Dirección no proporcionada',
          numero: direccionCompleta.numero || '1',
          apartamento: direccionCompleta.apartamento,
          codigo_postal: direccionCompleta.codigo_postal || '00000',
          ciudad: direccionCompleta.ciudad || 'N/A',
          departamento: direccionCompleta.departamento || 'N/A',
          pais: direccionCompleta.pais || 'Uruguay'
        }
      });
    } else {
      // Actualizar cliente existente
      const datosActualizacion: any = {};
      
      if (nombre) datosActualizacion.nombre = nombre;
      if (apellido) datosActualizacion.apellido = apellido;
      if (telefono) datosActualizacion.telefono = telefono;
      if (direccion) datosActualizacion.direccion = direccion;

      if (Object.keys(datosActualizacion).length > 0) {
        cliente = await ClienteService.actualizarCliente(cliente._id.toString(), datosActualizacion);
      }
    }

    if (!cliente) {
      return res.status(500).json({ error: "Error actualizando perfil" });
    }

    return res.json({
      success: true,
      cliente: {
        id: cliente._id,
        nombre: cliente.nombre,
        apellido: cliente.apellido,
        email: cliente.email,
        telefono: cliente.telefono,
        direccion: cliente.direccion,
        fecha_registro: cliente.fecha_registro,
        ultima_actividad: cliente.ultima_actividad
      }
    });
  } catch (error: any) {
    return res.status(500).json({ error: "Error actualizando perfil", message: error.message });
  }
});

export default router;


