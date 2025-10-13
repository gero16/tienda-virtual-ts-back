// Script para reportar productos sin MANUFACTURING_TIME configurado
const axios = require('axios');

const API_URL = process.env.API_URL || 'https://poppy-shop-production.up.railway.app';

async function generarReporte() {
  try {
    console.log('📊 Generando reporte de MANUFACTURING_TIME...\n');
    console.log('⏳ Obteniendo todos los productos...\n');
    
    // Obtener todos los productos
    const response = await axios.get(`${API_URL}/ml/productos?limit=10000`);
    const productos = response.data.productos || response.data;
    
    console.log(`✅ Total de productos: ${productos.length}\n`);
    
    // Agrupar por días de preparación
    const porDias = {};
    const sinConfiguracion = [];
    const stockFisico = [];
    const dropshipping = [];
    
    productos.forEach(producto => {
      const diasPrep = producto.dropshipping?.dias_preparacion || 
                       producto.dias_preparacion || 
                       0;
      
      // Agrupar
      if (!porDias[diasPrep]) {
        porDias[diasPrep] = [];
      }
      porDias[diasPrep].push(producto);
      
      // Clasificar
      if (diasPrep === 0) {
        sinConfiguracion.push(producto);
      } else if (diasPrep <= 10) {
        stockFisico.push(producto);
      } else {
        dropshipping.push(producto);
      }
    });
    
    // REPORTE PRINCIPAL
    console.log('=' .repeat(90));
    console.log('📋 RESUMEN EJECUTIVO');
    console.log('='.repeat(90));
    console.log(`\nTotal de productos: ${productos.length}`);
    console.log(`\n❌ Sin MANUFACTURING_TIME (0 días): ${sinConfiguracion.length} (${Math.round(sinConfiguracion.length/productos.length*100)}%)`);
    console.log(`🏪 Stock Físico (1-10 días): ${stockFisico.length} (${Math.round(stockFisico.length/productos.length*100)}%)`);
    console.log(`📦 Dropshipping (> 10 días): ${dropshipping.length} (${Math.round(dropshipping.length/productos.length*100)}%)`);
    
    // PRODUCTOS SIN CONFIGURACIÓN (0 días)
    if (sinConfiguracion.length > 0) {
      console.log('\n\n' + '='.repeat(90));
      console.log('⚠️  PRODUCTOS SIN MANUFACTURING_TIME CONFIGURADO (0 días)');
      console.log('='.repeat(90));
      console.log(`\n❌ Estos ${sinConfiguracion.length} productos NO tienen tiempo de preparación en MercadoLibre:`);
      console.log('   Aparecerán como "Stock Físico" con 3 días por defecto\n');
      
      sinConfiguracion.slice(0, 20).forEach((p, index) => {
        console.log(`${index + 1}. ${p.title.substring(0, 70)}...`);
        console.log(`   ML ID: ${p.ml_id}`);
        console.log(`   Status: ${p.status}`);
        console.log(`   Stock: ${p.available_quantity}`);
        console.log(`   Tipo venta: ${p.tipo_venta || 'no definido'}`);
        console.log('');
      });
      
      if (sinConfiguracion.length > 20) {
        console.log(`   ... y ${sinConfiguracion.length - 20} productos más con 0 días\n`);
      }
    }
    
    // DISTRIBUCIÓN COMPLETA
    console.log('\n' + '='.repeat(90));
    console.log('📊 DISTRIBUCIÓN POR DÍAS DE PREPARACIÓN');
    console.log('='.repeat(90));
    
    const dias = Object.keys(porDias).map(Number).sort((a, b) => a - b);
    
    dias.forEach(dia => {
      const prods = porDias[dia];
      const porcentaje = Math.round(prods.length / productos.length * 100);
      const esDropshipping = dia > 10;
      
      let icono = '🏪';
      let tipo = 'Stock Físico';
      if (dia === 0) {
        icono = '❌';
        tipo = 'SIN CONFIGURAR';
      } else if (esDropshipping) {
        icono = '📦';
        tipo = 'Dropshipping';
      }
      
      console.log(`\n${icono} ${dia} días - ${tipo}`);
      console.log(`   Cantidad: ${prods.length} productos (${porcentaje}%)`);
      console.log(`   Ejemplos: ${prods.slice(0, 3).map(p => `${p.ml_id} - ${p.title.substring(0, 40)}...`).join('\n             ')}`);
    });
    
    // RECOMENDACIONES
    console.log('\n\n' + '='.repeat(90));
    console.log('💡 RECOMENDACIONES');
    console.log('='.repeat(90));
    
    if (sinConfiguracion.length > 0) {
      console.log(`\n⚠️  ACCIÓN REQUERIDA: ${sinConfiguracion.length} productos sin tiempo configurado`);
      console.log('\n   Para cada producto sin configurar:');
      console.log('   1. Ve a tu panel de MercadoLibre');
      console.log('   2. Edita el producto');
      console.log('   3. Configura "Tiempo de preparación" (MANUFACTURING_TIME)');
      console.log('   4. Guarda los cambios');
      console.log('   5. Ejecuta: POST /ml/sync/force para re-sincronizar');
      
      console.log('\n   📋 Lista de ML IDs para configurar:');
      const mlIds = sinConfiguracion.slice(0, 10).map(p => p.ml_id).join(', ');
      console.log(`   ${mlIds}${sinConfiguracion.length > 10 ? `, ... y ${sinConfiguracion.length - 10} más` : ''}`);
    }
    
    console.log('\n\n✅ CONFIGURACIÓN ACTUAL:');
    console.log(`   Umbral de dropshipping: > 10 días`);
    console.log(`   Productos que se muestran en frontend: ${dropshipping.length}`);
    console.log(`   Productos sin badge: ${productos.length - dropshipping.length}`);
    
    // Guardar reporte en archivo
    const fs = require('fs');
    const reportePath = './reporte_manufacturing_time.txt';
    
    let reporteTexto = `REPORTE DE MANUFACTURING_TIME\n`;
    reporteTexto += `Fecha: ${new Date().toISOString()}\n\n`;
    reporteTexto += `Total productos: ${productos.length}\n`;
    reporteTexto += `Sin configurar (0 días): ${sinConfiguracion.length}\n`;
    reporteTexto += `Stock físico (1-10): ${stockFisico.length}\n`;
    reporteTexto += `Dropshipping (>10): ${dropshipping.length}\n\n`;
    reporteTexto += `PRODUCTOS SIN CONFIGURAR:\n\n`;
    
    sinConfiguracion.forEach((p, i) => {
      reporteTexto += `${i + 1}. ${p.ml_id} - ${p.title}\n`;
      reporteTexto += `   Status: ${p.status}, Stock: ${p.available_quantity}\n\n`;
    });
    
    fs.writeFileSync(reportePath, reporteTexto);
    console.log(`\n\n📄 Reporte completo guardado en: ${reportePath}`);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
    }
  }
}

console.log('🚀 Reporte de MANUFACTURING_TIME');
console.log('='.repeat(90));
console.log('');

generarReporte();

