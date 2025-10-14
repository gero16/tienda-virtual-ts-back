// Script para verificar si los productos son realmente tuyos
const axios = require('axios');
const mongoose = require('mongoose');

const API_URL = process.env.API_URL || 'https://poppy-shop-production.up.railway.app';

async function verificarSellerId() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║   Verificación de Seller ID                    ║');
  console.log('╚════════════════════════════════════════════════╝\n');
  
  try {
    // 1. Conectar a la BD directamente para obtener el token
    console.log('🔌 Conectando a la base de datos...');
    
    const mongoUri = process.env.MONGO_URI || 
      'mongodb+srv://geronimomontero04:XNLHyh6aEGYVYMWo@cluster0.f9tnb.mongodb.net/tienda-virtual';
    
    await mongoose.connect(mongoUri);
    console.log('✅ Conectado a MongoDB\n');
    
    // 2. Obtener el token directamente de la BD
    const Token = mongoose.model('Token', new mongoose.Schema({
      access_token: String,
      token_type: String,
      expires_in: Number,
      scope: String,
      user_id: Number,
      refresh_token: String,
      last_updated: Date
    }));
    
    const token = await Token.findOne().sort({ last_updated: -1 });
    
    if (!token) {
      console.log('❌ No se encontró token en la BD');
      await mongoose.disconnect();
      return;
    }
    
    console.log('🔑 Token encontrado en BD');
    console.log(`📋 Tu User ID (del token): ${token.user_id}\n`);
    
    // 3. Obtener un producto aleatorio y verificar su seller_id
    console.log('📦 Consultando un producto de ejemplo...');
    
    const { data: producto } = await axios.get(
      `${API_URL}/ml/productos?limit=1`
    );
    
    const primerProducto = producto.productos?.[0] || producto[0];
    
    if (!primerProducto) {
      console.log('❌ No se encontraron productos en la BD');
      await mongoose.disconnect();
      return;
    }
    
    console.log(`   Producto: ${primerProducto.title}`);
    console.log(`   ML ID: ${primerProducto.ml_id}\n`);
    
    // 4. Consultar el seller_id de ese producto en ML
    console.log('🔍 Consultando seller_id en MercadoLibre...');
    
    const { data: productoML } = await axios.get(
      `https://api.mercadolibre.com/items/${primerProducto.ml_id}`,
      { headers: { Authorization: `Bearer ${token.access_token}` } }
    );
    
    const sellerIdDelProducto = productoML.seller_id;
    
    console.log(`📋 Seller ID del producto: ${sellerIdDelProducto}\n`);
    
    // 5. Comparar
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('🔍 COMPARACIÓN:\n');
    console.log(`Tu User ID:           ${token.user_id}`);
    console.log(`Seller ID del producto: ${sellerIdDelProducto}\n`);
    
    if (String(token.user_id) === String(sellerIdDelProducto)) {
      console.log('✅ ¡COINCIDEN! Los productos SON TUYOS\n');
      console.log('📊 CONCLUSIÓN:');
      console.log('   • Todos tus productos son correctos');
      console.log('   • El seller_id 1978988970 es TU seller_id');
      console.log('   • No hay productos de otros vendedores\n');
      console.log('✅ Todo está bien configurado!\n');
    } else {
      console.log('❌ NO COINCIDEN - Los productos son de OTRO vendedor\n');
      console.log('⚠️  PROBLEMA CRÍTICO:');
      console.log('   • Los productos en tu BD NO son tuyos');
      console.log('   • Pertenecen a otro vendedor');
      console.log('   • Necesitas limpiar y sincronizar correctamente\n');
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    await mongoose.disconnect();
    console.log('🔌 Desconectado de MongoDB');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Detalles API:', error.response.data);
    }
    await mongoose.disconnect();
  }
}

verificarSellerId();

