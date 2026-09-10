# docs-implementation

Documentación **del código**, no del producto.

> ⚠️ Esto **no reemplaza** a `docs/`, que es la fuente de verdad del proyecto y
> es de solo lectura. Si algo de acá contradice a `docs/`, gana `docs/` y hay que
> reportar la discrepancia (CLAUDE.md §4 y §13).

| Documento                                                            | Contenido                                                              |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [deployment-coolify.md](deployment-coolify.md)                       | Despliegue en un VPS con Coolify: Dockerfile, variables y verificacion |
| [setup-local.md](setup-local.md)                                     | Cómo levantar el proyecto y qué comandos existen                       |
| [architecture-implementation.md](architecture-implementation.md)     | Qué se construyó y cómo se mapea a la arquitectura documentada         |
| [infra-validation.md](infra-validation.md)                           | Validación end-to-end de Docker, PostgreSQL y Redis                    |
| [erd-to-drizzle.md](erd-to-drizzle.md)                               | Traducción del ERD v1.0 al schema de Drizzle + auditoría               |
| [gaps-pre-migration.md](gaps-pre-migration.md)                       | Gaps a resolver antes de la primera migration (propuesta)              |
| [post-migration-validation.md](post-migration-validation.md)         | Validación de PostgreSQL real contra el ERD                            |
| [auth-module.md](auth-module.md)                                     | Módulo AUTH + USERS + SELLERS                                          |
| [seller-tax-identity.md](seller-tax-identity.md)                     | Identidad fiscal del vendedor (CUIT/CUIL/CDI)                          |
| [mercadopago-oauth-spec.md](mercadopago-oauth-spec.md)               | **Especificación** de OAuth de Mercado Pago (contrato de diseño)       |
| [mercadopago-oauth-module.md](mercadopago-oauth-module.md)           | Conexión con Mercado Pago, **tal como quedó implementada**             |
| [mercadopago-payments-spec.md](mercadopago-payments-spec.md)         | **Especificación** de Payments / Split 1:1                             |
| [mercadopago-payments-module.md](mercadopago-payments-module.md)     | Checkout, webhooks y refunds, **tal como quedaron implementados**      |
| [authorization-module.md](authorization-module.md)                   | Autorización por capacidad (DEC-023)                                   |
| [seller-approval-module.md](seller-approval-module.md)               | Aprobación automática del vendedor (TS-001 / DEC-044)                  |
| [notifications-email-module.md](notifications-email-module.md)       | Emails por SES, rebotes y quejas                                       |
| [rate-limiting.md](rate-limiting.md)                                 | Límites por IP y por usuario                                           |
| [frontend-design-system.md](frontend-design-system.md)               | **Sistema visual y de componentes del frontend**                       |
| [auditoria-frontend-2026-09-09.md](auditoria-frontend-2026-09-09.md) | **Auditoría del frontend por fases: lo que falta y lo que no**         |
| [frontend-movimiento.md](frontend-movimiento.md)                     | **Sistema de movimiento: entradas, scroll, View Transitions**          |
| [frontend-2026-09-10.md](frontend-2026-09-10.md)                     | **Frontend completo: primitivas, pantallas y datos (2026-09-10)**      |
| [frontend-rediseno-2026-09-10.md](frontend-rediseno-2026-09-10.md)   | **Rediseño visual: el eje de 112°, cuatro planos y el movimiento**     |
| [adr/](adr/)                                                         | Decisiones técnicas de implementación                                  |

## Estado actual

> ⚠️ **ESTA SECCIÓN ESTÁ DESACTUALIZADA** (verificado el 2026-09-09). Describe
> el proyecto como si el frontend fuera un placeholder y hubiera 312 tests;
> hoy hay **21 pantallas en producción** y **538 tests**. El estado real y
> vigente vive en **`CLAUDE.md` §19**, que es el que se mantiene. Lo de abajo
> se conserva sin tocar porque reescribirlo entero excede el alcance del
> trabajo de frontend; **actualizarlo es una tarea pendiente propia**.

**Foundation + modelo de datos.** El ERD v1.2 está traducido a Drizzle, las
migrations están aplicadas y PostgreSQL real fue validado contra el ERD
(ver [post-migration-validation.md](post-migration-validation.md)).

**Implementado:** autenticación (registro, verificación de email, login, logout,
sesión, recuperación de contraseña, **rate limiting**), perfil de vendedor,
**identidad fiscal** (CUIT/CUIL/CDI con validación sintáctica e historial),
**conexión OAuth con Mercado Pago** (PKCE, tokens cifrados en reposo, conflictos
de cuenta, desvinculación), **pagos con Checkout Pro + Split 1:1** (comisión 6%,
webhooks idempotentes, refunds) y **registro de auditoría** (`audit_log`).

**312 tests** (180 unitarios + 132 de integración contra PostgreSQL y Redis
reales). CI corre ambos, aplica las migraciones sobre una base vacía y verifica
que el schema de Drizzle no se haya separado de las migraciones.

Explícitamente **no** implementado: validación fiscal real contra ARCA,
aprobación del vendedor, **refresh de tokens de Mercado Pago**, **webhook
`mp-connect`**, percepciones, Config Store operativo, catálogo, listings,
búsqueda, carrito, edición/moderación de listings, imágenes, descuento de stock,
envíos, chargebacks, disputas, reviews, reputación, admin, **envío de emails** y
**frontend** (sigue siendo un placeholder).

⚠️ La conexión con Mercado Pago exige `seller_profiles.status = 'approved'`, y
**hoy ningún vendedor puede llegar a ese estado**: depende de TS-001, que sigue
🟡 pendiente. Ver [mercadopago-oauth-module.md](mercadopago-oauth-module.md).

⚠️ Sin módulo de notificaciones, el token de verificación se genera pero **no se
envía**: fuera de desarrollo nadie puede completar el alta (BR-001).
