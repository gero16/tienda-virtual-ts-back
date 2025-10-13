// Diagnóstico completo del producto MLU693711190
const axios = require('axios');

const API_URL = process.env.API_URL || 'https://poppy-shop-production.up.railway.app';
const ML_ID = 'MLU693711190';

async function diagnostico() {
  try {
    console.log('🔍 DIAGNÓSTICO COMPLETO - Producto MLU693711190');
    console.log('='.repeat(90));
    
    // 1. Consultar producto en tu DB
    console.log('\n📊 1. CONSULTANDO TU BASE DE DATOS...\n');
    const dbResponse = await axios.get(`${API_URL}/ml/productos/${ML_ID}`);
    const producto = dbResponse.data;
    
    console.log(`Título: ${producto.title}`);
    console.log(`ML ID: ${producto.ml_id}`);
    console.log(`Status en ML: ${producto.status}`);
    console.log(`\n💰 PRECIO Y DESCUENTO:`);
    console.log(`   Precio base: US$ ${producto.price}`);
    console.log(`   Descuento activo: ${producto.descuento?.activo ? '✅ SÍ' : '❌ NO'}`);
    
    if (producto.descuento?.activo) {
      console.log(`   Porcentaje: ${producto.descuento.porcentaje}%`);
      console.log(`   Precio original: US$ ${producto.descuento.precio_original}`);
      const precioConDesc = producto.price * (1 - producto.descuento.porcentaje / 100);
      console.log(`   Precio con descuento: US$ ${precioConDesc.toFixed(2)}`);
      console.log(`   Ahorro: US$ ${(producto.price - precioConDesc).toFixed(2)}`);
    }
    
    console.log(`\n🔗 PERMALINK:`);
    console.log(`   URL guardada: ${producto.permalink}`);
    console.log(`   ¿Tiene guion?: ${producto.permalink?.includes('MLU-') ? '✅ SÍ' : '❌ NO'}`);
    console.log(`   ¿Contiene el ID correcto?: ${producto.permalink?.includes('693711190') ? '✅ SÍ' : '❌ NO'}`);
    
    // 2. Verificar qué URL se debería usar
    console.log('\n\n📋 2. ANÁLISIS DE URL:\n');
    
    const urlActual = producto.permalink;
    const urlCorrecta = `https://articulo.mercadolibre.com.uy/MLU-693711190`;
    
    console.log(`   URL actual en DB:    ${urlActual}`);
    console.log(`   URL correcta esperada: ${urlCorrecta}`);
    console.log(`   ¿Coinciden?: ${urlActual === urlCorrecta ? '✅ SÍ' : '❌ NO'}`);
    
    if (urlActual !== urlCorrecta) {
      console.log(`\n   ⚠️  PROBLEMA DETECTADO:`);
      console.log(`   La URL en tu DB no es la correcta.`);
      console.log(`   Necesitas ejecutar: node scripts/fixAllPermalinks.js`);
    }
    
    // 3. Verificar status del producto
    console.log('\n\n📦 3. ESTADO DEL PRODUCTO:\n');
    console.log(`   Status: ${producto.status}`);
    
    if (producto.status === 'closed') {
      console.log(`\n   ⚠️  PROBLEMA: El producto está CERRADO en MercadoLibre`);
      console.log(`   Cuando un producto está cerrado, ML puede redirigir a:`);
      console.log(`   - Productos similares de otros vendedores`);
      console.log(`   - Catálogos de productos`);
      console.log(`   - Página de error`);
      console.log(`\n   SOLUCIÓN: Reactivar el producto en MercadoLibre`);
    } else if (producto.status === 'paused') {
      console.log(`\n   ⚠️  El producto está PAUSADO`);
    } else {
      console.log(`   ✅ El producto está ACTIVO`);
    }
    
    // 4. Testing de la URL
    console.log('\n\n🧪 4. PROBANDO LA URL:\n');
    console.log(`   Abre esta URL en tu navegador:`);
    console.log(`   ${urlCorrecta}`);
    console.log(`\n   Debería mostrar:`);
    console.log(`   - Producto: ${producto.title}`);
    console.log(`   - Vendedor: Poppy Shop UY`);
    console.log(`   - Precio: US$ ${producto.price}`);
    
    // 5. Resumen
    console.log('\n\n' + '='.repeat(90));
    console.log('📝 RESUMEN DE PROBLEMAS:');
    console.log('='.repeat(90));
    
    let problemasEncontrados = 0;
    
    if (producto.status === 'closed') {
      problemasEncontrados++;
      console.log(`\n${problemasEncontrados}. ❌ Producto CERRADO en MercadoLibre`);
      console.log(`   → Reactivar en panel de MercadoLibre`);
    }
    
    if (urlActual !== urlCorrecta) {
      problemasEncontrados++;
      console.log(`\n${problemasEncontrados}. ❌ Permalink incorrecto`);
      console.log(`   → Ejecutar: node scripts/fixAllPermalinks.js`);
    }
    
    if (producto.descuento?.activo && producto.price === producto.descuento.precio_original) {
      problemasEncontrados++;
      console.log(`\n${problemasEncontrados}. ❌ Descuento no aplicado al precio`);
      console.log(`   → El frontend ahora calculará el descuento automáticamente`);
    }
    
    if (problemasEncontrados === 0) {
      console.log('\n✅ No se encontraron problemas graves');
    }
    
    console.log('\n' + '='.repeat(90));
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
    }
  }
}

diagnostico();

