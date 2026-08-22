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
    │           │   └── api/         health, auth, sellers
    │           ├── lib/             guard de auth, cookies, HTTP, rate limiting
    │           └── modules/         módulos de dominio (ver modules/README.md)
    │               ├── auth/  users/  sellers/
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

| Documentado                                                  | Implementado                                                   |
| ------------------------------------------------------------ | -------------------------------------------------------------- |
| Monorepo Turborepo con `apps/` y `packages/` (tech-stack §2) | ✅ npm workspaces + Turborepo                                  |
| `packages/database`, `config`, `types`, `utils`              | ✅ los cuatro                                                  |
| Monolito modular                                             | ✅ `apps/web/src/modules/`                                     |
| Route Handler → Controller → Service → Repository            | ✅ ejercitado de verdad por `auth` y `sellers`                 |
| Integraciones aisladas en `infrastructure/` por módulo       | ✅ `sellers/infrastructure/fiscal-source` (port + adapter)     |
| PostgreSQL + Drizzle, sólo migraciones                       | ✅ ERD v1.2 completo: 51 tablas, 37 enums, 2 migraciones       |
| Redis + BullMQ                                               | ✅ conexión y registro; Redis además sostiene el rate limiting |
| Docker para dev                                              | ✅ Postgres 17 + Redis 8                                       |
| Auth propia                                                  | ✅ sesión opaca en base, argon2id, rate limiting               |
| OAuth externos (Google, etc.)                                | ⏸ no implementado                                              |
| Búsqueda en PostgreSQL full-text                             | ⏸ tablas e índices migrados; sin código de búsqueda            |
| Config Store operativo (`app_settings`, `seller_tiers`)      | ⏸ tablas migradas pero **vacías y sin código que las lea**     |
| Jobs de negocio en BullMQ                                    | ⏸ infraestructura lista, ningún job todavía                    |
| Mercado Pago / Correo Argentino                              | ⏸ no implementado                                              |
| Frontend                                                     | ⏸ placeholder                                                  |

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

### El schema se verifica contra PostgreSQL real, no sólo con tipos

La invariante `ERD = Drizzle = Migration = PostgreSQL` no la garantiza ningún
análisis estático: `tsc` no sabe nada de un `ON DELETE CASCADE` ni de un índice
único parcial. Por eso CI levanta PostgreSQL, aplica las migraciones **sobre una
base vacía** —lo que verifica de paso que las extensiones se creen antes que las
tablas que las usan (ERD §1.b)— y corre los tests de integración.

CI incluye además un **drift check**: si alguien toca el schema de Drizzle sin
generar la migración, `drizzle-kit generate` produce un archivo nuevo y el
workflow falla mostrando el diff. Ése es exactamente el estado que rompe la
invariante.

### El rate limiting vive en `lib/`, no en un módulo

`lib/rate-limit.ts` es infraestructura de la app, no dominio: no representa
ninguna regla de negocio del marketplace y lo va a usar cualquier endpoint
expuesto, no sólo `auth`. Los umbrales son configuración de seguridad por
entorno y siguen pendientes de confirmación del owner.

## Qué falta para seguir

1. **Investigar Mercado Pago contra sandbox** (retención de fondos, refunds sin
   saldo, semántica del split, webhooks). Es 🔵 y su resultado **puede cambiar el
   ERD**: conviene saberlo antes de construir `orders` y `payments`.
2. **Config Store operativo**: seed de `app_settings` + lectura tipada + el
   patrón de snapshot económico (DEC-030/038). Lo necesita toda operación con
   dinero, así que se construye una vez y antes de la primera orden.
3. **Catálogo, listings y búsqueda** — el diferencial del producto; está
   desbloqueado por DEC-041 y DEC-042.
4. **Aprobación de vendedor**, en cuanto TS-001 esté definida.
5. **Módulo de notificaciones**: hoy los tokens de verificación se generan pero
   no se envían, con lo cual fuera de desarrollo nadie puede completar el alta.
