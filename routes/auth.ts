import express, { Router, Request, Response } from "express";
import jwt, { Secret, SignOptions } from "jsonwebtoken";
import bcrypt from "bcryptjs";
import Usuario from "../models/Usuario";
import { authenticate, authorize } from "../middleware/auth";

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

export default router;


