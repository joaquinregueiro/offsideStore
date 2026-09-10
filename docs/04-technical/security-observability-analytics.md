# Security, Observability & Analytics — OFFSIDE STORE

> Consolida los requisitos **no funcionales** de seguridad (Bloque 16),
> observabilidad (Bloque 17) y analytics/KPIs (Bloque 18). Complementa
> `architecture.md` y `tech-stack.md`. Actualizado 2026-08-19.

## 1. Seguridad (Bloque 16) — requisitos a mantener

Requisitos base desde el día 1 (✅ como principios; detalles finos 🟡):

- **Hash de passwords** (argon2/bcrypt).
- **Sesiones** seguras.
- **Rate limiting**.
- Protección **CSRF**.
- Protección **XSS**.
- Prevención de **SQL injection** (Drizzle + queries parametrizadas).
- **Validación de archivos** subidos.
- Escaneo de **malware** en uploads.
- **Protección de webhooks** (validación de firma/idempotencia — MP 🌐).
- **Tokens de Mercado Pago cifrados** en reposo (crítico — RISK-T1).
- **Secrets management** (variables de entorno / gestor de secretos; nunca en Git,
  frontend, logs ni DB).
- **Audit logs** (tabla `audit_log`, append-only).
- **Backups** de base de datos.
- **Disaster recovery** (plan 🟡).

Ver también `payments-and-commissions.md` (PC-030..033) y `database-design.md`
(`audit_log`).

## 2. Observabilidad (Bloque 17) — requisitos a mantener

- **Logs** estructurados.
- **Error tracking**.
- **Métricas** de aplicación.
- **Performance** monitoring.
- **Monitoring** de infraestructura.
- **Alertas**.
- Monitoreo específico de fallas de **Mercado Pago**.
- Monitoreo específico de fallas de **Correo Argentino**.
- **Jobs fallidos** (BullMQ).
- **Webhooks fallidos** (reintentos, dead-letter).

Prioridad alta por la dependencia de terceros (MP/Correo): las fallas de
integración deben ser visibles y accionables (RISK-T3).

## 3. Analytics & KPIs (Bloque 18)

### 3.1 Eventos iniciales a instrumentar

```
USER_REGISTERED     LISTING_VIEWED     SEARCH_PERFORMED
FAVORITE_ADDED      CART_CREATED       CHECKOUT_STARTED
PAYMENT_APPROVED    ORDER_CREATED      SHIPMENT_CREATED
ORDER_DELIVERED     REVIEW_CREATED     DISPUTE_CREATED
REFUND_CREATED
```

> 💡 Nota: varios de estos eventos ya tienen soporte natural en el modelo de datos
> (órdenes, pagos, envíos, disputas, refunds, favoritos). El **stream de analytics**
> como tal (tabla/servicio de eventos) es 🟡 a definir; puede empezar derivándose de
> las tablas existentes + `audit_log`.

### 3.2 KPIs

**Marketplace:** GMV, Revenue, Take rate, Orders, AOV, Buyers, Sellers, Active
listings.
**Confianza:** Dispute rate, Refund rate, Cancellation rate, Fraud rate.
**Growth:** CAC, Conversion, Repeat purchase, Retention.

## 4. Estado y dependencias

- ✅ Principios de seguridad/observabilidad a mantener; 🟡 configuración fina.
- 🌐 Webhooks/integraciones dependen de MP y Correo Argentino.
- Interna: `architecture.md`, `tech-stack.md`, `database-design.md`.

## 5. Decisiones / pendientes

- 🟡 Herramientas concretas (APM, error tracking, log aggregation) — parte de la
  operación del stack (DEC-012), sin decidir marca.
- 🟡 Diseño del **stream de analytics** (tabla de eventos vs derivación).
- 🟡 Plan de **backups/DR** detallado.

## 6. Riesgos

Ver `RISKS.md`: RISK-T1 (credenciales), RISK-T2 (webhooks), RISK-T3 (dependencia de
terceros), RISK-O2 (conciliación), RISK-O3 (evidencia de entrega).
