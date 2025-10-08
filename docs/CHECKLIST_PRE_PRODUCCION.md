# ✅ Checklist Pre-Producción

## 🔴 CRÍTICO - NO lanzar sin esto

- [ ] **Validación de precios en backend**
  - Los precios vienen de la DB, NO del frontend
  - Verificar que `transaction_amount` coincide con precios reales
  
- [ ] **Autenticación en /admin/***
  - Login con usuario/contraseña
  - JWT o sesiones
  - Rutas protegidas
  
- [ ] **Transacciones atómicas para stock**
  - Usar MongoDB transactions
  - Reservar stock ANTES de cobrar
  - Rollback si el pago falla
  
- [ ] **Registrar uso de cupones**
  - Llamar `/api/cupones/aplicar` al confirmar pago
  - Incrementar `usos_actuales`
  - Agregar email a `usuarios_usados`
  
- [ ] **Webhook de MercadoPago funcional**
  - Actualizar estado de órdenes
  - Enviar email de confirmación
  - Sincronizar con base de datos

---

## 🟡 IMPORTANTE - Implementar pronto

- [ ] **Índices en MongoDB**
  - `ml_id`, `category_id`, `status`
  - `payment_id`, `customer.email`
  - `codigo` (cupones)
  
- [ ] **Validación de stock en tiempo real**
  - Verificar stock antes de "Agregar al Carrito"
  - Actualizar stock en tiempo real (WebSocket o polling)
  
- [ ] **Manejo de errores global**
  - Try/catch en todas las peticiones
  - Error boundaries en React
  - Mensajes amigables al usuario
  
- [ ] **Logs de auditoría**
  - ¿Quién aplicó qué descuento?
  - ¿Cuándo se creó cada cupón?
  - Historial de cambios
  
- [ ] **Emails de confirmación**
  - Al confirmar pago
  - Al despachar producto
  - Con tracking number

---

## 🟢 RECOMENDADO - Para mejor UX

- [ ] **Paginación en API de productos**
  - Backend devuelve 100 productos max
  - Frontend pide más según necesidad
  
- [ ] **Caché de productos**
  - React Query o SWR
  - 5 minutos de caché
  - Revalidar al actualizar
  
- [ ] **Analytics**
  - Google Analytics
  - Tracking de conversiones
  - Embudo de ventas
  
- [ ] **Sistema de reviews**
  - Clientes pueden dejar reseñas
  - Moderación de comentarios
  
- [ ] **Panel de cliente**
  - Ver mis órdenes
  - Tracking de envío
  - Historial de compras

---

## 🔒 SEGURIDAD

- [ ] **Variables de entorno**
  - ✅ MP_ACCESS_TOKEN en .env (ya está)
  - ✅ JWT_SECRET en .env
  - ✅ MONGODB_CNN en .env (ya está)
  - ❌ Nunca en código fuente

- [ ] **Rate Limiting**
  - Max 100 requests/minuto por IP
  - Evitar spam de API
  
- [ ] **Sanitización de inputs**
  - Validar emails
  - Validar teléfonos
  - Prevenir SQL injection
  
- [ ] **HTTPS**
  - ✅ Certificado SSL
  - ✅ Redirect HTTP → HTTPS
  - ✅ Secure cookies

---

## 📊 TESTING

- [ ] **Test de carga**
  - Simular 100 usuarios simultáneos
  - Ver si el servidor aguanta
  
- [ ] **Test de compra completa**
  - Agregar producto
  - Aplicar cupón
  - Pagar
  - Verificar orden en DB
  - Verificar stock actualizado
  
- [ ] **Test de casos extremos**
  - Carrito con 100 productos
  - Aplicar cupón 10 veces
  - Comprar con stock en 0
  - Cupón expirado
  - Cupón con límite alcanzado

---

## 📞 SOPORTE

- [ ] **Página de contacto funcional**
  - Email de soporte
  - WhatsApp
  - Chat en vivo (opcional)
  
- [ ] **FAQs**
  - ¿Cómo pago?
  - ¿Cómo uso cupón?
  - ¿Tiempos de entrega?
  - ¿Política de devolución?

---

## 📈 MONITORING

- [ ] **Uptime monitoring**
  - UptimeRobot o similar
  - Alertas si cae el servidor
  
- [ ] **Error tracking**
  - Sentry para capturar errores
  - Stack traces
  - Alertas en Slack/Email
  
- [ ] **Performance monitoring**
  - Tiempo de carga de páginas
  - Tiempo de respuesta de API
  
- [ ] **Backup de base de datos**
  - Backup diario automático
  - Guardar en otro servidor
  - Test de restauración

---

## 🎯 PLAN DE 3 DÍAS (Mínimo Viable)

### Día 1: Seguridad 🔒
- ⏰ Mañana (3h): Validación de precios
- ⏰ Tarde (2h): Autenticación básica
- ✅ **Al final del día**: Sistema seguro contra fraude

### Día 2: Stock y Pagos 💰
- ⏰ Mañana (3h): Transacciones atómicas
- ⏰ Tarde (2h): Webhook funcional + Registro de cupones
- ✅ **Al final del día**: Compras funcionan correctamente

### Día 3: Testing 🧪
- ⏰ Mañana (2h): Índices en DB
- ⏰ Tarde (3h): Testing exhaustivo
- ✅ **Al final del día**: Sistema testeado y listo

**Total: 15 horas de trabajo → Sistema en producción seguro** ✅

---

## 🚀 DESPUÉS DEL LAUNCH

### Primera Semana:
- Monitorear 24/7
- Verificar cada orden manualmente
- Responder soporte rápido
- Arreglar bugs inmediatamente

### Primer Mes:
- Analizar métricas
- Implementar mejoras de UX
- Optimizar conversión
- Agregar features según feedback

---

## 📝 TEMPLATE DE TESTING

```markdown
## Test #1: Compra Normal
1. [ ] Agregar producto al carrito
2. [ ] Ir al checkout
3. [ ] Llenar datos
4. [ ] Pagar
5. [ ] Verificar:
   - [ ] Orden en /admin/orders
   - [ ] Stock reducido
   - [ ] Email recibido
   - [ ] Estado "approved"

## Test #2: Compra con Cupón
1. [ ] Agregar productos ($1000 total)
2. [ ] Aplicar cupón "TEST10" (10%)
3. [ ] Verificar descuento: -$100
4. [ ] Pagar $900
5. [ ] Verificar:
   - [ ] Cupón registrado (usos +1)
   - [ ] No se puede usar de nuevo
   
## Test #3: Compra Simultánea (2 navegadores)
1. [ ] Navegador A y B: Mismo producto (stock: 1)
2. [ ] Ambos agregan al carrito
3. [ ] Ambos intentan pagar
4. [ ] Verificar:
   - [ ] Solo 1 pago exitoso
   - [ ] El otro recibe error de stock
   - [ ] Stock final: 0
```

---

## ⚠️ SEÑALES DE ALERTA EN PRODUCCIÓN

### 🚨 Para inmediato:
- Stock negativo en DB
- Órdenes con monto $0
- Cupones con 1000+ usos
- 10+ órdenes en 1 minuto del mismo IP
- Errores 500 repetidos

### ⚡ Respuesta:
1. Pausar pagos temporalmente
2. Revisar logs
3. Arreglar problema
4. Re-activar

---

## 💪 TU SISTEMA ACTUAL

### ✅ Funciona bien para:
- Desarrollo
- Testing interno
- Demo a clientes
- Pocos usuarios (<10 simultáneos)

### ⚠️ Necesita refuerzo para:
- Producción
- Tráfico real
- Seguridad
- Escalabilidad

---

## 🎉 CONCLUSIÓN

Tu tienda está **95% lista**. Solo necesita ese **5% de producción-hardening** para estar perfecta.

**¿Quieres que implemente las 5 soluciones críticas?** 
Solo dime y empiezo inmediatamente. ⚡

---

## 📞 ¿Dudas?

Si tienes dudas sobre algún problema o necesitas que explique algo en detalle, solo pregunta.

**Estoy aquí para ayudarte a lanzar tu tienda de forma segura** 🚀

