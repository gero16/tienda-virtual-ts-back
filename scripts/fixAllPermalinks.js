// Script para corregir TODOS los permalinks con el nuevo formato
const axios = require('axios');

const API_URL = process.env.API_URL || 'https://poppy-shop-production.up.railway.app';

async function fixAllPermalinks() {
  try {
    console.log('🚀 CORRECCIÓN DE PERMALINKS - TODOS LOS PRODUCTOS');
    console.log('='.repeat(90));
    console.log('\n⚠️  Este script corregirá los permalinks de TODOS los productos\n');
    console.log('📋 Formato antiguo: https://articulo.mercadolibre.com.uy/MLU644321979');
    console.log('✅ Formato nuevo:   https://articulo.mercadolibre.com.uy/MLU-644321979\n');
    console.log('⏳ Esperando 5 segundos antes de comenzar...\n');
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('🔄 Iniciando corrección...\n');
    
    const response = await axios.post(
      `${API_URL}/ml/fix-permalinks`,
      {},
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 120000 // 2 minutos
      }
    );
    
    console.log('✅ Corrección completada!\n');
    console.log('='.repeat(90));
    console.log('📊 RESULTADOS:');
    console.log('='.repeat(90));
    console.log(`\n   Total de productos:    ${response.data.total}`);
    console.log(`   ✅ Corregidos:          ${response.data.corregidos}`);
    console.log(`   ℹ️  Sin cambios:         ${response.data.sin_cambios}`);
    console.log(`   ❌ Errores:             ${response.data.errores}`);
    
    if (response.data.detalles && response.data.detalles.length > 0) {
      console.log('\n\n📋 EJEMPLOS DE PRODUCTOS CORREGIDOS (primeros 10):\n');
      
      response.data.detalles.slice(0, 10).forEach((detalle, index) => {
        if (detalle.estado === 'corregido') {
          console.log(`${index + 1}. ${detalle.title ? detalle.title.substring(0, 60) : detalle.ml_id}...`);
          console.log(`   ML ID: ${detalle.ml_id}`);
          console.log(`   Antes: ${detalle.anterior || '(vacío)'}`);
          console.log(`   Ahora: ${detalle.nuevo}`);
          console.log('');
        }
      });
    }
    
    console.log('\n' + '='.repeat(90));
    console.log('✅ PROCESO COMPLETADO');
    console.log('='.repeat(90));
    console.log('\n💡 Ahora TODOS los enlaces "Ver en MercadoLibre" apuntarán a');
    console.log('   productos de Poppy Shop UY, no a otros vendedores.\n');
    
    // Verificar un producto específico
    console.log('🔍 Verificando producto MLU693711190...\n');
    
    const checkResponse = await axios.get(`${API_URL}/ml/productos/MLU693711190`);
    const producto = checkResponse.data;
    
    console.log(`   Título: ${producto.title}`);
    console.log(`   Permalink: ${producto.permalink}`);
    console.log(`   ✅ ${producto.permalink.includes('MLU-693711190') ? 'CORRECTO - Con guion' : '⚠️ Verificar'}`);
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      
      if (error.response.status === 404) {
        console.error('\n   ⚠️  El endpoint no está disponible.');
        console.error('   ¿Railway terminó de desplegar el código nuevo?');
        console.error('   Espera 2-3 minutos más y vuelve a intentar.\n');
      }
      
      if (error.response.data) {
        console.error(`   Detalles: ${JSON.stringify(error.response.data, null, 2)}`);
      }
    } else if (error.code === 'ECONNABORTED') {
      console.error('\n   ⏰ Timeout - El proceso está tardando más de lo esperado.');
      console.error('   Esto puede ser normal si tienes muchos productos.');
      console.error('   Espera un momento y verifica los productos manualmente.\n');
    }
    
    process.exit(1);
  }
}

console.log('\n');
fixAllPermalinks();

