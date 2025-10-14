// Script para corregir los 3 permalinks vacíos
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 
  'mongodb+srv://geronimomontero04:XNLHyh6aEGYVYMWo@cluster0.f9tnb.mongodb.net/tienda-virtual';

const productosSinPermalink = [
  'MLU896468592',
  'MLU895675668',
  'MLU895675890'
];

function getCorrectPermalink(mlId) {
  // Normalizar el ID para asegurar que tenga el formato correcto con guion
  const normalizedId = mlId.includes('-') ? mlId : mlId.replace(/^(MLU)(\d+)$/, '$1-$2');
  return `https://articulo.mercadolibre.com.uy/${normalizedId}`;
}

async function corregirPermalinks() {
  try {
    console.log('🔌 Conectando a MongoDB...\n');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Conectado\n');

    const Producto = mongoose.model('Producto', new mongoose.Schema({
      ml_id: String,
      title: String,
      permalink: String
    }), 'productos');

    console.log('🔧 Corrigiendo permalinks...\n');

    for (const mlId of productosSinPermalink) {
      const permalink = getCorrectPermalink(mlId);
      
      const resultado = await Producto.updateOne(
        { ml_id: mlId },
        { $set: { permalink: permalink } }
      );

      if (resultado.matchedCount > 0) {
        console.log(`✅ ${mlId}`);
        console.log(`   → ${permalink}\n`);
      } else {
        console.log(`⚠️  ${mlId} - No encontrado\n`);
      }
    }

    console.log('✅ Corrección completada!\n');
    
    await mongoose.disconnect();
    console.log('🔌 Desconectado de MongoDB');

  } catch (error) {
    console.error('❌ Error:', error.message);
    await mongoose.disconnect();
    process.exit(1);
  }
}

corregirPermalinks();

