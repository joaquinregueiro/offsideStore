# Identidad fiscal del vendedor

Módulo de identificación fiscal, dentro del onboarding de vendedores.
**Fecha: 2026-08-21.** Documentado en el **ERD v1.2 §7.5**.

## Dónde encaja en el flujo

```
USUARIO ANÓNIMO ──► navega, busca, consulta
      │
      ▼ acción que requiere identidad
AUTH OFFSIDE          email + password              ✅ implementado
      │
      ▼
EMAIL VERIFICADO      BR-001                        ✅ implementado
      │
      ▼
USUARIO ACTIVO
      │
      ▼ "quiero vender"
PERFIL DE VENDEDOR    status = 'pending'            ✅ implementado
      │
      ▼
IDENTIDAD FISCAL      CUIT / CUIL / CDI             ✅ implementado  ← este módulo
      │               normalización + dígito verificador
      ▼
VALIDACIÓN FISCAL     contra ARCA                   ❌ NO implementado
      │
      ▼
APROBACIÓN            status = 'approved'           ❌ NO implementado
      │
      ▼
CONEXIÓN MERCADO PAGO OAuth + PKCE                  ❌ NO implementado
      │
      ▼
PUEDE VENDER = status='approved' AND mp='connected' ❌ predicado NO implementado
```

### Qué existe hoy

Auth · perfil de vendedor · identidad fiscal · validación sintáctica · dígito
verificador · persistencia con historial · endpoint de consulta · endpoint de
verify (responde 503) · adapter de fuente fiscal no disponible.

### Qué NO existe todavía

ARCA real · aprobación (automática ni manual) · Mercado Pago OAuth · Payments ·
comisiones · percepciones · liquidaciones · frontend de onboarding.

## Conceptos

### `tax_id_type`

Qué **tipo** de identificador fiscal argentino declaró el vendedor: `CUIT`,
`CUIL` o `CDI`.

**No existe una columna `cuit`** a propósito: no todo vendedor tiene CUIT. Una
persona física sin actividad comercial puede tener sólo CUIL, y CDI aplica a
quienes no tienen ninguno de los dos. Asumir CUIT dejaría afuera vendedores
legítimos.

### `tax_id`

El número, **normalizado a sólo dígitos**: `20-12345678-6` → `20123456786`.

Se guarda normalizado para que el mismo identificador no pueda entrar dos veces
escrito distinto. **El formateo con guiones es responsabilidad de la UI**, no de
la base.

### Validación sintáctica ≠ validación fiscal

Es la distinción central del módulo:

|                | Qué responde                            | Quién la hace             | Estado hoy      |
| -------------- | --------------------------------------- | ------------------------- | --------------- |
| **Sintáctica** | "¿este número _puede_ ser válido?"      | `fiscal-identity.service` | ✅ implementada |
| **Fiscal**     | "¿la autoridad lo confirma y qué dice?" | fuente oficial (ARCA)     | ❌ sin integrar |

Un CUIT puede tener formato y dígito verificador correctos y aun así no
corresponder a nadie. **Que pase la validación sintáctica no lo vuelve
verificado.**

Por eso hay dos columnas separadas:

- `verification_status` — si la fuente oficial lo confirmó.
- `tax_condition` — qué dijo esa fuente.

## Estados

`verification_status`: `PENDING | VERIFIED | REJECTED`.

**Hoy sólo `PENDING` es alcanzable**: no hay integración fiscal. `VERIFIED` y
`REJECTED` se declaran ahora para evitar un `ALTER TYPE` después — riesgo que el
ERD §26.1 marca explícitamente.

`tax_condition` es `text` y **no** un enum: los valores concretos los define la
fuente oficial y todavía no se conocen. Enumerarlos ahora sería inventarlos.

### Relación con `seller_profiles.status`

**Cargar datos fiscales NO aprueba al vendedor.** El perfil sigue en `pending`.
Hay cuatro cosas separadas y ninguna implica la siguiente:

```
datos ingresados → validación sintáctica → validación fiscal → aprobación
```

La aprobación sigue sin implementarse: depende de TS-001 (_"qué significa
identidad verificada"_), que está 🟡 sin definir.

**No existe ningún campo `can_sell`.** La capacidad de vender se deriva:

```
seller_profiles.status = 'approved'  AND  mercadopago_accounts.status = 'connected'
```

## Historial

La tabla es **append-only por diseño**: la condición fiscal de una persona
cambia con el tiempo, y una liquidación vieja debe poder explicarse con la
condición que regía entonces.

- Reemplazar el identificador **cierra** la fila vigente (`valid_to`) e inserta
  una nueva.
- Un índice único parcial `ON (seller_id) WHERE valid_to IS NULL` garantiza
  **una sola fila vigente por vendedor**.
- Nada se borra ni se sobrescribe.

## Endpoints

| Método | Ruta                              | Auth                      | Descripción                      |
| ------ | --------------------------------- | ------------------------- | -------------------------------- |
| POST   | `/api/sellers/tax-profile`        | sesión + email verificado | Declara la identidad fiscal. 201 |
| GET    | `/api/sellers/tax-profile`        | sesión                    | La vigente, o `null`             |
| POST   | `/api/sellers/tax-profile/verify` | sesión + email verificado | Verificación fiscal. **Hoy 503** |

Códigos: 401 sin sesión · 403 email sin verificar · 422 identificador inválido ·
**503 sin fuente fiscal integrada**.

### Autorización

El perfil se resuelve **siempre desde el usuario autenticado** (`user.id`),
nunca desde un id que venga del request. No hay parámetro que un atacante pueda
manipular para tocar el perfil de otro vendedor.

## Validación implementada

En orden: no vacío · sólo dígitos, guiones o puntos · 11 dígitos · **dígito
verificador** (módulo 11, mismo algoritmo para CUIT/CUIL/CDI).

⚠️ **No se valida el prefijo contra el `tax_id_type`.** Es deliberado: la
correspondencia entre prefijos (20/23/24/27/30/33/34/…) y tipo no está definida
en la documentación del proyecto, y una tabla inventada rechazaría
identificadores legítimos. Se valida sólo lo demostrablemente incorrecto.

## Seguridad

- El `tax_id` **nunca** aparece en mensajes de error. `maskTaxId()` lo enmascara
  (`20*******86`) para logs.
- Se devuelve completo **sólo al propio dueño**, detrás de autenticación.
- No hay cifrado en reposo: el proyecto lo reserva para credenciales de terceros
  (`TOKEN_ENCRYPTION_KEY`, tokens de MP). Si se decide que el identificador
  fiscal también lo requiere, es una decisión pendiente.

## Dónde se integrará ARCA

```
modules/sellers/infrastructure/fiscal-source/
  ├── fiscal-source.port.ts                    ← contrato (ya definido)
  └── unavailable-fiscal-source.adapter.ts     ← default: declara que no hay integración
```

El adapter actual **no es un mock**: no inventa condiciones fiscales ni finge
consultar a ARCA. Falla explícitamente. La alternativa —devolver una condición
ficticia— sería peor que no tener nada: haría creer que un vendedor está
verificado cuando no lo está, y ese dato terminaría alimentando liquidaciones
reales.

Cuando exista la integración se agrega un `ArcaFiscalSourceAdapter` al lado y se
cambia qué devuelve `getFiscalSource()`. **Nada del dominio cambia.**

Sigue pendiente la investigación de ARCA: qué servicio de padrón, certificados y
autenticación, ambientes, cadencia de refresco, y qué condición habilita a
vender.

## Dirección de la dependencia

```
sellers ──► identidad fiscal        (el módulo fiscal IDENTIFICA al vendedor)

payments ──► consume información fiscal cuando corresponda
```

**Nunca al revés.** El módulo fiscal no conoce `commission_rate`,
`marketplace_fee`, Mercado Pago, pagos, percepciones ni liquidaciones. Payments
decidirá más adelante qué hacer con la información fiscal.

## Fuera de alcance (no implementado, a propósito)

- Percepciones, retenciones y RG 5319.
- Comisiones. **`tax_condition` NO deriva ninguna tasa** — la comisión de
  Offside y la fiscalidad son conceptos desacoplados.
- Integración con ARCA.
- Mercado Pago: OAuth, PKCE, tokens, Split, `marketplace_fee`.
- Refunds, chargebacks, liquidaciones, settlements.
- KYC propio de Offside: no se pide DNI, foto, selfie ni domicilio.
- Aprobación automática del vendedor.

## Sincronización con el ERD — ✅ resuelta

`seller_tax_profiles` y sus dos enums están documentados en el **ERD v1.2**
(§7.5 y §3), autorizado por el owner el 2026-08-21. Cambios registrados en el
changelog §29 del ERD.

La invariante está restablecida y verificada:

|        | ERD v1.2 | Drizzle | Migration | PostgreSQL |
| ------ | -------- | ------- | --------- | ---------- |
| Tablas | 51       | 51      | 51        | **51**     |
| Enums  | 37       | 37      | 37        | **37**     |

`drizzle-kit generate` responde **"No schema changes"**: no hay divergencia
pendiente y no se generó ninguna migration innecesaria.
