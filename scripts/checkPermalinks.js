// Script para verificar permalinks
const axios = require('axios');

const API_URL = process.env.API_URL || 'https://poppy-shop-production.up.railway.app';

async function checkPermalinks() {
  try {
    console.log('🔍 Verificando permalinks de productos...\n');
    
    const response = await axios.get(`${API_URL}/ml/productos?limit=10`);
    
    const productos = response.data.productos || response.data;
    
    console.log(`📊 Mostrando primeros ${productos.length} productos:\n`);
    
    productos.forEach((producto, index) => {
      console.log(`${index + 1}. ${producto.title}`);
      console.log(`   ML ID: ${producto.ml_id}`);
      console.log(`   Permalink: ${producto.permalink || '(sin permalink)'}`);
      console.log(`   Status: ${producto.status}`);
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
    }
  }
}

checkPermalinks();

