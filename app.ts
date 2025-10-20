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
import cupones from './routes/cupones'; // 🆕 Importar rutas de cupones
import sitemap from './routes/sitemap'; // 🆕 Importar rutas de sitemap/SEO
import checkoutPro from './routes/checkoutPro'; // 🆕 Checkout Pro para USD
import webhook from './routes/webhook'; // 🆕 Webhook de MercadoPago
import verificarUSD from './routes/verificarUSD'; // 🆕 Verificar soporte de USD
import authRoutes from './routes/auth'; // 🆕 Rutas de autenticación
import eventos from './routes/eventos'; // 🆕 Rutas de eventos especiales

const app : Express = express();
const port = 3000;

// ⚠️ IMPORTANTE: CORS debe ir ANTES de bodyParser
// Configuración CORS mejorada para permitir el frontend de Vercel
const corsOptions = {
  origin: [
    'https://mercado-libre-roan.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:3001',
    // Producción
    'https://www.poppyshopuy.com',
    'https://poppyshopuy.com'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  credentials: true,
  optionsSuccessStatus: 200,
  preflightContinue: false
};

// Aplicar CORS globalmente PRIMERO
app.use(cors(corsOptions));

// Manejar preflight requests explícitamente
app.options('*', cors(corsOptions));

// LUEGO bodyParser
app.use(bodyParser.json())

import mercadopago from 'mercadopago';

// Configurar MercadoPago con variable de entorno
const mpAccessToken = process.env.MP_ACCESS_TOKEN || 'TEST-3488859500794386-010715-320f2dd75257891352172318a1ed84fd-370206533';

mercadopago.configure({
  access_token: mpAccessToken,
})

app.use('/api', routes);
app.use('/ml', mercadolibre);
app.use('/auth', authRoutes); // 🆕 Auth (login, crear admin)
app.use('/api/clientes', clientes); // 🆕 Agregar rutas de clientes
app.use('/api/descuentos', descuentos); // 🆕 Agregar rutas de descuentos
app.use('/api/cupones', cupones); // 🆕 Agregar rutas de cupones
app.use('/api/eventos', eventos); // 🆕 Agregar rutas de eventos especiales
app.use('/api', sitemap); // 🆕 Agregar rutas de sitemap y robots.txt para SEO
app.use('/api/checkout-pro', checkoutPro); // 🆕 Checkout Pro para cobrar en USD
app.use('/webhook', webhook); // 🆕 Webhook para notificaciones de MercadoPago
app.use('/api/verificar', verificarUSD); // 🆕 Verificar soporte de USD en cuenta de MP
app.get('/', (req: Request, res: Response) => {
  res.send('Ruta funcionando!');
});

// 🆕 Seeding opcional de admin al iniciar si variables de entorno están definidas
import Usuario from './models/Usuario';
const seedAdmin = async () => {
  try {
    const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD, SEED_ADMIN } = process.env;
    if (SEED_ADMIN !== 'true') return;

    const admins = await Usuario.countDocuments({ rol: 'admin' });
    if (admins > 0) return;

    if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
      console.log('⚠️ SEED_ADMIN=true pero faltan ADMIN_NAME, ADMIN_EMAIL o ADMIN_PASSWORD');
      return;
    }

    await Usuario.create({ nombre: ADMIN_NAME, email: ADMIN_EMAIL.toLowerCase(), password: ADMIN_PASSWORD, rol: 'admin' });
    console.log('✅ Admin inicial creado mediante seeding');
  } catch (e) {
    console.error('❌ Error en seeding de admin:', e);
  }
};


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

// Ejecutar seeding de admin si corresponde
seedAdmin();

app.listen(port, () => {
  console.log(`Servidor Express corriendo en http://localhost:${port}`);
});
