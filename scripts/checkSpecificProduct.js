// Script para verificar un producto específico
const axios = require('axios');

const API_URL = process.env.API_URL || 'https://poppy-shop-production.up.railway.app';
const ML_ID = 'MLU693711190'; // Vtech VM819 Monitor

async function checkProduct() {
  try {
    console.log(`🔍 Verificando producto ${ML_ID}...\n`);
    
    const response = await axios.get(`${API_URL}/ml/productos/${ML_ID}`);
    const producto = response.data;
    
    console.log('📦 INFORMACIÓN DEL PRODUCTO:\n');
    console.log(`Título: ${producto.title}`);
    console.log(`ML ID: ${producto.ml_id}`);
    console.log(`Status: ${producto.status}`);
    console.log(`Precio: US$ ${producto.price}`);
    console.log(`Stock: ${producto.available_quantity}`);
    
    console.log('\n⏱️ INFORMACIÓN DE TIEMPO DE ENVÍO:\n');
    console.log(`Tipo de venta: ${producto.tipo_venta || 'NO DEFINIDO'}`);
    
    console.log('\n📊 Dropshipping (objeto):');
    if (producto.dropshipping) {
      console.log(`   Días preparación: ${producto.dropshipping.dias_preparacion}`);
      console.log(`   Días envío: ${producto.dropshipping.dias_envio_estimado}`);
      console.log(`   Proveedor: ${producto.dropshipping.proveedor}`);
      console.log(`   País origen: ${producto.dropshipping.pais_origen}`);
      console.log(`   Total: ${producto.dropshipping.dias_preparacion + producto.dropshipping.dias_envio_estimado} días`);
    } else {
      console.log('   ❌ NO TIENE objeto dropshipping');
    }
    
    console.log('\n📊 Campos de nivel raíz:');
    console.log(`   dias_preparacion: ${producto.dias_preparacion || 'NO DEFINIDO'}`);
    console.log(`   dias_envio_estimado: ${producto.dias_envio_estimado || 'NO DEFINIDO'}`);
    
    console.log('\n🏪 Stock físico (objeto):');
    if (producto.stock_fisico) {
      console.log(`   Cantidad: ${producto.stock_fisico.cantidad_disponible}`);
      console.log(`   Ubicación: ${producto.stock_fisico.ubicacion}`);
    } else {
      console.log('   ❌ NO TIENE objeto stock_fisico');
    }
    
    // Calcular si DEBERÍA ser dropshipping
    const diasPrep = producto.dropshipping?.dias_preparacion || 
                     producto.dias_preparacion || 
                     3;
    
    console.log('\n🎯 ANÁLISIS:');
    console.log(`   Días de preparación detectados: ${diasPrep}`);
    console.log(`   ¿Es > 14 días? ${diasPrep > 14 ? 'SÍ ✅' : 'NO ❌'}`);
    console.log(`   ¿Debería ser dropshipping con umbral de 14? ${diasPrep > 14 ? 'SÍ' : 'NO'}`);
    console.log(`   ¿Debería ser dropshipping con umbral de 10? ${diasPrep > 10 ? 'SÍ' : 'NO'}`);
    
    console.log('\n🎨 EN EL FRONTEND:');
    const isDropshipping = producto.dropshipping?.dias_preparacion && 
                          producto.dropshipping.dias_preparacion > 14;
    
    if (isDropshipping) {
      console.log('   ✅ SE MUESTRA badge de dropshipping');
      console.log(`   Texto: "🚚 Tiempo de envío: ${producto.dropshipping.dias_preparacion} días"`);
    } else {
      console.log('   ❌ NO SE MUESTRA badge de dropshipping');
      console.log('   Razón: dias_preparacion no existe o es ≤ 14');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

checkProduct();

