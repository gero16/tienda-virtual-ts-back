// Script para corregir permalinks incorrectos
const axios = require('axios');

const API_URL = process.env.API_URL || 'https://poppy-shop-production.up.railway.app';

async function fixPermalinks() {
  try {
    console.log('🔧 Iniciando corrección de permalinks...');
    console.log(`📡 API URL: ${API_URL}`);
    
    const response = await axios.post(`${API_URL}/ml/fix-permalinks`, {}, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 120000 // 2 minutos de timeout
    });
    
    console.log('\n✅ Corrección completada!');
    console.log('\n📊 Resumen:');
    console.log(`   Total de productos: ${response.data.total}`);
    console.log(`   ✅ Corregidos: ${response.data.corregidos}`);
    console.log(`   ℹ️  Sin cambios: ${response.data.sin_cambios}`);
    console.log(`   ❌ Errores: ${response.data.errores}`);
    
    if (response.data.detalles && response.data.detalles.length > 0) {
      console.log('\n📋 Productos corregidos (primeros 10):');
      response.data.detalles.slice(0, 10).forEach((detalle, index) => {
        if (detalle.estado === 'corregido') {
          console.log(`\n${index + 1}. ${detalle.title}`);
          console.log(`   ML ID: ${detalle.ml_id}`);
          console.log(`   Anterior: ${detalle.anterior || '(vacío)'}`);
          console.log(`   Nuevo: ${detalle.nuevo}`);
        }
      });
    }
    
  } catch (error) {
    console.error('\n❌ Error ejecutando la corrección:');
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Mensaje: ${JSON.stringify(error.response.data, null, 2)}`);
    } else if (error.request) {
      console.error('   No se recibió respuesta del servidor');
      console.error('   Verifica que el servidor esté ejecutándose');
    } else {
      console.error(`   Error: ${error.message}`);
    }
    process.exit(1);
  }
}

console.log('🚀 Script de corrección de permalinks');
console.log('=====================================\n');

fixPermalinks();

