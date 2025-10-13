// Script para buscar productos con descuento nativo de ML
const axios = require('axios');

const API_URL = 'https://poppy-shop-production.up.railway.app';

async function buscarDescuentosML() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║   Búsqueda de Descuentos Nativos de ML        ║');
  console.log('╚════════════════════════════════════════════════╝\n');
  
  try {
    // 1. Obtener productos
    console.log('📦 Obteniendo productos...');
    const { data: productoData } = await axios.get(`${API_URL}/ml/productos?limit=50`);
    const productos = productoData.productos || productoData;
    
    console.log(`✅ ${productos.length} productos obtenidos\n`);
    console.log('🔍 Consultando MercadoLibre para detectar descuentos nativos...\n');
    
    let productosConDescuento = [];
    let productosSinDescuento = 0;
    let errores = 0;
    
    for (const producto of productos.slice(0, 20)) {  // Solo primeros 20 para ser rápido
      try {
        const { data: debugData } = await axios.get(`${API_URL}/ml/debug/producto/${producto.ml_id}`);
        const item = debugData.item_completo;
        
        const originalPrice = item.original_price;
        const currentPrice = item.price;
        const dealIds = item.deal_ids || [];
        
        if (originalPrice && originalPrice !== currentPrice) {
          const descuentoPorcentaje = Math.round((1 - currentPrice / originalPrice) * 100);
          
          productosConDescuento.push({
            ml_id: producto.ml_id,
            title: producto.title,
            original_price: originalPrice,
            current_price: currentPrice,
            descuento_porcentaje: descuentoPorcentaje,
            deal_ids: dealIds
          });
          
          console.log(`💰 ${producto.ml_id} - ¡DESCUENTO DE ML!`);
          console.log(`   ${producto.title.substring(0, 60)}...`);
          console.log(`   Precio original: $${originalPrice}`);
          console.log(`   Precio con descuento: $${currentPrice}`);
          console.log(`   Descuento: ${descuentoPorcentaje}%`);
          if (dealIds.length > 0) console.log(`   Deal IDs: ${dealIds.join(', ')}`);
          console.log('');
        } else {
          productosSinDescuento++;
        }
        
        // Pausa para no saturar la API
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        errores++;
      }
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📊 RESUMEN:\n');
    console.log(`Productos analizados: 20`);
    console.log(`Con descuento de ML: ${productosConDescuento.length}`);
    console.log(`Sin descuento de ML: ${productosSinDescuento}`);
    console.log(`Errores: ${errores}\n`);
    
    if (productosConDescuento.length === 0) {
      console.log('ℹ️  No se encontraron productos con descuento nativo de ML en la muestra.');
      console.log('   Esto es normal si no has aplicado ofertas desde MercadoLibre.\n');
      console.log('💡 INFORMACIÓN:\n');
      console.log('   MercadoLibre devuelve estos campos cuando hay descuento:');
      console.log('   • original_price: Precio antes del descuento');
      console.log('   • price: Precio con descuento');
      console.log('   • deal_ids: IDs de ofertas/promociones aplicadas\n');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

buscarDescuentosML();

