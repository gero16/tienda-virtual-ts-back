// Script para sincronizar todos los productos
const axios = require('axios');

const API_URL = process.env.API_URL || 'https://poppy-shop-production.up.railway.app';

async function syncProductos() {
  try {
    console.log('🔄 Iniciando sincronización de productos desde MercadoLibre...\n');
    console.log('⚠️  ADVERTENCIA: Este proceso puede tardar varios minutos.\n');
    
    const response = await axios.get(
      `${API_URL}/ml/sync/productos`,
      {
        timeout: 300000 // 5 minutos de timeout
      }
    );
    
    console.log('\n✅ Sincronización completada!\n');
    console.log('📊 Resultado:');
    console.log(JSON.stringify(response.data, null, 2));
    
    // Esperar un momento
    console.log('\n⏳ Esperando 5 segundos...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Verificar el producto problemático
    console.log('🔍 Verificando producto MLU693711190...\n');
    const checkResponse = await axios.get(`${API_URL}/ml/productos/MLU693711190`);
    const producto = checkResponse.data;
    
    console.log(`Título: ${producto.title}`);
    console.log(`Tipo de venta: ${producto.tipo_venta}`);
    
    if (producto.dropshipping) {
      const dias = producto.dropshipping.dias_preparacion;
      console.log(`Días preparación: ${dias}`);
      console.log(`¿Es dropshipping (> 10)?: ${dias > 10 ? '✅ SÍ' : '❌ NO'}`);
    } else {
      console.log('❌ Sin información de dropshipping');
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    
    if (error.code === 'ECONNABORTED') {
      console.error('\n⏰ La sincronización está tardando más de lo esperado.');
      console.error('   Esto es NORMAL. El proceso continúa en el servidor.');
      console.error('   Espera 2-3 minutos y verifica los productos manualmente.');
    } else if (error.response) {
      console.error('   Status:', error.response.status);
      if (error.response.data) {
        console.error('   Data:', JSON.stringify(error.response.data, null, 2));
      }
    }
  }
}

console.log('🚀 Script de Sincronización de Productos');
console.log('========================================\n');

syncProductos();

