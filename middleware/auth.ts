import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

interface JwtPayload {
  id: string;
  email: string;
  rol: string;
}

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

    if (!token) {
      return res.status(401).json({ error: "No autorizado: token faltante" });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ error: "Config error: JWT_SECRET no definido" });
    }

    const decoded = jwt.verify(token, secret) as JwtPayload;
    // @ts-ignore - extenderemos el tipo de Request en el futuro si es necesario
    req.user = decoded;
    next();
  } catch (error: any) {
    return res.status(401).json({ error: "Token inválido" });
  }
};

export const authorize = (...rolesPermitidos: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // @ts-ignore
    const user = req.user as JwtPayload | undefined;
    if (!user) {
      return res.status(401).json({ error: "No autorizado" });
    }
    if (rolesPermitidos.length && !rolesPermitidos.includes(user.rol)) {
      return res.status(403).json({ error: "Prohibido: permisos insuficientes" });
    }
    next();
  };
};


