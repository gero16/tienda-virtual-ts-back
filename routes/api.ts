import mercadopago from "mercadopago";
import express, { Router, Request, Response } from "express";
import colors from "colors";

import ProductoModel from "../models/products-model";

const router = Router();

// =====================
// Tipos auxiliares
// =====================
interface Producto {
  _id: string;
  id: string;
  name: string;
  price: number;
  image?: string;
  category: string;
  stock: number;
  cantidad: number;
}

interface PreferenceItem {
  id?: string;
  title: string;
  quantity: number;
  unit_price: number;
}

interface PreferenceCreateRequest {
  purpose?: "wallet_purchase";
  items: PreferenceItem[];
}

// =====================
// Configurar credenciales
// =====================
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN as string,
});

// =====================
// Crear preferencia
// =====================
router.post("/create_preference", async (req: Request, res: Response) => {
  try {
    const { title, quantity, price } = req.body;

    const preference: PreferenceCreateRequest = {
      purpose: "wallet_purchase", // podés omitirlo para permitir guest checkout
      items: [
        {
          id: "item-ID-1234",
          title,
          quantity: Number(quantity),
          unit_price: Number(price),
        },
      ],
    };

    const response = await mercadopago.preferences.create(preference);

    return res.json({ preferenceId: response.body.id });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error creando la preferencia" });
  }
});

// =====================
// Rutas de prueba
// =====================
router.get("/", (req: Request, res: Response) => {
  res.send("Hola, mundo desde el enrutador!");
});

router.get("/productos", async (req: Request, res: Response) => {
  try {
    const registros: Producto[] = await ProductoModel.find().lean();
    const registrosOrdenados = registros.sort((a, b) =>
      a.id > b.id ? 1 : a.id < b.id ? -1 : 0
    );

    let msg: string = "Registros Encontrados";
    if (!registros.length) msg = "No existen registros";

    console.log(colors.bgRed(JSON.stringify(registrosOrdenados)));

    return res.status(200).json({ msg, registros: registrosOrdenados });
  } catch (error) {
    console.error(error);
    let msg: string = "Error en la Consulta";
    return res.status(500).json({ msg });
  }
});

export default router;
