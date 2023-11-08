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

  interface Preferencia {
    items: {
      title: string;
      unit_price: number;
      quantity: number;
    }[]
    back_urls: {
      success: string;
      failure: string;
      pending: string;
    },
    // No tengo claro porque cuando era string me tiraba un error
    auto_return: any,
  }

  router.post('/pay', async (req: Request, res: Response) => {
    const body = req.body;
    const infoProductos = body[1];
    //console.log(colors.bgBlue(infoProductos));
  
    // Leer archivos de la BD -
    const registros = await ProductoModel.find().lean();
  
    // Preferencias - Para mandar el producto por MP
    let preferencia: Preferencia  = {
      items: [],
      back_urls: {
        success: 'http://localhost:3000/feedback',
        failure: 'http://localhost:3000/feedback',
        pending: 'http://localhost:3000/feedback',
      },
      auto_return: 'approved',
    };
    
    infoProductos.forEach((productoInfo : { id: number, cantidad: number }) => {
      console.log(productoInfo)
      
      const productAct = registros.find((p) => p.id === productoInfo.id);
      console.log(productAct)
      if (productAct) {
        productAct.cantidad = productoInfo.cantidad;
  
        // Agregar la preferencia de MP
        preferencia.items.push({
          title: productAct.name,
          unit_price: productAct.price,
          quantity: productAct.cantidad,
        });

        console.log(preferencia)
  
        const idMongo = productAct._id.valueOf();
  
        const actualizarStock = async () => {
          try {
            // 
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
      try {
        const response = await preferences.create(preferencia);
        console.log(response.body.id);
        const preferenceId = response.body.id;
    
        res.status(200).send({ preferenceId });
      } catch (error) {
        res.status(404).send({ error });
        console.log(error)
      }
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