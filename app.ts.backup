import 'dotenv/config'

import express, {Express, Router, Request, Response } from 'express';
import cors from "cors";
import mongoose from 'mongoose';
import bodyParser from "body-parser"
import colors from "colors"

import routes from './routes/api'; 
import mercadolibre from './routes/mercadolibre'; 

const app : Express = express();
const port = 3000;

app.use(bodyParser.json())
app.use(cors())

import mercadopago from 'mercadopago';

// Configurar MercadoPago con variable de entorno
const mpAccessToken = process.env.MP_ACCESS_TOKEN || 'TEST-3488859500794386-010715-320f2dd75257891352172318a1ed84fd-370206533';

mercadopago.configure({
  access_token: mpAccessToken,
})

app.use('/api', routes);
app.use('/ml', mercadolibre);
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