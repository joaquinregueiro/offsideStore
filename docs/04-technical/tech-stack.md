# Tech Stack — OFFSIDE STORE

> Cierra **DEC-012** (antes 🟡). Estado: ✅ **Stack oficial confirmado.**
> Este documento es la fuente de verdad de las decisiones tecnológicas y de
> arquitectura. Complementa `architecture.md` (arquitectura lógica de dominio).

## 1. Stack oficial

| Capa | Tecnología | Estado |
|------|-----------|--------|
| Frontend | **Next.js + TypeScript** | ✅ |
| Backend/API | **Next.js** (Route Handlers / Server Actions) | ✅ |
| Base de datos | **PostgreSQL** | ✅ |
| ORM | **Drizzle ORM** | ✅ |
| Cache | **Redis** | ✅ |
| Jobs / colas | **BullMQ** (sobre Redis) | ✅ |
| Archivos / imágenes | **S3 compatible** | ✅ |
| Búsqueda inicial | **PostgreSQL** (full-text + índices + filtros) | ✅ |
| Auth | **Auth propia + OAuth externos** | ✅ |
| Pagos | **Mercado Pago Split 1:1** | ✅ |
| Envíos | **API Correo Argentino** | ✅ |
| Infraestructura | **Docker + Coolify** | ✅ |
| Lenguaje | **TypeScript** (todo el stack) | ✅ |

### Por qué PostgreSQL (no MySQL)
Modelo muy relacional y estructurado (productos, atributos, vendedores, órdenes,
pagos, disputas, reputación, eventos, búsquedas) + margen para evolucionar la
búsqueda (full-text, `tsvector`, `GIN`) y trabajar con datos semiestructurados
(`JSONB`) cuando haga falta.

## 2. Arquitectura: monolito modular

Una sola aplicación Next.js (sin microservicios en el MVP), organizada por
módulos con lógica de negocio propia:

```
src/
├── app/                      # rutas Next.js (storefront, seller, admin, api)
├── modules/
│   ├── auth/  users/  sellers/  products/  listings/  search/
│   ├── cart/  orders/  payments/  shipments/  disputes/
│   ├── reviews/  favorites/  notifications/
├── lib/                      # utilidades compartidas
├── db/                       # Drizzle: schema + migrations
└── jobs/                     # BullMQ workers
```

### Monorepo (Turborepo)

> **Actualizado 2026-08-20 por autorización explícita del owner.** La versión
> anterior de este diagrama ubicaba el monorepo en la raíz del repositorio, con
> `docs/` adentro. Se movió el monorepo a `offsideApp/`, dejando `docs/` y
> `design/` como carpetas hermanas en la raíz. **Es un cambio de ubicación en el
> repositorio, no un cambio de arquitectura:** el monorepo, sus packages y el
> layering por módulo siguen exactamente igual.

```
Offside Store/                # raíz del repositorio git
├── docs/                     # fuente de verdad (solo lectura)
├── design/                   # sistema visual (solo lectura)
├── .github/workflows/        # CI (GitHub solo lee workflows desde la raíz)
└── offsideApp/               # raíz del MONOREPO
    ├── apps/
    │   └── web/              # Next.js (storefront + seller + admin + api)
    ├── packages/
    │   ├── database/  config/  types/  utils/
    ├── docs-implementation/  # documentación del código (no reemplaza a docs/)
    ├── docker-compose.yml
    ├── package.json
    └── turbo.json
```

Preparado para que luego aparezcan `apps/admin` y `apps/worker` sin reorganizar.

### Capas dentro de cada módulo (lógica FUERA de los Route Handlers)
```
Route Handler → Controller → Service → Repository → Database
```
Los Route Handlers (`/api/...`) sólo orquestan; la lógica de negocio vive en
Services/Repositories. Evita `route.ts` de 500 líneas.

## 3. Principios técnicos (no negociables desde el día 1)

1. **La base de datos se modifica exclusivamente por migraciones** (Drizzle). Nada
   de cambios manuales en PostgreSQL.
2. **Los webhooks son la fuente de verdad** de pagos y envíos, no el redirect del
   frontend. (Ver `payments-and-commissions.md`, `orders-and-refunds.md`.)
3. **Integraciones externas aisladas** detrás de infraestructura por módulo:
   `modules/payments/infrastructure/mercadopago/*`,
   `modules/shipments/infrastructure/correoargentino/*`. El dominio no se acopla
   al proveedor.
4. **Auth propia ≠ Mercado Pago.** El login de OFFSIDE (email/password + OAuth
   externos tipo Google) es independiente del **OAuth de Mercado Pago**, que sólo
   sirve para conectar/verificar la cuenta de cobro del vendedor. Conectar MP **no**
   es login ni otorga confianza (BR-003).
5. **Secretos sólo en variables de entorno / gestor de secretos**, nunca en Git,
   frontend, logs ni base de datos. Los **tokens OAuth de vendedores** son datos
   sensibles: cifrados en reposo.
6. **Imágenes en S3**, no en PostgreSQL (la DB sólo guarda metadatos/URLs).
7. **Redis para lo que necesita velocidad/asincronía** (cache + colas), no como
   almacén principal.

## 4. Variables de entorno (referencia inicial)

```
DATABASE_URL
REDIS_URL
MERCADOPAGO_CLIENT_ID
MERCADOPAGO_CLIENT_SECRET
MERCADOPAGO_ACCESS_TOKEN          # app / marketplace
MERCADOPAGO_WEBHOOK_SECRET
CORREO_ARGENTINO_API_KEY          # 🌐 nombre real según su API
S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY
AUTH_SESSION_SECRET
TOKEN_ENCRYPTION_KEY              # cifrado de tokens OAuth de vendedores
```

## 5. Infraestructura (Coolify)

```
Coolify
├── offside-store (Next.js)
├── postgresql
├── redis
└── worker (BullMQ)   # inicialmente puede correr en el mismo proceso; se separa luego
```
💡 Entornos separados dev / test-sandbox / prod. El MVP se ejercita primero contra
**sandbox/test de MP** y un ShippingService de prueba (ver `marketplace-flow.md`
MVP).

## 6. Búsqueda: estrategia por fases

- **Fase 1 (MVP):** PostgreSQL full-text (`tsvector`/`GIN`) + índices + filtros
  estructurados por columnas. Sin Elastic/Meili/Typesense.
- **Disparador de Fase 2:** ~50.000–100.000+ publicaciones o límites de
  relevancia. El **modelo de datos se diseña desde ya para poder migrar** a un
  motor de búsqueda externo sin rehacer el dominio (ver `database-design.md`).

## 7. Relación con decisiones y dependencias

- ✅ **DEC-012** cerrada por este documento.
- 🌐 Dependencias externas siguen siendo Mercado Pago y Correo Argentino
  (aisladas por módulo). No se inventan sus comportamientos (ver docs de
  operaciones).
- 🔴 Siguen pendientes las decisiones de negocio no técnicas (comisión exacta,
  política de refunds/autenticidad/fiscal, plazos) — ver `OPEN-QUESTIONS.md`.
