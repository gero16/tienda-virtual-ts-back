# Autenticación y Administración de Usuarios

## Endpoints

- POST `/auth/login`
  - body: `{ email, password }`
  - retorna: `{ token, user }`

- POST `/auth/register-admin`
  - Solo si no existe ningún admin.
  - body: `{ nombre, email, password }`
  - retorna: `{ token, user }`

- POST `/auth/create-admin` (requiere Bearer token de admin)
  - body: `{ nombre, email, password }`
  - retorna: `{ success, user }`

- GET `/auth/me` (requiere Bearer token)
  - retorna: `{ user }`

## Protección de rutas

Se aplicó `authenticate` + `authorize('admin')` en:
- `routes/descuentos.ts`: `POST /aplicar`, `POST /quitar`, `PUT /actualizar`
- `routes/cupones.ts`: `POST /crear`, `POST /aplicar`, `PUT /actualizar/:id`, `PATCH /toggle/:id`, `DELETE /eliminar/:id`

## Variables de entorno

- `JWT_SECRET` (requerido)
- `JWT_EXPIRES_IN` (opcional, por defecto `7d`)
- `SEED_ADMIN` (`true|false`)
- `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (requeridos si `SEED_ADMIN=true` y no hay admin)

## Crear el primer admin

Opción A (seeding):
- Configura en `.env`:
```
SEED_ADMIN=true
ADMIN_NAME=Tu Nombre
ADMIN_EMAIL=admin@tu-dominio.com
ADMIN_PASSWORD=una-contraseña-segura
JWT_SECRET=un-secreto-muy-seguro
```
- Inicia el servidor. Si no existen admins, se creará uno.

Opción B (endpoint):
- Llama a `POST /auth/register-admin` con `{ nombre, email, password }` si no hay admins.

## Autorización en el frontend

- Enviar header: `Authorization: Bearer <token>` para rutas protegidas.
- Guardar el token de manera segura (ej. localStorage/secure storage) y refrescarlo según `JWT_EXPIRES_IN`.
