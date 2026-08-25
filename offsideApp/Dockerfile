# Imagen de produccion de Offside Store.
#
# Contexto de build: `offsideApp/` (la raiz del monorepo, NO la del repo git).
# En Coolify eso es el "Base Directory".
#
# POR QUE NO USA `output: 'standalone'` DE NEXT: las migraciones corren con
# `tsx` sobre `packages/database/src/migrate.ts`, que es la unica via
# autorizada para tocar el esquema (CLAUDE.md §6). Un standalone dejaria
# afuera tsx y el codigo de migraciones, y obligaria a duplicar el runner en
# JavaScript. Se prefiere una imagen mas grande antes que dos implementaciones
# del mismo migrador. Si algun dia pesa, se resuelve compilando el migrador,
# no duplicandolo.

# ---------------------------------------------------------------- dependencias
FROM node:24-alpine AS deps
WORKDIR /app

# Solo los manifiestos primero: mientras no cambien, Docker reutiliza la capa
# del `npm ci`, que es lo que mas tarda.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/database/package.json packages/database/
COPY packages/jobs/package.json packages/jobs/
COPY packages/types/package.json packages/types/
COPY packages/utils/package.json packages/utils/

# Con dev dependencies: hacen falta para construir (next, typescript) y para
# migrar en runtime (tsx).
RUN npm ci

# ---------------------------------------------------------------------- build
FROM node:24-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# ⚠️ VALORES FICTICIOS, SOLO PARA CONSTRUIR. `next build` evalua los modulos de
# las rutas al recolectar page data, y algunos leen el entorno al importarse
# (`auth.schemas.ts` lee AUTH_PASSWORD_MIN_LENGTH). @offside/config valida el
# objeto COMPLETO, asi que sin estas dos el build falla.
#
# NADA se conecta a ellas: en runtime las reemplaza lo que inyecta Coolify.
# Es el mismo patron que ya usa el job de build de CI (.github/workflows/ci.yml).
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV REDIS_URL=redis://localhost:6379

# `next build` corre el typecheck (ignoreBuildErrors: false): un error de tipos
# rompe el deploy acá, que es donde tiene que romperse.
RUN npm run build

# --------------------------------------------------------------------- runner
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
# Next lee PORT; el host se fija explicitamente para que el contenedor acepte
# conexiones desde afuera y no solo desde localhost.
ENV HOSTNAME=0.0.0.0

COPY --from=build /app ./

# No correr como root.
USER node

EXPOSE 3000

# Las migraciones se aplican en cada arranque. Drizzle lleva su propia tabla de
# control, asi que reejecutarlas es idempotente: aplica solo lo que falta.
# Si fallan, el contenedor no levanta — preferible a servir contra un esquema
# que no es el que el codigo espera.
CMD ["sh", "-c", "npm run db:migrate && npm start -w @offside/web"]
