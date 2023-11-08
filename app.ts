import 'dotenv/config'
import express, {Express, Router, Request, Response } from 'express';
import cors from "cors";
import routes from './routes/api'; 
import mongoose from 'mongoose';
import bodyParser from "body-parser"
import colors from "colors"

const app : Express = express();
const port = 3000;

app.use(bodyParser.json())
app.use(cors())

import mercadopago from 'mercadopago';
// Agrega credenciales
mercadopago.configure({
  access_token:
    'TEST-3488859500794386-010715-320f2dd75257891352172318a1ed84fd-370206533',
})


app.use('/api', routes);


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