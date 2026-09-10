# @offside/config

Configuración **técnica** del proceso: lee y valida las variables de entorno con
Zod, y las expone tipadas.

```ts
import { getEnv } from '@offside/config';

const env = getEnv(); // lanza si el entorno es invalido
```

## ⚠️ Esto NO es el Configuration Store de negocio

No confundir con el **Config Store administrativo** (DEC-013 / DEC-038,
catálogo en `docs/04-technical/configuration-registry.md`):

|                 | `@offside/config`             | Config Store (Admin)                              |
| --------------- | ----------------------------- | ------------------------------------------------- |
| Qué guarda      | credenciales, URLs, endpoints | comisión %, ventanas de tiempo, límites, umbrales |
| Quién lo cambia | quien opera el deploy         | un administrador, desde el panel                  |
| Cuándo cambia   | en un deploy                  | en caliente, sin tocar código                     |
| Dónde vive      | variables de entorno          | base de datos (`app_settings`)                    |

El Config Store **todavía no está implementado**. Su modelo de datos figura en
el ERD v1.0 (`app_settings`, `seller_tiers`) pero los **valores por defecto**
siguen 🟡 pendientes. Nunca hardcodear un parámetro de negocio acá.

## Variables obligatorias vs opcionales

Sólo `DATABASE_URL` y `REDIS_URL` son obligatorias para arrancar. Todo lo demás
(S3, Mercado Pago, Correo Argentino, secretos de auth) es **opcional en el
esquema** porque su módulo no existe todavía.

Cuando construyas uno de esos módulos, validá su credencial en el borde con
`requireEnv()` en lugar de volverla obligatoria globalmente — así el resto del
sistema sigue arrancando sin credenciales de terceros:

```ts
const accessToken = requireEnv(env, 'MERCADOPAGO_ACCESS_TOKEN');
```
