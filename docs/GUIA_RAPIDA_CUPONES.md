# 🚀 Guía Rápida - Sistema de Cupones

## ✅ ¿Qué es el Sistema de Cupones?

Un sistema donde **TÚ (admin) creas códigos** como "VERANO2026" que los **clientes ingresan en el checkout** para obtener descuentos.

---

## 📍 URLs Importantes

- **Panel Admin**: `/admin/cupones`
- **Checkout**: `/checkout` (donde el cliente aplica el cupón)
- **Panel Principal Admin**: `/admin` (tiene botón "Gestionar Cupones 🎟️")

---

## 🎯 Para el Administrador

### Paso 1: Crear un Cupón

#### Acceder
```
/admin → Botón "Gestionar Cupones 🎟️"
o directamente
/admin/cupones
```

#### Llenar el Formulario
```
┌─────────────────────────────────────────┐
│ ✨ Crear Nuevo Cupón                    │
├─────────────────────────────────────────┤
│ Código: [VERANO2026____________]        │ ← Inventas el código
│ Descripción: [Desc. de verano__]        │
│ Tipo: [Porcentaje ▼] Valor: [20_]%     │ ← 20% de descuento
│ Fecha Inicio: [2026-01-01]              │
│ Fecha Fin: [2026-03-31]                 │
│ Usos Máximos: [100______]               │ ← Total de usos permitidos
│ Usos por Usuario: [1__]                 │ ← Por cliente
│ Monto Mínimo: [$1000__]                 │ ← Opcional
│                                          │
│         [Cancelar] [Crear Cupón]        │
└─────────────────────────────────────────┘
```

### Paso 2: Ver Cupones Creados

```
┌────────────────────────────────────────────┐
│ 📋 Cupones Existentes (3 cupones)          │
├────────────────────────────────────────────┤
│ ┌────────────────────────────────────┐    │
│ │ 🎟️ VERANO2026      [Activo]       │    │
│ │ Descuento de verano                │    │
│ │ • Descuento: 20%                   │    │
│ │ • Válido hasta: 31/03/2026         │    │
│ │ • Usos: 25 / 100                   │    │
│ │ [Desactivar] [Eliminar]            │    │
│ └────────────────────────────────────┘    │
│                                            │
│ ┌────────────────────────────────────┐    │
│ │ 🎟️ FLASH24H        [Activo]       │    │
│ │ Flash sale 24 horas                │    │
│ │ • Descuento: 50%                   │    │
│ │ • Válido hasta: 16/01/2026         │    │
│ │ • Usos: 50 / 50  ← ¡AGOTADO!      │    │
│ │ [Desactivar] [Eliminar]            │    │
│ └────────────────────────────────────┘    │
└────────────────────────────────────────────┘
```

### Acciones Disponibles
- ✅ **Desactivar**: El cupón existe pero no se puede usar
- ✅ **Activar**: Reactivar un cupón desactivado
- ✅ **Eliminar**: Borrar permanentemente

---

## 👥 Para el Cliente

### Paso 1: Agregar Productos al Carrito
```
Cliente navega la tienda → Agrega productos → Ir al checkout
```

### Paso 2: En el Checkout
```
┌────────────────────────────────────────────┐
│ Resumen del Pedido                         │
├────────────────────────────────────────────┤
│ Remera Deportiva  x2            $2000      │
│ Short Adidas      x1            $500       │
├────────────────────────────────────────────┤
│ 🎟️ ¿Tienes un cupón de descuento?        │
│ ┌────────────────────────────┐            │
│ │ [VERANO2026___] [Aplicar]  │            │ ← Ingresa aquí
│ └────────────────────────────┘            │
└────────────────────────────────────────────┘
```

### Paso 3: Aplicar Cupón
Cliente escribe "verano2026" (en minúsculas o mayúsculas, da igual)
```
┌────────────────────────────────────────────┐
│ [VERANO2026___] [Aplicar] ← Clic aquí     │
└────────────────────────────────────────────┘
         ↓
    Validando...
         ↓
```

### Paso 4: Ver Descuento Aplicado
```
┌────────────────────────────────────────────┐
│ ✅ VERANO2026                [Quitar]      │ ← Cupón aplicado
│ Descuento de verano                        │
├────────────────────────────────────────────┤
│ Subtotal:              $2500               │
│ 🎟️ Descuento (20%)    -$500               │ ← Ahorro visible
│ Total a Pagar:         $2000               │ ← Precio final
└────────────────────────────────────────────┘
```

---

## 💡 Ejemplos Prácticos

### Ejemplo 1: Cupón de Bienvenida
```
ADMIN CREA:
  Código: BIENVENIDO10
  Tipo: Porcentaje
  Valor: 10%
  Usos por usuario: 1
  
CLIENTE USA:
  Compra: $3000
  Descuento: $300
  Paga: $2700
```

### Ejemplo 2: Flash Sale
```
ADMIN CREA:
  Código: FLASH50
  Tipo: Porcentaje
  Valor: 50%
  Fecha fin: Hoy + 24h
  Usos máximos: 50
  
CLIENTE USA:
  Compra: $2000
  Descuento: $1000
  Paga: $1000
```

### Ejemplo 3: Cupón Premium
```
ADMIN CREA:
  Código: VIP500
  Tipo: Monto Fijo
  Valor: $500
  Monto mínimo: $2000
  Usos por usuario: 5
  
CLIENTE USA:
  Compra: $2500 ✅ (cumple mínimo)
  Descuento: $500
  Paga: $2000
  
CLIENTE USA (2):
  Compra: $1500 ❌ (no cumple mínimo)
  Error: "El monto mínimo es $2000"
```

---

## 🎨 Tipos de Descuento

### 🔢 Porcentaje
```
Valor: 20
Tipo: Porcentaje
Compra: $1000
Descuento: $1000 × 20% = $200
Total: $800
```

### 💵 Monto Fijo
```
Valor: 500
Tipo: Monto Fijo
Compra: $2000
Descuento: $500 (fijo)
Total: $1500
```

---

## 🔒 Seguridad y Límites

### Control de Uso
```
CUPON: LIMITADO50
Usos máximos: 100
Usos por usuario: 1

Usuario A: Usa 1 vez ✅
Usuario A: Intenta usar 2da vez ❌ "Ya usaste este cupón"

100 personas lo usan → Cupón agotado
Persona 101: ❌ "Ha alcanzado su límite de usos"
```

### Control de Fechas
```
CUPON: VERANO2026
Inicio: 01/01/2026
Fin: 31/03/2026

Hoy: 15/12/2025 ❌ "Este cupón aún no es válido"
Hoy: 15/02/2026 ✅ Válido
Hoy: 15/04/2026 ❌ "Este cupón ha expirado"
```

### Control de Monto
```
CUPON: GRANDE1000
Monto mínimo: $5000

Compra: $3000 ❌ "El mínimo es $5000"
Compra: $6000 ✅ Cupón aplicado
```

---

## 🆚 Cuándo Usar Cada Sistema

### Usa DESCUENTOS cuando:
- ✅ Quieres que **todos** vean la oferta
- ✅ Es una rebaja de producto específico
- ✅ Quieres destacar visualmente en la tienda
- ✅ Es permanente o de largo plazo

### Usa CUPONES cuando:
- ✅ Quieres hacer **campañas exclusivas**
- ✅ Necesitas **controlar el alcance**
- ✅ Quieres **rastrear conversiones**
- ✅ Es para un **grupo específico** de clientes
- ✅ Necesitas **límites estrictos**

---

## 🤝 Puedes Combinar Ambos

**Ejemplo:**
```
Producto: Remera Deportiva
Precio original: $1000
Descuento automático: -20% → $800

Cliente en checkout:
  Subtotal: $800 (ya con descuento de producto)
  Cupón EXTRA10: -10% → -$80
  Total final: $720

¡Doble descuento! 🎉
```

---

## 🛠️ Comandos Útiles

### Probar en Terminal
```bash
# Listar cupones
curl https://poppy-shop-production.up.railway.app/api/cupones/listar

# Validar cupón
curl -X POST https://poppy-shop-production.up.railway.app/api/cupones/validar \
  -H "Content-Type: application/json" \
  -d '{"codigo":"VERANO2026","monto_compra":1500}'

# Crear cupón
curl -X POST https://poppy-shop-production.up.railway.app/api/cupones/crear \
  -H "Content-Type: application/json" \
  -d '{
    "codigo":"TEST10",
    "descripcion":"Cupón de prueba",
    "tipo_descuento":"porcentaje",
    "valor_descuento":10
  }'
```

---

## 📱 Responsive

Todo funciona en:
- 💻 Desktop
- 📱 Tablet
- 📱 Móvil

---

## 🎉 ¡Empieza Ahora!

1. Ve a `/admin/cupones`
2. Haz clic en **"+ Crear Nuevo Cupón"**
3. Crea tu primer cupón: **PRUEBA10** con 10% de descuento
4. Ve al checkout y pruébalo
5. ¡Verás el descuento aplicado inmediatamente!

**¡Disfruta tu nuevo sistema de cupones!** 🎟️✨

