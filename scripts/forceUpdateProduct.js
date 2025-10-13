// Script para forzar actualización de un producto específico
const axios = require('axios');

const API_URL = process.env.API_URL || 'https://poppy-shop-production.up.railway.app';
const ML_ID = 'MLU693711190'; // Vtech VM819 Monitor

async function forceUpdate() {
  try {
    console.log(`🔄 Forzando actualización del producto ${ML_ID}...\n`);
    
    // Intentar el endpoint de force-update
    try {
      const response = await axios.post(
        `${API_URL}/ml/productos/${ML_ID}/force-update`,
        {},
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 60000
        }
      );
      
      console.log('✅ Producto actualizado exitosamente!\n');
      console.log('📦 Información actualizada:');
      console.log(JSON.stringify(response.data, null, 2));
      
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log('⚠️ Endpoint force-update no encontrado, intentando alternativa...\n');
        
        // Alternativa: trigger webhook manualmente
        const webhookResponse = await axios.post(
          `${API_URL}/ml/webhook`,
          {
            resource: `/items/${ML_ID}`,
            topic: 'items'
          },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 60000
          }
        );
        
        console.log('✅ Webhook procesado!\n');
      } else {
        throw error;
      }
    }
    
    // Esperar un momento para que se procese
    console.log('\n⏳ Esperando 3 segundos para que se procese...\n');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Verificar el producto actualizado
    const checkResponse = await axios.get(`${API_URL}/ml/productos/${ML_ID}`);
    const producto = checkResponse.data;
    
    console.log('🔍 VERIFICACIÓN POST-ACTUALIZACIÓN:\n');
    console.log(`Título: ${producto.title}`);
    console.log(`Status: ${producto.status}`);
    console.log(`Tipo de venta: ${producto.tipo_venta || 'NO DEFINIDO'}`);
    
    if (producto.dropshipping) {
      console.log('\n📦 Dropshipping:');
      console.log(`   Días preparación: ${producto.dropshipping.dias_preparacion}`);
      console.log(`   Días envío: ${producto.dropshipping.dias_envio_estimado}`);
      console.log(`   Total: ${producto.dropshipping.dias_preparacion + producto.dropshipping.dias_envio_estimado} días`);
      console.log(`   Proveedor: ${producto.dropshipping.proveedor}`);
    } else {
      console.log('\n⚠️ Sin información de dropshipping');
    }
    
    const diasPrep = producto.dropshipping?.dias_preparacion || 0;
    console.log('\n🎯 RESULTADO:');
    console.log(`   ¿Es > 10 días? ${diasPrep > 10 ? '✅ SÍ' : '❌ NO'}`);
    console.log(`   ¿Debería mostrarse en frontend? ${diasPrep > 10 ? '✅ SÍ' : '❌ NO'}`);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

forceUpdate();

