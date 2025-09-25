const fs = require('fs');

// Leer el archivo
const content = fs.readFileSync('routes/api.ts', 'utf8');

// Reemplazar la función transformItemsData
const newTransformFunction = `    const transformItemsData = async (items: any) => {
      if (!items || !Array.isArray(items)) {
        return [];
      }

      const transformedItems = [];
      
      for (const item of items) {
        let mlId = item.id?.toString();
        
        // Si el item.id no es un ml_id, buscar en la base de datos
        if (item.id && !item.id.toString().startsWith('MLA')) {
          try {
            // Buscar como producto principal
            const producto = await ProductoModel.findOne({ _id: item.id });
            if (producto && producto.ml_id) {
              mlId = producto.ml_id;
            } else {
              // Buscar como variante
              const variante = await Variante.findOne({ _id: item.id });
              if (variante && variante.id) {
                mlId = variante.id;
              }
            }
          } catch (dbError) {
            console.log(\`⚠️ No se pudo encontrar ml_id para item \${item.id}\`);
          }
        }

        transformedItems.push({
          product_id: mlId || item.id?.toString() || \`item-\${Date.now()}-\${Math.random()}\`,
          product_name: item.title || item.name || \`Producto \${transformedItems.length + 1}\`,
          variant_id: item.variant_id || undefined,
          color: item.color || undefined,
          size: item.size || undefined,
          quantity: item.quantity || item.cantidad || 1,
          unit_price: item.unit_price || item.price || 0,
          total_price: (item.quantity || item.cantidad || 1) * (item.unit_price || item.price || 0)
        });
      }
      
      return transformedItems;
    };`;

// Reemplazar la función existente
const updatedContent = content.replace(
  /const transformItemsData = \(items: any\) => \{[\s\S]*?\};/,
  newTransformFunction
);

// Cambiar la llamada a transformItemsData para que sea async
const finalContent = updatedContent.replace(
  /items: transformItemsData\(items\),/,
  'items: await transformItemsData(items),'
);

// Escribir el archivo actualizado
fs.writeFileSync('routes/api.ts', finalContent);

console.log('✅ Archivo actualizado correctamente');
