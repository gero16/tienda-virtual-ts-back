
import express, { Router, Request, Response } from 'express';
import ProductoModel from '../models/products-model';
import colors from "colors"
const router = Router();

interface Producto {
    id: number;
    name: string;
    price: number;
    image?: string; // El ? hace que "image" sea opcional
    category: string;
    stock: number;
    cantidad: number;
  }

  router.post('/pay', async (req: Request, res: Response) => {
    const body = req.body
    console.log(colors.bgBlue(body))
    let ids = body[1]
  
    // Leer archivos de la BD -
    const registros : Producto[] = await ProductoModel.find().lean()
    // console.log(colors.bgGreen(registros))
    if(registros) {
      // Preferencias - Para mandar el producto por MP
      let preference = {
        items: [],
        back_urls: {
          success: 'http://localhost:3000/feedback',
          failure: 'http://localhost:3000/feedback',
          pending: 'http://localhost:3000/feedback',
        },
        auto_return: 'approved',
      }
    
      console.log(`Esto es el ids ${ids}`)
    }
   
    res.status(200).json({"mensaje" : "hola"})
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