# Setup local

## Requisitos

|                         | Versión                       | Estado en esta máquina |
| ----------------------- | ----------------------------- | ---------------------- |
| Node.js                 | `>=20.9.0` (ver `.nvmrc`: 24) | ✅ v24.11.1            |
| npm                     | 11.x                          | ✅ 11.6.2              |
| Docker + Docker Compose | cualquiera reciente           | ❌ **no instalado**    |

Sin Docker no arrancan PostgreSQL ni Redis. La app igual levanta: el health
check reporta `degraded` y los servicios como `down`.

## Puesta en marcha

> ⚠️ **Todos los comandos se ejecutan desde `offsideApp/`**, no desde la raíz del
> repositorio. La raíz sólo contiene `docs/`, `design/`, el CI y `CLAUDE.md`.

```bash
cd offsideApp
```

```bash
npm install
```

```bash
cp .env.example .env
```

`.env` ya trae valores válidos de desarrollo para `DATABASE_URL` y `REDIS_URL`,
que coinciden con `docker-compose.yml`. El resto de las variables quedan vacías
a propósito: pertenecen a módulos que todavía no existen.

```bash
docker compose up -d
```

```bash
npm run dev
```

La app queda en http://localhost:3000 y el health check en
http://localhost:3000/api/health.

## Comandos

### Desarrollo

| Comando                                    | Qué hace                                              |
| ------------------------------------------ | ----------------------------------------------------- |
| `npm run dev`                              | Levanta la app Next.js                                |
| `npm run build`                            | Build de producción de todo el monorepo               |
| `npm start`                                | Sirve el build de producción                          |
| `npm run worker --workspace @offside/jobs` | Proceso worker de BullMQ (hoy no registra ningún job) |

### Calidad

| Comando                                   | Qué hace                                                          |
| ----------------------------------------- | ----------------------------------------------------------------- |
| `npm run verify`                          | **format:check + lint + typecheck + test.** Lo mismo que corre CI |
| `npm run lint` / `npm run lint:fix`       | ESLint sobre todo el monorepo                                     |
| `npm run format` / `npm run format:check` | Prettier                                                          |
| `npm run typecheck`                       | `tsc --noEmit` en cada workspace                                  |
| `npm test`                                | Tests unitarios                                                   |
| `npm test -- --project=integration`       | Tests de integración (requieren Postgres y Redis levantados)      |

### Base de datos

| Comando               | Qué hace                                            |
| --------------------- | --------------------------------------------------- |
| `npm run db:generate` | Genera una migración a partir del schema de Drizzle |
| `npm run db:migrate`  | Aplica las migraciones pendientes                   |
| `npm run db:studio`   | Abre Drizzle Studio                                 |

> Estos comandos están configurados pero **todavía no hacen nada útil**: el
> schema de Drizzle está vacío a propósito. `db:generate` no va a producir
> ninguna migración hasta que se implemente el schema del ERD.

### Docker

| Comando                  | Qué hace                          |
| ------------------------ | --------------------------------- |
| `npm run docker:up`      | Levanta PostgreSQL y Redis        |
| `npm run docker:down`    | Los detiene                       |
| `npm run docker:logs`    | Sigue los logs                    |
| `docker compose down -v` | Los detiene y **borra los datos** |

## Servicios locales

| Servicio      | Puerto | Credenciales de desarrollo                |
| ------------- | ------ | ----------------------------------------- |
| PostgreSQL 17 | 5432   | `offside` / `offside`, base `offside_dev` |
| Redis 8       | 6379   | sin auth                                  |

Credenciales triviales a propósito: son sólo para desarrollo local y nunca
salen de esta máquina. Los entornos reales usan secretos del gestor de Coolify.

## Problemas conocidos

**La ruta del proyecto tiene espacios** (`...\Proyects\Offside Store`). Si
escribís scripts, entrecomillá siempre las rutas.

**El health check devuelve 503.** Es correcto si no levantaste Docker: significa
que Postgres y Redis no responden. Con `docker compose up -d` pasa a 200.
