// Script para forzar corrección de permalinks agregando el guion
const axios = require('axios');

const API_URL = process.env.API_URL || 'https://poppy-shop-production.up.railway.app';

async function forceFixPermalinks() {
  try {
    console.log('🔧 Forzando corrección de permalinks (agregando guiones)...\n');
    
    // Obtener todos los productos
    const response = await axios.get(`${API_URL}/ml/productos?limit=10000`);
    const productos = response.data.productos || response.data;
    
    console.log(`📊 Total de productos: ${productos.length}\n`);
    
    let corregidos = 0;
    let errores = 0;
    
    for (const producto of productos) {
      try {
        const mlId = producto.ml_id;
        const permalinkActual = producto.permalink || '';
        
        // Normalizar el ID para asegurar que tenga el guion
        let normalizedId = mlId;
        if (!mlId.includes('-')) {
          // MLU644321979 → MLU-644321979
          normalizedId = mlId.replace(/^([A-Z]{3})(\d+)/, '$1-$2');
        }
        
        const permalinkCorrecto = `https://articulo.mercadolibre.com.uy/${normalizedId}`;
        
        // Si el permalink es diferente, actualizar
        if (permalinkActual !== permalinkCorrecto) {
          await axios.put(
            `${API_URL}/ml/productos/${mlId}`,
            { permalink: permalinkCorrecto },
            { headers: { 'Content-Type': 'application/json' } }
          );
          
          corregidos++;
          
          if (corregidos <= 10) {
            console.log(`✅ Corregido: ${producto.title.substring(0, 50)}...`);
            console.log(`   ML ID: ${mlId}`);
            console.log(`   Anterior: ${permalinkActual}`);
            console.log(`   Nuevo: ${permalinkCorrecto}\n`);
          }
        }
      } catch (error) {
        errores++;
        if (errores <= 5) {
          console.error(`❌ Error procesando ${producto.ml_id}:`, error.message);
        }
      }
    }
    
    console.log(`\n📊 Resumen:`);
    console.log(`   ✅ Corregidos: ${corregidos}`);
    console.log(`   ❌ Errores: ${errores}`);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
    }
  }
}

forceFixPermalinks();

