# 🎟️ Sistema de Cupones - Documentación Completa

## 📋 Resumen

Se ha implementado un **sistema completo de cupones de descuento** que permite al administrador crear códigos promocionales (como "VERANO2026") que los clientes pueden aplicar en el checkout para obtener descuentos.

---

## ✨ Características Implementadas

### Backend (Node.js + TypeScript + MongoDB)

1. **Modelo de Cupón** (`models/Cupon.ts`)
   - Código único del cupón (mayúsculas automáticas)
   - Descripción
   - Tipo de descuento: Porcentaje o Monto Fijo
   - Valor del descuento
   - Fechas de validez (inicio/fin)
   - Límites de uso (total y por usuario)
   - Monto mínimo de compra
   - Control de usuarios que ya usaron el cupón

2. **Rutas de API** (`routes/cupones.ts`)
   - `POST /api/cupones/crear` - Crear nuevo cupón
   - `GET /api/cupones/listar` - Listar todos los cupones
   - `POST /api/cupones/validar` - Validar un cupón
   - `POST /api/cupones/aplicar` - Registrar uso de cupón
   - `PUT /api/cupones/actualizar/:id` - Actualizar cupón
   - `PATCH /api/cupones/toggle/:id` - Activar/Desactivar
   - `DELETE /api/cupones/eliminar/:id` - Eliminar cupón
   - `GET /api/cupones/estadisticas` - Estadísticas

### Frontend (React + TypeScript)

1. **CartContext actualizado** - Maneja cupones globalmente
2. **CheckoutPage** - Input para aplicar cupones
3. **AdminCupones** - Panel completo de administración

---

## 🎯 Cómo Funciona

### Para el Administrador

#### 1. Acceder al Panel
```
/admin/cupones
```

#### 2. Crear un Cupón
El admin puede configurar:

- **Código**: Ej: "VERANO2026" (se convierte automáticamente a mayúsculas)
- **Descripción**: "Descuento especial de verano"
- **Tipo de Descuento**:
  - **Porcentaje**: 10%, 20%, 50%, etc.
  - **Monto Fijo**: $100, $500, etc.
- **Valor**: El número del descuento
- **Fechas**: Inicio y fin de validez (opcional)
- **Usos Máximos**: Cuántas veces se puede usar en total (opcional)
- **Usos por Usuario**: Cuántas veces puede usarlo el mismo cliente
- **Monto Mínimo**: Compra mínima requerida (opcional)

#### 3. Gestionar Cupones
- Ver lista de cupones activos e inactivos
- Activar/Desactivar cupones
- Eliminar cupones
- Ver estadísticas de uso

### Para el Cliente

#### 1. En el Checkout

```
┌────────────────────────────────────┐
│ Resumen del Pedido                 │
├────────────────────────────────────┤
│ Producto A    $1000                │
│ Producto B    $500                 │
├────────────────────────────────────┤
│ 🎟️ ¿Tienes un cupón?              │
│ [VERANO2026___] [Aplicar]          │ ← Ingresar código aquí
└────────────────────────────────────┘
```

#### 2. Aplicar Cupón
1. Cliente ingresa el código (ej: "verano2026")
2. Sistema valida automáticamente:
   - ✅ Que el cupón existe
   - ✅ Que está activo
   - ✅ Que no expiró
   - ✅ Que no alcanzó límite de usos
   - ✅ Que cumple monto mínimo
   - ✅ Que el usuario no excedió su límite
3. Si es válido, muestra el descuento

#### 3. Ver Descuento Aplicado

```
┌────────────────────────────────────┐
│ Subtotal:            $1500         │
│ 🎟️ Descuento (20%)  -$300         │ ← Descuento visible
│ Total a Pagar:       $1200         │ ← Total con descuento
└────────────────────────────────────┘
```

---

## 📊 Ejemplos de Cupones

### Ejemplo 1: Descuento Porcentual Simple
```javascript
Código: BIENVENIDO10
Descripción: 10% de descuento para nuevos clientes
Tipo: Porcentaje
Valor: 10%
Usos máximos: 100
Usos por usuario: 1
```

### Ejemplo 2: Descuento de Monto Fijo
```javascript
Código: VERANO2026
Descripción: $500 de descuento en compras de verano
Tipo: Monto Fijo
Valor: $500
Monto mínimo: $2000
Usos por usuario: 1
```

### Ejemplo 3: Flash Sale
```javascript
Código: FLASH24H
Descripción: 50% OFF solo por 24 horas
Tipo: Porcentaje
Valor: 50%
Fecha inicio: 2026-01-15
Fecha fin: 2026-01-16
Usos máximos: 50
```

### Ejemplo 4: Cliente VIP
```javascript
Código: VIP2026
Descripción: Descuento exclusivo para clientes VIP
Tipo: Porcentaje
Valor: 30%
Usos por usuario: 5 (puede usar 5 veces)
Sin fecha de expiración
```

---

## 🔧 API Endpoints

### Crear Cupón
```bash
POST https://poppy-shop-production.up.railway.app/api/cupones/crear
Content-Type: application/json

{
  "codigo": "VERANO2026",
  "descripcion": "Descuento de verano",
  "tipo_descuento": "porcentaje",
  "valor_descuento": 20,
  "fecha_inicio": "2026-01-01",
  "fecha_fin": "2026-03-31",
  "usos_maximos": 100,
  "monto_minimo_compra": 1000,
  "limite_por_usuario": 1
}
```

**Respuesta:**
```json
{
  "success": true,
  "message": "Cupón creado exitosamente",
  "cupon": {
    "_id": "...",
    "codigo": "VERANO2026",
    "activo": true,
    ...
  }
}
```

### Validar Cupón
```bash
POST https://poppy-shop-production.up.railway.app/api/cupones/validar
Content-Type: application/json

{
  "codigo": "VERANO2026",
  "monto_compra": 1500,
  "email_usuario": "cliente@email.com"
}
```

**Respuesta (Éxito):**
```json
{
  "valido": true,
  "cupon": {
    "_id": "...",
    "codigo": "VERANO2026",
    "descripcion": "Descuento de verano",
    "tipo_descuento": "porcentaje",
    "valor_descuento": 20
  },
  "descuento": 300,
  "monto_final": 1200
}
```

**Respuesta (Error):**
```json
{
  "valido": false,
  "error": "Este cupón ha expirado"
}
```

### Listar Cupones
```bash
GET https://poppy-shop-production.up.railway.app/api/cupones/listar
```

### Activar/Desactivar
```bash
PATCH https://poppy-shop-production.up.railway.app/api/cupones/toggle/{id}
```

### Eliminar
```bash
DELETE https://poppy-shop-production.up.railway.app/api/cupones/eliminar/{id}
```

---

## 🎨 Interfaz de Usuario

### Panel de Admin (`/admin/cupones`)

```
┌──────────────────────────────────────────────┐
│ 🎟️ Gestión de Cupones                       │
│                            [+ Crear Nuevo]   │
├──────────────────────────────────────────────┤
│                                              │
│ Formulario de Creación:                      │
│ ┌──────────────────────────────────────┐    │
│ │ Código: [VERANO2026___________]      │    │
│ │ Descripción: [Desc. de verano_]      │    │
│ │ Tipo: [Porcentaje ▼] Valor: [20__]% │    │
│ │ Fecha Inicio: [2026-01-01]           │    │
│ │ Fecha Fin: [2026-03-31]              │    │
│ │ Usos Máximos: [100__]                │    │
│ │ Monto Mínimo: [$1000_]               │    │
│ │          [Cancelar] [Crear Cupón]    │    │
│ └──────────────────────────────────────┘    │
│                                              │
│ Cupones Existentes (3):                      │
│ ┌──────────────────────────────────────┐    │
│ │ 🎟️ VERANO2026         [Activo]      │    │
│ │ Descuento de verano                  │    │
│ │ Descuento: 20%                       │    │
│ │ Válido hasta: 31/03/2026             │    │
│ │ Usos: 25 / 100                       │    │
│ │ [Desactivar] [Eliminar]              │    │
│ └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

### Checkout con Cupón

```
┌──────────────────────────────────────────────┐
│ Resumen del Pedido                           │
├──────────────────────────────────────────────┤
│ Producto A  x2                      $2000    │
│ Producto B  x1                      $500     │
├──────────────────────────────────────────────┤
│ 🎟️ ¿Tienes un cupón de descuento?          │
│ ┌──────────────────────────────┐            │
│ │ VERANO2026_____    [Aplicar]  │            │
│ └──────────────────────────────┘            │
│                                              │
│ ✅ VERANO2026                                │
│ Descuento de verano         [Quitar]         │
├──────────────────────────────────────────────┤
│ Subtotal:                  $2500             │
│ 🎟️ Descuento (20%)        -$500             │
│ Total a Pagar:             $2000             │
└──────────────────────────────────────────────┘
```

---

## 🔐 Validaciones del Sistema

### Validaciones al Crear Cupón
- ✅ Código único (no puede haber duplicados)
- ✅ Código se convierte a mayúsculas automáticamente
- ✅ Porcentaje entre 1-100 si es tipo porcentaje
- ✅ Monto fijo mayor a 0
- ✅ Fecha fin debe ser posterior a fecha inicio

### Validaciones al Aplicar Cupón
1. **Existencia**: El cupón debe existir en la base de datos
2. **Estado**: Debe estar activo
3. **Fechas**: Debe estar dentro del rango de validez
4. **Usos Totales**: No debe haber alcanzado el límite máximo
5. **Usos por Usuario**: El cliente no debe haber excedido su límite
6. **Monto Mínimo**: El carrito debe cumplir el monto mínimo (si aplica)

### Mensajes de Error
- "Cupón no encontrado"
- "Este cupón no está activo"
- "Este cupón aún no es válido"
- "Este cupón ha expirado"
- "Este cupón ha alcanzado su límite de usos"
- "Ya has usado este cupón el máximo de veces permitidas"
- "El monto mínimo de compra para este cupón es $X"

---

## 💾 Estructura de Base de Datos

### Colección: `cupones`

```javascript
{
  _id: ObjectId("..."),
  codigo: "VERANO2026",                    // Código único (mayúsculas)
  descripcion: "Descuento de verano",      // Descripción
  tipo_descuento: "porcentaje",            // "porcentaje" o "monto_fijo"
  valor_descuento: 20,                     // 20% o $20
  activo: true,                            // Estado activo/inactivo
  fecha_inicio: ISODate("2026-01-01"),     // Fecha de inicio
  fecha_fin: ISODate("2026-03-31"),        // Fecha de fin (opcional)
  usos_maximos: 100,                       // Límite total (opcional)
  usos_actuales: 25,                       // Veces usado
  monto_minimo_compra: 1000,               // Compra mínima (opcional)
  limite_por_usuario: 1,                   // Usos por cliente
  usuarios_usados: [                       // Emails de quienes lo usaron
    "cliente1@email.com",
    "cliente2@email.com",
    ...
  ],
  date_created: ISODate("2026-01-01"),
  date_updated: ISODate("2026-01-15")
}
```

---

## 🚀 Flujo Completo

### 1. Admin Crea Cupón
```
Admin → /admin/cupones → Llenar formulario → Crear
                                                ↓
                                         MongoDB guarda
```

### 2. Cliente Usa Cupón
```
Cliente → Checkout → Ingresa "VERANO2026" → Aplicar
                                                ↓
                            API valida (todas las verificaciones)
                                                ↓
                                  Válido → Descuento aplicado
                                                ↓
                                  Pago con descuento
                                                ↓
                            Se registra uso en MongoDB
```

### 3. Sistema Actualiza
```
Cada uso → usos_actuales++
        → usuarios_usados.push(email)
        → Si alcanza usos_maximos → No más usos permitidos
```

---

## 📈 Casos de Uso

### Caso 1: Primera Compra
**Objetivo**: Incentivar nuevos clientes

```javascript
{
  codigo: "PRIMERACOMPRA",
  descripcion: "15% en tu primera compra",
  tipo_descuento: "porcentaje",
  valor_descuento: 15,
  limite_por_usuario: 1,
  sin_fecha_expiracion: true
}
```

### Caso 2: Campaña Temporal
**Objetivo**: Aumentar ventas en temporada baja

```javascript
{
  codigo: "INVIERNO30",
  descripcion: "30% OFF en temporada de invierno",
  tipo_descuento: "porcentaje",
  valor_descuento: 30,
  fecha_inicio: "2026-06-01",
  fecha_fin: "2026-08-31",
  usos_maximos: 500
}
```

### Caso 3: Compras Grandes
**Objetivo**: Incentivar tickets altos

```javascript
{
  codigo: "COMPRAGRANDE",
  descripcion: "$1000 OFF en compras mayores a $5000",
  tipo_descuento: "monto_fijo",
  valor_descuento: 1000,
  monto_minimo_compra: 5000,
  limite_por_usuario: 3
}
```

---

## 🎯 Diferencias: Descuentos vs Cupones

| Característica | Descuentos | Cupones |
|----------------|------------|---------|
| **Aplicación** | Automática en productos seleccionados | Manual, cliente ingresa código |
| **Visibilidad** | Visible en la tienda (badge, precio tachado) | Solo en checkout |
| **Ubicación** | Página principal + Tienda | Checkout únicamente |
| **Control** | Por producto | Por compra total |
| **Límites** | Sin límite de uso | Con límites configurables |
| **Fecha** | Opcional | Opcional |
| **Usuario** | Todos ven el descuento | Solo quien tiene el código |

---

## 🔥 Mejoras Futuras (Opcionales)

1. **Cupones por Categoría**: Aplicar solo a ciertos productos
2. **Cupones Únicos**: Generar códigos únicos por usuario
3. **Combinación**: Permitir/Prohibir combinar con otros descuentos
4. **Compartir**: Botones para compartir cupones en redes sociales
5. **Histórico**: Ver historial de cupones usados por cliente
6. **Analytics**: Dashboard con métricas de uso de cupones
7. **Email Marketing**: Enviar cupones automáticos a clientes

---

## 📞 Rutas del Sistema

### Frontend
- `/admin/cupones` - Panel de administración
- `/checkout` - Aplicar cupón (integrado)

### Backend
- `/api/cupones/*` - Todas las operaciones de cupones

---

## ✅ Checklist de Implementación

- ✅ Modelo de Cupón en MongoDB
- ✅ Rutas API completas
- ✅ Validaciones de cupones
- ✅ CartContext con soporte de cupones
- ✅ CheckoutPage con input de cupón
- ✅ AdminCupones página completa
- ✅ Estilos CSS responsive
- ✅ Integración con sistema de pago
- ✅ Mensajes de error claros
- ✅ Documentación completa

---

## 🎉 ¡Sistema Listo!

El sistema de cupones está **100% funcional** y listo para usar. Los administradores pueden crear cupones desde `/admin/cupones` y los clientes pueden aplicarlos en el checkout.

**¡Felicitaciones! Ahora tienes un sistema profesional de cupones de descuento. 🚀**

