# Sistema de Gestión de Clientes

Este documento describe el nuevo sistema de gestión de clientes implementado en la tienda virtual.

## 📋 Descripción

Se ha creado un modelo específico para los clientes que permite:
- Gestión independiente de datos de clientes
- Historial de compras y estadísticas
- Preferencias de comunicación
- Integración con el sistema de órdenes existente

## 🗂️ Archivos Creados

### Modelos
- `models/Cliente.ts` - Modelo principal de cliente con todas las propiedades necesarias

### Servicios
- `services/clienteService.ts` - Lógica de negocio para operaciones con clientes

### Rutas
- `routes/clientes.ts` - Endpoints REST para gestión de clientes

### Scripts
- `scripts/migrarClientes.ts` - Script para migrar datos existentes desde órdenes

## 🚀 Características del Modelo de Cliente

### Información Básica
- Nombre y apellido
- Email (único)
- Teléfono
- Dirección completa

### Información Adicional
- Fecha de nacimiento
- Género
- Fecha de registro
- Última actividad
- Estado activo/inactivo

### Preferencias
- Notificaciones por email
- Notificaciones por SMS
- Newsletter
- Idioma preferido

### Historial de Compras
- Total de compras
- Total gastado
- Número de órdenes

### Datos de MercadoLibre
- ID de usuario de ML (opcional)
- Métodos de pago guardados

## 🔌 Endpoints Disponibles

### GET /api/clientes
Obtener lista de clientes con paginación y filtros
- Query params: `pagina`, `limite`, `activo`, `ciudad`, `departamento`, `busqueda`

### GET /api/clientes/estadisticas
Obtener estadísticas generales de clientes

### GET /api/clientes/:id
Obtener cliente específico por ID

### GET /api/clientes/email/:email
Obtener cliente por email

### POST /api/clientes
Crear nuevo cliente

### PUT /api/clientes/:id
Actualizar cliente existente

### DELETE /api/clientes/:id
Eliminar cliente (soft delete)

### POST /api/clientes/buscar
Buscar cliente por email o teléfono

### POST /api/clientes/desde-orden
Crear o actualizar cliente desde datos de orden

## 📊 Migración de Datos

Para migrar los datos existentes de clientes desde las órdenes:

```bash
# Compilar TypeScript
npx tsc

# Ejecutar migración
node dist/scripts/migrarClientes.js
```

## 🔧 Integración con Órdenes

El sistema está diseñado para trabajar junto con el modelo de órdenes existente:

1. **Creación automática**: Cuando se procesa una orden, se crea o actualiza automáticamente el cliente
2. **Actualización de estadísticas**: Las compras actualizan automáticamente las estadísticas del cliente
3. **Datos consistentes**: Los datos del cliente se mantienen sincronizados

## 📈 Beneficios

1. **Gestión centralizada**: Todos los datos de clientes en un solo lugar
2. **Historial completo**: Seguimiento de todas las compras del cliente
3. **Análisis de datos**: Estadísticas y métricas de clientes
4. **Comunicación personalizada**: Preferencias de notificaciones
5. **Escalabilidad**: Fácil agregar nuevas funcionalidades

## 🛠️ Uso en el Frontend

### Crear Cliente
```javascript
const nuevoCliente = {
  nombre: "Juan",
  apellido: "Pérez",
  email: "juan@example.com",
  telefono: "099123456",
  direccion: {
    calle: "Av. 18 de Julio",
    numero: "1234",
    codigo_postal: "11000",
    ciudad: "Montevideo",
    departamento: "Montevideo",
    pais: "Uruguay"
  }
};

const response = await fetch('/api/clientes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(nuevoCliente)
});
```

### Obtener Clientes
```javascript
const response = await fetch('/api/clientes?pagina=1&limite=10');
const data = await response.json();
```

### Buscar Cliente
```javascript
const response = await fetch('/api/clientes/buscar', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'juan@example.com' })
});
```

## 🔒 Seguridad

- Validación de datos en todos los endpoints
- Sanitización de inputs
- Validación de emails y teléfonos
- Soft delete para preservar datos históricos
- Exclusión de métodos de pago en consultas generales

## 📝 Notas Importantes

1. El email es único en el sistema
2. Los datos se validan antes de guardar
3. Las estadísticas se actualizan automáticamente
4. El sistema es compatible con el flujo de órdenes existente
5. Se mantiene la compatibilidad con MercadoLibre
