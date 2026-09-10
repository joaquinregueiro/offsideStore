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
AWS_REGION=<region de SES, ej. us-east-1>
AWS_ACCESS_KEY_ID=<del usuario IAM con ses:SendEmail>
AWS_SECRET_ACCESS_KEY=<idem>
EMAIL_FROM_ADDRESS=<casilla del dominio verificado en SES>
EMAIL_FROM_NAME=Offside Store
S3_ENDPOINT=https://<cloudflare-account-id>.r2.cloudflarestorage.com
S3_BUCKET=<nombre del bucket en R2>
S3_ACCESS_KEY=<Access Key ID del token R2>
S3_SECRET_KEY=<Secret Access Key del token R2>
S3_PUBLIC_URL=https://<dominio publico del bucket>
S3_REGION=auto
```

⚠️ **LAS CREDENCIALES DE STORAGE Y LAS DE SES SON DE PROVEEDORES DISTINTOS.**
`AWS_*` es Amazon SES (emails); `S3_*` es Cloudflare R2 (fotos). Se llaman
`S3_*` porque nombran el PROTOCOLO, que R2 habla, no al proveedor. Mezclarlas es
un error facil y real: una `S3_ACCESS_KEY` que empieza con `AKIA` es de AWS IAM,
no de R2 —las de R2 son 32 caracteres hexadecimales sin prefijo—.

⚠️ **`S3_ENDPOINT` lleva el ACCOUNT ID de Cloudflare, no el Access Key ID.**
Los dos son 32 caracteres hex y se confunden. El Account ID esta en la URL del
panel: `dash.cloudflare.com/<ACCOUNT_ID>/r2/overview`. Con el equivocado, el
edge de Cloudflare **corta el handshake de TLS** (`SSL alert number 40`), porque
hay DNS comodin pero el certificado se provisiona por cuenta.

⚠️ **`S3_ENDPOINT` no lleva el bucket.** Con `forcePathStyle` el SDK arma
`<endpoint>/<bucket>/<key>`; si el endpoint ya lo trae, R2 responde "Bucket does
not exist". El bucket va solo en `S3_BUCKET`.

⚠️ **`S3_PUBLIC_URL` es por donde se LEE, `S3_ENDPOINT` por donde se ESCRIBE.**
El bucket tiene que tener acceso publico habilitado —dominio propio, o la URL
`r2.dev` que Cloudflare limita y desaconseja para produccion—. Si falta, se
sube bien y despues no se ve ninguna foto.

⚠️ **Sin las cinco variables de storage, en produccion la subida de fotos se
rompe a proposito.** No se cae al adaptador local porque escribiria dentro del
contenedor: las fotos desapareceran en el proximo deploy mientras el sistema
informa exito.

### Como verificar el endpoint ANTES de deployar

```bash
curl -sv https://<account-id>.r2.cloudflarestorage.com 2>&1 | tail -20
```

Exito = handshake de TLS completo y un **HTTP 400 con XML** quejandose de falta
de autenticacion. Ese 400 prueba que el host, el certificado y la salida a
internet funcionan. Si aparece `alert number 40`, el Account ID esta mal.

⚠️ **Sin las cuatro variables de SES, en produccion el envio de emails se
rompe a proposito** y nadie puede completar un alta: el token de verificacion se
genera pero no se entrega, y BR-001 exige el email verificado para operar. No se
cae al adaptador de log porque eso escribiria tokens en el log del servidor. El
fallo es ruidoso y el job se reintenta, pero el usuario no recibe nada.

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

## Aprendido en el primer despliegue real (2026-08-25)

- **`APP_ENV=development` en un deploy publico es un agujero de seguridad.**
  Gobierna cuatro cosas: los endpoints de auth devuelven los tokens en la
  respuesta HTTP —incluido el de reset de password—, la cookie de sesion pierde
  el flag `Secure`, Drizzle loguea todas las consultas con sus parametros, y el
  pool de conexiones baja a 5. Coolify avisa del valor con un mensaje pensado
  para Laravel, facil de ignorar.
- **`APP_URL` tiene que ser el dominio publico.** Es la base del redirect de
  vuelta al frontend; si queda en `localhost`, el flujo de Mercado Pago funciona
  pero el navegador termina en una URL inexistente.
- **`TOKEN_ENCRYPTION_KEY` en hexadecimal no sirve.** Debe ser base64 de 32
  bytes. Una clave hex de 64 caracteres decodifica a 48 y falla, pero **no al
  arrancar**: falla en la primera operacion que cifra, que es el callback de
  Mercado Pago.
- **Los recursos de base no se crean solos ni se conectan solos.** Hay que crear
  PostgreSQL y Redis, copiar la URL **interna** de cada uno y pegarla en las
  variables de la aplicacion. Con `localhost` no funciona: dentro del contenedor
  es el contenedor mismo.
- **Cuidado con los placeholders de Coolify.** Los campos de "Custom Docker
  options", "Pre/Post deployment" y "Port mappings" muestran ejemplos —incluido
  `--cap-add SYS_ADMIN` y comandos de Laravel— que si quedan guardados rompen el
  deploy o abren un riesgo serio.

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
- **Qué hacer con un pago aprobado sin stock** no está decidido: se audita
  como `ORDER_PAID_WITHOUT_STOCK` y queda para resolución manual.

Con credenciales de **TEST** de Mercado Pago esto es un entorno de prueba
perfectamente útil. Con credenciales de producción, mueve dinero real.
