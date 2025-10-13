# 🔍 Endpoint de Validación de Concordancia

## 📋 Descripción

Este endpoint compara los datos de tu base de datos con los datos reales de MercadoLibre para detectar discrepancias y errores.

---

## 🚀 USO

### Endpoint:
```
GET /ml/validar-concordancia
```

### Parámetros opcionales:

| Parámetro | Tipo | Default | Descripción |
|-----------|------|---------|-------------|
| `limit` | number | 50 | Cantidad de productos a validar |
| `full` | boolean | false | Si es `true`, valida TODOS los productos |

### Ejemplos:

```bash
# Validar 50 productos (rápido - 1 minuto)
GET https://poppy-shop-production.up.railway.app/ml/validar-concordancia

# Validar 100 productos
GET https://poppy-shop-production.up.railway.app/ml/validar-concordancia?limit=100

# Validar TODOS los productos (puede tardar 10 minutos)
GET https://poppy-shop-production.up.railway.app/ml/validar-concordancia?full=true
```

---

## 📊 QUÉ VALIDA

El endpoint compara 7 aspectos críticos:

### 1. **PRECIO**
- ✅ Detecta si el precio en tu DB difiere del precio en ML
- Ejemplo: DB=120.32 vs ML=115.00

### 2. **STOCK**
- ✅ Detecta diferencias en cantidad disponible
- Ejemplo: DB=5 vs ML=0

### 3. **STATUS**
- ✅ Detecta cambios de estado
- Ejemplo: DB=active vs ML=closed

### 4. **TÍTULO**
- ✅ Detecta si el título cambió
- Útil para saber si ML modificó algo

### 5. **PERMALINK**
- ✅ Verifica que el permalink sea correcto
- Detecta enlaces a otros vendedores

### 6. **MANUFACTURING_TIME**
- ✅ Compara días de preparación
- Ejemplo: DB=0 vs ML=18

### 7. **SELLER_ID**
- 🚨 **CRÍTICO:** Detecta si el producto es de OTRO vendedor
- Alerta si el producto no te pertenece

---

## 📄 RESPUESTA

### Ejemplo de respuesta exitosa:

```json
{
  "mensaje": "Validación de concordancia completada",
  "total_productos": 50,
  "correctos": 35,
  "con_discrepancias": 15,
  "errores_api": 0,
  "porcentaje_correcto": 70,
  "discrepancias": [
    {
      "ml_id": "MLU693711190",
      "title": "Vtech VM819 Monitor...",
      "diferencias": [
        "Status: DB=closed vs ML=active",
        "Días preparación: DB=0 vs ML=18"
      ],
      "datos_db": {
        "precio": 120.32,
        "stock": 2,
        "status": "closed",
        "dias_preparacion": 0
      },
      "datos_ml": {
        "precio": 120.32,
        "stock": 2,
        "status": "active",
        "dias_preparacion": 18,
        "seller_id": 123456789
      }
    }
  ],
  "productos_correctos": [...],
  "recomendaciones": {
    "sincronizar": true,
    "productos_a_revisar": ["MLU693711190", ...]
  }
}
```

---

## 🛠️ USAR EL SCRIPT

### Validación rápida (50 productos):
```bash
cd /home/gero/Desktop/programacion/relacionados/tienda-virtual-ts-back
node scripts/validarConcordancia.js
```

### Validación de 100 productos:
```bash
node scripts/validarConcordancia.js 100
```

### Validación completa (TODOS):
```bash
node scripts/validarConcordancia.js 0 full
```

---

## 📊 TIPOS DE DISCREPANCIAS COMUNES

### 🔴 **Críticas (resolver urgente):**

1. **Producto de otro vendedor**
   ```
   ⚠️ ALERTA: Producto de OTRO vendedor! Seller=999999999
   ```
   → Eliminar de tu DB

2. **Error de API**
   ```
   ERROR API: Request failed with status code 404
   ```
   → El producto ya no existe en ML

### ⚠️ **Importantes (sincronizar):**

3. **Precio diferente**
   ```
   Precio: DB=120.32 vs ML=115.00
   ```
   → Ejecutar sincronización

4. **Stock diferente**
   ```
   Stock: DB=5 vs ML=0
   ```
   → Ejecutar sincronización

5. **Status diferente**
   ```
   Status: DB=active vs ML=closed
   ```
   → Ejecutar sincronización

### ℹ️ **Menores (revisar):**

6. **Días preparación**
   ```
   Días preparación: DB=0 vs ML=18
   ```
   → Ejecutar sincronización

7. **Permalink incorrecto**
   ```
   Permalink: DB=.../MLU123 vs Correcto=.../MLU-123
   ```
   → Ejecutar fix-permalinks

---

## 💡 CUÁNDO USAR ESTE ENDPOINT

### **Uso Regular (recomendado):**
- ✅ Una vez por semana
- ✅ Después de cambios masivos en ML
- ✅ Antes de promociones importantes

### **Uso Específico:**
- ✅ Cuando detectes un producto con datos raros
- ✅ Después de una sincronización para verificar
- ✅ Si clientes reportan precios incorrectos

### **NO usar:**
- ❌ Antes de CADA venta (es lento)
- ❌ Múltiples veces al día (limites de API)

---

## 🔄 SI ENCUENTRAS DISCREPANCIAS

### Paso 1: Ejecutar sincronización
```bash
GET /ml/sync/force
```

### Paso 2: Ejecutar corrección de permalinks
```bash
POST /ml/fix-permalinks
```

### Paso 3: Validar nuevamente
```bash
GET /ml/validar-concordancia?limit=100
```

---

## ⚡ PERFORMANCE

| Productos | Tiempo estimado | Uso |
|-----------|----------------|-----|
| 50 | ~1 minuto | ✅ Uso diario |
| 100 | ~2 minutos | ✅ Uso semanal |
| 500 | ~10 minutos | ⚠️ Verificación mensual |
| TODOS (1,400+) | ~25 minutos | ⚠️ Solo cuando sea necesario |

---

## 🎯 EJEMPLO DE REPORTE

```
📊 RESUMEN GENERAL
Total productos validados: 50
✅ Correctos: 35 (70%)
⚠️  Con discrepancias: 15
❌ Errores API: 0

📌 PRECIO:
   Productos afectados: 5
   1. Producto A - Precio: DB=99.99 vs ML=89.99
   2. Producto B - Precio: DB=50.00 vs ML=55.00

📌 STOCK:
   Productos afectados: 8
   1. Producto C - Stock: DB=10 vs ML=0
   2. Producto D - Stock: DB=0 vs ML=5

📌 STATUS:
   Productos afectados: 2
   1. Producto E - Status: DB=active vs ML=closed

💡 RECOMENDACIONES:
   1. Ejecutar sincronización para actualizar tu DB
   2. Revisar manualmente productos críticos
```

---

## ✅ BENEFICIOS

- 🔍 Detecta errores automáticamente
- 💰 Evita vender a precios incorrectos
- 📦 Evita overselling (vender sin stock)
- 🚨 Detecta productos de otros vendedores
- 📊 Reporte detallado y accionable

---

**Endpoint listo para usar! 🎉**

