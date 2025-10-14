// Script para forzar la actualización de un producto con descuento de ML
const axios = require('axios');

const API_URL = 'https://poppy-shop-production.up.railway.app';
const PRODUCTO_CON_DESCUENTO = 'MLU693711190'; // Vtech Monitor con descuento del 6%

async function actualizarProducto() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║   Actualizar Producto con Descuento ML        ║');
  console.log('╚════════════════════════════════════════════════╝\n');
  
  try {
    console.log(`🔄 Esperando 90 segundos para que se complete el deploy...\n`);
    await new Promise(resolve => setTimeout(resolve, 90000));
    
    console.log(`🔄 Actualizando producto ${PRODUCTO_CON_DESCUENTO}...\n`);
    
    // Simular webhook actualizando el producto
    const response = await axios.post(
      `${API_URL}/ml/ml/productos/${PRODUCTO_CON_DESCUENTO}/actualizar`
    );
    
    console.log('✅ Respuesta:', JSON.stringify(response.data, null, 2));
    
    console.log('\n📊 Verificando producto actualizado...\n');
    
    // Verificar que se guardó el descuento
    const { data: productosData } = await axios.get(`${API_URL}/ml/productos?limit=9999`);
    const productos = productosData.productos || productosData;
    const producto = productos.find(p => p.ml_id === PRODUCTO_CON_DESCUENTO);
    
    if (producto) {
      console.log('📦 Producto encontrado:');
      console.log(`   Título: ${producto.title}`);
      console.log(`   Precio actual: $${producto.price}`);
      
      if (producto.descuento_ml && producto.descuento_ml.original_price) {
        console.log(`   ✅ DESCUENTO DE ML DETECTADO:`);
        console.log(`      Precio original: $${producto.descuento_ml.original_price}`);
        console.log(`      Descuento: ${Math.round((1 - producto.price / producto.descuento_ml.original_price) * 100)}%`);
        if (producto.descuento_ml.deal_ids && producto.descuento_ml.deal_ids.length > 0) {
          console.log(`      Deal IDs: ${producto.descuento_ml.deal_ids.join(', ')}`);
        }
      } else {
        console.log(`   ⚠️  Descuento de ML no encontrado (puede tardar en sincronizar)`);
      }
    } else {
      console.log('⚠️  Producto no encontrado en la BD');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Detalles:', error.response.data);
    }
  }
}

actualizarProducto();



