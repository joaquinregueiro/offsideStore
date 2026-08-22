# Módulos de dominio

Monolito modular. Cada módulo es un dominio de negocio con su lógica propia y
fronteras explícitas, según `docs/04-technical/tech-stack.md` §2 y
`docs/04-technical/architecture.md` §4.

## Layering obligatorio

```
Route Handler   apps/web/src/app/api/**/route.ts   ← SOLO orquesta
      ↓
Controller      modules/<modulo>/controllers/      ← valida input, traduce a HTTP
      ↓
Service         modules/<modulo>/services/         ← lógica de negocio
      ↓
Repository      modules/<modulo>/repositories/     ← acceso a datos (Drizzle)
      ↓
PostgreSQL
```

Reglas que no se negocian:

- **El Route Handler no tiene lógica.** Nada de `route.ts` de 500 líneas.
- **El Service no conoce HTTP.** No recibe `Request` ni devuelve `Response`.
- **El Repository no conoce reglas de negocio.** Sólo lee y escribe.
- **Un módulo no importa el Repository de otro módulo.** Se habla Service a
  Service, o por eventos.

## Integraciones externas

Todo proveedor externo vive aislado en `infrastructure/`, detrás de una interfaz
definida por el dominio (`architecture.md` §3.1 y §5):

```
modules/payments/infrastructure/mercadopago/*
modules/shipments/infrastructure/correoargentino/*
```

El Service depende de la **interfaz** (`PaymentService`, `ShippingService`),
nunca del SDK del proveedor. Eso es lo que permite tener un proveedor _fake_
para tests y MVP (`architecture.md` §5.2).

## Módulos previstos

Todavía **no hay ninguno implementado**. Los previstos en `tech-stack.md` §2:

|                                           |                                                   |
| ----------------------------------------- | ------------------------------------------------- |
| `auth`                                    | sesión, login, OAuth externos                     |
| `users`                                   | perfil, direcciones, historial                    |
| `sellers`                                 | perfil de vendedor, tiers, cuenta de Mercado Pago |
| `products` / `listings`                   | catálogo y publicaciones                          |
| `search`                                  | búsqueda facetada (PostgreSQL full-text)          |
| `cart` / `orders`                         | carrito y órdenes                                 |
| `payments`                                | Mercado Pago, split, webhooks, refunds            |
| `shipments`                               | Correo Argentino, tracking                        |
| `disputes`                                | disputas y evidencias                             |
| `reviews` / `favorites` / `notifications` |                                                   |

Crear un módulo copiando `_template/`. No crear módulos "por las dudas": se
crean cuando se implementa su funcionalidad.
