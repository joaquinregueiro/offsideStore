# docs-implementation

Documentación **del código**, no del producto.

> ⚠️ Esto **no reemplaza** a `docs/`, que es la fuente de verdad del proyecto y
> es de solo lectura. Si algo de acá contradice a `docs/`, gana `docs/` y hay que
> reportar la discrepancia (CLAUDE.md §4 y §13).

| Documento                                                        | Contenido                                                         |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| [setup-local.md](setup-local.md)                                 | Cómo levantar el proyecto y qué comandos existen                  |
| [architecture-implementation.md](architecture-implementation.md) | Qué se construyó y cómo se mapea a la arquitectura documentada    |
| [infra-validation.md](infra-validation.md)                       | Validación end-to-end de Docker, PostgreSQL y Redis               |
| [erd-to-drizzle.md](erd-to-drizzle.md)                           | Traducción del ERD v1.0 al schema de Drizzle + auditoría          |
| [gaps-pre-migration.md](gaps-pre-migration.md)                   | Gaps a resolver antes de la primera migration (propuesta)         |
| [post-migration-validation.md](post-migration-validation.md)     | Validación de PostgreSQL real contra el ERD                       |
| [auth-module.md](auth-module.md)                                 | Módulo AUTH + USERS + SELLERS                                     |
| [seller-tax-identity.md](seller-tax-identity.md)                 | Identidad fiscal del vendedor (CUIT/CUIL/CDI)                     |
| [mercadopago-oauth-spec.md](mercadopago-oauth-spec.md)           | **Especificación** de OAuth de Mercado Pago (contrato de diseño)  |
| [mercadopago-oauth-module.md](mercadopago-oauth-module.md)       | Conexión con Mercado Pago, **tal como quedó implementada**        |
| [mercadopago-payments-spec.md](mercadopago-payments-spec.md)     | **Especificación** de Payments / Split 1:1                        |
| [mercadopago-payments-module.md](mercadopago-payments-module.md) | Checkout, webhooks y refunds, **tal como quedaron implementados** |
| [adr/](adr/)                                                     | Decisiones técnicas de implementación                             |

## Estado actual

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
