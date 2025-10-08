# 🚨 Problemas con Descuentos + Cupones + Validación de Precios

## 📋 Problemas Identificados

---

## 🔴 PROBLEMA #1: Cupones NO Son Validados en Backend

### 🎯 Situación Actual:

```typescript
// Frontend aplica cupón:
Subtotal productos: $2500
Cupón VERANO20 (20%): -$500
Total a pagar: $2000 ✅

// Backend valida:
Total calculado (productos): $2500
Total recibido (frontend): $2000
Diferencia: $500

❌ Backend detecta como FRAUDE (pero es cupón legítimo)
```

### 💥 Resultado:
```
Cliente legítimo con cupón válido
→ Sistema lo rechaza como fraude
→ Cliente no puede comprar
→ Pérdida de venta
```

### ✅ Solución Necesaria:

```typescript
// En routes/api.ts - VALIDAR CUPÓN EN BACKEND TAMBIÉN

const { cupon_codigo, cupon_email } = req.body;

// Calcular total de productos
let totalCalculado = calcularTotalProductos();

// SI hay cupón, validarlo y aplicarlo
if (cupon_codigo) {
  const cuponReal = await CuponModel.findOne({ 
    codigo: cupon_codigo.toUpperCase(),
    activo: true 
  });
  
  if (cuponReal) {
    // Validar todas las condiciones
    const ahora = new Date();
    
    // ✅ Validar fechas
    if (cuponReal.fecha_fin && ahora > cuponReal.fecha_fin) {
      throw new Error('Cupón expirado');
    }
    
    // ✅ Validar usos
    if (cuponReal.usos_maximos && cuponReal.usos_actuales >= cuponReal.usos_maximos) {
      throw new Error('Cupón agotado');
    }
    
    // ✅ Validar monto mínimo
    if (cuponReal.monto_minimo_compra && totalCalculado < cuponReal.monto_minimo_compra) {
      throw new Error(`Monto mínimo: $${cuponReal.monto_minimo_compra}`);
    }
    
    // ✅ Calcular descuento REAL del cupón
    let descuentoCupon = 0;
    if (cuponReal.tipo_descuento === 'porcentaje') {
      descuentoCupon = totalCalculado * (cuponReal.valor_descuento / 100);
    } else {
      descuentoCupon = cuponReal.valor_descuento;
    }
    
    // Aplicar descuento al total
    totalCalculado -= descuentoCupon;
    
    console.log(colors.green(`✅ Cupón validado: ${cuponReal.codigo}`));
    console.log(colors.green(`   Descuento: $${descuentoCupon}`));
  } else {
    // Cupón no existe pero cliente lo envió
    throw new Error(`Cupón "${cupon_codigo}" no existe o no está activo`);
  }
}

// AHORA comparar con transaction_amount
const diferencia = Math.abs(totalCalculado - transaction_amount);
if (diferencia > 0.10) {
  throw new Error('Monto no coincide');
}
```

---

## 🔴 PROBLEMA #2: Race Condition en Descuentos

### 🎯 Situación:

```
Cliente A agrega producto al carrito:
  Precio en ese momento: $1000 (con 20% descuento)
  ↓
Cliente A va al checkout (tarda 5 minutos)
  ↓
MIENTRAS TANTO: Admin quita el descuento
  Precio ahora: $1250 (sin descuento)
  ↓
Cliente A intenta pagar $1000
  ↓
Backend valida: Precio en DB = $1250
Diferencia: $250
❌ Rechazado como "fraude"
```

### 💥 Resultado:
```
Cliente confundido: "¿Por qué no puedo pagar?"
Abandona la compra
Pérdida de venta
```

### ✅ Soluciones Posibles:

#### Opción A: Advertir al Cliente
```typescript
// En CheckoutPage.tsx
useEffect(() => {
  // Revalidar precios antes de pagar
  const validarPreciosActuales = async () => {
    const preciosActuales = await fetch('/ml/productos');
    
    for (const item of cartItems) {
      const productoActual = preciosActuales.find(p => p.ml_id === item.ml_id);
      
      if (productoActual.price !== item.price) {
        alert(`⚠️ El precio de ${item.name} cambió de $${item.price} a $${productoActual.price}. Actualiza tu carrito.`);
      }
    }
  };
  
  validarPreciosActuales();
}, []);
```

#### Opción B: Aceptar Precio del Carrito (Más Generoso)
```typescript
// Backend guarda "precio al momento de agregar"
// Si cambió, honrar el precio original por X minutos

const TIEMPO_GRACIA = 30 * 60 * 1000; // 30 minutos

if (precio_cambio && tiempo_en_carrito < TIEMPO_GRACIA) {
  // Usar precio original del carrito
  console.log('Honrando precio antiguo por tiempo en carrito');
  precioFinal = precio_carrito;
} else {
  // Usar precio actual
  precioFinal = precio_db;
}
```

#### Opción C: Bloquear Cambios Durante Compras
```typescript
// Al iniciar checkout, "congelar" precios por 10 minutos
await ProductoModel.updateOne(
  { ml_id: product_id },
  { 
    precio_bloqueado_hasta: new Date(Date.now() + 10*60*1000),
    precio_bloqueado: precio_actual
  }
);

// Admin no puede cambiar descuentos si hay bloqueo activo
```

---

## 🔴 PROBLEMA #3: Cupón Aplicado Pero No Enviado al Backend

### 🎯 Situación:

```
Cliente en checkout:
1. Aplica cupón "VERANO20" (20% OFF)
2. Ve total: $2000 (de $2500)
3. Hace clic en "Pagar"

Frontend envía:
{
  transaction_amount: 2000,
  items: [...],
  // ❌ NO envía info del cupón aplicado
}

Backend:
Total calculado: $2500
Total recibido: $2000
Diferencia: $500
❌ RECHAZA como fraude
```

### ✅ Solución:

```typescript
// 1. Modificar CheckoutPage.tsx para enviar cupón
const handlePaymentSubmit = async ({ formData }) => {
  return originalOnSubmit(
    { formData },
    cartItems,
    customerData,
    cuponAplicado // ← AGREGAR CUPÓN
  );
};

// 2. Modificar hooks/useMercadoPago.ts
const onSubmit = async (formData, cartItems, customerData, cuponAplicado) => {
  await fetch('/api/process_payment', {
    method: 'POST',
    body: JSON.stringify({
      ...formData,
      items: cartItems,
      customer: customerData,
      cupon_codigo: cuponAplicado?.cupon?.codigo, // ← ENVIAR
      cupon_descuento: cuponAplicado?.descuento
    })
  });
};

// 3. Backend valida cupón (ya mostrado arriba)
```

---

## 🔴 PROBLEMA #4: Doble Descuento No Validado

### 🎯 Situación:

```
Producto: Remera
Precio original: $1000
Descuento en producto: 20% → $800 (guardado en DB)

Cliente:
1. Agrega remera: $800
2. Aplica cupón "EXTRA10": -10% → $720
3. Intenta pagar: $720

Backend:
Precio en DB: $800
Total calculado: $800
Total recibido: $720
Diferencia: $80
❌ Rechazado (pero el cupón es real)
```

### ✅ Solución:

Validar cupón EN BACKEND (como mostramos en Problema #1).

---

## 🟡 PROBLEMA #5: Cliente Usa Cupón Vencido (Cached)

### 🎯 Situación:

```
09:00 - Cliente valida cupón "FLASH24H":
  Frontend: ✅ Válido
  Guarda en state: cuponAplicado

11:00 - Cupón expira (fecha_fin alcanzada)

11:30 - Cliente va a pagar (2.5 horas después)
  Frontend envía cupón (todavía en state)
  Backend: ❌ Cupón expiró
  
Resultado: Cliente confundido
```

### ✅ Solución:

```typescript
// Frontend: Revalidar cupón antes de pagar
const handleSubmit = async (e) => {
  e.preventDefault();
  
  // Revalidar cupón si existe
  if (cuponAplicado) {
    const revalidacion = await aplicarCupon(
      cuponAplicado.cupon.codigo, 
      customerData.email
    );
    
    if (!revalidacion.valido) {
      alert(`⚠️ El cupón ${cuponAplicado.cupon.codigo} ya no es válido: ${revalidacion.error}`);
      quitarCupon();
      return;
    }
  }
  
  // Continuar con pago...
};
```

---

## 🟡 PROBLEMA #6: Admin Cambia Descuento Durante Compra

### 🎯 Situación:

```
10:00 - Cliente ve producto con 30% descuento:
  Precio: $700 (de $1000)
  Agrega al carrito

10:05 - Admin cambia descuento a 10%:
  Nuevo precio en DB: $900

10:10 - Cliente intenta pagar $700:
  Backend valida: $900
  Diferencia: $200
  ❌ Rechazado
  
Cliente: "Pero el precio era $700!"
```

### ✅ Soluciones:

#### Opción A: Advertir al Cliente
```typescript
// Antes de pagar, verificar precios actuales
const preciosActualizados = await verificarPreciosActuales();

if (hayCambios) {
  mostrarModal({
    titulo: "⚠️ Precios Actualizados",
    mensaje: "Algunos precios cambiaron. ¿Deseas continuar?",
    cambios: [
      { producto: "Remera", antes: "$700", ahora: "$900" }
    ],
    acciones: ["Actualizar Carrito", "Cancelar"]
  });
}
```

#### Opción B: Honrar Precio Original (Tiempo Limitado)
```typescript
// Guardar timestamp cuando se agregó al carrito
interface CartItem {
  // ... campos existentes
  agregado_en: Date;
  precio_al_agregar: number;
}

// Backend: Si pasaron menos de 30 min, usar precio original
const tiempoEnCarrito = Date.now() - item.agregado_en;
const TIEMPO_GRACIA = 30 * 60 * 1000; // 30 minutos

if (tiempoEnCarrito < TIEMPO_GRACIA) {
  console.log('Honrando precio original por tiempo en carrito');
  precioFinal = item.precio_al_agregar;
} else {
  precioFinal = precio_db_actual;
}
```

---

## 🔴 PROBLEMA #7: Cálculo de Cupón Inconsistente

### 🎯 Situación:

```javascript
// Frontend calcula:
Productos: $2500
Cupón 20%: $2500 × 0.20 = $500
Total: $2000

// Backend calcula:
Productos: $2500
Cupón 20%: Math.round($2500 × 0.20) = $500
Total: $2000

// Pero con redondeos complejos:
Productos: $2537.83
Frontend: $2537.83 × 0.20 = $507.566 → $507.57
Backend: $2537.83 × 0.20 = $507.566 → $507.57

// JavaScript puede dar resultados ligeramente diferentes
Frontend: $2030.26
Backend: $2030.25
Diferencia: $0.01
```

### ✅ Solución:
Tolerancia de $0.10 ya implementada ✅

Pero mejor: **Usar mismo código de cálculo** en frontend y backend.

---

## 🔴 PROBLEMA #8: Doble Descuento Malicioso

### 🎯 Ataque Posible:

```javascript
// Producto tiene descuento del 20%:
DB: $800 (precio con descuento)

Cliente malicioso:
1. Ve precio: $800
2. Modifica en DevTools: cartItems[0].price = 640
   (simula un descuento adicional del 20%)
3. Aplica cupón legítimo "EXTRA10": -10%
   Total calculado en frontend: $576
4. Intenta pagar $576

Backend debería detectar:
Precio real: $800
Cupón 10%: $80
Total esperado: $720
Total recibido: $576
Diferencia: $144
✅ FRAUDE DETECTADO
```

### ✅ Validación Actual:
**Ya funciona** ✅ - La validación de precios detecta la modificación.

---

## 🟡 PROBLEMA #9: Descuento Removido Durante Checkout

### 🎯 Situación:

```
Cliente:
1. Agrega producto con 50% descuento: $500 (de $1000)
2. Va al checkout
3. Llena formulario (tarda 5 minutos)

Admin (mientras tanto):
4. Quita el descuento
5. Precio en DB ahora: $1000

Cliente:
6. Hace clic en "Pagar" - Espera pagar $500
7. Backend valida: $1000
8. ❌ Rechazado: Diferencia $500

Experiencia: HORRIBLE 😡
```

### ✅ Soluciones:

#### Opción A: Modal de Advertencia (Recomendado)
```typescript
// Antes de procesar pago, verificar precios
const verificarCambiosPrecios = async () => {
  const cambios = [];
  
  for (const item of cartItems) {
    const productoActual = await fetch(`/ml/productos/${item.ml_id}`);
    
    if (productoActual.price !== item.price) {
      cambios.push({
        producto: item.name,
        precioAnterior: item.price,
        precioNuevo: productoActual.price,
        diferencia: productoActual.price - item.price
      });
    }
  }
  
  if (cambios.length > 0) {
    // Mostrar modal
    const confirmacion = await mostrarModalCambiosPrecios(cambios);
    
    if (confirmacion) {
      actualizarCarritoConNuevosPrecios();
    } else {
      return; // Cancelar pago
    }
  }
};
```

#### Opción B: Guardar Snapshot del Precio
```typescript
// Cuando cliente hace checkout, guardar precios
await CheckoutSnapshot.create({
  session_id: session_id,
  items: cartItems.map(i => ({
    product_id: i.ml_id,
    precio_snapshot: i.price,
    timestamp: new Date()
  })),
  valido_hasta: new Date(Date.now() + 15*60*1000) // 15 min
});

// Backend usa snapshot si es reciente
const snapshot = await CheckoutSnapshot.findOne({ session_id });
if (snapshot && !snapshot.expirado) {
  // Usar precios del snapshot
} else {
  // Usar precios actuales
}
```

---

## 🟡 PROBLEMA #10: Cupón Alcanza Límite Entre Validación y Pago

### 🎯 Situación:

```
Cupón: FLASH100 (límite: 100 usos, usos actuales: 99)

Cliente A:
10:00:00 - Valida cupón FLASH100
  Backend: usos 99/100 ✅ Válido
  Frontend: Muestra descuento

Cliente B:
10:00:01 - Usa el cupón y PAGA
  usos: 100/100 (límite alcanzado)

Cliente A:
10:05:00 - Intenta pagar (5 min después)
  Backend valida de nuevo: usos 100/100
  ❌ "Cupón agotado"
  
Cliente A: "¡Pero me dijeron que era válido!"
```

### ✅ Solución:

#### Opción A: Reserva de Cupón
```typescript
// Al validar cupón, reservarlo temporalmente
await CuponModel.findOneAndUpdate(
  { codigo: 'FLASH100' },
  { 
    $push: { 
      reservas: {
        email: cliente_email,
        timestamp: new Date(),
        expira_en: new Date(Date.now() + 10*60*1000) // 10 min
      }
    }
  }
);

// Limpiar reservas expiradas
// Contar usos + reservas activas para validar límite
```

#### Opción B: Revalidar y Avisar
```typescript
// Frontend: Revalidar antes de confirmar pago
if (cuponAplicado) {
  const revalidacion = await revalidarCupon();
  
  if (!revalidacion.valido) {
    alert('⚠️ El cupón ya no está disponible');
    quitarCupon();
    return;
  }
}
```

---

## 🟢 PROBLEMA #11: Cupones Combinados con Descuentos

### 🎯 Situación:

```
¿Es válido aplicar cupón sobre producto con descuento?

Producto: $1000
Descuento automático: 20% → $800
Cupón adicional: 10%

Opción A: Cupón sobre precio con descuento
  $800 × 10% = $80
  Total: $720

Opción B: Cupón sobre precio original
  $1000 × 10% = $100
  Total: $700

¿Cuál es correcto?
```

### ✅ Decisión de Negocio:

Debes decidir:

1. **Permitir combo** (más generoso):
   ```typescript
   // Cupón se aplica sobre precio ya con descuento
   precioFinal = precio_con_descuento * (1 - cupon_porcentaje/100);
   ```

2. **No permitir combo** (más restrictivo):
   ```typescript
   if (producto.descuento?.activo && cupon) {
     throw new Error('No se pueden combinar descuentos de producto con cupones');
   }
   ```

3. **Cupón sobre precio original** (medio):
   ```typescript
   const precioBase = producto.descuento?.precio_original || producto.price;
   descuentoCupon = precioBase * (cupon_porcentaje/100);
   ```

---

## 📊 Resumen de Problemas

| # | Problema | Severidad | Estado Actual |
|---|----------|-----------|---------------|
| 1 | Cupones no validados en backend | 🔴 Alta | ❌ Sin solución |
| 2 | Race condition en descuentos | 🟡 Media | ❌ Sin solución |
| 3 | Cupón no enviado al backend | 🔴 Alta | ❌ Sin solución |
| 4 | Doble descuento malicioso | 🟢 Baja | ✅ Detectado |
| 5 | Descuento removido durante checkout | 🟡 Media | ❌ Sin solución |
| 6 | Cupón alcanza límite | 🟡 Media | ❌ Sin solución |
| 7 | Cálculo de cupón inconsistente | 🟢 Baja | ✅ Tolerancia |
| 8 | Combo descuento+cupón | 🟢 Baja | ⚠️ Decidir política |

---

## ✅ Soluciones Prioritarias a Implementar

### 🔴 URGENTE (Implementar Ya):

#### 1. Validar Cupones en Backend
```typescript
// Agregar al endpoint process_payment
if (cupon_codigo) {
  const cuponValidado = await validarCuponBackend(cupon_codigo, totalProductos);
  totalCalculado -= cuponValidado.descuento;
}
```

#### 2. Enviar Cupón al Backend
```typescript
// Modificar CheckoutPage y useMercadoPago
// Para que envíen cuponAplicado en el request
```

### 🟡 IMPORTANTE (Primera Semana):

#### 3. Revalidar Precios Antes de Pagar
```typescript
// Advertir al cliente si precios cambiaron
```

#### 4. Definir Política de Combinación
```typescript
// ¿Permitir descuento + cupón?
// Documentarlo claramente
```

---

## 🎯 Plan de Implementación Recomendado

### Implementación Inmediata:

```typescript
// routes/api.ts - Agregar después de validar precios de productos

// 🆕 VALIDAR CUPÓN SI SE ENVIÓ
if (req.body.cupon_codigo) {
  const cuponValidacion = await validarYAplicarCupon(
    req.body.cupon_codigo,
    req.body.cupon_email || customer?.email,
    totalCalculado
  );
  
  if (cuponValidacion.valido) {
    totalCalculado -= cuponValidacion.descuento;
    console.log(colors.green(`✅ Cupón validado: -$${cuponValidacion.descuento}`));
  } else {
    await session.abortTransaction();
    return res.status(400).json({ 
      error: `Cupón inválido: ${cuponValidacion.error}` 
    });
  }
}

// Comparar total (ahora incluye cupón)
const diferencia = Math.abs(totalCalculado - transaction_amount);
```

---

## 💡 Recomendación Final

### Para Producción Segura, Necesitas:

1. ✅ **Validación de precios de productos** (YA HECHO)
2. ❌ **Validación de cupones en backend** (FALTA)
3. ❌ **Enviar cupón aplicado al backend** (FALTA)
4. ⚠️ **Revalidación de precios pre-pago** (RECOMENDADO)
5. ⚠️ **Política clara de combo descuento+cupón** (DECIDIR)

---

## 🚀 ¿Implementamos las Soluciones?

Puedo implementar **ahora mismo**:

1. **Función de validación de cupones en backend**
2. **Modificar CheckoutPage para enviar cupón**
3. **Integrar validación en process_payment**
4. **Agregar revalidación de precios en frontend**

**¿Continúo con la implementación?** 🎯

Total tiempo estimado: ~30 minutos
Beneficio: Sistema 100% seguro con descuentos + cupones

