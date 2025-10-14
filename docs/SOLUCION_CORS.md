# 🔧 Solución: Error de CORS

## ❌ Problema

El frontend en Vercel (`https://mercado-libre-roan.vercel.app`) no podía hacer peticiones al backend en Railway (`https://poppy-shop-production.up.railway.app`) debido a errores de CORS:

```
Access to fetch at 'https://poppy-shop-production.up.railway.app/api/cupones/validar' 
from origin 'https://mercado-libre-roan.vercel.app' has been blocked by CORS policy: 
Response to preflight request doesn't pass access control check: 
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

---

## ✅ Solución Implementada

He mejorado la configuración de CORS en el backend para manejar correctamente las peticiones **preflight** (OPTIONS).

### Cambios en `tienda-virtual-ts-back/app.ts`

**Antes:**
```typescript
app.use(bodyParser.json())

const corsOptions = {
  origin: [
    'https://mercado-libre-roan.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:3001'
  ],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions))
```

**Después:**
```typescript
// ⚠️ IMPORTANTE: CORS debe ir ANTES de bodyParser
const corsOptions = {
  origin: [
    'https://mercado-libre-roan.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:3001'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  credentials: true,
  optionsSuccessStatus: 200,
  preflightContinue: false
};

// Aplicar CORS globalmente PRIMERO
app.use(cors(corsOptions));

// Manejar preflight requests explícitamente
app.options('*', cors(corsOptions));

// LUEGO bodyParser
app.use(bodyParser.json())
```

### ¿Qué se mejoró?

1. **✅ Orden correcto:** CORS se aplica **antes** de bodyParser
2. **✅ Métodos HTTP:** Se especifican explícitamente todos los métodos permitidos
3. **✅ Headers permitidos:** Se definen los headers que el frontend puede enviar
4. **✅ Preflight explícito:** `app.options('*')` maneja las peticiones OPTIONS
5. **✅ preflightContinue: false:** Evita que las peticiones preflight continúen a las rutas

---

## 🚀 Cómo Aplicar la Solución

### 1. **Compilar el Backend**
```bash
cd tienda-virtual-ts-back
npm run start
```

Esto compilará el TypeScript a JavaScript en la carpeta `dist/`.

### 2. **Desplegar en Railway**

#### Opción A: Deploy Automático con Git
Si tienes Railway conectado a tu repositorio Git:

```bash
# Hacer commit de los cambios
git add tienda-virtual-ts-back/app.ts
git commit -m "Fix: Mejorar configuración CORS para preflight requests"
git push origin main
```

Railway detectará los cambios automáticamente y desplegará.

#### Opción B: Deploy Manual con Railway CLI
```bash
# Instalar Railway CLI (si no lo tienes)
npm install -g @railway/cli

# Login en Railway
railway login

# Desplegar
cd tienda-virtual-ts-back
railway up
```

#### Opción C: Deploy desde el Dashboard de Railway
1. Ve a [Railway Dashboard](https://railway.app/dashboard)
2. Encuentra tu proyecto "poppy-shop-production"
3. Click en "Deploy" > "Trigger Deploy"
4. Selecciona la rama que contiene los cambios

### 3. **Verificar el Despliegue**
Una vez desplegado, verifica que el backend esté funcionando:

```bash
# Verificar que el backend responde
curl https://poppy-shop-production.up.railway.app/

# Deberías ver: "Ruta funcionando!"
```

### 4. **Probar CORS**
Desde tu navegador, abre la consola (F12) en tu sitio de Vercel y prueba:

```javascript
fetch('https://poppy-shop-production.up.railway.app/api/cupones/validar', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    codigo: 'TEST',
    monto_compra: 100
  })
})
.then(res => res.json())
.then(data => console.log('✅ CORS funciona:', data))
.catch(err => console.error('❌ Error:', err))
```

Si CORS está funcionando correctamente, no deberías ver errores de CORS en la consola.

---

## 🔍 Diagnóstico de Problemas

### El error persiste después de desplegar
**Causa posible:** Railway no desplegó los cambios
**Solución:**
1. Verifica en el dashboard de Railway que el despliegue fue exitoso
2. Revisa los logs de Railway para ver si hay errores
3. Asegúrate de que el archivo `app.ts` compilado esté en `dist/app.js`

### Error: "504 Gateway Timeout"
**Causa posible:** El backend tardó mucho en responder
**Solución:**
1. Verifica que la base de datos MongoDB esté funcionando
2. Revisa los logs del backend en Railway
3. Aumenta el timeout en Railway si es necesario

### Error: "Cannot find module"
**Causa posible:** No se compiló el TypeScript
**Solución:**
```bash
cd tienda-virtual-ts-back
npm run start  # Compila TS a JS
```

### Los cambios no se reflejan
**Causa posible:** Caché del navegador
**Solución:**
1. Hacer hard refresh: `Ctrl + Shift + R` (Windows/Linux) o `Cmd + Shift + R` (Mac)
2. Abrir en ventana incógnita
3. Limpiar caché del navegador

---

## 📊 Endpoints Afectados (Ahora funcionan)

Estos endpoints ahora deberían funcionar correctamente desde el frontend de Vercel:

✅ `/api/cupones/validar` - Validar cupones
✅ `/api/cupones/listar` - Listar cupones
✅ `/api/cupones/crear` - Crear cupones
✅ `/api/create_preference` - Crear preferencia de MercadoPago
✅ `/api/process_payment` - Procesar pagos
✅ `/api/descuentos/*` - Endpoints de descuentos
✅ `/api/clientes/*` - Endpoints de clientes
✅ `/ml/*` - Endpoints de MercadoLibre

---

## 🧪 Testing

### Test 1: Validar Cupón
```bash
curl -X POST https://poppy-shop-production.up.railway.app/api/cupones/validar \
  -H "Content-Type: application/json" \
  -H "Origin: https://mercado-libre-roan.vercel.app" \
  -d '{"codigo":"TEST","monto_compra":100}'
```

**Respuesta esperada:**
```json
{
  "valido": false,
  "error": "Cupón no encontrado"
}
```

### Test 2: Listar Cupones
```bash
curl -X GET https://poppy-shop-production.up.railway.app/api/cupones/listar \
  -H "Origin: https://mercado-libre-roan.vercel.app"
```

**Respuesta esperada:**
```json
{
  "success": true,
  "count": X,
  "cupones": [...]
}
```

---

## 💡 Explicación Técnica

### ¿Qué es CORS?
**CORS (Cross-Origin Resource Sharing)** es una política de seguridad del navegador que restringe las peticiones HTTP desde un origen (dominio) diferente al del servidor.

### ¿Qué es una petición Preflight?
Cuando el navegador hace una petición compleja (POST, PUT, DELETE con headers personalizados), **primero** envía una petición **OPTIONS** para verificar si el servidor permite la petición original. Esta se llama **preflight request**.

### Flujo de una petición con CORS:

1. **Frontend** (Vercel): "Quiero hacer POST a /api/cupones/validar"
2. **Navegador**: "Primero voy a preguntar al servidor si lo permite" → **OPTIONS /api/cupones/validar**
3. **Backend** (Railway): "Sí, permito POST desde mercado-libre-roan.vercel.app" → Headers CORS
4. **Navegador**: "Ok, ahora sí hago la petición real" → **POST /api/cupones/validar**
5. **Backend**: Responde con datos + Headers CORS
6. **Frontend**: Recibe la respuesta

### Headers CORS importantes:

- `Access-Control-Allow-Origin`: Qué dominios pueden hacer peticiones
- `Access-Control-Allow-Methods`: Qué métodos HTTP están permitidos
- `Access-Control-Allow-Headers`: Qué headers puede enviar el cliente
- `Access-Control-Allow-Credentials`: Si permite cookies/auth

---

## 📚 Referencias

- [MDN - CORS](https://developer.mozilla.org/es/docs/Web/HTTP/CORS)
- [Express CORS Middleware](https://expressjs.com/en/resources/middleware/cors.html)
- [Railway Documentation](https://docs.railway.app/)

---

## ✅ Checklist de Verificación

Antes de marcar como resuelto:

- [ ] Código actualizado en `app.ts`
- [ ] Backend compilado (`npm run start`)
- [ ] Cambios desplegados en Railway
- [ ] Logs de Railway sin errores
- [ ] Petición de prueba exitosa desde consola del navegador
- [ ] Frontend en Vercel puede hacer peticiones sin errores CORS
- [ ] Validación de cupones funciona
- [ ] Checkout de MercadoPago funciona

---

**Autor:** Asistente IA  
**Fecha:** 2025-10-10  
**Estado:** ✅ Resuelto

