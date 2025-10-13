// Script rápido para contar productos por seller_id sin validar todo
const axios = require('axios');

const API_URL = process.env.API_URL || 'https://poppy-shop-production.up.railway.app';

async function contarProductosPorSeller() {
  console.log('🔍 Analizando productos en tu BD...\n');
  
  try {
    // 1. Obtener tu user_id del token (puede ser null si endpoint no actualizado)
    console.log('📡 Consultando tu user_id...');
    let tuUserId = null;
    
    try {
      const statusResponse = await axios.get(`${API_URL}/ml/status`);
      tuUserId = statusResponse.data.user_id;
      
      if (tuUserId) {
        console.log(`✅ Tu user_id: ${tuUserId}\n`);
      } else {
        console.log(`⚠️ No se pudo obtener tu user_id (endpoint no actualizado)`);
        console.log(`   Continuando sin comparación...\n`);
      }
    } catch (error) {
      console.log(`⚠️ No se pudo obtener tu user_id`);
      console.log(`   Continuando sin comparación...\n`);
    }
    
    // 2. Obtener todos los productos de tu BD (solo ml_id)
    console.log('📊 Consultando productos en tu BD...');
    const productosResponse = await axios.get(`${API_URL}/ml/productos?limit=9999`);
    const productos = productosResponse.data.productos || productosResponse.data;
    
    console.log(`✅ Total productos en BD: ${productos.length}\n`);
    
    // 3. Tomar una muestra representativa (100 productos aleatorios)
    const muestraSize = Math.min(100, productos.length);
    const muestra = [];
    const indices = new Set();
    
    while (muestra.length < muestraSize) {
      const randomIndex = Math.floor(Math.random() * productos.length);
      if (!indices.has(randomIndex)) {
        indices.add(randomIndex);
        muestra.push(productos[randomIndex]);
      }
    }
    
    console.log(`🎲 Validando muestra de ${muestraSize} productos aleatorios...\n`);
    
    // 3.5. Obtener token de autenticación
    console.log('🔑 Obteniendo token de autenticación...');
    let accessToken = null;
    
    try {
      const tokenResponse = await axios.get(`${API_URL}/ml/status`);
      if (tokenResponse.data.authenticated) {
        // El token no se devuelve directamente, así que usamos el endpoint interno
        console.log('✅ Autenticado\n');
        accessToken = 'authenticated'; // Marcador para usar endpoint interno
      }
    } catch (error) {
      console.log('⚠️ No se pudo verificar autenticación\n');
    }
    
    // 4. Validar la muestra
    const sellers = {};
    let errores = 0;
    let validados = 0;
    let errores403 = 0;
    let errores404 = 0;
    
    for (const producto of muestra) {
      try {
        // Pequeña pausa para no saturar la API
        await new Promise(resolve => setTimeout(resolve, 150));
        
        // Usar endpoint interno que tiene autenticación
        const mlResponse = await axios.get(
          `${API_URL}/ml/debug/producto/${producto.ml_id}`
        );
        
        const sellerId = mlResponse.data.item_completo?.seller_id || 'unknown';
        
        if (!sellers[sellerId]) {
          sellers[sellerId] = {
            count: 0,
            productos: []
          };
        }
        
        sellers[sellerId].count++;
        sellers[sellerId].productos.push({
          ml_id: producto.ml_id,
          title: producto.title
        });
        
        validados++;
        
        // Mostrar progreso cada 10 productos
        if (validados % 10 === 0) {
          console.log(`   Progreso: ${validados}/${muestraSize}`);
        }
        
      } catch (error) {
        errores++;
        
        if (error.response?.status === 403) {
          errores403++;
        } else if (error.response?.status === 404) {
          errores404++;
        }
        
        // Solo mostrar primeros 10 errores
        if (errores <= 10) {
          console.log(`   ⚠️ Error ${error.response?.status || ''} con ${producto.ml_id}`);
        } else if (errores === 11) {
          console.log(`   ... (ocultando errores restantes)`);
        }
      }
    }
    
    console.log(`\n✅ Validación de muestra completada!\n`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // 5. Mostrar resultados
    console.log('📊 RESULTADOS:\n');
    console.log(`Total productos en BD: ${productos.length}`);
    console.log(`Muestra validada: ${validados} productos`);
    console.log(`Errores totales: ${errores}`);
    
    if (errores > 0) {
      console.log(`   - Error 403 (Prohibido): ${errores403}`);
      console.log(`   - Error 404 (No encontrado): ${errores404}`);
      console.log(`   - Otros errores: ${errores - errores403 - errores404}`);
    }
    console.log('');
    
    console.log('👥 SELLERS ENCONTRADOS:\n');
    
    const sellerIds = Object.keys(sellers);
    
    for (const sellerId of sellerIds) {
      const esTuyo = tuUserId ? (sellerId === String(tuUserId)) : null;
      const porcentaje = Math.round((sellers[sellerId].count / validados) * 100);
      const proyeccion = Math.round((sellers[sellerId].count / validados) * productos.length);
      
      let marker = '📦';
      let label = '';
      
      if (esTuyo === true) {
        marker = '✅';
        label = ' (TÚ)';
      } else if (esTuyo === false) {
        marker = '❌';
        label = ' (OTRO VENDEDOR)';
      }
      
      console.log(`${marker} Seller ID: ${sellerId}${label}`);
      console.log(`   En muestra: ${sellers[sellerId].count}/${validados} (${porcentaje}%)`);
      console.log(`   Proyección total: ~${proyeccion} productos en tu BD`);
      console.log(`   Ejemplos:`);
      
      sellers[sellerId].productos.slice(0, 3).forEach(p => {
        console.log(`      - ${p.ml_id}: ${p.title.substring(0, 50)}...`);
      });
      
      console.log('');
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // 6. Recomendaciones
    const tuyos = sellers[tuUserId]?.count || 0;
    const ajenos = validados - tuyos;
    
    if (errores > 0 && validados === 0) {
      console.log('🚨 ADVERTENCIA CRÍTICA: NO se pudo validar ningún producto!\n');
      console.log('📋 ANÁLISIS DE ERRORES:\n');
      
      if (errores403 > errores / 2) {
        console.log(`❌ ${errores403} productos dieron error 403 (Prohibido)`);
        console.log('   Esto significa que esos productos:\n');
        console.log('   • Ya NO existen en MercadoLibre');
        console.log('   • Fueron eliminados o cerrados permanentemente');
        console.log('   • O son de OTRO vendedor sin acceso público\n');
      }
      
      if (errores404 > errores / 2) {
        console.log(`❌ ${errores404} productos dieron error 404 (No encontrado)`);
        console.log('   Esto significa que esos productos fueron eliminados de ML\n');
      }
      
      console.log('🔧 RECOMENDACIONES URGENTES:\n');
      console.log('1. ⚠️ Tu BD contiene productos OBSOLETOS que ya no existen');
      console.log('2. 🗑️ Limpiar todos los productos de tu BD');
      console.log('3. 🔄 Ejecutar sincronización completa desde ML');
      console.log('4. ✅ Esto traerá solo productos que realmente existen\n');
      
      const proyeccion = Math.round((errores / muestraSize) * productos.length);
      console.log(`📊 PROYECCIÓN: De tus ${productos.length} productos en BD,`);
      console.log(`   aproximadamente ${proyeccion} NO existen en MercadoLibre.\n`);
      
    } else if (ajenos > 0) {
      console.log('⚠️  ADVERTENCIA: Tienes productos de OTROS vendedores en tu BD!\n');
      console.log('🔧 RECOMENDACIONES:\n');
      console.log('1. Eliminar productos ajenos de tu BD');
      console.log('2. Sincronizar solo TUS productos desde ML');
      console.log('3. Verificar cómo llegaron esos productos a tu BD\n');
    } else if (validados > 0) {
      console.log('✅ Todos los productos validados son TUYOS!\n');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Detalles:', error.response.data);
    }
  }
}

// Ejecutar
console.log('╔════════════════════════════════════════════════╗');
console.log('║   Análisis de Productos por Seller ID         ║');
console.log('╚════════════════════════════════════════════════╝\n');

contarProductosPorSeller();

