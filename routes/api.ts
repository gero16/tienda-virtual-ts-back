import { preferences } from 'mercadopago';
import express, { Router, Request, Response } from 'express';
import colors from "colors"

import ProductoModel from '../models/products-model';

const router = Router();

interface Producto {
    _id : string,
    id: string;
    name: string;
    price: number;
    image?: string; // El ? hace que "image" sea opcional
    category: string;
    stock: number;
    cantidad: number;
  }

  
  router.post('/pay', async (req: Request, res: Response) => {
    const body = req.body;
    const ids = body[1];
    console.log(colors.bgBlue(ids));
  
    

    // Leer archivos de la BD -
    const registros = await ProductoModel.find().lean();
  
    // Preferencias - Para mandar el producto por MP
    let preference: any = {
      items: [],
      back_urls: {
        success: 'http://localhost:3000/feedback',
        failure: 'http://localhost:3000/feedback',
        pending: 'http://localhost:3000/feedback',
      },
      auto_return: 'approved',
    };
  
    console.log(`Esto es el ids ${ids}`);
  
    ids.forEach((id: { id: number; cantidad: number }) => {
      //console.log(colors.bgGreen(id.cantidad.toString()));

  
      const productAct = registros.find((p: any) => p.id === id.id);
      //console.log(colors.bgRed(productAct));
      if (productAct) {
        productAct.cantidad = id.cantidad;
  
        // Agregar la preferencia de MP
        preference.items.push({
          title: productAct.name,
          unit_price: productAct.price,
          quantity: productAct.cantidad,
        });
  
        const idMongo = productAct._id.valueOf();
  
        const actualizarStock = async () => {
          try {
            productAct.cantidad = 0;
            await ProductoModel.findByIdAndUpdate(idMongo, productAct);
            console.log('Producto actualizado!');
          } catch (err) {
            console.error('Error al buscar el producto:', err);
          }
        };
  
        actualizarStock();
      }
    });
  
    const preferenciasMercadoPago = async () => {
      // LLamar a mercado pago y mandarle las preferencias
      const response = await preferences.create(preference);
      console.log(response.body.id);
      const preferenceId = response.body.id;
  
      res.send({ preferenceId });
    };

    preferenciasMercadoPago();
 
  })
  

router.get('/', (req: Request, res: Response) => {
  res.send('Hola, mundo desde el enrutador!');
});


router.get('/productos', async (req: Request, res: Response) => {
    try {
      const registros : Producto[] = await ProductoModel.find().lean()
      const registrosOrdenados = registros.sort(function (a, b) {
        if (a.id > b.id) return 1;
        if (a.id < b.id) return -1;
        return 0;
      });

      let msg :string = 'Registros Encontrados'
  
      if (!registros.length) msg = 'No existen registros'
      console.log(colors.bgRed(JSON.stringify(registrosOrdenados)))
      return res.status(200).json({ msg, registros })

    } catch (error) {
      console.error(error)
      let msg : string = 'Error en la Consula'
      return res.status(500).json({ msg })
    }
});





export default router;