# 🧹 Guía: Limpiar Clientes Duplicados

## 📋 Problema

Si tienes varios registros de clientes con el mismo email en la base de datos, esto puede causar:
- ❌ Problemas con los cupones (límite por usuario)
- ❌ Estadísticas incorrectas
- ❌ Confusión en el historial de compras
- ❌ El índice único de MongoDB no funciona

---

## ✅ Solución

He creado un script que:
1. **Encuentra** todos los emails duplicados
2. **Mantiene** el cliente más reciente
3. **Consolida** estadísticas (órdenes, total gastado)
4. **Elimina** los duplicados
5. **Verifica** que el índice único esté creado

---

## 🚀 Cómo Ejecutar

### Paso 1: Ejecutar el Script

```bash
cd tienda-virtual-ts-back
npm run limpiar-duplicados
```

### Paso 2: Revisar el Output

El script mostrará algo como:

```
==========================================
  🧹 Limpieza de Clientes Duplicados
==========================================

✅ Conectado a MongoDB

📊 Estadísticas ANTES de la limpieza:
   Total de clientes: 50
   Clientes activos: 48
   Clientes con órdenes: 25

🔍 Buscando clientes duplicados...

⚠️  Se encontraron 5 emails con duplicados:

📧 Email: test@test.com
   Total de registros: 3
   ✅ Manteniendo: 64b5f8a3e9c8d4f0012345ab
      Nombre: Juan Pérez
      Fecha: 2025-01-10T10:30:00.000Z
      Órdenes: 2
      Total gastado: $150
   ❌ Eliminando: 64a2c1d8b7f6e3a001234567
      Nombre: Juan
      Fecha: 2025-01-05T08:20:00.000Z
      Órdenes: 1
      Total gastado: $50
   ❌ Eliminando: 649f3b2a6e5d2c900123def4
      Nombre: Juan P
      Fecha: 2025-01-01T14:15:00.000Z
      Órdenes: 0
      Total gastado: $0
   📊 Estadísticas consolidadas:
      Órdenes totales: 3
      Total gastado: $200

✅ Limpieza completada:
   📧 Emails únicos mantenidos: 5
   🗑️  Duplicados eliminados: 8

🔍 Verificando índice único en email...
✅ Índice único creado exitosamente

📊 Estadísticas DESPUÉS de la limpieza:
   Total de clientes: 42
   Clientes activos: 40
   Clientes con órdenes: 25

✅ Proceso completado exitosamente
==========================================
```

---

## 🔍 ¿Qué Hace Exactamente el Script?

### 1. **Busca Duplicados**
```typescript
// Agrupa clientes por email
db.clientes.aggregate([
  { $group: { _id: "$email", count: { $sum: 1 } }},
  { $match: { count: { $gt: 1 } }}
])
```

### 2. **Mantiene el Más Reciente**
Para cada email duplicado:
- Ordena por fecha de creación (más reciente primero)
- Mantiene el primer registro (más reciente)
- Elimina los demás

### 3. **Consolida Estadísticas**
Si los duplicados tienen órdenes o compras:
- Suma todas las órdenes
- Suma todo el dinero gastado
- Actualiza el cliente que se mantiene

**Ejemplo:**
```
Cliente 1 (mantener): 2 órdenes, $150
Cliente 2 (eliminar): 1 orden, $50
Cliente 3 (eliminar): 0 órdenes, $0

Resultado final:
Cliente 1: 3 órdenes, $200
```

### 4. **Crea Índice Único**
```typescript
db.clientes.createIndex({ email: 1 }, { unique: true })
```

Esto **previene** futuros duplicados automáticamente.

---

## ⚠️ Precauciones

### Antes de Ejecutar:

1. **✅ Haz un backup de tu base de datos**
   ```bash
   mongodump --uri="tu_mongodb_uri" --out=backup_clientes_$(date +%Y%m%d)
   ```

2. **✅ Ejecuta en un entorno de prueba primero** (si es posible)

3. **✅ Revisa los clientes duplicados** manualmente si quieres:
   ```javascript
   // En MongoDB Compass o mongosh:
   db.clientes.aggregate([
     { $group: { _id: "$email", count: { $sum: 1 }, docs: { $push: "$$ROOT" } }},
     { $match: { count: { $gt: 1 } }},
     { $sort: { count: -1 } }
   ])
   ```

---

## 🔐 Prevención de Futuros Duplicados

Una vez ejecutado el script, MongoDB **automáticamente rechazará** cualquier intento de crear un cliente con un email ya existente.

### En el Código

El modelo ya tiene configurado:

```typescript
// models/Cliente.ts
email: { 
  type: String, 
  required: true, 
  unique: true,  // 👈 Previene duplicados
  lowercase: true, // 👈 test@test.com = TEST@TEST.COM
  trim: true
}
```

### En el Servicio de Clientes

Ya está manejado en `clienteService.ts`:

```typescript
// Si intenta crear un cliente con email existente:
try {
  await nuevoCliente.save();
} catch (error) {
  if (error.code === 11000) {
    // Error de duplicado
    throw new Error('Ya existe un cliente con ese email');
  }
}
```

---

## 🧪 Casos de Prueba

### Test 1: Sin Duplicados
```bash
npm run limpiar-duplicados

# Output esperado:
✅ No se encontraron clientes duplicados
✅ El índice único en email ya existe
```

### Test 2: Con Duplicados
```bash
npm run limpiar-duplicados

# Output esperado:
⚠️  Se encontraron 3 emails con duplicados
✅ Limpieza completada:
   📧 Emails únicos mantenidos: 3
   🗑️  Duplicados eliminados: 5
```

### Test 3: Intentar Crear Duplicado Después
```javascript
// En tu código o API:
POST /api/clientes
{
  "email": "test@test.com",  // Email que ya existe
  // ... otros datos
}

// Response:
{
  "success": false,
  "message": "Ya existe un cliente con ese email"
}
```

---

## 📊 Verificar Resultados

### Opción 1: MongoDB Compass
1. Conecta a tu base de datos
2. Ve a la colección `clientes`
3. Agrupa por email: `{ $group: { _id: "$email", count: { $sum: 1 } } }`
4. Verifica que todos tengan `count: 1`

### Opción 2: Consulta Manual
```javascript
// En mongosh o Compass:
db.clientes.aggregate([
  { $group: { _id: "$email", count: { $sum: 1 } }},
  { $match: { count: { $gt: 1 } }}
])

// Si está limpio, debería devolver: []
```

### Opción 3: Verificar Índice
```javascript
db.clientes.getIndexes()

// Deberías ver:
{
  "email_1": {
    "v": 2,
    "key": { "email": 1 },
    "name": "email_1",
    "unique": true  // 👈 Esto debe estar presente
  }
}
```

---

## 🛠️ Solución de Problemas

### Error: "No se pudo crear el índice único"
**Causa:** Aún hay duplicados en la base de datos

**Solución:**
```bash
# Ejecuta el script de nuevo
npm run limpiar-duplicados
```

### Error: "Cannot connect to MongoDB"
**Causa:** La variable `MONGODB_CNN` no está configurada

**Solución:**
```bash
# Verifica tu archivo .env
cat .env | grep MONGODB_CNN

# Debe tener algo como:
MONGODB_CNN=mongodb+srv://usuario:password@cluster.mongodb.net/database
```

### Error: "Permission denied"
**Causa:** Tu usuario de MongoDB no tiene permisos

**Solución:** Asegúrate de que tu usuario tenga rol de `readWrite` o `dbAdmin`

---

## 📚 Recursos Adicionales

- [MongoDB Unique Indexes](https://www.mongodb.com/docs/manual/core/index-unique/)
- [Mongoose Schema Validation](https://mongoosejs.com/docs/validation.html)
- [MongoDB Aggregation Pipeline](https://www.mongodb.com/docs/manual/core/aggregation-pipeline/)

---

## ✅ Checklist

Antes de dar por terminado:

- [ ] Hice backup de la base de datos
- [ ] Ejecuté `npm run limpiar-duplicados`
- [ ] Revisé el output (sin errores)
- [ ] Verifiqué que no queden duplicados
- [ ] Confirmé que el índice único existe
- [ ] Probé crear un cliente con email existente (debe fallar)
- [ ] Actualicé la documentación si es necesario

---

**¡Listo! Tus clientes ahora tienen emails únicos y futuros duplicados serán prevenidos automáticamente.** 🎉

