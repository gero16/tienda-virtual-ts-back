# 📋 INSTRUCCIONES: Corrección de Permalinks

## 🎯 Objetivo
Corregir los permalinks de TODOS los productos para que apunten a Poppy Shop UY, no a otros vendedores.

---

## 📝 PASO 1: Hacer Push a GitHub

**Opción A - Desde VSCode/IDE:**
1. Clic en el icono de "Source Control" (Ctrl+Shift+G)
2. Clic en "Sync Changes" o botón de "Push"
3. Ingresar credenciales de GitHub si te las pide

**Opción B - Desde Terminal:**
```bash
cd /home/gero/Desktop/programacion/relacionados/tienda-virtual-ts-back
git push origin main
```

---

## ⏰ PASO 2: Esperar Deploy en Railway

1. Ve a: https://railway.app
2. Busca tu proyecto "tienda-virtual-ts-back"
3. Espera a que el deploy termine (2-3 minutos)
4. Verás un ✅ verde cuando esté listo

---

## 🔧 PASO 3: Ejecutar Corrección de Permalinks

Desde la carpeta del backend, ejecuta:

```bash
cd /home/gero/Desktop/programacion/relacionados/tienda-virtual-ts-back
node scripts/fixAllPermalinks.js
```

Este script:
- ✅ Corregirá los 1,423 productos
- ✅ Agregará el guion: MLU-XXXXXX
- ✅ Garantizará que todos apunten a TUS productos

---

## ✅ PASO 4: Verificación

El script te mostrará:
- Total de productos corregidos
- Ejemplos de cambios realizados
- Verificación del producto MLU693711190

**Formato correcto:**
```
https://articulo.mercadolibre.com.uy/MLU-693711190
```

---

## 🚨 Si hay errores:

### Error 404:
```
⚠️ Railway aún no terminó de desplegar
✅ Solución: Espera 2-3 minutos más
```

### Timeout:
```
⚠️ El proceso está tardando (normal con muchos productos)
✅ Solución: Los cambios se están aplicando, espera y verifica manualmente
```

---

## 🧪 Prueba Manual

Después de ejecutar el script, verifica un producto:

1. Ve a tu tienda: https://mercado-libre-roan.vercel.app
2. Abre cualquier producto
3. Clic en "Ver en MercadoLibre"
4. **Debe abrir TU publicación** en Poppy Shop UY

---

## 📊 Qué se corrigió:

### Antes:
❌ URL sin guion o de otro vendedor
❌ Redirige a productos de otros
❌ Confunde a los clientes

### Después:
✅ URL con guion: MLU-XXXXXX
✅ Apunta a Poppy Shop UY
✅ Experiencia correcta para clientes

---

## 💡 Nota Importante:

Este cambio es PERMANENTE. Todas las futuras sincronizaciones 
usarán este formato correcto automáticamente.

---

¿Problemas? Revisa los logs del script para más detalles.

