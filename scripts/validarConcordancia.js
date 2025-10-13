// Script para validar concordancia entre DB y MercadoLibre
const axios = require('axios');

const API_URL = process.env.API_URL || 'https://poppy-shop-production.up.railway.app';

async function validarConcordancia() {
  try {
    console.log('🔍 VALIDACIÓN DE CONCORDANCIA: DB vs MercadoLibre');
    console.log('='.repeat(90));
    console.log('');
    
    const limit = process.argv[2] || 50;
    const fullCheck = process.argv[3] === 'full';
    
    console.log(`📊 Validando ${fullCheck ? 'TODOS' : limit} productos...`);
    console.log(`⏳ Esto puede tardar ${fullCheck ? '5-10' : '1-2'} minutos...\n`);
    
    const url = `${API_URL}/ml/validar-concordancia?limit=${limit}${fullCheck ? '&full=true' : ''}`;
    
    const response = await axios.get(url, {
      timeout: 600000 // 10 minutos
    });
    
    const data = response.data;
    
    console.log('✅ VALIDACIÓN COMPLETADA\n');
    console.log('='.repeat(90));
    console.log('📊 RESUMEN GENERAL');
    console.log('='.repeat(90));
    console.log(`\nTotal productos validados: ${data.total_productos}`);
    console.log(`✅ Correctos: ${data.correctos} (${data.porcentaje_correcto}%)`);
    console.log(`⚠️  Con discrepancias: ${data.con_discrepancias}`);
    console.log(`❌ Errores API: ${data.errores_api}`);
    
    if (data.con_discrepancias > 0) {
      console.log('\n\n' + '='.repeat(90));
      console.log('⚠️  PRODUCTOS CON DISCREPANCIAS');
      console.log('='.repeat(90));
      
      // Agrupar por tipo de diferencia
      const porTipo = {};
      
      data.discrepancias.forEach(disc => {
        disc.diferencias.forEach(dif => {
          const tipo = dif.split(':')[0];
          if (!porTipo[tipo]) {
            porTipo[tipo] = [];
          }
          porTipo[tipo].push({
            ml_id: disc.ml_id,
            title: disc.title,
            detalle: dif,
            datos_db: disc.datos_db,
            datos_ml: disc.datos_ml
          });
        });
      });
      
      // Mostrar por tipo
      Object.keys(porTipo).forEach(tipo => {
        const productos = porTipo[tipo];
        console.log(`\n\n📌 ${tipo.toUpperCase()}:`);
        console.log(`   Productos afectados: ${productos.length}`);
        console.log('   ' + '-'.repeat(85));
        
        productos.slice(0, 10).forEach((p, index) => {
          console.log(`\n   ${index + 1}. ${p.title.substring(0, 60)}...`);
          console.log(`      ML ID: ${p.ml_id}`);
          console.log(`      ${p.detalle}`);
        });
        
        if (productos.length > 10) {
          console.log(`\n      ... y ${productos.length - 10} productos más con diferencias en ${tipo}`);
        }
      });
      
      // Productos críticos (de otro vendedor o con errores mayores)
      const criticos = data.discrepancias.filter(d => 
        d.diferencias.some(dif => dif.includes('OTRO vendedor') || dif.includes('ERROR API'))
      );
      
      if (criticos.length > 0) {
        console.log('\n\n' + '='.repeat(90));
        console.log('🚨 PROBLEMAS CRÍTICOS');
        console.log('='.repeat(90));
        
        criticos.forEach((p, index) => {
          console.log(`\n${index + 1}. ${p.title}`);
          console.log(`   ML ID: ${p.ml_id}`);
          p.diferencias.forEach(dif => {
            console.log(`   ⚠️  ${dif}`);
          });
        });
      }
    }
    
    // Recomendaciones
    console.log('\n\n' + '='.repeat(90));
    console.log('💡 RECOMENDACIONES');
    console.log('='.repeat(90));
    
    if (data.con_discrepancias === 0) {
      console.log('\n✅ ¡Excelente! Todos los productos están sincronizados correctamente.');
      console.log('   No se requiere ninguna acción.');
    } else {
      console.log(`\n⚠️  Se encontraron ${data.con_discrepancias} productos con diferencias.`);
      console.log('\n   ACCIONES RECOMENDADAS:');
      console.log('   1. Ejecutar sincronización para actualizar tu DB:');
      console.log('      GET /ml/sync/force');
      console.log('\n   2. Revisar manualmente productos críticos');
      console.log('\n   3. Verificar productos de otros vendedores');
      
      console.log(`\n📋 ML_IDs a revisar (primeros 20):`);
      const mlIds = data.discrepancias.slice(0, 20).map(d => d.ml_id).join(', ');
      console.log(`   ${mlIds}${data.discrepancias.length > 20 ? `, ... y ${data.discrepancias.length - 20} más` : ''}`);
    }
    
    // Guardar reporte
    const fs = require('fs');
    const reportePath = './reporte_concordancia.json';
    fs.writeFileSync(reportePath, JSON.stringify(data, null, 2));
    
    console.log(`\n\n📄 Reporte completo guardado en: ${reportePath}`);
    console.log('\n' + '='.repeat(90));
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    
    if (error.code === 'ECONNABORTED') {
      console.error('\n⏰ Timeout - La validación está tardando más de lo esperado.');
      console.error('   Reduce el número de productos o espera más tiempo.');
    } else if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

console.log('\n🚀 Validación de Concordancia DB vs MercadoLibre');
console.log('');
console.log('Uso:');
console.log('  node scripts/validarConcordancia.js [limit] [full]');
console.log('');
console.log('Ejemplos:');
console.log('  node scripts/validarConcordancia.js          → Valida 50 productos');
console.log('  node scripts/validarConcordancia.js 100      → Valida 100 productos');
console.log('  node scripts/validarConcordancia.js 0 full   → Valida TODOS los productos');
console.log('');
console.log('='.repeat(90));
console.log('');

validarConcordancia();

