const fs = require('fs');

// Leer el archivo
const content = fs.readFileSync('routes/api.ts', 'utf8');

// Cambiar la importación
const updatedContent = content.replace(
  'import ProductoModel from "../models/products-model";',
  'import ProductoModel from "../models/Producto";'
);

// Escribir el archivo actualizado
fs.writeFileSync('routes/api.ts', updatedContent);

console.log('✅ Importación corregida');
