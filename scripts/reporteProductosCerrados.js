// Script para reportar productos cerrados
const axios = require('axios');

const API_URL = process.env.API_URL || 'https://poppy-shop-production.up.railway.app';

async function reporteCerrados() {
  try {
    console.log('📊 REPORTE DE PRODUCTOS CERRADOS EN MERCADOLIBRE\n');
    console.log('='.repeat(90));
    
    // Obtener todos los productos
    const response = await axios.get(`${API_URL}/ml/productos?limit=10000`);
    const productos = response.data.productos || response.data;
    
    console.log(`\n✅ Total de productos: ${productos.length}\n`);
    
    // Agrupar por status
    const porStatus = {
      active: [],
      paused: [],
      closed: [],
      inactive: [],
      under_review: []
    };
    
    productos.forEach(producto => {
      const status = producto.status || 'unknown';
      if (porStatus[status]) {
        porStatus[status].push(producto);
      } else {
        if (!porStatus.otros) porStatus.otros = [];
        porStatus.otros.push(producto);
      }
    });
    
    // Mostrar resumen
    console.log('📊 DISTRIBUCIÓN POR STATUS:\n');
    
    Object.keys(porStatus).forEach(status => {
      const prods = porStatus[status];
      if (prods && prods.length > 0) {
        const porcentaje = Math.round(prods.length / productos.length * 100);
        
        let icono = '📦';
        let nombre = status.toUpperCase();
        
        if (status === 'active') {
          icono = '✅';
          nombre = 'ACTIVOS';
        } else if (status === 'paused') {
          icono = '⏸️ ';
          nombre = 'PAUSADOS';
        } else if (status === 'closed') {
          icono = '🔴';
          nombre = 'CERRADOS';
        } else if (status === 'inactive') {
          icono = '⚫';
          nombre = 'INACTIVOS';
        }
        
        console.log(`${icono} ${nombre}: ${prods.length} productos (${porcentaje}%)`);
      }
    });
    
    // Detalle de productos cerrados
    if (porStatus.closed && porStatus.closed.length > 0) {
      console.log('\n\n' + '='.repeat(90));
      console.log('🔴 PRODUCTOS CERRADOS (Redirigen a otros vendedores)');
      console.log('='.repeat(90));
      console.log(`\nTotal: ${porStatus.closed.length} productos\n`);
      
      porStatus.closed.forEach((producto, index) => {
        console.log(`${index + 1}. ${producto.title.substring(0, 65)}...`);
        console.log(`   ML ID: ${producto.ml_id}`);
        console.log(`   Stock actual: ${producto.available_quantity}`);
        console.log(`   Precio: US$ ${producto.price}`);
        
        if (producto.descuento?.activo) {
          console.log(`   Tiene descuento: ${producto.descuento.porcentaje}%`);
        }
        
        console.log(`   Permalink: ${producto.permalink || 'sin permalink'}`);
        console.log('');
      });
      
      console.log('\n💡 ACCIONES RECOMENDADAS:');
      console.log('   1. Revisar cada producto en tu panel de MercadoLibre');
      console.log('   2. Decidir si republicar (con nuevo ID) o reactivar');
      console.log('   3. Si tienes stock, republicar es la mejor opción');
      console.log('   4. Después ejecutar sincronización para actualizar tu tienda');
      
      // Lista de ML_IDs para copiar
      console.log('\n📋 ML_IDs de productos cerrados (para buscar en ML):');
      const mlIds = porStatus.closed.map(p => p.ml_id).join(', ');
      console.log(`   ${mlIds}`);
    }
    
    // Productos pausados
    if (porStatus.paused && porStatus.paused.length > 0) {
      console.log('\n\n' + '='.repeat(90));
      console.log('⏸️  PRODUCTOS PAUSADOS');
      console.log('='.repeat(90));
      console.log(`\nTotal: ${porStatus.paused.length} productos`);
      console.log('\n💡 Estos productos están pausados manualmente.');
      console.log('   Puedes reactivarlos desde tu panel de MercadoLibre cuando quieras.\n');
    }
    
    // Resumen final
    console.log('\n\n' + '='.repeat(90));
    console.log('📈 RESUMEN FINAL');
    console.log('='.repeat(90));
    
    const activos = porStatus.active.length;
    const pausados = porStatus.paused.length;
    const cerrados = porStatus.closed.length;
    const total = productos.length;
    
    console.log(`\n✅ Productos ACTIVOS (vendibles):     ${activos} (${Math.round(activos/total*100)}%)`);
    console.log(`⏸️  Productos PAUSADOS (reactivables): ${pausados} (${Math.round(pausados/total*100)}%)`);
    console.log(`🔴 Productos CERRADOS (republicar):   ${cerrados} (${Math.round(cerrados/total*100)}%)`);
    console.log(`\n📊 Total productos funcionando: ${activos + pausados} / ${total}`);
    
    if (cerrados > 0) {
      console.log(`\n⚠️  ATENCIÓN: ${cerrados} productos cerrados están generando`);
      console.log('   enlaces a productos de OTROS vendedores.');
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

reporteCerrados();

