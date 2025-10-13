// Script para verificar permalinks directamente desde la API de ML
const axios = require('axios');

const API_URL = process.env.API_URL || 'https://poppy-shop-production.up.railway.app';

async function verifyPermalinks() {
  try {
    console.log('🔍 Verificando permalinks desde la API de MercadoLibre...\n');
    
    // Obtener token
    const tokenResponse = await axios.get(`${API_URL}/ml/status`);
    const accessToken = tokenResponse.data.token?.access_token;
    const userId = tokenResponse.data.token?.user_id;
    
    if (!accessToken) {
      console.log('❌ No hay token de acceso disponible');
      return;
    }
    
    console.log(`✅ User ID: ${userId}\n`);
    
    // Obtener algunos productos de la DB
    const response = await axios.get(`${API_URL}/ml/productos?limit=10`);
    const productos = response.data.productos || response.data;
    
    console.log('📊 VERIFICANDO PERMALINKS DE 10 PRODUCTOS:\n');
    console.log('='.repeat(100));
    
    for (const producto of productos) {
      const mlId = producto.ml_id;
      
      try {
        // Consultar directamente a la API de ML
        const mlResponse = await axios.get(
          `https://api.mercadolibre.com/items/${mlId}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        
        const item = mlResponse.data;
        const permalinkAPI = item.permalink;
        const permalinkDB = producto.permalink;
        const sellerId = item.seller_id;
        
        console.log(`\n📦 Producto: ${producto.title.substring(0, 60)}...`);
        console.log(`   ML ID: ${mlId}`);
        console.log(`   Seller ID en ML: ${sellerId}`);
        console.log(`   ¿Es tu seller? ${sellerId === userId ? '✅ SÍ' : '❌ NO'}`);
        console.log(`   Status: ${item.status}`);
        console.log(`\n   📋 Permalink en API de ML: ${permalinkAPI}`);
        console.log(`   📋 Permalink en tu DB:     ${permalinkDB}`);
        console.log(`   ¿Coinciden? ${permalinkAPI === permalinkDB ? '✅ SÍ' : '❌ NO'}`);
        
        // Verificar si el permalink contiene el ML_ID correcto
        const permalinkContieneID = permalinkAPI && permalinkAPI.includes(mlId.replace('-', ''));
        console.log(`   ¿Permalink contiene tu ML_ID? ${permalinkContieneID ? '✅ SÍ' : '❌ NO - PROBLEMA!'}`);
        
        if (!permalinkContieneID) {
          console.log(`   ⚠️  ALERTA: El permalink NO contiene tu producto!`);
          console.log(`   💡 Permalink correcto debería ser: https://articulo.mercadolibre.com.uy/${mlId}`);
        }
        
        console.log('   ' + '-'.repeat(90));
        
        // Pequeña pausa para no saturar la API
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        console.log(`   ❌ Error consultando ${mlId}: ${error.message}`);
      }
    }
    
    console.log('\n\n💡 ANÁLISIS:');
    console.log('   Si ves "❌ NO - PROBLEMA!" significa que la API de ML está devolviendo');
    console.log('   permalinks de otros vendedores o catálogos en lugar de TU producto.');
    console.log('\n   SOLUCIÓN: Construir el permalink manualmente siempre usando:');
    console.log('   https://articulo.mercadolibre.com.uy/{ML_ID}');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
    }
  }
}

verifyPermalinks();

