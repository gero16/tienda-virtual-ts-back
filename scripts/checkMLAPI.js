// Script para consultar directamente la API de MercadoLibre
const axios = require('axios');

const ML_ID = 'MLU693711190'; // Vtech VM819 Monitor

async function checkMLAPI() {
  try {
    console.log(`🔍 Consultando API de MercadoLibre para ${ML_ID}...\n`);
    
    // Consultar sin autenticación (endpoint público)
    const response = await axios.get(
      `https://api.mercadolibre.com/items/${ML_ID}`
    );
    
    const item = response.data;
    
    console.log('📦 INFORMACIÓN DEL PRODUCTO EN MERCADOLIBRE:\n');
    console.log(`Título: ${item.title}`);
    console.log(`ID: ${item.id}`);
    console.log(`Status: ${item.status}`);
    console.log(`Precio: ${item.currency_id} ${item.price}`);
    
    console.log('\n⏱️ SALE TERMS (términos de venta):');
    
    if (item.sale_terms && item.sale_terms.length > 0) {
      item.sale_terms.forEach(term => {
        console.log(`\n  ${term.id}:`);
        console.log(`    name: ${term.name}`);
        if (term.value_id) console.log(`    value_id: ${term.value_id}`);
        if (term.value_name) console.log(`    value_name: ${term.value_name}`);
        if (term.value_struct) {
          console.log(`    value_struct:`, JSON.stringify(term.value_struct, null, 6));
        }
        
        // Destacar MANUFACTURING_TIME
        if (term.id === 'MANUFACTURING_TIME') {
          console.log(`\n    ⭐ MANUFACTURING_TIME ENCONTRADO!`);
          if (term.value_struct && term.value_struct.number) {
            console.log(`    📅 Días de preparación: ${term.value_struct.number}`);
            console.log(`    ¿Es > 10 días? ${term.value_struct.number > 10 ? '✅ SÍ' : '❌ NO'}`);
          } else {
            console.log(`    ⚠️  No tiene value_struct.number`);
          }
        }
      });
    } else {
      console.log('  ❌ NO HAY sale_terms configurados');
    }
    
    // Buscar MANUFACTURING_TIME específicamente
    const manufacturingTime = item.sale_terms?.find(term => term.id === 'MANUFACTURING_TIME');
    
    console.log('\n🎯 ANÁLISIS FINAL:');
    if (manufacturingTime) {
      const dias = manufacturingTime.value_struct?.number || 0;
      console.log(`✅ Tiene MANUFACTURING_TIME: ${dias} días`);
      console.log(`¿Debería ser dropshipping (> 10)?: ${dias > 10 ? '✅ SÍ' : '❌ NO'}`);
    } else {
      console.log('❌ NO tiene MANUFACTURING_TIME configurado en MercadoLibre');
      console.log('   Este producto aparecerá como stock_fisico (default: 3 días)');
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
    }
  }
}

checkMLAPI();

