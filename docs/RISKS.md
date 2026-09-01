# RISKS — OFFSIDE STORE

Registro de **riesgos**: técnicos, comerciales, financieros, legales, de fraude y
operativos. Cada riesgo tiene: descripción, impacto, probabilidad (estimada,
cualitativa), mitigación propuesta y referencia. Las estimaciones son
cualitativas y preliminares.

Escala: Impacto {Bajo, Medio, Alto, Crítico} · Probabilidad {Baja, Media, Alta}.

---

## 1. Riesgos financieros

### RISK-F1 — Refunds no recuperables (vendedor sin fondos) — **Crítico / Media**
En Split 1:1, el refund se reparte proporcionalmente; si el vendedor no tiene
saldo, su parte **no se recupera automáticamente**. OFFSIDE puede terminar
absorbiendo la pérdida.
*Mitigación:* **diseñar el sistema asumiendo el riesgo** (registro de
`SellerLiability`), recupero de ventas futuras, provisión contable y sanciones.

⚠️ **El hold de fondos quedó DESCARTADO el 2026-09-01 (DEC-019).** Mercado Pago
no ofrece retención configurable para este stack: al aprobarse el pago el dinero
se acredita al vendedor. Este riesgo pierde así su mitigación más fuerte y
depende enteramente del recupero posterior. **Es el riesgo central del modelo.**

⚠️ **🔵 Sin confirmar:** qué hace Mercado Pago cuando se pide un refund y el
vendedor **no tiene saldo** —si lo rechaza, si deja la cuenta en negativo, o si
depende del esquema—. Determina si Offside se entera de la deuda en el momento
del refund o después, y **el código de refunds todavía no contempla ese fallo**.
No se asume sin verificar. Ref: `orders-and-refunds.md`, DEC-008, DEC-019.

### RISK-F2 — Comisión mal calibrada — **Alto / Media**
Si la comisión no cubre costo de MP + fiscal + provisión por refunds, el margen es
negativo; si es muy alta, ahuyenta vendedores.
*Mitigación:* cerrar DEC-007 con análisis completo antes de lanzar. Ref:
`business-model.md`.

### RISK-F3 — Comisión de MP no modelada correctamente — **Alto / Media**
Asumir mal quién paga la comisión de MP en el split distorsiona los unit
economics. 🌐
*Mitigación:* verificar con MP (OQ-B1) y persistir `comisión_mp` real por orden.
Ref: `payments-and-commissions.md`.

### RISK-F4 — Chargebacks — **Alto / Media**
Contracargos (incluidos los fraudulentos) pueden debitar del split y generar
pérdidas; el flujo depende de MP y las redes de tarjetas. 🌐
*Mitigación:* registrar y defender con evidencia (tracking, fotos); mismo marco de
riesgo de fondos que refunds. Ref: `orders-and-refunds.md` §6.

## 2. Riesgos de fraude

### RISK-FR1 — Falsificaciones vendidas como auténticas — **Crítico / Alta**
Riesgo central del nicho de coleccionismo. Daña la propuesta de valor y expone
legalmente.
*Mitigación:* eje de autenticidad (DEC-010), sanciones severas, disputas con
`FULL_REFUND` + `SELLER_PENALTY`, niveles de riesgo, revisión manual. Comunicar
"declarada vs verificada". Ref: `trust-and-safety.md`.

### RISK-FR2 — Vendedor que cobra y desaparece — **Alto / Media**
Vende, retira su parte del split y no despacha o no cubre el refund.
*Mitigación:* hold de fondos durante la ventana de protección (🌐), reputación,
niveles de riesgo, suspensión/expulsión. Ref: `orders-and-refunds.md`,
`trust-and-safety.md`.

### RISK-FR3 — Fraude del comprador — **Medio / Media**
Chargebacks abusivos, `RETURN_REQUIRED` sin devolver, reclamos falsos.
*Mitigación:* evidencia obligatoria en disputas, tracking, orden de operaciones en
returns (OQ-C6), historial del comprador. Ref: `orders-and-refunds.md`,
`trust-and-safety.md`.

### RISK-FR4 — Manipulación de reputación — **Medio / Media**
Autocompras, reviews falsas, evasión de sanciones con cuentas nuevas.
*Mitigación:* detección de patrones, verificación de identidad, reglas BR-051/
BR-004. Ref: `business-rules.md`, `trust-and-safety.md`.

## 3. Riesgos técnicos

### RISK-T1 — Seguridad de credenciales (tokens de MP) — **Crítico / Baja-Media**
Fuga de access/refresh tokens = acceso a cobros de cuentas de terceros.
*Mitigación:* cifrado en reposo, gestor de secretos, mínimo privilegio, auditoría
de accesos, rotación, TLS. Ref: `payments-and-commissions.md` PC-030..033,
`architecture.md`.

### RISK-T2 — Estados inconsistentes por mal manejo de webhooks — **Alto / Media**
Confiar en el redirect en vez del webhook, o falta de idempotencia, produce
órdenes/pagos inconsistentes o efectos duplicados.
*Mitigación:* webhooks como fuente de verdad, idempotencia, reconsulta a MP,
conciliación. Ref: `payments-and-commissions.md` §6, `architecture.md` §8.

### RISK-T3 — Dependencia total de terceros (MP / Correo Argentino) — **Alto / Media**
Cambios de API, tarifas o disponibilidad impactan negocio y técnica.
*Mitigación:* aislar detrás de servicios (`PaymentService`, `ShippingService`),
conciliación, monitoreo, y **no inventar** comportamientos (documentar
dependencias). Ref: `architecture.md`.

### RISK-T4 — Datos de catálogo sucios → filtros inútiles — **Alto / Media**
Si se permite texto libre donde debería haber catálogo controlado, se degrada la
búsqueda facetada (el diferencial).
*Mitigación:* catálogos controlados, validación, gobierno de catálogos (OQ-F2).
Ref: `product-specification.md`.

### RISK-T5 — Overselling — **Medio / Media**
Descuento de stock no atómico al confirmar el pago.
*Mitigación:* descontar stock atómicamente al pago aprobado; revalidar en
checkout. Ref: `marketplace-flow.md` MF-010/022.

### RISK-T6 — Elección prematura/errónea de stack — **Medio / Media**
Elegir stack sin contemplar el motor de búsqueda facetada o los flujos de pago.
*Mitigación:* cerrar DEC-012 con los requisitos ya documentados; 💡 monolito
modular en MVP. Ref: `architecture.md`.

## 4. Riesgos comerciales

### RISK-C1 — Falta de liquidez del marketplace (oferta/demanda) — **Alto / Alta**
Sin suficientes vendedores/productos no hay compradores, y viceversa
(problema del huevo y la gallina).
*Mitigación:* el MVP siembra ~100 camisetas con vendedores controlados para
simular actividad; estrategia de adquisición posterior 🔴 pendiente. Ref:
`marketplace-flow.md` MVP.

### RISK-C2 — Take rate no competitivo — **Alto / Media**
Comisión alta vs alternativas (vender por redes, otros marketplaces) espanta
vendedores.
*Mitigación:* benchmarking + DEC-007 informada. Ref: `business-model.md`.

### RISK-C3 — Propuesta de valor no percibida — **Medio / Media**
Si los filtros/confianza no se notan, OFFSIDE parece "otro marketplace más".
*Mitigación:* invertir en el diferencial (búsqueda especializada + confianza/
autenticidad). Ref: `product-specification.md`, `trust-and-safety.md`.

## 5. Riesgos legales / regulatorios

### RISK-L1 — Falta de claridad fiscal — **Alto / Media**
Sin modelo fiscal (DEC-011) definido, hay riesgo impositivo y de facturación.
*Mitigación:* definir facturación, IVA, retenciones (🌐 AFIP/ARCA + MP) antes de
operar con dinero real. Ref: `business-model.md`, OQ-H1.

### RISK-L2 — Responsabilidad por productos de terceros (falsificaciones) — **Alto / Media**
Un marketplace puede tener responsabilidad legal por lo que se vende.
*Mitigación:* términos claros, política de autenticidad, remoción y sanción,
asesoría legal. Ref: `trust-and-safety.md`, OQ-H4.

### RISK-L3 — Defensa del consumidor / protección de datos — **Medio / Media**
Obligaciones legales (garantías, arrepentimiento, datos personales).
*Mitigación:* T&C, política de privacidad, cumplimiento normativo (OQ-H2/H3).

## 6. Riesgos operativos

### RISK-O1 — Cola de revisión manual saturada — **Medio / Media**
Umbrales de riesgo mal calibrados generan demasiada revisión manual.
*Mitigación:* calibrar umbrales (OQ-D4), automatizar lo posible, priorizar por
severidad. Ref: `trust-and-safety.md`.

### RISK-O2 — Conciliación deficiente — **Alto / Media**
Sin conciliación robusta con MP, los márgenes y pérdidas se miden mal.
*Mitigación:* proceso de conciliación auditable con MP como fuente de verdad. Ref:
`orders-and-refunds.md` §7.

### RISK-O3 — Evidencia de entrega poco confiable — **Medio / Media**
Si el tracking de Correo Argentino no es confiable/actualizado, las disputas de
"no recibido" son difíciles de resolver. 🌐
*Mitigación:* tracking histórico persistido, mapeo de estados, políticas claras.
Ref: `shipping.md`.

### RISK-O4 — Costos de devolución indefinidos — **Bajo-Medio / Media**
Sin política de quién paga la devolución, hay fricción y pérdidas.
*Mitigación:* definir OQ-C7/SH-014. Ref: `shipping.md`, `orders-and-refunds.md`.

---

## 7. Mapa de calor (resumen cualitativo)

| Riesgo | Impacto | Probabilidad |
|--------|---------|--------------|
| RISK-F1 Refunds no recuperables | Crítico | Media |
| RISK-FR1 Falsificaciones | Crítico | Alta |
| RISK-T1 Seguridad de credenciales | Crítico | Baja-Media |
| RISK-C1 Liquidez del marketplace | Alto | Alta |
| RISK-F2 Comisión mal calibrada | Alto | Media |
| RISK-F3 Comisión de MP mal modelada | Alto | Media |
| RISK-F4 Chargebacks | Alto | Media |
| RISK-FR2 Vendedor que desaparece | Alto | Media |
| RISK-T2 Webhooks/estados inconsistentes | Alto | Media |
| RISK-T3 Dependencia de terceros | Alto | Media |
| RISK-T4 Datos de catálogo sucios | Alto | Media |
| RISK-L1 Claridad fiscal | Alto | Media |
| RISK-L2 Responsabilidad por falsificaciones | Alto | Media |
| RISK-O2 Conciliación deficiente | Alto | Media |
| RISK-C2 Take rate no competitivo | Alto | Media |
| (otros) | Medio/Bajo | — |

> Los tres riesgos que **definen el diseño** de OFFSIDE: **RISK-F1** (refunds no
> recuperables), **RISK-FR1** (falsificaciones) y **RISK-T1** (seguridad de
> credenciales). El resto de la documentación está construida para mitigarlos.
