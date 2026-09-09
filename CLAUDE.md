# CLAUDE.md — Offside Store

> Reglas de trabajo para Claude Code dentro de este repositorio.
> Ámbito: **todo el desarrollo de Offside Store**.
> Raíz del repo: `C:\Users\tango\Documents\Proyects\Offside Store\`.
> Estado: marketplace operable de punta a punta —registro, publicación, compra y
> cobro con Mercado Pago— con frontend propio, incluido el back-office (ver §19).
> Última actualización: 2026-09-08.

---

## 0. Regla de oro

**El código NO decide la arquitectura. La documentación decide la arquitectura.**

Jerarquía del proyecto:

```
Business / Product / Operations
        ↓
Documentation  (docs/)
        ↓
Architecture / ERD
        ↓
Implementation
        ↓
Code
```

Nunca se invierte. Una necesidad técnica no habilita a cambiar una decisión
documentada: habilita a **informar el problema y pedir decisión**.

---

## 1. Estructura real del proyecto

Estructura verificada el 2026-08-20, **después de mover el monorepo a
`offsideApp/`** (ver §18). Manda esta estructura, no la conceptual descrita
informalmente:

```
C:\Users\tango\Documents\Proyects\Offside Store\   ← **RAÍZ DEL REPO GIT**
├── .git/                      ← remote: github.com/joaquinregueiro/offsideStore.git
├── .gitattributes
├── .gitignore                 ← reglas del repo (los artefactos, en offsideApp/)
├── .github/workflows/ci.yml   ← CI: GitHub sólo lee workflows desde la raíz
├── CLAUDE.md                  ← este archivo
├── docs/                      ← FUENTE DE VERDAD  (conceptualmente "Documentation/")
│   ├── README.md              ← índice y orden de lectura
│   ├── DECISIONS.md           ← decisiones oficiales (DEC-001 … DEC-044)
│   ├── OPEN-QUESTIONS.md      ← decisiones pendientes
│   ├── RISKS.md
│   ├── 01-business/           ← business-model, business-rules, trust-and-safety,
│   │                            mvp-scope, legal
│   ├── 02-product/            ← product-specification, marketplace-flow,
│   │                            buyer-system, seller-system,
│   │                            notifications-and-engagement
│   ├── 03-operations/         ← payments-and-commissions, orders-and-refunds,
│   │                            shipping
│   └── 04-technical/          ← architecture, tech-stack, database-design (ERD v1.0),
│                                erd-audit-fase2, open-decisions-impact,
│                                configuration-registry,
│                                security-observability-analytics
├── design/                    ← sistema visual (conceptualmente "Design/")
│   ├── assets/icons/          ← icon-autenticado, -balon, -camiseta, -etiqueta,
│   │                            -favorito, -intercambio
│   ├── assets/logos/          ← offside-isotipo-bandera, -logo-invertido,
│   │                            -logo-principal, -wordmark
│   └── Offside Identidad Visual.html
│
└── offsideApp/                ← **RAÍZ DEL MONOREPO** — aquí va TODO el código
    ├── apps/web/              ← Next.js (storefront + seller + admin + api)
    │   └── src/{app,lib,modules}
    ├── packages/              ← config, database, jobs, types, utils
    ├── docs-implementation/   ← documentación del código (§13)
    ├── docker-compose.yml     ← PostgreSQL + Redis (desarrollo local)
    ├── package.json           ← npm workspaces + scripts
    ├── turbo.json  tsconfig.base.json  eslint.config.mjs  vitest.config.mts
    └── .env.example  .gitignore  .nvmrc  .prettierrc.json  .prettierignore
```

**Todo el código vive en `offsideApp/`.** Los comandos de npm se ejecutan desde
ahí, no desde la raíz. Ver `docs/04-technical/tech-stack.md` §2.

Notas importantes:

- **No existe** una carpeta `Research/` al día de hoy. Si aparece, aplica §2 (autoridad).
- `design/` **no** tiene subcarpetas `Brand/ UX/ UI/`; hoy sólo `assets/` y un HTML
  de identidad visual.
- `DECISIONS.md` está en `docs/DECISIONS.md` (**no** en `04-technical/`).
- Salvo indicación contraria, las rutas de este documento son **relativas a la
  raíz del repo**. Las de código son relativas a `offsideApp/`.
- El repositorio en GitHub es `joaquinregueiro/offsideStore`.
- La ruta contiene **espacios** (`...\Proyects\Offside Store`): entrecomillar
  siempre en scripts y configuración. Ya **no** está bajo OneDrive (ver §18).

---

## 2. Fuentes de verdad y orden de autoridad

Ante cualquier conflicto, este es el orden (mayor a menor):

1. Instrucción explícita del usuario en la conversación
2. `docs/` — decisiones **✅ DECIDIDO / ⚙️ CONFIGURABLE** (equivalente a "CLOSED")
3. `docs/` — especificaciones (business / product / operations)
4. ERD aprobado: `docs/04-technical/database-design.md` (**ERD v1.0 CERRADO**)
5. Arquitectura documentada: `docs/04-technical/architecture.md` y `tech-stack.md`
6. Research (cuando exista)
7. Implementación existente en el código
8. Suposiciones ← **nunca** pueden contradecir a 2–5

### Taxonomía de estados de la documentación (canónica)

La doc oficial no usa CLOSED/PENDING, usa **5 estados**. Mapeo obligatorio:

| Marca                                     | Significado                                   | Cómo lo trato                                                        |
| ----------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| ✅ **DECIDIDO**                           | Decisión firme                                | Obligatorio. Se construye sobre ella.                                |
| ⚙️ **CONFIGURABLE**                       | Gobernado desde Admin                         | El **mecanismo** es obligatorio; el **valor** NO se hardcodea (§12). |
| 🟡 **PENDIENTE**                          | Falta definir (interno)                       | No inventar. Informar antes de implementar solución definitiva.      |
| 🔵 **REQUIERE INVESTIGACIÓN**             | Depende de un tercero (MP / Correo Argentino) | No asumir comportamiento externo. Investigar o marcar pendiente.     |
| 🔴 **REQUIERE ASESORAMIENTO PROFESIONAL** | Fiscal / legal                                | No implementar reglas fiscales o legales por cuenta propia.          |
| 🌐 _(tag)_                                | Dependencia externa                           | No se inventan endpoints, campos ni comportamientos.                 |

Documentos anteriores al 2026-08-19 pueden usar 🔴 con el sentido viejo de
"DECISION REQUIRED": reinterpretar según esta tabla.

---

## 3. Permisos

### Dentro de `offsideApp/` — permitido

- crear, modificar y eliminar archivos y carpetas de código
- instalar dependencias y configurar herramientas
- ejecutar comandos, tests y migrations
- crear scripts
- crear documentación técnica del código en `offsideApp/docs-implementation/` (ver §13)

### En la raíz del repo — permitido con criterio

Sólo lo que **no puede** vivir dentro de `offsideApp/`: `.github/workflows/`
(GitHub sólo lee workflows desde la raíz), `.gitignore`, `.gitattributes` y este
`CLAUDE.md`. Nada de código.

⚠️ `docs/` y `design/` viven **dentro** del repositorio. Que estén versionadas
no las vuelve editables: siguen siendo solo lectura. La ventaja es que cualquier
modificación accidental aparece en `git status` y puede revertirse.

### `docs/` — SOLO LECTURA

**Nunca** crear, editar, eliminar, renombrar ni mover archivos ahí, salvo
autorización explícita del usuario en una instrucción concreta.

### `design/` — SOLO LECTURA

Se puede leer para implementar el sistema visual. No modificar sin autorización
explícita. Si la implementación y el diseño se contradicen: **informar antes de
cambiar nada**.

### Research (si aparece)

Material de referencia. **No tiene autoridad sobre `docs/`.** Ante
contradicción, gana la documentación.

---

## 4. Qué hacer ante una contradicción o un vacío en la documentación

No corregir automáticamente. **Detenerse** y reportar en este formato:

```
⚠️ BLOQUEO DE DOCUMENTACIÓN
1. Qué encontré:        <descripción precisa>
2. Documento(s):        <ruta/s exacta/s + sección>
3. Impacto:             <por qué bloquea o condiciona la implementación>
4. Decisión necesaria:  <opciones razonables con trade-offs, sin elegir por el usuario>
```

Aplica igual a: contradicciones entre documentos, errores, decisiones faltantes,
incompatibilidades entre Drizzle y el ERD, y comportamientos no confirmados de
terceros.

---

## 5. Clasificación de cambios (regla de autorización)

| Tipo               | Definición                                                                                                               | ¿Puedo hacerlo?               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| **MENOR**          | No afecta arquitectura, modelo de datos ni reglas de negocio (formato, refactor local, typo, test)                       | ✅ Sí                         |
| **TÉCNICO**        | Afecta implementación pero no decisiones de negocio, y cae **dentro** de la arquitectura definida                        | ✅ Sí, informando qué se hizo |
| **ARQUITECTÓNICO** | Afecta ERD, arquitectura, contratos de API, integraciones, máquinas de estado, reglas de negocio o seguridad estructural | ❌ NO sin autorización        |

Ejemplos de **ARQUITECTÓNICO** (siempre requieren autorización): crear o renombrar
una tabla, agregar o quitar una columna, cambiar una relación o una FK, agregar un
valor a un enum de dominio, cambiar un flujo, alterar un estado de
Order/Payment/Refund/Dispute, cambiar cómo se calcula la comisión, tocar el split
de Mercado Pago.

---

## 6. Base de datos y ERD

**Fuente de verdad:** `docs/04-technical/database-design.md` (ERD v1.0 CERRADO).

Flujo obligatorio, en un solo sentido:

```
ERD  →  Drizzle Schema  →  Migration  →  PostgreSQL
```

- **Drizzle implementa el ERD. Drizzle no redefine el ERD.**
- La base **sólo** se modifica por migraciones de Drizzle. Nunca cambios manuales
  en PostgreSQL.
- No crear tablas, campos, relaciones ni enums de dominio que no estén en el ERD.
- Si una necesidad técnica parece exigir modificar el ERD: **detener esa parte de
  la implementación** y pedir decisión (§4).
- Convenciones del ERD que se respetan sin excepción:
  - `snake_case`, tablas en plural, FK = `<entidad>_id`
  - PK `uuid` con `gen_random_uuid()`
  - `created_at timestamptz NOT NULL DEFAULT now()`; `updated_at` gestionado por la app
  - **Dinero = `bigint` en centavos, nunca `float`**; toda tabla con importes lleva `currency char(3)`
  - Snapshots económicos: se **copian** a la transacción y nunca se recalculan con config futura
  - Soft delete en entidades de negocio (`status` / `deleted_at`); hard delete sólo en efímeras
  - FKs `ON DELETE RESTRICT` por defecto; `CASCADE` sólo en hijos dependientes
  - IDs externos (MP / Correo) como `text` en `*_external_id`, nunca como PK propia; el estado crudo se conserva

Los campos marcados 🟦 en el ERD tienen **estructura definida pero semántica
PENDIENTE**: se pueden crear, pero **no se les inventa comportamiento**.

---

## 7. Decisiones

- Registro oficial: `docs/DECISIONS.md` (DEC-001 … DEC-038)
- Pendientes: `docs/OPEN-QUESTIONS.md`
- Impacto de lo pendiente: `docs/04-technical/open-decisions-impact.md`

Reglas:

- Las decisiones ✅ / ⚙️ son **obligatorias**.
- Las decisiones 🟡 / 🔵 / 🔴 **no se inventan desde el código**.
- Si una funcionalidad depende de una decisión no cerrada: informarlo **antes** de
  implementar una solución definitiva. Se puede implementar la estructura neutral;
  nunca la política.

---

## 8. Stack oficial (DEC-012 ✅)

Definido en `docs/04-technical/tech-stack.md`. No sustituir ni ampliar sin autorización.

| Capa               | Tecnología                                                              |
| ------------------ | ----------------------------------------------------------------------- |
| Frontend / Backend | **Next.js + TypeScript** (Route Handlers / Server Actions)              |
| Base de datos      | **PostgreSQL**                                                          |
| ORM                | **Drizzle ORM**                                                         |
| Cache              | **Redis**                                                               |
| Jobs / colas       | **BullMQ**                                                              |
| Archivos           | **S3 compatible**                                                       |
| Búsqueda (Fase 1)  | PostgreSQL full-text (`tsvector` + `GIN`) — sin Elastic/Meili/Typesense |
| Auth               | Auth propia + OAuth externos                                            |
| Pagos              | Mercado Pago Split 1:1                                                  |
| Envíos             | API Correo Argentino                                                    |
| Infra              | Docker + Coolify                                                        |

**Arquitectura: monolito modular** en monorepo (Turborepo), con capas dentro de
cada módulo:

```
Route Handler → Controller → Service → Repository → Database
```

Los Route Handlers **sólo orquestan**. La lógica de negocio vive en Services y
Repositories. Nada de `route.ts` de 500 líneas.

---

## 9. Código

Todo código debe:

- ser **TypeScript** en todo el stack
- respetar la arquitectura y el layering definidos (§8)
- ser modular, mantenible, con nombres claros
- evitar duplicación innecesaria
- **manejar errores explícitamente** (nada de `catch` vacío o silencioso)
- **validar todos los inputs** en el borde (API / Server Action / job)
- aplicar seguridad desde el principio, no después
- incluir tests cuando corresponda (lógica de negocio, dinero, estados, edge cases)

**Dependencias:** no agregar dependencias innecesarias. Antes de introducir una
dependencia importante, evaluar si realmente hace falta y justificarlo.

---

## 10. Seguridad

Prohibido, sin excepción:

- hardcodear secretos, API keys, tokens o passwords
- commitear credenciales
- exponer credenciales en frontend, logs o base de datos

Reglas:

- Secretos **sólo** en variables de entorno / gestor de secretos.
- Los **tokens OAuth de vendedores** son datos sensibles: **cifrados en reposo**
  (`TOKEN_ENCRYPTION_KEY`).
- `.env` nunca se commitea; sí se mantiene un `.env.example` sin valores reales.
- Auth propia de Offside ≠ OAuth de Mercado Pago. Conectar MP **no es login** y no
  otorga confianza (BR-003).
- Referencia: `docs/04-technical/security-observability-analytics.md`.

Variables de entorno de referencia (`tech-stack.md` §4): `DATABASE_URL`,
`REDIS_URL`, `MERCADOPAGO_CLIENT_ID` / `CLIENT_SECRET` / `ACCESS_TOKEN` /
`WEBHOOK_SECRET`, `CORREO_ARGENTINO_API_KEY` 🌐, `S3_ENDPOINT` / `S3_BUCKET` /
`S3_ACCESS_KEY` / `S3_SECRET_KEY`, `AUTH_SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`.

---

## 11. Integraciones externas

Toda integración externa vive **aislada** detrás de la capa de infraestructura de
su módulo. El dominio nunca se acopla al proveedor:

```
modules/payments/infrastructure/mercadopago/*
modules/shipments/infrastructure/correoargentino/*
```

Aplica a: **Mercado Pago, Correo Argentino, S3, Redis, PostgreSQL**.
No mezclar lógica específica del proveedor con lógica de negocio general.

### Mercado Pago (integración crítica)

Referencias: `docs/03-operations/payments-and-commissions.md` y
`orders-and-refunds.md`. Cubren Checkout Pro, Split 1:1, OAuth de vendedores,
webhooks, estados de pago, idempotencia y refunds.

Reglas duras:

- **Los webhooks son la fuente de verdad** de pagos y envíos — **no** el redirect
  del frontend.
- Toda operación de pago debe ser **idempotente** (los webhooks se reintentan y
  llegan desordenados).
- Se conserva el **estado crudo** de MP (`mp_status` / payload `raw`) además del
  estado mapeado de Offside (DEC-035).
- **No asumir comportamientos de Mercado Pago que no estén confirmados.** Si algo
  depende de comportamiento externo no verificado: investigarlo contra la
  documentación oficial, o marcarlo 🔵 y reportarlo. No inventar endpoints, campos
  ni códigos de estado.
- La tasa de MP **no se hardcodea** (DEC-030).

Mismo criterio para **Correo Argentino** (`docs/03-operations/shipping.md`).

---

## 12. Configuration Store

Offside Store tiene un **Config Store administrativo** (DEC-013 / DEC-038;
registro completo en `docs/04-technical/configuration-registry.md`).

Todo lo que la documentación marque **⚙️ CONFIGURABLE** debe seguir siendo
configurable desde Admin. **No hardcodear** esos valores. Entre otros:

- comisión (%)
- límites y cupos
- ventanas de tiempo (liberación de fondos, plazos de disputa y refund)
- reglas de marketplace
- parámetros de riesgo y umbrales de nivel de usuario / seller tier
- parámetros de publicación

Regla complementaria: los valores usados en una operación concreta se guardan como
**snapshot económico** en la transacción y nunca se recalculan con la configuración
futura.

---

## 13. Documentación del código

La documentación de implementación va en **`offsideApp/docs-implementation/`**,
nunca dentro de `docs/`, que es solo lectura. El nombre evita que se confunda con
la fuente de verdad. Ahí puedo crear documentación **exclusivamente de
implementación**:

- arquitectura implementada
- decisiones técnicas de implementación (ADRs de código)
- setup local, comandos, testing
- APIs implementadas
- troubleshooting

Esta documentación **describe cómo está implementado el código**.
**No reemplaza** a `docs/` y nunca puede contradecirla. Si la contradice, gana
`docs/` y hay que reportar la discrepancia (§4).

---

## 14. Git

- Antes de cambios importantes: `git status` y revisar cambios existentes.
- **No hacer commits automáticamente**, salvo pedido explícito del usuario.
- **Nunca hacer push automáticamente**, salvo autorización explícita.
- No eliminar ni sobrescribir trabajo que no haya creado yo.
- La raíz del repo es `C:\Users\tango\Documents\Proyects\Offside Store\`; el
  código vive en `offsideApp/`. **`docs/` y `design/` están versionadas junto al
  código** (ver §18): la fuente de verdad tiene historial y trazabilidad. Siguen
  siendo solo lectura (§3).
- Remote: `origin → github.com/joaquinregueiro/offsideStore.git`, rama `main`.
- Nunca crear un `git init` anidado dentro del repo. Un `.git` de más ya causó
  una duplicación de repositorios (§18).
- Hay **un solo** `.gitignore` por ámbito: el de la raíz cubre entorno y editor;
  el de `offsideApp/` cubre dependencias y artefactos de build.

### Cambios existentes

Antes de modificar un archivo: verificar si contiene cambios previos hechos por el
usuario u otro proceso. **No asumir que un cambio ajeno es incorrecto.**
Preservarlo; si estorba, preguntar.

---

## 15. Forma de trabajo (por fases)

**Antes de empezar una fase:**

1. leer la documentación relevante en `docs/`
2. entender los requerimientos
3. identificar dependencias
4. identificar decisiones 🟡 / 🔵 / 🔴 que bloqueen
5. **proponer el plan** y esperar aprobación

**Durante la implementación:**

1. cambios pequeños e incrementales
2. validar
3. ejecutar tests
4. revisar errores
5. continuar

**Al terminar:**

1. verificar la implementación
2. ejecutar tests
3. revisar `git diff`
4. informar qué se modificó
5. informar problemas encontrados y decisiones que quedaron pendientes

---

## 16. No inventar (regla crítica)

- Si no sé algo: **no invento**.
- Si una decisión no está documentada: **no la asumo en silencio**.
- Si hay varias alternativas razonables: las explico con trade-offs y **pido
  decisión**.
- Si un comportamiento depende de un tercero y no está confirmado: lo marco 🔵 y lo
  reporto.

Preferible una pregunta a una suposición que se convierta en deuda arquitectónica.

---

## 17. Objetivo y prioridades

Construir Offside Store como un marketplace **serio, mantenible y escalable**. No
optimizar sólo para "que funcione".

Prioridades, en orden: **corrección → seguridad → mantenibilidad → trazabilidad →
testabilidad → simplicidad → escalabilidad razonable.**

Evitar sobreingeniería prematura. Regla DEC-032: **simple por defecto, configurable
cuando sea necesario.**

---

## 18. Notas del entorno (verificadas 2026-08-20)

- Repo git: raíz `C:\Users\tango\Documents\Proyects\Offside Store\`, remote
  `origin → github.com/joaquinregueiro/offsideStore.git`, rama `main`.
- Historial: `15bf4ea Initial commit` → `926bb22 inicial`. El segundo commit
  incorpora `docs/`, `design/` y `CLAUDE.md` (40 archivos versionados).
- **La foundation técnica está construida y sin commitear** (ver §19): monorepo
  en `offsideApp/`, sin funcionalidades de negocio y sin schema de Drizzle.
- `docs/` y `design/` están **dentro del repositorio**, por lo que la fuente de
  verdad queda versionada junto al código.
- El proyecto **ya no está en OneDrive**: se migró a `Documents\Proyects\`, lo
  que elimina el riesgo de que la sincronización rompa `node_modules/`.
- La ruta **sigue conteniendo espacios** (`Proyects\Offside Store`): entrecomillar
  rutas en scripts, configuración y comandos.
- Plataforma: Windows. Los comandos que se documenten deben funcionar ahí.

### Consolidación del repositorio (2026-08-20)

El proyecto tenía **dos repositorios git distintos** y el contenido anidado un
nivel de más. Se consolidó así:

| Antes                                                                                        | Después                                                     |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `Offside Store/offsideApp/.git` (commit `15bf4ea`, **con** remote de GitHub)                 | → movido a `Offside Store/.git` — **es el repo definitivo** |
| `Offside Store/Offside Store/.git` (commit `ce72d08`, **sin** remote, `git init` accidental) | → apartado como respaldo fuera del repo; no se borró        |
| `Offside Store/Offside Store/{docs,design,CLAUDE.md,.gitattributes}`                         | → subidos a la raíz `Offside Store/`                        |
| carpeta anidada `Offside Store/Offside Store/`                                               | → eliminada (quedó vacía)                                   |

### Migración fuera de OneDrive (2026-08-20)

Tras consolidar, el proyecto se migró a
`C:\Users\tango\Documents\Proyects\Offside Store` y se apuntó a un repositorio
nuevo de GitHub (`offsideStore`, antes `offsideApp`). Verificado: `git fsck`
sin errores, 39 archivos idénticos a la copia original, working tree limpio y
commit `926bb22` presente en el remoto.

La copia vieja de OneDrive fue **eliminada por el owner**. Ya no hay riesgo de
trabajar en el repositorio equivocado.

---

## 19. Estado de la implementación (2026-09-08)

**Marketplace operable de punta a punta: alguien puede registrarse, publicar,
comprar y cobrar —y Offside administrarlo— sin tocar la API a mano.**
Desplegado en producción.

> Esta sección venía desactualizada: afirmaba "schema de Drizzle vacío" y "sin
> funcionalidades de negocio" cuando el ERD ya estaba migrado y auth funcionaba.
> Es exactamente el fallo que previene §13. **Actualizar esta sección es parte de
> terminar un módulo, no una tarea aparte.**

Qué existe en `offsideApp/`:

|                                    |                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `apps/web`                         | Next.js 16 + React 19. **21 pantallas** y **22 rutas de API**                      |
| `packages/config`                  | validación de entorno con Zod. **No es el Config Store de negocio** (§12)          |
| `packages/database`                | **ERD v1.3** completo en Drizzle: **52 tablas, 38 enums, 9 migraciones aplicadas** |
| `packages/jobs`                    | Redis, colas y workers de BullMQ. Primera cola de negocio: `notifications-send`    |
| `packages/types`, `packages/utils` | tipos y utilidades transversales, sin lógica de negocio                            |

Módulos de dominio implementados (`apps/web/src/modules/`):

| Módulo     | Alcance                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `auth`     | registro, verificación de email, login, logout, sesión, reset de password, rate limiting                                        |
| `users`    | historial de hechos (`user_history_events`, DEC-036)                                                                            |
| `sellers`  | alta de perfil, identidad fiscal CUIT/CUIL/CDI, **conexión OAuth con Mercado Pago** y **aprobación automática (TS-001/TS-010)** |
| `audit`    | escritor de `audit_log` (ERD §19.1). Transversal: lo usan sellers y payments                                                    |
| `listings` | publicación de prendas, catálogo propio y **vitrina pública** + catálogo de categorías                                          |
| `orders`   | compra directa, snapshot económico, comisión del 6% (DEC-043) y bandeja de ventas del vendedor                                  |
| `payments` | Checkout Pro con **Split 1:1**, webhooks firmados, conciliación del reparto y refunds                                           |

**De las 52 tablas migradas se usan 25.** El resto está creada y vacía.
`categories` dejó de estar vacía: la migración `0004` carga sus seis filas.

**Mercado Pago — conexión Y pagos, verificados contra la API real.**

- **Conexión** (`mercadopago-oauth-spec.md`): PKCE S256, `state` de un solo uso
  en Redis, tokens cifrados con AES-256-GCM, conflictos de cuenta,
  desvinculación y auditoría.
- **Pagos** (`mercadopago-payments-spec.md`): preferencia creada **sobre la
  cuenta del vendedor** con `marketplace_fee`, webhooks autenticados por
  `x-signature`, reconsulta del pago a MP —nunca se confía en el payload—,
  idempotencia y refunds.

**Prueba real de punta a punta el 2026-08-26**: vendedor conectado → listing
publicado → orden → checkout → pago aprobado en Mercado Pago → webhook firmado →
orden en `PAID`, sin intervención manual. El reparto quedó
`6000` de Offside + `4100` de Mercado Pago + `89900` para el vendedor sobre
`100000`, **confirmando DEC-043**: el costo de MP se descuenta del lado del
vendedor y la comisión de Offside es un 6% limpio. Detalle y hallazgos en
`mercadopago-payments-module.md`.

**Un solo cambio de ERD en todo el esfuerzo**: `payments.mp_preference_id`
(migración `0002`). El resto ya estaba modelado. Las migraciones `0003` y `0004`
**no tocan el esquema**: cargan datos —la comisión y las categorías—.

**Categorías (migración `0004`)**: `categories` estaba vacía y
`listings.category_id` es FK `NOT NULL`, así que publicar era imposible. Se
cargan las **seis** filas del enum `garment_category`, que `database-design.md`
§5 define como conjunto fijo y excluye de `catalog_change_requests` (DEC-041):
no se inventó taxonomía. ⚠️ `required_attributes` y `aliases` quedan NULL — son
🟦 y dependen de decisiones y módulos que todavía no existen.

**Config Store operativo**: la comisión dejó de ser una constante. Vive en
`app_settings.commission_rate_default` (600 basis points = 6%), la carga la
migración `0003` y se cambia por `PUT /api/admin/settings/commission`, protegido
por la capacidad `system_config:manage` (DEC-023 ✅) — sin redeploy y sin SQL.
`orders` la lee UNA vez al crear la orden y la congela en el snapshot (DEC-030);
`payments` nunca la consulta. `updatedBy` sale de la sesión, nunca del cuerpo.
Se opera desde `/admin/comision`.

**Stock anti-overselling**: se descuenta al aprobarse el pago (MF-022 /
BR-022), con revalidación en el checkout (UC-MF-3) y descuento **atómico** en la
misma transacción que el paso a `PAID`. Un webhook repetido no descuenta dos
veces.

**Autorización por capacidad (DEC-023 ✅)**: los endpoints administrativos
declaran QUÉ capacidad necesitan y un mapa único (`lib/permissions.ts`) traduce
capacidad → roles. Hoy hay dos: `payments:refund` y `system_config:manage`. ⚠️
`MODERATOR` y `SUPPORT` quedan declarados **sin capacidades** hasta que exista
su funcionalidad. Los roles se asignan **sólo por SQL**: no hay vía de escalada
expuesta. Detalle en `authorization-module.md`.

**Aprobación de vendedores (TS-001/TS-010)**: identidad verificada = email
verificado + identificador fiscal válido + Mercado Pago conectado. Con las tres,
el vendedor **se aprueba solo**. La decisión quedó registrada en `docs/` como
**DEC-044**, y TS-001 pasó a ✅. De paso se corrigió el gate invertido que exigía
`approved` para conectar Mercado Pago, contra UC-SS-1.
⚠️ El identificador fiscal se valida por formato y dígito verificador, **no**
contra ARCA: no prueba titularidad por sí solo. Detalle en
`seller-approval-module.md`.

**Emails — ✅ ENTREGANDO EN PRODUCCIÓN (2026-09-02)**: verificación de cuenta,
**reenvío de la verificación** y reset de contraseña se envían por **Amazon SES**
detrás de un puerto, encolados en BullMQ. **Con esto cae el último bloqueo del
alta**: hasta ahora nadie podía completar un registro sin un `UPDATE` a mano.
El worker corre en el proceso web vía `instrumentation.ts` (`tech-stack.md`
§5), así que **no hace falta un segundo servicio**. ⚠️ El proveedor NO está en
DEC-012: es una decisión de implementación del owner, y por eso vive detrás de
un adaptador. Detalle en `notifications-email-module.md`.

El **reenvío** (2026-09-02) cerró un agujero, no agregó una comodidad: una cuenta
cuyo email no llegaba quedaba **muerta** —no podía ingresar por BR-001 y no
había forma de emitir otro token—, y la pantalla prometía un reenvío que no
existía. No revela si la cuenta existe ni si ya está verificada.

**Rate limiting — cerrado en las Server Actions de `auth` (2026-09-02)**: el
limitador vivía **sólo en los Controllers**, y las Server Actions llaman al
Service directo. O sea que `POST /api/auth/login` estaba limitado y **el
formulario de `/ingresar` no**: la puerta protegida era la que casi nadie usa.
Eso dejaba abiertos el credential stuffing y, peor, el agotamiento de recursos
—argon2id usa ~19 MB por intento a propósito, así que sin techo cada intento
fallido cuesta memoria del servidor y **no hace falta acertar una sola password
para voltear el sitio**—.

`lib/rate-limit-actions.ts` reusa las MISMAS funciones y por lo tanto las mismas
claves de Redis: si contaran aparte, un atacante bloqueado por un camino
seguiría libre por el otro. Dos criterios opuestos y los dos correctos: en login
el cupo por cuenta lo consumen **sólo los fallos** —si no, mandar cinco intentos
con el email ajeno dejaría a esa persona afuera de su cuenta—; en los envíos de
email lo consumen **todos**, porque ahí el intento exitoso ES el daño.
Detalle en `rate-limiting.md`.

⚠️ Costo aceptado: cinco fallos contra una cuenta la bloquean por la ventana,
así que **un atacante puede dejar a alguien afuera**. Es inherente a cualquier
límite por cuenta y ya estaba en la API. La salida cuando moleste no es subir el
número: es pedir prueba de humanidad tras los primeros fallos.

**Rate limiting — cerrado también en las operaciones AUTENTICADAS
(2026-09-08)**: publicar, editar, subir fotos, comprar, pagar, conectar Mercado
Pago y el back-office consumen su cupo. Con esto cae el pendiente que la entrada
anterior dejaba anotado.

⚠️ **Acá se cuenta por USUARIO, no por IP, y no es una preferencia de estilo.**
En auth la IP es lo único que hay: quien intenta entrar todavía no es nadie.
Acá hay sesión verificada, y entonces la IP es la peor de las dos claves —detrás
de un NAT (una oficina, la red móvil de una operadora) muchísima gente comparte
una sola, así que el abuso de un desconocido consumiría el cupo del resto; y una
IP se rota gratis, mientras que para tener otro `user_id` hay que verificar un
email real—. Los límites por IP que ya tenía la API **no se tocaron**; el
contador por usuario corre además en los dos caminos, la pantalla y el endpoint.

⚠️ **Presupuesto aparte del de auth.** `ACTIONS_RATE_LIMIT_MAX_PER_USER` (60) y
`ACTIONS_RATE_LIMIT_WINDOW_MINUTES` (15) son variables nuevas: los números de
auth están calibrados contra adivinar una password —5 por cuenta— y heredarlos
bloquearía a un vendedor que sube su catálogo un domingo a la tarde.

Lo que más lo justifica: `publicar` y `agregarFotos` son **las operaciones más
caras del sistema** —cada foto se decodifica y se reescribe en tres tamaños,
hasta ocho por envío—, así que un bucle desde una sola cuenta agota la memoria
del VPS sin explotar nada. Cada familia de operaciones cuenta aparte: si
publicar y editar compartieran contador, ordenar el catálogo dejaría sin poder
publicar. Los administrativos también se limitan: tener la capacidad no vuelve
inofensiva la repetición —cada cambio de comisión inserta una fila versionada y
cada reembolso mueve plata real—.

⚠️ **NO es un cupo de negocio.** Cuántas publicaciones puede tener un vendedor
es ⚙️ CONFIGURABLE (Config Store, §12) y el throttling por estado de riesgo es
TS-042, con umbrales 🟡. Esto es un techo de seguridad: alto para una persona,
bajo para un script. Valores 🟡 pendientes de confirmación.

⚠️ Costo aceptado: sin límite por IP, alguien con varias cuentas verificadas
suma el cupo de todas desde una sola máquina. Cada cuenta cuesta un email real y
pasa por `register`/`verify-resend`, que sí se limitan por IP.

**Vendedor desconectado — SS-013 / UC-SS-4 (2026-09-09)**: si un vendedor
desconecta Mercado Pago, sus publicaciones dejan de mostrarse en la vitrina, en
la búsqueda y en su ficha, y vuelven solas al reconectar.

Cierra el hueco que esta misma sección listaba: la compra ya rechazaba con `409
SELLER_NOT_OPERATIONAL`, pero la vitrina seguía ofreciendo la publicación, así
que el comprador se enteraba **después** de entrar, completar la dirección y
apretar comprar.

⚠️ **No era una decisión de producto abierta, como se venía diciendo acá.** Al
leer la documentación para implementarlo apareció que ya estaba decidida:
SS-013 dice que esas publicaciones "no pueden venderse" y que "el sistema debe
detectar y **comunicar** este estado", y UC-SS-4 es literal —"marca la cuenta
como MP desconectado y **pausa la venta hasta reconectar**"—. El código no
eligió una política: la cumplía a medias.

⚠️ **"Pausa la venta" se implementa como PREDICADO DERIVADO, no pisando
`listings.status`.** Es la decisión de diseño que más importa: si la desconexión
materializara `paused`, al reconectar sería imposible distinguir las que el
vendedor había pausado a mano (SS-050) de las que apagó la desconexión, y se
reactivarían publicaciones que su dueño quería abajo. Con un predicado, el
estado nunca se toca y reconectar no puede romper nada. Hay test que lo fija.

Alcance: vitrina, ficha (`/p/[id]` → **404**) y búsqueda —resultados, total y
facetas—. La ficha importa más de lo que parece: el enlace se comparte por
WhatsApp y sobrevive al catálogo. Las facetas también: si contaran lo invisible
ofrecerían "Talle L (1)" y al tocarlo no habría nada.

⚠️ **El panel del vendedor NO filtra**, al revés que la vitrina y a propósito:
esconderle sus propias publicaciones sería hacerle creer que las perdió, y la
reacción natural —borrarlas y republicar— destruye su historial. Lo que cambia
es el aviso, que es la mitad "comunicar" de SS-013 y era la que faltaba: dice
cuántas dejaron de verse y que **vuelven solas**, para que no toque nada.

⚠️ El predicado queda expresado **dos veces** —Drizzle para vitrina/ficha, un
`EXISTS` para la búsqueda— además del `canSell()` de `sellers`. Es la misma
duplicación consciente que ya existía entre `isPurchasable()` y el WHERE del
catálogo, y se acota igual: un solo lugar por lenguaje y tests que fijan que
digan lo mismo.

Verificado en el navegador: con MP conectado la camiseta aparece en vitrina,
búsqueda y ficha; desconectando queda vitrina en 0, búsqueda en "0
publicaciones" y ficha en **404**; reconectando vuelven las tres, y la
publicación siguió en `active` todo el tiempo.

**Rebotes y quejas de email — ✅ EN PRODUCCIÓN (2026-09-08)**:
`POST /api/webhooks/ses/notifications` recibe por SNS lo que publica SES y las
direcciones afectadas dejan de recibir email.

⚠️ **La mitad protectora ya existía sin que lo supiéramos.** La cuenta se creó en
2026, y AWS documenta que toda cuenta posterior al 25/11/2019 usa la lista de
supresión a nivel cuenta **por defecto**: SES no entrega a lo que rebotó duro y
esos envíos no cuentan para la tasa de rebote. El miedo original —que AWS
suspenda la cuenta— estaba mayormente cubierto de fábrica.

Lo que SES **no** hace es avisarnos: acepta el mensaje, el job termina bien, el
log dice "enviado" y nadie se entera de que no llegó nunca. Eso deja una **cuenta
muerta en silencio** —typo al registrarse → no puede ingresar por BR-001 → pide
reenvío → el reenvío "sale bien" y no llega—, que es el mismo agujero que cerró
el reenvío de verificación, un escalón más abajo. Esa es la mitad que se
construyó.

**`email_suppressions` no estaba en el ERD.** Ninguna de las 51 tablas cubría
esto: `notifications` (§18) es la campanita in-app, sin dirección ni estado de
entrega. El ERD sí modelaba los webhooks del otro proveedor
(`payment_webhook_events`); el de email, no. La tabla **la autorizó el owner**
(§4/§5) y el ERD se actualizó a **v1.3** con su misma autorización: §18.1 la
define, §2/§3/§24 quedaron sincronizados y la invariante
`ERD = Drizzle = Migration = PostgreSQL` se verificó contra la base real —52
tablas y 38 enums en los dos lados—.

⚠️ **El endpoint es público y sin sesión**, así que se autentica por firma igual
que el de Mercado Pago: sin eso, cualquiera que descubra la URL podría postear un
rebote falso con la dirección de otra persona y dejar esa cuenta muda. Hay **dos
puertas** y el orden importa: primero el `TopicArn` esperado —porque verificar la
firma puede obligar a descargar un certificado, y esa descarga la dispara un
desconocido— y después la firma RSA. La URL del certificado se valida **antes**
del fetch (HTTPS, `.pem`, host de SNS): evita a la vez que el atacante sirva su
propio certificado y que el endpoint sirva de SSRF. Falla **cerrado**, al revés
que el rate limiter y por la razón opuesta.

⚠️ **Lo más cuidado es a quién NO se suprime**: los rebotes `Transient` y
`Undetermined` no suprimen —es temporal, y adivinar cuesta dejar afuera a una
persona real— y la queja `not-spam` tampoco, porque es el único valor de IANA que
significa lo contrario que los demás. Suprimir de más no lo ve nadie hasta que
alguien se queja.

Verificado contra el endpoint corriendo: topic ajeno, firma inventada y
certificado en un host del atacante → **403**; cuerpo basura → **400**; cero
filas suprimidas. Detalle en `notifications-email-module.md`.

⚠️ **Falta la mitad visible**: no hay pantalla para liberar una dirección (se
hace por SQL, como los roles) ni aviso a la persona afectada. Decir "esa
dirección rebota" sólo cuando está suprimida convertiría la pantalla de reenvío
en un oráculo de qué direcciones están en el sistema, así que **qué mostrarle es
decisión de producto y sigue 🟡**.

**Refresh de tokens de MP**: barrido diario (BullMQ, 04:00) que renueva las
conexiones que vencen dentro de 30 días. ⚠️ Mercado Pago **rota** el
`refresh_token`, así que hay lock en Redis por vendedor: dos renovaciones
simultáneas dejarían la conexión sin poder renovarse nunca más. Un rechazo la
pasa a `expired`; una caída de red la deja intacta. Sin migraciones:
`last_refreshed_at` ya estaba en el ERD. **No probado contra MP real.**

**Frontend (2026-09-02)**: Server Components + Server Actions, CSS Modules y el
sistema visual de `design/` (Big Noodle + Inter, Verde Cancha). **Los formularios
funcionan sin JavaScript**: sin JS el navegador hace el POST nativo; con JS,
`useActionState` muestra el error sin recargar. Cinco grupos de rutas:

| Grupo        | Pantallas                                                                     |
| ------------ | ----------------------------------------------------------------------------- |
| público      | home/vitrina, detalle de publicación, errores                                 |
| `(auth)`     | registro, ingreso, verificación de email, olvidé/restablecer contraseña       |
| `(compra)`   | confirmar compra, checkout/pago y mis compras                                 |
| `(vendedor)` | panel, alta, identidad fiscal, Mercado Pago, publicaciones, publicar y ventas |
| `(admin)`    | índice del back-office, comisión y consola de pagos/reembolsos                |

⚠️ **El retorno de Mercado Pago NO confirma el pago** (BS-072 / DEC-028): con
`?status=success` y la orden todavía en `PENDING_PAYMENT`, el checkout dice
"estamos confirmando", nunca "pagado". La fuente de verdad es el webhook.

⚠️ **La autorización de las pantallas NO se duplica.** `lib/session.ts` lee la
cookie con `cookies()` porque un Server Component no tiene `Request`, pero la
regla sigue siendo `resolveSession` y el mapa de `lib/permissions.ts`. Diferencia
deliberada con la API: una pantalla **redirige**, un endpoint **lanza** 401/403;
y sin capacidad administrativa se devuelve **404, no 403** (el back-office no
debería existir para quien no es admin). Cada Server Action revalida por su
cuenta: son alcanzables por POST directo sin pasar por la pantalla.

**Back-office (DEC-023)**: el índice muestra sólo las capacidades del rol, y eso
es **cortesía, no seguridad** — cada pantalla y cada Server Action vuelven a
exigir la suya contra el mismo mapa de `lib/permissions.ts`. Verificado por rol:
`ADMIN` entra a todo, `FINANCE` opera pagos y recibe 404 en comisión, `MODERATOR`
recibe 404 en todo, y un usuario común contra la API recibe 403.
⚠️ La consola de reembolsos **avisa en pantalla** que nunca se ejecutaron contra
Mercado Pago real y que la deuda por saldo insuficiente no se registra.
⚠️ La consola **no lista** todos los pagos: se busca por número de orden. Un
listado global de pagos de la plataforma sería una fuga esperando.

**Fotos de publicaciones — ✅ EN PRODUCCIÓN (2026-09-08)**: subida, procesamiento
y entrega desde **Cloudflare R2**, detrás de un puerto igual que SES. ⚠️ El
proveedor NO está en DEC-012 —OQ-I3 sigue abierta—: es una decisión de
implementación del owner. La configuración (8 fotos, 5 MB, JPEG/PNG/WebP) vive
en `app_settings` (migración `0005`), no hardcodeada.

⚠️ **Es la primera entrada BINARIA del sistema**, y `image-processor.ts` es su
frontera de seguridad: se decodifica el archivo en vez de creerle al
`Content-Type`, hay techo de píxeles contra bombas de descompresión, **se borra
el EXIF** —una foto de celular lleva las coordenadas de la casa de quien vende—
y **nunca se guardan los bytes originales**: todo se recodifica a WebP, así que
lo que llega al bucket es lo que produjo el codificador.

⚠️ **Se guarda la CLAVE del objeto, no la URL.** El dominio público es
configuración y puede cambiar; la dirección se compone al leer. Cambiar
`S3_PUBLIC_URL` reapunta **todas** las fotos sin migrar filas. Hoy se sirve desde
la URL de desarrollo de R2, que Cloudflare desaconseja para producción: el
dominio propio requiere mover el DNS de `offside.com.ar` a Cloudflare, y esa
migración arrastra los registros DKIM/SPF de SES.

**PS-010 en vigor (2026-09-08)**: al menos una foto para publicar. No se puede
validar al crear —las imágenes necesitan que la publicación exista, por la FK—,
así que se implementó **SS-032**: la publicación **nace en `draft`** y se activa
recién cuando tiene una imagen. Sin fotos queda en borrador, fuera de la
vitrina, y el vendedor la completa desde sus publicaciones. Borrar la última
foto de una activa se **rechaza**: bajarla en silencio sería dejar de vender sin
enterarse.
⚠️ Las publicaciones creadas ANTES de esto siguen `active` sin fotos: no se
tocaron retroactivamente.

**Editar, pausar y eliminar publicaciones — SS-040/041/050/051 (2026-09-08)**:
el vendedor puede corregir lo publicado y sacarlo de la venta.

- **Precio y condición se auditan** (BR-015, que es un MUST): el precio va
  además a `listing_price_history` (ERD §9.3, hasta hoy vacía) porque su
  historia se consulta como serie. Editar el título NO ensucia nada: auditar
  cada typo escondería lo que importa.
- **Cambiar el precio no afecta órdenes ya creadas** (BR-023 / SS-041). Sale
  gratis: la orden congeló su importe al crearse (DEC-030) y nunca vuelve a
  leer el precio. Hay test, porque es plata de alguien.
- **Reactivar vuelve a exigir PS-010.** Sin eso, borrar las fotos con la
  publicación pausada y reactivarla sería la puerta de atrás a la regla.
- **Eliminar es LÓGICO** (`status = 'deleted'`) y terminal: `order_items`
  referencia la publicación, así que borrarla de verdad rompería el historial
  de compras de quien ya la compró.
- **SS-051**: vender la última unidad la marca `sold_out` sola, en la MISMA
  transacción que el descuento de stock. Sólo desde `active`: el estado de una
  pausada lo decidió una persona y no lo pisa un efecto secundario.
- ⚠️ **No se puede cambiar la categoría**: volvería obligatorios atributos que
  la publicación no tiene (ERD §9.1).
- ⚠️ Que la edición se pueda **apagar** es ⚙️ y sigue 🟡
  (`configuration-registry.md` §8): existe el mecanismo, no la perilla.

**Búsqueda — PS-020/020.b/021/022, DEC-042 (2026-09-08)**: full-text en
PostgreSQL, sin motor externo. `/buscar` con texto libre, facetas combinables y
conteos, y el buscador del header —que era decorativo— ya funciona.

- Todo viaja **en la URL por GET**: una búsqueda se comparte, se guarda en
  favoritos y vuelve con el botón atrás. Y anda sin JavaScript.
- **Dos mecanismos de coincidencia y hacen falta los dos**: full-text `spanish`
  con `unaccent` para palabras y variantes, y **trigramas** para lo mal escrito.
  El ejemplo obligatorio de PS-020.b —`"river 96 adidas"` encuentra `"River
Plate 1996 Adidas"`— y `"indepediente"` → `"Independiente"` están cubiertos
  por tests.
- **`search_vector` lo puebla el Service**, no un trigger ni una columna
  generada, como DEC-042 exige. Se reindexa al publicar y al editar; que falle
  no aborta la publicación.
- **Los pesos del ranking viven en `app_settings`** (migración `0006`), nunca
  hardcodeados: DEC-042 lo dice con esas palabras.
- La búsqueda usa **el mismo filtro de visibilidad que la vitrina** (ERD §9.1).
  Si mostrara una pausada o sin stock, prometería lo que la compra rechaza.
- Una faceta **no se filtra a sí misma**: si ya elegiste talle M, la lista sigue
  ofreciendo los demás para poder cambiar de idea.

**Catálogos controlados — PS-023/PS-024 (2026-09-08)**: las seis tablas de
`product-specification.md` §4.3 estaban **vacías**, así que `club_id`,
`brand_id`, `season_id`, `competition_id` y `national_team_id` eran siempre NULL
y la búsqueda facetada —el diferencial— no podía construirse.

La migración `0007` siembra **38 clubes, 25 selecciones, 18 marcas, 16
competiciones, 40 países y 135 temporadas**, todos con alias. ⚠️ §4.3 marca la
siembra como 🟡 HIPÓTESIS; la lista concreta **la aprobó el owner el
2026-09-08**, no se decidió desde el código.

- **PS-024 cumplido**: los alias entran al `search_vector` con peso `A`, así que
  **"CARP" y "Millonario" encuentran una camiseta cuyo título sólo dice
  "Camiseta retro 1996"**. Es el motivo por el que DEC-042 exigió que el vector
  lo poblara el Service: una columna generada no puede leer otra tabla.
- **PS-023 cumplido**: facetas por club, selección, marca, temporada y
  competición, con conteos y nombres legibles.
- Los campos son **opcionales al publicar**: exigirlos dejaría afuera cualquier
  camiseta cuyo club no esté sembrado, y el flujo de propuestas no existe.
- Una faceta **vacía no se muestra**: ofrecer un filtro que no filtra es peor
  que no ofrecerlo. Las de catálogo se recortan a 12 valores por cantidad — un
  desplegable con 135 temporadas no es un filtro, es una lista.

⚠️ **`catalog_change_requests` (DEC-041) NO está implementada.** La estructura
existe en el ERD y la decisión está cerrada, pero **quién aprueba sigue 🟡**:
depende de una capacidad nueva en el mapa de DEC-023, y `MODERATOR` hoy no tiene
ninguna. Mientras tanto el catálogo sólo crece por migración. No bloquea a nadie
porque los campos son opcionales.

**NO implementado:** webhook `mp-connect`, `catalog_change_requests`, jugador y
número en el formulario, ranking por popularidad/reputación (PS-021: no hay
reviews ni métricas), carrito, envíos, disputas, reviews, reputación, reordenar
fotos y editar la autenticidad declarada. Del back-office existen
**dos** de las nueve capacidades que lista `AR-006`: el resto pertenece a módulos
que todavía no existen. De los nueve emails que lista la documentación sólo están
los dos de `auth`; sus rebotes y quejas sí se procesan. Los refunds tienen código y tests, pero **no se probaron
contra Mercado Pago real**.

Tests: **538** (281 unitarios + 257 de integración contra PostgreSQL y Redis
reales). CI corre ambos, aplica las migraciones sobre una base vacía y verifica
que no haya drift entre el schema de Drizzle y las migraciones.
⚠️ Los fixtures **leen** las categorías que carga la migración `0004`; no crean
las suyas. `categories.code` es UNIQUE y son un conjunto fijo, así que inventar
una de test chocaba contra la fila real.

**Desplegado en producción** en **`offside.com.ar`**, en un VPS con Coolify
(DEC-012), con HTTPS y migraciones aplicadas al arrancar el contenedor. Ver
`offsideApp/docs-implementation/deployment-coolify.md`.

⚠️ **El dominio propio reemplazó al `sslip.io` del principio (2026-09-02).** Eso
obliga a mantener alineados `APP_URL`, `MERCADOPAGO_REDIRECT_URI` y la Redirect
URI del panel de Mercado Pago —MP exige coincidencia **exacta** y, si no
coincide, conectar un vendedor falla sin decir por qué—. `APP_URL` además
construye los enlaces de los emails.

Comandos (desde `offsideApp/`): `npm run dev`, `build`, `verify`
(format + lint + typecheck + test), `test`, `docker:up`, `db:generate`,
`db:migrate`. Detalle en `offsideApp/docs-implementation/setup-local.md`.

### Decisiones técnicas tomadas sin cobertura documental

`docs/` no define gestor de paquetes, framework de tests, CI ni librería de
validación. Se eligieron npm workspaces, Vitest, GitHub Actions y Zod, y se
fijó TypeScript en 5.9.3 porque `typescript-eslint@8` todavía no soporta TS 7.
Todo está justificado en
`offsideApp/docs-implementation/adr/ADR-001-tooling-de-la-foundation.md`, que
sigue **pendiente de confirmación** del owner.

Para conectar Mercado Pago hacen falta además `MERCADOPAGO_CLIENT_ID`,
`MERCADOPAGO_CLIENT_SECRET`, `MERCADOPAGO_REDIRECT_URI` y
`TOKEN_ENCRYPTION_KEY`, exigidas en el borde del módulo con `requireEnv()`. Las
URLs de Mercado Pago son constantes en `infrastructure/mercadopago/`, no
configuración: son parte del contrato del proveedor.

Los parámetros operables de auth (`AUTH_SESSION_TTL_HOURS`,
`AUTH_PASSWORD_MIN_LENGTH`, `AUTH_EMAIL_TOKEN_TTL_HOURS`,
`AUTH_PASSWORD_RESET_TTL_HOURS` y los tres `AUTH_RATE_LIMIT_*`) son
**parámetros de seguridad**, no reglas de negocio del marketplace: viven en
entorno y **también siguen pendientes de confirmación**. La comisión, las
ventanas de pago/cancelación/refund y los límites del marketplace NO están ahí:
pertenecen al Config Store (§12) y siguen 🟡.

### Decisiones bloqueantes conocidas

Lo que hoy frena el avance, en orden de impacto:

1. ~~**B1 — liberación/retención de fondos en MP Split**~~ ✅ **cerrado el
   2026-09-01, en negativo.** Mercado Pago **no ofrece retención configurable**
   para este stack: al aprobarse el pago acredita al vendedor y no hay
   parámetro de `hold`, `release_date` ni escrow; `capture=false` no existe en
   Checkout Pro. DEC-019 se reescribió: **Offside asume el riesgo** y registra
   la deuda en `seller_liabilities`, que es la primera mitigación que RISK-F1 ya
   listaba. ⚠️ RISK-F1 pierde así su mitigación más fuerte y **sigue siendo el
   riesgo central del modelo**.
2. **DEC-011 — modelo fiscal** 🔴. No bloquea un MVP en sandbox; **sí bloquea el
   lanzamiento comercial**. El módulo fiscal está limitado a identificación.

> La contradicción que esta sección señalaba entre `configuration-registry.md`
> §12–13 y el ERD quedó **resuelta**: el registro fue alineado con DEC-039 y el
> Config Store está modelado como `app_settings` + `seller_tiers`.
> `app_settings` **está en uso** (la comisión); `seller_tiers` sigue vacía.

### Huecos conocidos en el código

⚠️ **Los refunds no contemplan que el vendedor no tenga saldo.** Si Mercado Pago
rechaza un refund por saldo insuficiente, hoy se devuelve `paymentProviderError`
y **no queda registro de que hay una deuda**: `seller_liabilities` sigue vacía y
sin código que la escriba.

Es el agujero que deja abierto el cierre de B1, y no es hipotético: es
exactamente el escenario de RISK-F1. Lo que **falta confirmar 🔵** es qué hace
Mercado Pago en ese caso —rechaza, deja la cuenta en negativo, o depende del
esquema—; hasta saberlo no se puede escribir el manejo correcto. Los refunds
tampoco se probaron nunca contra Mercado Pago real.
