// Script para analizar productos pausados
const axios = require('axios');

const API_URL = process.env.API_URL || 'https://poppy-shop-production.up.railway.app';

async function analizarPausados() {
  try {
    console.log('📊 ANÁLISIS DE PRODUCTOS PAUSADOS\n');
    console.log('='.repeat(90));
    
    // Obtener todos los productos
    const response = await axios.get(`${API_URL}/ml/productos?limit=10000`);
    const productos = response.data.productos || response.data;
    
    // Filtrar pausados
    const pausados = productos.filter(p => p.status === 'paused');
    
    console.log(`\n⏸️  Total productos PAUSADOS: ${pausados.length}\n`);
    
    // Clasificar por stock
    const conStock = pausados.filter(p => p.available_quantity > 0);
    const sinStock = pausados.filter(p => p.available_quantity === 0);
    
    console.log('📦 CLASIFICACIÓN POR STOCK:\n');
    console.log(`   ✅ PAUSADOS con stock:    ${conStock.length} productos`);
    console.log(`   ❌ PAUSADOS sin stock:    ${sinStock.length} productos\n`);
    
    // Productos pausados CON stock
    if (conStock.length > 0) {
      console.log('='.repeat(90));
      console.log('✅ PRODUCTOS PAUSADOS QUE TIENEN STOCK');
      console.log('='.repeat(90));
      console.log('\n⚠️  Estos productos PODRÍAN venderse pero están pausados:\n');
      
      conStock.forEach((p, index) => {
        console.log(`${index + 1}. ${p.title.substring(0, 60)}...`);
        console.log(`   ML ID: ${p.ml_id}`);
        console.log(`   Stock: ${p.available_quantity} unidades`);
        console.log(`   Precio: US$ ${p.price}`);
        if (p.descuento?.activo) {
          const precioDesc = p.price * (1 - p.descuento.porcentaje / 100);
          console.log(`   Descuento: ${p.descuento.porcentaje}% (US$ ${precioDesc.toFixed(2)})`);
        }
        console.log('');
      });
      
      console.log('💡 RECOMENDACIÓN: Reactivar estos productos si quieres venderlos.');
    }
    
    // Productos pausados SIN stock
    if (sinStock.length > 0) {
      console.log('\n' + '='.repeat(90));
      console.log('❌ PRODUCTOS PAUSADOS SIN STOCK');
      console.log('='.repeat(90));
      console.log('\n📦 Estos productos no tienen inventario:\n');
      
      sinStock.forEach((p, index) => {
        console.log(`${index + 1}. ${p.title.substring(0, 60)}...`);
        console.log(`   ML ID: ${p.ml_id}`);
        console.log(`   Stock: ${p.available_quantity}`);
        console.log(`   Precio: US$ ${p.price}`);
        console.log('');
      });
      
      console.log('💡 OPCIONES:');
      console.log('   1. Agregar stock y reactivar');
      console.log('   2. Dejar pausados hasta tener stock');
      console.log('   3. Eliminar si no los vas a vender más');
    }
    
    // Productos activos sin stock
    const activosSinStock = productos.filter(p => 
      p.status === 'active' && p.available_quantity === 0
    );
    
    if (activosSinStock.length > 0) {
      console.log('\n' + '='.repeat(90));
      console.log('⚠️  PRODUCTOS ACTIVOS SIN STOCK');
      console.log('='.repeat(90));
      console.log('\n🚨 ALERTA: Estos productos están ACTIVOS pero sin stock:\n');
      
      activosSinStock.forEach((p, index) => {
        console.log(`${index + 1}. ${p.title.substring(0, 60)}...`);
        console.log(`   ML ID: ${p.ml_id}`);
        console.log(`   Status: ${p.status}`);
        console.log(`   Stock: ${p.available_quantity}`);
        console.log('');
      });
      
      console.log('⚠️  PROBLEMA: Clientes pueden intentar comprar pero no hay stock.');
      console.log('💡 SOLUCIÓN: Pausar o agregar stock.');
    }
    
    // Resumen de stock general
    console.log('\n' + '='.repeat(90));
    console.log('📈 RESUMEN DE INVENTARIO');
    console.log('='.repeat(90));
    
    const totalStock = productos.reduce((sum, p) => sum + p.available_quantity, 0);
    const prodsConStock = productos.filter(p => p.available_quantity > 0).length;
    const prodsSinStock = productos.filter(p => p.available_quantity === 0).length;
    
    console.log(`\n📦 Total unidades en inventario: ${totalStock}`);
    console.log(`✅ Productos con stock: ${prodsConStock} (${Math.round(prodsConStock/productos.length*100)}%)`);
    console.log(`❌ Productos sin stock: ${prodsSinStock} (${Math.round(prodsSinStock/productos.length*100)}%)`);
    
    console.log(`\n🎯 POR STATUS Y STOCK:`);
    console.log(`   ✅ ACTIVOS con stock:   ${productos.filter(p => p.status === 'active' && p.available_quantity > 0).length}`);
    console.log(`   ⚠️  ACTIVOS sin stock:   ${activosSinStock.length}`);
    console.log(`   ⏸️  PAUSADOS con stock:  ${conStock.length}`);
    console.log(`   📦 PAUSADOS sin stock:  ${sinStock.length}`);
    console.log(`   🔴 CERRADOS:            ${productos.filter(p => p.status === 'closed').length}`);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

analizarPausados();

