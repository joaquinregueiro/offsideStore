# Arquitectura implementada

Cómo se materializa hoy `docs/04-technical/tech-stack.md` §2 y
`docs/04-technical/architecture.md`. Describe lo que **existe**, no lo que se
planea.

## Estructura

```
Offside Store/                       raíz del repositorio git
├── docs/                            FUENTE DE VERDAD (solo lectura)
├── design/                          sistema visual (solo lectura)
├── .github/workflows/ci.yml         CI (GitHub sólo lee workflows desde la raíz)
├── CLAUDE.md
└── offsideApp/                      raíz del MONOREPO — todo el código
    ├── apps/
    │   └── web/                     Next.js 16 — storefront + seller + admin + api
    │       └── src/
    │           ├── app/             rutas (App Router)
    │           │   └── api/health/  health check de infraestructura
    │           ├── lib/             utilidades de la app
    │           └── modules/         módulos de dominio (ver modules/README.md)
    │               └── _template/   plantilla con el layering obligatorio
    ├── packages/
    │   ├── config/                  validación tipada del entorno (Zod)
    │   ├── database/                Drizzle + cliente Postgres + migrations
    │   ├── jobs/                    Redis, colas y workers de BullMQ
    │   ├── types/                   tipos transversales
    │   └── utils/                   utilidades sin lógica de negocio
    ├── docs-implementation/         esta documentación
    ├── docker-compose.yml           PostgreSQL + Redis para desarrollo
    └── turbo.json                   orquestación de tareas
```

**Todos los comandos de npm se ejecutan desde `offsideApp/`**, no desde la raíz
del repositorio.

`packages/*` se consumen como **TypeScript sin compilar** (`main: ./src/index.ts`),
por eso `apps/web` los declara en `transpilePackages`. Evita un paso de build
intermedio en cada cambio.

## Correspondencia con la documentación

| Documentado                                                  | Implementado                                          |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| Monorepo Turborepo con `apps/` y `packages/` (tech-stack §2) | ✅ npm workspaces + Turborepo                         |
| `packages/database`, `config`, `types`, `utils`              | ✅ los cuatro                                         |
| Monolito modular                                             | ✅ `apps/web/src/modules/`                            |
| Route Handler → Controller → Service → Repository            | ✅ convención + plantilla; sin módulos reales todavía |
| Integraciones aisladas en `infrastructure/` por módulo       | ✅ carpeta en la plantilla; sin adaptadores todavía   |
| PostgreSQL + Drizzle, sólo migraciones                       | ✅ Drizzle Kit configurado; **schema vacío**          |
| Redis + BullMQ                                               | ✅ conexión, registro de colas y de workers           |
| Docker para dev                                              | ✅ Postgres 17 + Redis 8                              |
| Búsqueda en PostgreSQL full-text                             | ⏸ no aplica todavía (depende del schema)              |
| Auth propia + OAuth                                          | ⏸ no implementado                                     |
| Mercado Pago / Correo Argentino                              | ⏸ no implementado                                     |

## Decisiones de diseño de la foundation

### Validación de entorno perezosa

`getEnv()` valida y cachea al primer uso, no al importar el módulo. Si validara
al importar, cualquier herramienta que toque un package (tests, drizzle-kit,
lint) reventaría sin un `.env` completo.

El costo es que un `.env` incompleto no falla al arrancar sino en el primer uso.
Por eso el health check reporta `degraded` en vez de tirar el proceso.

### Credenciales de terceros opcionales en el esquema

Sólo `DATABASE_URL` y `REDIS_URL` son obligatorias. Las de Mercado Pago, Correo
Argentino y S3 son opcionales y se exigen **en el borde de su módulo** con
`requireEnv()`. Así el sistema arranca y se puede testear sin credenciales de
terceros — necesario porque esos módulos ni siquiera existen.

### Un pool de conexiones por proceso

`getDatabase()` y `getRedisClient()` son singletons. En desarrollo Next.js
recarga módulos en cada cambio; sin singleton se agotan las conexiones del
servidor en minutos.

Los Workers de BullMQ son la excepción: cada uno necesita conexión **dedicada**
(`createRedisConnection()`) porque bloquea la conexión esperando jobs, y
requiere `maxRetriesPerRequest: null`.

### Reintentos con backoff por defecto

`defaultJobOptions` aplica 5 intentos con backoff exponencial, según
`architecture.md` §8. **No sustituye a la idempotencia**: cada processor que
consuma eventos externos debe ser idempotente por su cuenta, porque los webhooks
llegan duplicados y desordenados.

### El schema de Drizzle está vacío a propósito

`packages/database/src/schema/index.ts` no exporta ninguna tabla. El ERD v1.0
está cerrado y es la fuente de verdad, pero traducirlo a Drizzle es una fase
posterior que todavía no fue autorizada. El archivo documenta el mapeo previsto
módulo por módulo y las convenciones obligatorias.

## Qué falta para empezar a implementar negocio

1. Traducir el ERD v1.0 a schema de Drizzle y generar la primera migración.
2. Definir el módulo de auth (primer módulo real que ejercita el layering).
3. Resolver las decisiones 🟡 que bloquean cada módulo — ver
   `docs/04-technical/open-decisions-impact.md`.
