# docs-implementation

Documentación **del código**, no del producto.

> ⚠️ Esto **no reemplaza** a `docs/`, que es la fuente de verdad del proyecto y
> es de solo lectura. Si algo de acá contradice a `docs/`, gana `docs/` y hay que
> reportar la discrepancia (CLAUDE.md §4 y §13).

| Documento                                                        | Contenido                                                      |
| ---------------------------------------------------------------- | -------------------------------------------------------------- |
| [setup-local.md](setup-local.md)                                 | Cómo levantar el proyecto y qué comandos existen               |
| [architecture-implementation.md](architecture-implementation.md) | Qué se construyó y cómo se mapea a la arquitectura documentada |
| [infra-validation.md](infra-validation.md)                       | Validación end-to-end de Docker, PostgreSQL y Redis            |
| [erd-to-drizzle.md](erd-to-drizzle.md)                           | Traducción del ERD v1.0 al schema de Drizzle + auditoría       |
| [gaps-pre-migration.md](gaps-pre-migration.md)                   | Gaps a resolver antes de la primera migration (propuesta)      |
| [post-migration-validation.md](post-migration-validation.md)     | Validación de PostgreSQL real contra el ERD                    |
| [auth-module.md](auth-module.md)                                 | Módulo AUTH + USERS + SELLERS                                  |
| [seller-tax-identity.md](seller-tax-identity.md)                 | Identidad fiscal del vendedor (CUIT/CUIL/CDI)                  |
| [adr/](adr/)                                                     | Decisiones técnicas de implementación                          |

## Estado actual

**Foundation + modelo de datos.** El ERD v1.2 está traducido a Drizzle, las
migrations están aplicadas y PostgreSQL real fue validado contra el ERD
(ver [post-migration-validation.md](post-migration-validation.md)).

**Implementado:** autenticación (registro, verificación de email, login, logout,
sesión, recuperación de contraseña, **rate limiting**), perfil de vendedor e
**identidad fiscal** (CUIT/CUIL/CDI con validación sintáctica e historial).

**105 tests** (57 unitarios + 48 de integración contra PostgreSQL real). CI corre
ambos, aplica las migraciones sobre una base vacía y verifica que el schema de
Drizzle no se haya separado de las migraciones.

Explícitamente **no** implementado: validación fiscal real contra ARCA,
aprobación del vendedor, Mercado Pago, Payments, comisiones, percepciones,
Config Store operativo, catálogo, listings, búsqueda, carrito, órdenes, Correo
Argentino, refunds, disputas, reviews, reputación, admin, **envío de emails** y
**frontend** (sigue siendo un placeholder).

⚠️ Sin módulo de notificaciones, el token de verificación se genera pero **no se
envía**: fuera de desarrollo nadie puede completar el alta (BR-001).
