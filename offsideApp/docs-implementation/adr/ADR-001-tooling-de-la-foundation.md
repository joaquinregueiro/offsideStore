# ADR-001 — Tooling de la foundation

- **Fecha:** 2026-08-20
- **Estado:** Parcialmente confirmado. El owner confirmó el **punto 0**
  (ubicación en `offsideApp/`), el **punto 1** (npm) y el **punto 6**
  (`packages/jobs`). Los puntos 3 (Vitest), 7 (`exactOptionalPropertyTypes`) y 8
  siguen **propuestos**.
- **Ámbito:** decisiones **técnicas** de implementación (CLAUDE.md §5). Ninguna
  toca arquitectura, ERD ni reglas de negocio.

## Contexto

`docs/04-technical/tech-stack.md` cierra DEC-012 y fija el stack: Next.js,
TypeScript, PostgreSQL, Drizzle, Redis, BullMQ, S3, Docker, monorepo Turborepo.

Pero **no dice nada** sobre varias piezas necesarias para que el repo funcione.
Se verificó por búsqueda en toda la documentación: no hay ninguna mención a
gestor de paquetes, framework de tests, proveedor de CI ni librería de
validación.

Estas decisiones se tomaron con criterio de "simple por defecto" (DEC-032) y se
documentan acá para que el owner las confirme o las cambie.

## Decisiones

### 0. Ubicación del monorepo: `offsideApp/` — ✅ decidido por el owner

El monorepo se construyó primero en la raíz del repositorio, siguiendo el
diagrama de `tech-stack.md` §2. El **2026-08-20 el owner decidió moverlo a
`offsideApp/`** y autorizó explícitamente actualizar la documentación que lo
contradecía.

```
Offside Store/            raíz del repo git
├── docs/  design/        fuente de verdad (solo lectura)
├── .github/workflows/    CI
└── offsideApp/           raíz del monorepo
```

Consecuencias:

- `docs/` deja de estar dentro del monorepo y pasa a ser hermana de
  `offsideApp/`. Se actualizó el diagrama de `tech-stack.md` §2 dejando
  constancia del cambio y de su autorización.
- El workflow de CI **no puede** moverse: GitHub sólo lee `.github/workflows`
  desde la raíz del repositorio. Usa `defaults.run.working-directory:
offsideApp`.
- Hay dos `.gitignore`: el de la raíz (entorno, editor) y el de `offsideApp/`
  (dependencias, artefactos). El segundo además hace que Prettier —que lee
  `.gitignore` por defecto desde Prettier 3— siga ignorando `next-env.d.ts`.
- No cambia nada de la arquitectura: mismos packages, mismo layering, mismos
  módulos.

### 1. Gestor de paquetes: npm workspaces — ✅ confirmado por el owner

Turborepo suele asociarse a pnpm, pero en esta máquina sólo hay npm y pnpm
requeriría instalación aparte. npm workspaces cubre el caso sin agregar nada.

**El owner decidió el 2026-08-20 mantener npm y npm workspaces, y no migrar a
pnpm.** La alternativa pnpm queda descartada; se menciona sólo como registro
histórico de la evaluación.

Estado verificado: único lockfile `package-lock.json`, `packageManager` fijado
en `npm@11.6.2`, workspaces `apps/*` y `packages/*`, y CI con `npm ci`. No hay
`pnpm-lock.yaml` ni `yarn.lock`.

### 2. TypeScript fijado en 5.9.3, no en la última

TypeScript 7.0.2 ya está publicado, pero `typescript-eslint@8` declara
`typescript: >=4.8.4 <6.1.0`. Con TS 7 el lint no arranca.

**Se revisa** cuando typescript-eslint soporte TS 7.

### 3. Tests: Vitest

Nativo en TypeScript y ESM, sin configuración de transpilación, y comparte
config con Vite. Dos proyectos separados: `unit` (sin IO, corren siempre) e
`integration` (requieren Postgres y Redis, excluidos por defecto).

**Alternativa:** Jest, más extendido pero necesita transpilación explícita.

### 4. Validación: Zod

Necesaria ya para validar el entorno, y es la que se va a usar para validar
inputs en el borde (CLAUDE.md §9). Se elige una sola librería para las dos cosas
en vez de dos.

### 5. CI: GitHub Actions

El repositorio ya está en GitHub (`joaquinregueiro/offsideStore`). El workflow
corre format, lint, typecheck, tests unitarios y build. Sin deploy.

### 6. `packages/jobs` — ✅ confirmado por el owner

`tech-stack.md` §2 lista `packages/database`, `config`, `types` y `utils`. La
misma sección muestra `src/jobs/` **dentro** de la app, pero §5 dice que el
worker "inicialmente puede correr en el mismo proceso; se separa luego" y §2 que
el monorepo debe permitir que aparezca `apps/worker` "sin reorganizar".

Si los workers vivieran en `apps/web`, el futuro `apps/worker` tendría que
importar desde otra app — exactamente la reorganización que se quiere evitar.
Por eso van en un package compartido.

**El owner decidió el 2026-08-20 mantener `packages/jobs`.**

#### ⚠️ Discrepancia registrada (no corregida)

Lo **decidido** está cubierto por la documentación oficial: BullMQ sobre Redis es
✅ DEC-012 (`tech-stack.md` §1), el procesamiento asíncrono por cola está en
`architecture.md` §8, y las notificaciones por BullMQ en `database-design.md`
§18. Nada de eso se inventó.

Lo que la documentación oficial **no** refleja es la **ubicación** del código de
jobs dentro del monorepo:

| Dice la doc                                                                                     | Está implementado                 |
| ----------------------------------------------------------------------------------------------- | --------------------------------- |
| `tech-stack.md` §2 — diagrama `src/`: `└── jobs/` dentro de la app                              | `packages/jobs/`                  |
| `tech-stack.md` §2 — diagrama monorepo: `packages/ database, config, types, utils` (sin `jobs`) | `packages/` incluye además `jobs` |

**No se modificó `tech-stack.md` por esto**: el owner pidió _registrar_ la
discrepancia, no corregir la documentación oficial. Queda pendiente de decisión
si se actualiza el diagrama o se documenta como desviación aceptada.

### 7. TypeScript estricto, con `exactOptionalPropertyTypes`

Además de `strict`, se activan `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitReturns` y `noUnused*`.

`exactOptionalPropertyTypes` ya detectó un error real en el cliente de Postgres
durante esta fase. Es la opción más molesta del conjunto: distingue entre "la
propiedad no está" y "la propiedad vale `undefined`". Si genera demasiada
fricción al implementar UI, es la primera candidata a desactivar.

### 8. Imports relativos sin extensión

Los packages se consumen como TypeScript sin compilar y el bundler de Next no
resuelve `./client.js` a `./client.ts`. Con `moduleResolution: "Bundler"` los
imports van sin extensión.

**Consecuencia:** estos packages no son consumibles como ESM de Node sin
bundler. Hoy no hace falta (Next los transpila, el worker usa `tsx`). Si alguna
vez hay que publicarlos compilados, habrá que agregar un paso de build.

## Consecuencias

- `npm run verify` reproduce exactamente lo que corre CI.
- Ninguna decisión de negocio quedó embebida en el tooling.
- Puntos 0, 1 y 6 confirmados por el owner el 2026-08-20.
- Queda por confirmar el punto 3 (Vitest); conviene hacerlo antes de escribir
  tests de negocio, porque migrar después cuesta más. Los puntos 2, 7 y 8 son
  reversibles en cualquier momento.
