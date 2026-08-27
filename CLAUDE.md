# CLAUDE.md — Offside Store

> Reglas de trabajo para Claude Code dentro de este repositorio.
> Ámbito: **todo el desarrollo de Offside Store**.
> Raíz del repo: `C:\Users\tango\Documents\Proyects\Offside Store\`.
> Estado: ERD migrado; auth, sellers y conexión con Mercado Pago implementados (ver §19).
> Última actualización: 2026-08-24.

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
│   ├── DECISIONS.md           ← decisiones oficiales (DEC-001 … DEC-038)
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

## 19. Estado de la implementación (2026-08-26)

**Cadena de venta completa contra Mercado Pago real, desplegada en producción.**

> Esta sección venía desactualizada: afirmaba "schema de Drizzle vacío" y "sin
> funcionalidades de negocio" cuando el ERD ya estaba migrado y auth funcionaba.
> Es exactamente el fallo que previene §13. **Actualizar esta sección es parte de
> terminar un módulo, no una tarea aparte.**

Qué existe en `offsideApp/`:

|                                    |                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `apps/web`                         | Next.js 16 + React 19. **Frontend: sigue siendo placeholder.** 20 rutas de API  |
| `packages/config`                  | validación de entorno con Zod. **No es el Config Store de negocio** (§12)       |
| `packages/database`                | ERD v1.2 completo en Drizzle: **51 tablas, 37 enums, 4 migraciones aplicadas**  |
| `packages/jobs`                    | Redis, colas y workers de BullMQ. Primera cola de negocio: `notifications-send` |
| `packages/types`, `packages/utils` | tipos y utilidades transversales, sin lógica de negocio                         |

Módulos de dominio implementados (`apps/web/src/modules/`):

| Módulo     | Alcance                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| `auth`     | registro, verificación de email, login, logout, sesión, reset de password, rate limiting                               |
| `users`    | historial de hechos (`user_history_events`, DEC-036)                                                                   |
| `sellers`  | alta de perfil (nace en `pending`), identidad fiscal CUIT/CUIL/CDI con historial y **conexión OAuth con Mercado Pago** |
| `audit`    | escritor de `audit_log` (ERD §19.1). Transversal: lo usan sellers y payments                                           |
| `listings` | publicación de prendas y lectura del catálogo propio                                                                   |
| `orders`   | compra directa, snapshot económico y comisión del 6% (DEC-043)                                                         |
| `payments` | Checkout Pro con **Split 1:1**, webhooks firmados, conciliación del reparto y refunds                                  |

**De las 51 tablas migradas se usan 16.** El resto está creada y vacía.

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
(migración `0002`). El resto ya estaba modelado.

**Config Store operativo**: la comisión dejó de ser una constante. Vive en
`app_settings.commission_rate_default` (600 basis points = 6%), la carga la
migración `0003` y se puede cambiar sin redesplegar. `orders` la lee UNA vez al
crear la orden y la congela en el snapshot (DEC-030); `payments` nunca la
consulta. Sin panel de admin: DEC-023 sigue 🟡.

**Stock anti-overselling**: se descuenta al aprobarse el pago (MF-022 /
BR-022), con revalidación en el checkout (UC-MF-3) y descuento **atómico** en la
misma transacción que el paso a `PAID`. Un webhook repetido no descuenta dos
veces.

**Emails**: verificación de cuenta y reset de contraseña se envían por
**Amazon SES** detrás de un puerto, encolados en BullMQ. El worker corre en el
proceso web vía `instrumentation.ts` (`tech-stack.md` §5), así que **no hace
falta un segundo servicio**. ⚠️ El proveedor NO está en DEC-012: es una decisión
de implementación del owner, y por eso vive detrás de un adaptador.
Detalle en `notifications-email-module.md`.

**NO implementado:** refresh de tokens de MP, webhook `mp-connect`, catálogo,
búsqueda, carrito, envíos, disputas, reviews, reputación, aprobación de vendedor,
admin y frontend. De los nueve emails que lista la documentación sólo están los
dos de `auth`. Los refunds tienen código y tests, pero **no se probaron
contra Mercado Pago real**.

Tests: **320** (188 unitarios + 132 de integración contra PostgreSQL y Redis
reales). CI corre ambos, aplica las migraciones sobre una base vacía y verifica
que no haya drift entre el schema de Drizzle y las migraciones.

**Desplegado en producción** en un VPS con Coolify (DEC-012), con HTTPS y
migraciones aplicadas al arrancar el contenedor. Ver
`offsideApp/docs-implementation/deployment-coolify.md`.

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

1. **TS-001 — "qué significa identidad verificada"** 🟡. Sin esto no se puede
   aprobar a ningún vendedor, y `seller_profiles.status` se queda en `pending`
   para siempre. Bloquea toda la cadena de venta. **Desde la conexión con
   Mercado Pago el bloqueo es visible en el código**: `connect` exige
   `approved`, así que hoy todo vendedor real recibe `MP_SELLER_NOT_APPROVED`.
   El gate NO se relajó: hacerlo sería inventar la decisión que falta.
2. **B1 — liberación/retención de fondos en MP Split** 🔵. Es la única
   mitigación conocida de RISK-F1, el riesgo central del negocio. **Requiere
   investigación contra la API real; no se asume.** La prueba del 2026-08-26
   mostró el reparto pero **no** cómo retener fondos: al aprobarse el pago, MP
   acredita al vendedor de inmediato.
3. **DEC-023 — permisos granulares por rol** 🟡. `requireAdminRole()`
   autoriza sólo por rol. Bloquea la aprobación de `catalog_change_requests`
   (OQ-F2), y es lo que impide darle un panel al Config Store: la comisión se
   cambia por SQL porque no hay a quién autorizar.
4. **DEC-011 — modelo fiscal** 🔴. No bloquea un MVP en sandbox; **sí bloquea el
   lanzamiento comercial**. El módulo fiscal está limitado a identificación.

> La contradicción que esta sección señalaba entre `configuration-registry.md`
> §12–13 y el ERD quedó **resuelta**: el registro fue alineado con DEC-039 y el
> Config Store está modelado como `app_settings` + `seller_tiers`. Ambas tablas
> están migradas pero **vacías y sin código que las lea**.
