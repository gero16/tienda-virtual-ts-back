import 'dotenv/config'

import express, {Express, Router, Request, Response } from 'express';
import cors from "cors";
import mongoose from 'mongoose';
import bodyParser from "body-parser"
import colors from "colors"

import routes from './routes/api'; 
import mercadolibre from './routes/mercadolibre';
import clientes from './routes/clientes'; // 🆕 Importar rutas de clientes
import descuentos from './routes/descuentos'; // 🆕 Importar rutas de descuentos

const app : Express = express();
const port = 3000;

app.use(bodyParser.json())

// Configuración CORS para permitir el frontend de Vercel
const corsOptions = {
  origin: [
    'https://mercado-libre-roan.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:3001'
  ],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions))

import mercadopago from 'mercadopago';

// Configurar MercadoPago con variable de entorno
const mpAccessToken = process.env.MP_ACCESS_TOKEN || 'TEST-3488859500794386-010715-320f2dd75257891352172318a1ed84fd-370206533';

mercadopago.configure({
  access_token: mpAccessToken,
})

app.use('/api', routes);
app.use('/ml', mercadolibre);
app.use('/api/clientes', clientes); // 🆕 Agregar rutas de clientes
app.use('/api/descuentos', descuentos); // 🆕 Agregar rutas de descuentos
app.get('/', (req: Request, res: Response) => {
  res.send('Ruta funcionando!');
});


const dbConnection = async () : Promise <void> => {
  try {
    await mongoose.connect(process.env.MONGODB_CNN as string);
    console.log(colors.yellow('Base de datos Conectada'));
  } catch (error) {
    console.error(error);
    throw new Error('Error a la hora de iniciar la base de datos');
  }
};


const conectarDB = async () : Promise <void> => {
  await dbConnection()
}

conectarDB()

app.listen(port, () => {
  console.log(`Servidor Express corriendo en http://localhost:${port}`);
});
