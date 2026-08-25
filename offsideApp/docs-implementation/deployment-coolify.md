# Despliegue en Coolify (VPS)

Cómo se despliega Offside Store en un VPS con Coolify, que es la infraestructura
decidida en DEC-012 / `tech-stack.md` §5. **Fecha: 2026-08-25.**

## Artefactos

| Archivo         | Rol                                                       |
| --------------- | --------------------------------------------------------- |
| `Dockerfile`    | Imagen de producción, multi-stage (deps → build → runner) |
| `.dockerignore` | Deja afuera `node_modules`, artefactos y **`.env`**       |

**El contexto de build es `offsideApp/`, no la raíz del repo.** La raíz de git
tiene `docs/` y `design/`; el monorepo vive un nivel más abajo. En Coolify eso
es el **Base Directory**.

## Configuración en Coolify

1. **Recursos**: agregar **PostgreSQL 17** y **Redis 8** (mismas versiones que
   `docker-compose.yml`, para no descubrir diferencias en producción).
2. **Aplicación**: origen el repo de GitHub, rama `main`.

| Setting             | Valor         |
| ------------------- | ------------- |
| Build Pack          | `Dockerfile`  |
| Base Directory      | `offsideApp`  |
| Dockerfile Location | `Dockerfile`  |
| Puerto expuesto     | `3000`        |
| Health Check Path   | `/api/health` |

3. **Variables de entorno** (Coolify las inyecta en el contenedor):

```
DATABASE_URL=postgresql://<usuario>:<password>@<host-postgres>:5432/<db>
REDIS_URL=redis://<host-redis>:6379
APP_ENV=production
APP_URL=https://<dominio>
AUTH_SESSION_SECRET=<openssl rand -base64 32>
TOKEN_ENCRYPTION_KEY=<openssl rand -base64 32>
MERCADOPAGO_CLIENT_ID=<APP_ID>
MERCADOPAGO_CLIENT_SECRET=<secreto>
MERCADOPAGO_REDIRECT_URI=https://<dominio>/api/sellers/mercadopago/callback
MERCADOPAGO_WEBHOOK_SECRET=<secreto del panel de MP>
```

⚠️ `TOKEN_ENCRYPTION_KEY` debe ser **base64 de 32 bytes**. Una clave hex de 64
caracteres decodifica a 48 bytes y el código la rechaza al arrancar.

⚠️ El `.env` local **no** viaja en la imagen: está en `.dockerignore`.

4. **Mercado Pago**: la Redirect URI y la URL del webhook del panel tienen que
   apuntar al dominio del deploy. MP exige coincidencia exacta.

## Decisiones de la imagen

### Las migraciones corren al arrancar el contenedor

```
CMD npm run db:migrate && npm start -w @offside/web
```

Drizzle lleva su propia tabla de control: reejecutarlas es idempotente y sólo
aplica lo que falta. **Si fallan, el contenedor no levanta** — preferible a
servir contra un esquema que no es el que el código espera.

### No se usa `output: 'standalone'`

El migrador corre con `tsx` sobre `packages/database/src/migrate.ts`, que es la
única vía autorizada para tocar el esquema (CLAUDE.md §6). Un standalone dejaría
afuera `tsx` y el código de migraciones, y obligaría a **duplicar el migrador en
JavaScript**. Se prefiere una imagen más grande (~1,3 GB) antes que dos
implementaciones del mismo migrador. Si algún día pesa, se resuelve compilando
el migrador, no duplicándolo.

### `DATABASE_URL` y `REDIS_URL` con valores ficticios en el build

`next build` evalúa los módulos de las rutas al recolectar page data, y algunos
leen el entorno al importarse (`auth.schemas.ts` lee `AUTH_PASSWORD_MIN_LENGTH`).
`@offside/config` valida el objeto completo, así que sin esas dos variables el
build falla. La imagen las define con valores **ficticios y locales**: nada se
conecta a ellas y en runtime las reemplaza lo que inyecta Coolify. Es el mismo
patrón que ya usa el job de build de CI.

### `turbo.json` declara esas dos variables en `globalEnv`

Turborepo filtra el entorno: lo que no está declarado no llega a la tarea. En
local y en CI el build funcionaba igual porque `next.config.ts` lee el `.env`
del disco, pero **en la imagen no hay `.env`** y las variables se perdían.
Declararlas también hace que la caché de Turbo se invalide correctamente cuando
cambian.

## Verificado

La imagen se construyó y se corrió contra el PostgreSQL y el Redis locales:
migraciones aplicadas, `/api/health` en `200` con `database: up` y `redis: up`, y
`GET /api/auth/me` respondiendo `401` sin sesión.

## Lo que NO está listo para usuarios reales

- **No hay envío de emails.** El token de verificación se genera pero no se
  manda, y BR-001 exige email verificado para operar: **nadie puede completar el
  alta**. Es el bloqueo más duro para un uso real.
- **Ningún vendedor puede aprobarse** (TS-001): hay que marcarlo a mano en la
  base, como hacen los tests.
- **El frontend es un placeholder**: hoy esto es una API.
- **Sin refresh de tokens de MP**: la conexión de un vendedor muere a los 180
  días.
- El **stock no se descuenta** al aprobarse un pago.

Con credenciales de **TEST** de Mercado Pago esto es un entorno de prueba
perfectamente útil. Con credenciales de producción, mueve dinero real.
