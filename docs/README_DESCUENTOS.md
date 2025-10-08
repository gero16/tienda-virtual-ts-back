# 🎯 Sistema de Descuentos - Documentación

## Resumen

Se ha implementado un sistema completo de descuentos que permite al administrador aplicar descuentos porcentuales a productos específicos. Los productos con descuento se muestran en la página principal y en la tienda con su propio filtro.

## ✨ Características Implementadas

### Backend (Node.js + TypeScript + MongoDB)

1. **Modelo de Producto actualizado** (`models/Producto.ts`)
   - Nuevo campo `descuento` con:
     - `activo`: Si el descuento está activo
     - `porcentaje`: Porcentaje del descuento (1-100)
     - `precio_original`: Precio antes del descuento
     - `fecha_inicio`: Fecha de inicio del descuento (opcional)
     - `fecha_fin`: Fecha de fin del descuento (opcional)

2. **Nuevas rutas de API** (`routes/descuentos.ts`)
   - `POST /api/descuentos/aplicar` - Aplicar descuento a productos
   - `POST /api/descuentos/quitar` - Quitar descuento de productos
   - `GET /api/descuentos/listar` - Listar productos con descuento
   - `GET /api/descuentos/producto/:ml_id` - Obtener descuento de un producto
   - `PUT /api/descuentos/actualizar` - Actualizar porcentaje de descuento

### Frontend (React + TypeScript)

1. **Componente DiscountedProducts** (`components/DiscountedProducts.tsx`)
   - Muestra productos con descuento en la página principal
   - Carrusel con navegación
   - Muestra precio original tachado y precio con descuento
   - Muestra el ahorro en pesos

2. **Panel de Administración** (`pages/AdminDescuentos.tsx`)
   - Interfaz para gestionar descuentos
   - Lista paginada de productos con descuento activo (12 por página)
   - Selección múltiple de productos
   - Slider para ajustar porcentaje de descuento
   - Búsqueda de productos con filtrado en tiempo real
   - Paginación inteligente para listas grandes (20 productos por página)
   - Contador de productos totales y seleccionados
   - Scroll automático al cambiar de página

3. **Actualizaciones en TiendaPage**
   - Muestra badge con porcentaje de descuento
   - Precio original tachado
   - Precio con descuento en rojo destacado
   - Filtro "Con Descuento" funcional

4. **Actualizaciones en FeaturedProducts**
   - Muestra descuentos en productos destacados
   - Badge cambia de color cuando hay descuento

## 📋 Uso del Sistema

### Para el Administrador

#### Acceder al Panel de Descuentos

1. Navega a `/admin/descuentos` en tu navegador
2. Verás dos secciones principales:
   - **Productos con Descuento Activo**: Lista paginada de productos que tienen descuento (12 por página)
   - **Aplicar Descuentos**: Interfaz para aplicar nuevos descuentos con lista paginada (20 por página)

#### Aplicar Descuentos

1. En la sección "Aplicar Descuentos":
   - Ajusta el **porcentaje de descuento** usando el slider (1-100%)
   - Usa el **buscador** para filtrar productos
   - Selecciona los productos haciendo clic en ellos (o usa "Seleccionar Todos")
   - Haz clic en **"Aplicar Descuento"**

2. El sistema automáticamente:
   - Guarda el precio original
   - Calcula el nuevo precio con descuento
   - Actualiza el precio del producto
   - Marca el descuento como activo

#### Quitar Descuentos

1. En la sección "Productos con Descuento Activo":
   - Encuentra el producto del cual quieres quitar el descuento
   - Haz clic en **"Quitar Descuento"**
   - El producto recuperará su precio original automáticamente

### Para el Cliente

#### Ver Productos con Descuento

1. **Página Principal**:
   - Sección "🔥 Productos en Descuento" muestra productos con ofertas
   - Badge rojo con el porcentaje de descuento
   - Precio original tachado
   - Precio con descuento destacado en rojo
   - Ahorro calculado

2. **Tienda**:
   - Filtro "🔥 Con Descuento" muestra solo productos en oferta
   - Los productos con descuento tienen badge visible
   - Precios mostrados con tachado y descuento

3. **Carrito y Pago**:
   - Los precios con descuento se aplican automáticamente
   - El cliente paga el precio con descuento
   - No se requiere código de cupón

## 🔌 API Endpoints

### Aplicar Descuento
```bash
POST https://poppy-shop-production.up.railway.app/api/descuentos/aplicar
Content-Type: application/json

{
  "product_ids": ["MLA123456789", "MLA987654321"],
  "porcentaje": 15,
  "fecha_inicio": "2025-10-01",  // opcional
  "fecha_fin": "2025-10-31"      // opcional
}
```

**Respuesta:**
```json
{
  "success": true,
  "message": "Descuentos aplicados: 2 exitosos, 0 fallidos",
  "resultados": [
    {
      "product_id": "MLA123456789",
      "success": true,
      "title": "Producto X",
      "precio_original": 1000,
      "precio_descuento": 850,
      "porcentaje": 15
    }
  ]
}
```

### Quitar Descuento
```bash
POST https://poppy-shop-production.up.railway.app/api/descuentos/quitar
Content-Type: application/json

{
  "product_ids": ["MLA123456789"]
}
```

### Listar Productos con Descuento
```bash
GET https://poppy-shop-production.up.railway.app/api/descuentos/listar
```

**Respuesta:**
```json
{
  "success": true,
  "count": 5,
  "productos": [
    {
      "ml_id": "MLA123456789",
      "title": "Producto X",
      "precio_original": 1000,
      "precio_descuento": 850,
      "porcentaje": 15,
      "ahorro": 150,
      "image": "https://...",
      "available_quantity": 10,
      "status": "active"
    }
  ]
}
```

### Obtener Descuento de un Producto
```bash
GET https://poppy-shop-production.up.railway.app/api/descuentos/producto/MLA123456789
```

### Actualizar Porcentaje
```bash
PUT https://poppy-shop-production.up.railway.app/api/descuentos/actualizar
Content-Type: application/json

{
  "product_ids": ["MLA123456789"],
  "porcentaje": 20
}
```

## 🎨 Estilos Visuales

### Colores del Sistema de Descuentos
- **Rojo principal**: `#d32f2f` - Para badges y precios con descuento
- **Rojo secundario**: `#e53935` - Para gradientes
- **Verde de ahorro**: `#388e3c` - Para mostrar el ahorro
- **Gris tachado**: `#999` - Para precios originales

### Badges
- Badge circular con `-X%`
- Animación de pulsación sutil
- Sombra para destacar
- Posición absoluta en esquina superior derecha de las imágenes

## 🚀 Flujo Completo del Sistema

1. **Administrador aplica descuento**:
   - Selecciona productos y porcentaje
   - Sistema guarda precio original
   - Calcula y aplica nuevo precio
   - Marca descuento como activo

2. **Cliente navega la tienda**:
   - Ve productos con badge de descuento
   - Precio original tachado
   - Precio con descuento destacado
   - Puede filtrar por "Con Descuento"

3. **Cliente agrega al carrito**:
   - Producto se agrega con precio con descuento
   - No requiere acción adicional

4. **Cliente paga**:
   - Pago se procesa con precio con descuento
   - Orden se guarda con precio final

5. **Administrador quita descuento**:
   - Sistema restaura precio original
   - Desactiva el descuento
   - Producto vuelve a precio normal

## 📊 Base de Datos

### Estructura del campo descuento en MongoDB

```javascript
descuento: {
  activo: Boolean,           // true si el descuento está activo
  porcentaje: Number,        // 1-100
  precio_original: Number,   // Precio antes del descuento
  fecha_inicio: Date,        // Opcional
  fecha_fin: Date           // Opcional
}
```

### Ejemplo de Documento
```javascript
{
  _id: ObjectId("..."),
  ml_id: "MLA123456789",
  title: "Producto Ejemplo",
  price: 850,                // Precio con descuento
  descuento: {
    activo: true,
    porcentaje: 15,
    precio_original: 1000,
    fecha_inicio: ISODate("2025-10-01T00:00:00Z"),
    fecha_fin: ISODate("2025-10-31T23:59:59Z")
  }
}
```

## 🔧 Consideraciones Técnicas

### Cálculo de Descuento
```typescript
const nuevo_precio = precio_original * (1 - porcentaje / 100)
// Ejemplo: 1000 * (1 - 15/100) = 1000 * 0.85 = 850
```

### Redondeo
Los precios se redondean a 2 decimales:
```typescript
Math.round(precio * 100) / 100
```

### Validaciones
- Porcentaje debe estar entre 1 y 100
- Se requiere al menos un producto para aplicar descuento
- Se verifica que el producto exista antes de aplicar/quitar descuento
- No se permite aplicar descuento a productos pausados

## 🔢 Sistema de Paginación

El panel de administración incluye paginación avanzada para manejar grandes cantidades de productos:

### Características de la Paginación

1. **Productos con Descuento Activo**:
   - 12 productos por página
   - Botones de navegación (Anterior/Siguiente)
   - Indicadores numéricos de página
   - Contador total de productos

2. **Lista de Productos para Aplicar Descuento**:
   - 20 productos por página
   - Paginación inteligente con puntos suspensivos (...)
   - Muestra páginas cercanas a la actual (±2 páginas)
   - Siempre muestra primera y última página
   - Información de rango actual (ej: "Mostrando 1-20 de 150 productos")

3. **Experiencia de Usuario**:
   - Scroll automático al cambiar de página
   - Botones deshabilitados en los extremos
   - Diseño responsive para móviles
   - La búsqueda resetea a la página 1
   - Productos seleccionados se mantienen entre páginas

### Ejemplo de Paginación
```
[← Anterior] [1] [2] [3] ... [10] [11] [12] ... [45] [Siguiente →]
                      ↑ Página actual
```

## 🎯 Mejoras Futuras (Opcionales)

1. **Descuentos por tiempo**:
   - Auto-activar/desactivar según fechas
   - Cron job para verificar fechas

2. **Descuentos por cantidad**:
   - "Compra 2, lleva 3"
   - Descuentos escalonados

3. **Códigos de cupón**:
   - Cupones únicos por cliente
   - Límite de usos

4. **Descuentos por categoría**:
   - Aplicar a toda una categoría
   - Descuentos por marca

5. **Historial de descuentos**:
   - Registro de descuentos aplicados
   - Análisis de efectividad

6. **Notificaciones**:
   - Avisar a clientes sobre nuevos descuentos
   - Email marketing

## 📞 Soporte

Si encuentras algún problema o necesitas ayuda, verifica:

1. ✅ Backend corriendo en el puerto correcto
2. ✅ MongoDB conectada
3. ✅ Variables de entorno configuradas
4. ✅ Rutas registradas en `app.ts`
5. ✅ Frontend conectado al backend correcto

## 🎉 ¡Listo!

El sistema de descuentos está completamente funcional y listo para usar. Puedes comenzar a aplicar descuentos desde el panel de administración en `/admin/descuentos`.
