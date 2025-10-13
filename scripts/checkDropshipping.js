// Script para verificar productos con diferentes tiempos de envío
const axios = require('axios');

const API_URL = process.env.API_URL || 'https://poppy-shop-production.up.railway.app';

async function checkDropshipping() {
  try {
    console.log('🔍 Verificando productos con diferentes tiempos de envío...\n');
    
    // Obtener productos con diferentes configuraciones
    const response = await axios.get(`${API_URL}/ml/productos?limit=100`);
    
    const productos = response.data.productos || response.data;
    
    // Agrupar productos por días de preparación
    const porTiempos = {};
    
    productos.forEach(producto => {
      const diasPrep = producto.dropshipping?.dias_preparacion || 
                       producto.dias_preparacion || 
                       3; // default
      
      if (!porTiempos[diasPrep]) {
        porTiempos[diasPrep] = [];
      }
      
      porTiempos[diasPrep].push({
        ml_id: producto.ml_id,
        title: producto.title,
        tipo_venta: producto.tipo_venta,
        dias_preparacion: diasPrep,
        dias_envio: producto.dropshipping?.dias_envio_estimado || 
                    producto.dias_envio_estimado || 
                    (diasPrep > 10 ? 7 : 3),
        es_dropshipping: diasPrep > 10,
        status: producto.status
      });
    });
    
    // Mostrar resumen
    console.log('📊 RESUMEN POR DÍAS DE PREPARACIÓN:\n');
    
    const dias = Object.keys(porTiempos).map(Number).sort((a, b) => a - b);
    
    dias.forEach(dia => {
      const productos = porTiempos[dia];
      const esDropshipping = dia > 10;
      const diasEnvio = esDropshipping ? 7 : 3;
      const total = dia + diasEnvio;
      
      console.log(`\n${'='.repeat(80)}`);
      console.log(`⏱️  ${dia} días de preparación`);
      console.log(`${esDropshipping ? '📦 DROPSHIPPING' : '🏪 STOCK FÍSICO'}`);
      console.log(`   Días de envío: ${diasEnvio} días`);
      console.log(`   Total: ${total} días`);
      console.log(`   ${esDropshipping ? '✅ SE MUESTRA EN FRONTEND' : '❌ NO SE MUESTRA EN FRONTEND'}`);
      console.log(`   Cantidad de productos: ${productos.length}`);
      console.log(`${'='.repeat(80)}`);
      
      // Mostrar primeros 3 productos de cada grupo
      productos.slice(0, 3).forEach((p, index) => {
        console.log(`\n${index + 1}. ${p.title.substring(0, 60)}...`);
        console.log(`   ML ID: ${p.ml_id}`);
        console.log(`   Status: ${p.status}`);
        console.log(`   Tipo venta: ${p.tipo_venta || 'no definido'}`);
        console.log(`   Preparación: ${p.dias_preparacion} días`);
        console.log(`   Envío: ${p.dias_envio} días`);
        console.log(`   Total entrega: ${p.dias_preparacion + p.dias_envio} días`);
      });
      
      if (productos.length > 3) {
        console.log(`\n   ... y ${productos.length - 3} productos más con ${dia} días`);
      }
    });
    
    // Estadísticas finales
    console.log('\n\n📈 ESTADÍSTICAS GENERALES:\n');
    
    const totalProductos = productos.length;
    const conDropshipping = productos.filter(p => {
      const dias = p.dropshipping?.dias_preparacion || p.dias_preparacion || 3;
      return dias > 10;
    }).length;
    const conStockFisico = totalProductos - conDropshipping;
    
    console.log(`Total productos analizados: ${totalProductos}`);
    console.log(`📦 Dropshipping (> 10 días): ${conDropshipping} (${Math.round(conDropshipping/totalProductos*100)}%)`);
    console.log(`🏪 Stock Físico (≤ 10 días): ${conStockFisico} (${Math.round(conStockFisico/totalProductos*100)}%)`);
    
    // Mostrar qué se ve en el frontend
    console.log('\n\n🎨 EN EL FRONTEND (Página de detalle):');
    console.log('\n📦 Productos DROPSHIPPING (> 10 días):');
    console.log('   ✅ SE MUESTRA: Badge "🚚 Tiempo de envío: X días"');
    console.log('   ✅ Color: Fondo amarillo (dropshipping-info)');
    console.log('   ✅ Visible para el cliente');
    
    console.log('\n🏪 Productos STOCK FÍSICO (≤ 10 días):');
    console.log('   ❌ NO SE MUESTRA: Ningún badge de tiempo de envío');
    console.log('   ❌ No hay indicador visual de días de preparación');
    console.log('   ❌ El cliente NO ve los días estimados');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
    }
  }
}

checkDropshipping();

