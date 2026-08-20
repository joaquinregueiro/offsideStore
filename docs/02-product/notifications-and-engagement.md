# Notifications & Engagement — OFFSIDE STORE

> Consolida notificaciones (Bloque 13) y favoritos/engagement (Bloque 14).
> Complementa `buyer-system.md` y el módulo `notifications` del ERD.
> Actualizado 2026-08-19.

## 1. Propósito

Definir qué se notifica y qué funcionalidades de engagement se mantienen, con su
alcance en el MVP.

## 2. Notificaciones (Bloque 13)

### 2.1 Email — eventos a soportar
Registro, venta, compra, pago, envío, entrega, refund, reclamo, disputa.

### 2.2 In-app
Notificaciones, mensajes, alertas (registro `notifications` en el ERD; el envío se
procesa por **BullMQ**).

### 2.3 Push
**Fuera del MVP inicial** (ver `mvp-scope.md`).

> 🟡 **PENDIENTE:** plantillas, disparadores exactos, preferencias del usuario
> (opt-in/opt-out) y proveedor de email. Varios de estos serán ⚙️ configurables.

## 3. Engagement / Favoritos (Bloque 14) — funcionalidades a mantener

- **Favoritos** (ya en el ERD: `favorites`).
- **Alertas de precio** (favorito baja de precio).
- **Producto vendido** (aviso).
- **Producto nuevamente disponible**.
- **Búsquedas guardadas** (saved searches).
- **Seguir vendedores**.
- **Seguir clubes**.
- **Seguir jugadores**.

> **Impacto ERD (no se modifica ahora):** "búsquedas guardadas" y "follows"
> (vendedores/clubes/jugadores) sugieren tablas nuevas (`saved_searches`,
> `follows`) que **aún no existen** en el ERD. Registrado en
> `04-technical/open-decisions-impact.md`. Alcance en MVP 🟡 (algunos pueden ser
> post-MVP).

## 4. Estado y dependencias

- ✅ Se **mantienen** como funcionalidades objetivo.
- 🟡 Alcance exacto en el MVP por definir (push queda fuera).
- Interna: `buyer-system.md`, `database-design.md` (`notifications`, `favorites`),
  `security-observability-analytics.md` (eventos).

## 5. Riesgos

- **Sobrenotificar** degrada la experiencia → preferencias configurables.
- Alertas dependen de jobs (BullMQ) fiables → observabilidad (Bloque 17).
