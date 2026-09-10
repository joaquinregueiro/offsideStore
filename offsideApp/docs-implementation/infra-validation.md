# Validación de infraestructura local

Resultado de la verificación end-to-end de la foundation. **Fecha: 2026-08-21.**

## Resumen

| Comprobación                    | Resultado                                                      |
| ------------------------------- | -------------------------------------------------------------- |
| Docker Engine                   | ✅ 29.7.2 (Compose v5.4.0), motor linux/x86_64, WSL2           |
| PostgreSQL                      | ✅ 17.11, contenedor `healthy`                                 |
| Redis                           | ✅ 8.10.1, contenedor `healthy`                                |
| Healthchecks de compose         | ✅ ambos `healthy`                                             |
| Puertos publicados              | ✅ 5432 y 6379                                                 |
| Networking entre servicios      | ✅ DNS por nombre en `offsideapp_default`                      |
| Persistencia de volúmenes       | ✅ sobrevive `docker compose restart`                          |
| Conexión de la app a PostgreSQL | ✅ vía Drizzle: `user=offside db=offside_dev`                  |
| Conexión de la app a Redis      | ✅ + cola BullMQ creada y eliminada                            |
| `GET /api/health`               | ✅ **HTTP 200** `{"status":"ok","database":"up","redis":"up"}` |
| Worker BullMQ                   | ✅ arranca y apaga ordenadamente                               |
| `npm run verify`                | ✅ format + lint + typecheck (6/6) + tests (17/17)             |
| `npm run build`                 | ✅                                                             |

Estado de PostgreSQL al cierre: **0 tablas** en `public`. No se creó schema.

## Datos verificados

```
PostgreSQL 17.11 on x86_64-pc-linux-musl
  user=offside  db=offside_dev
  gen_random_uuid() -> disponible de forma nativa (sin extensión pgcrypto)

Redis 8.10.1
  appendonly=yes (persistencia AOF activa)

Red offsideapp_default
  offside-postgres -> 172.18.0.3
  offside-redis    -> 172.18.0.2
  resolución por nombre de servicio: OK en ambos sentidos
```

`gen_random_uuid()` nativo confirma que la convención de PK del ERD (§1) funciona
sin instalar ninguna extensión.

## Persistencia

Probada sin crear tablas:

- **PostgreSQL:** `system_identifier` de `pg_control_system()` idéntico antes y
  después del restart (`7676452476983246884`) → el cluster es el mismo, el
  volumen persistió.
- **Redis:** una clave temporal sobrevivió al restart y luego se eliminó.

## Problemas encontrados y corregidos

### 1. Docker Desktop no arrancaba — sockets huérfanos

Docker Desktop arrancaba, mostraba un diálogo de error y se cerraba solo:

```
starting services: initializing Ingest server:
listening on unix://.../Docker/run/sailor-ingest.sock:
remove ...: The file cannot be accessed by the system.
```

Sockets AF_UNIX huérfanos de un arranque anterior que crasheó. Windows no
permitía borrarlos (fallaban `del`, `Remove-Item` y el propio Docker).

**Solución:** renombrar los directorios que los contenían — Docker los recrea
limpios al arrancar. Los originales **no se borraron**, quedaron como:

```
%LOCALAPPDATA%\Docker.bak-20260821-085424
%LOCALAPPDATA%\docker-secrets-engine.bak-20260821-085424
```

Contenían sólo logs y estado de runtime. Se pueden borrar cuando quieras.

> Si vuelve a pasar, un reinicio de Windows también lo resuelve.

### 2. Redis: el health check colgaba para siempre

`getRedisClient()` usaba el perfil **bloqueante** (`maxRetriesPerRequest: null`),
que es obligatorio para los Workers de BullMQ pero desastroso para todo lo demás:
ioredis encola los comandos indefinidamente en vez de rechazarlos. Con Redis
caído, `checkRedisConnection()` **no volvía nunca** (>15 s medidos), y el
endpoint de health se habría colgado en producción.

**Solución:** dos perfiles separados y explícitos en `packages/jobs/src/connection.ts`:

- `blockingOptions` — sólo Workers y QueueEvents.
- `sharedOptions` — colas, cache y health checks: `maxRetriesPerRequest: 3` +
  `connectTimeout: 5s`.

Más un tope duro con `withTimeout()` (nuevo, en `@offside/utils`) de 3 s en ambos
health checks, para que nunca puedan colgar a quien los llama.

Medido: Redis caído pasó de **>15 000 ms (colgado)** a **348 ms (DOWN)**.

> Intento intermedio descartado: `enableOfflineQueue: false` hacía fallar el
> **primer** comando incluso con Redis sano, porque ioredis conecta de forma
> asíncrona. El límite lo pone el timeout, no esa opción.

### 3. BullMQ rechaza `:` en los nombres de cola

Las colas que estaban documentadas como previstas (`payments:webhooks`,
`shipments:tracking`, …) habrían fallado todas: BullMQ v6 usa `:` para sus
propias claves en Redis y valida el nombre al construir la cola.

**Solución:** convención con `-` (`payments-webhooks`), documentada junto al
registro de colas.

### 4. La app no veía el `.env`

El `.env` vive en la raíz del monorepo, pero **Next.js sólo lee `.env` desde el
directorio de su propia app** (`apps/web/`). Resultado: con PostgreSQL y Redis
perfectamente sanos, `/api/health` devolvía `503` y ambos servicios como `down`.
El worker y drizzle-kit tenían el mismo problema.

**Solución:** `loadRootEnv()` en `@offside/config` busca el `.env` más cercano
subiendo desde el directorio del proceso. Se llama explícitamente en cada punto
de entrada: `next.config.ts`, `workers/main.ts`, `drizzle.config.ts` y
`migrate.ts`. Las variables ya presentes en el entorno tienen prioridad, así que
lo que inyecte Coolify nunca lo pisa un archivo local.

Sin dependencias nuevas: usa `process.loadEnvFile()` de Node.

## Cómo reproducir

```bash
cd offsideApp
```

```bash
docker compose up -d
```

```bash
npm run verify && npm run build
```

```bash
npm run dev
```

Con los servicios arriba, http://localhost:3000/api/health debe devolver
**200** con ambos servicios en `up`. Si devuelve `503`, revisá que los
contenedores estén `healthy` con `docker compose ps`.
