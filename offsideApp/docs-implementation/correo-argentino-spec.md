# Correo Argentino — relevamiento de las APIs oficiales

Relevamiento de lo que Correo Argentino **realmente ofrece**, leído de sus dos
manuales oficiales. **Fecha: 2026-09-09.**

> **Estado: NO IMPLEMENTADO.** Este documento no describe código: describe el
> contrato del proveedor, para que el puerto `ShippingPort` se diseñe contra lo
> que existe y no contra lo que suponemos.
>
> ⚠️ **Nada de acá fue probado contra la API real.** No hay credenciales: los
> dos manuales dicen que se solicitan a Correo Argentino, y PAQ.AR además exige
> un **acuerdo comercial** previo. Todo lo que sigue sale de leer los PDF.

## Fuentes

| Documento                                  | Versión                   | URL                                                              |
| ------------------------------------------ | ------------------------- | ---------------------------------------------------------------- |
| API MiCorreo                               | 8/8/2022, 16 pág.         | `correoargentino.com.ar/MiCorreo/public/img/pag/apiMiCorreo.pdf` |
| Plataforma de Integración API 2.0 (PAQ.AR) | v1.2, abril 2023, 37 pág. | `correoargentino.com.ar/MiCorreo/public/img/pag/apiPaqAr-v2.pdf` |

⚠️ **Los dos manuales están viejos.** El de PAQ.AR ya documenta cambios "a partir
de la versión 1.3" (los rótulos pasaron de `GET` a `POST`), así que el documento
va detrás de la API desplegada. Tratar todo esto como **punto de partida a
verificar**, no como verdad.

---

## 1. ⚠️ Son DOS APIs distintas, no una

Es el hallazgo principal del relevamiento y condiciona todo el diseño. No
comparten base, ni autenticación, ni vocabulario.

|                 | **MiCorreo**                                           | **PAQ.AR 2.0**                                            |
| --------------- | ------------------------------------------------------ | --------------------------------------------------------- |
| Base test       | `https://apitest.correoargentino.com.ar/micorreo/v1`   | `https://apitest.correoargentino.com.ar/paqar/v1`         |
| Base prod       | `https://api.correoargentino.com.ar/micorreo/v1`       | `https://api.correoargentino.com.ar/paqar/v1`             |
| Autenticación   | Basic → `POST /token` → **JWT Bearer con vencimiento** | headers `Authorization: Apikey <key>` + `agreement: <id>` |
| **Cotizar**     | ✅ `POST /rates`                                       | ❌ no existe                                              |
| Crear envío     | `POST /shipping/import`                                | `POST /v1/orders`                                         |
| **Rótulo**      | ❌                                                     | ✅ `POST /v1/labels`                                      |
| **Tracking**    | ❌                                                     | ✅ `GET /v1/tracking`                                     |
| Cancelar        | ❌                                                     | ✅ `PATCH /v1/orders/{tn}/cancel`                         |
| Sucursales      | ✅ `GET /agencies`                                     | ✅ `GET /v1/agencies`                                     |
| Alta de usuario | ✅ `POST /register`, `POST /users/validate`            | ❌                                                        |

⚠️ **Ninguna de las dos cubre sola lo que pide `shipping.md` §3.2.** Cotizar vive
en MiCorreo; rótulo y tracking viven en PAQ.AR. O se usan las dos, o hay que
preguntarle a Correo cuál de las dos plataformas habilita nuestro acuerdo.
**Es la primera pregunta para el contacto comercial.**

### Cómo se llegó a esto

⚠️ Vale dejarlo escrito para no repetirlo: el primer relevamiento leyó **sólo**
el manual de PAQ.AR y concluyó que "Correo Argentino no ofrece cotización". Es
falso, y el error no fue de lectura sino de alcance — generalizar desde un
documento sin comprobar si había otros. Lo correcto era decir "el manual de
PAQ.AR no la tiene".

---

## 2. MiCorreo

### 2.1 Autenticación

```
POST {base}/token       (HTTP Basic con usuario:password)
→ 200 { "token": "eyJ0eXAi…", "expires": "2022-04-26 21:16:20" }
```

Después, `Authorization: Bearer <token>` en todo lo demás.

⚠️ **El token VENCE** y el manual devuelve la fecha exacta. El adaptador tiene
que renovarlo, no cachearlo para siempre. Es el mismo problema que ya resolvimos
con el refresh de Mercado Pago, aunque acá es más simple: no hay rotación de
refresh token, se vuelve a pedir con Basic.

Sólo HTTPS. HTTP simple falla.

### 2.2 `POST /rates` — cotizar

| Campo                   | Tipo           | Req. | Notas                                           |
| ----------------------- | -------------- | ---- | ----------------------------------------------- |
| `customerId`            | string         | ✔    | Id de usuario **de MiCorreo** (ver §2.5)        |
| `postalCodeOrigin`      | string         | ✔    | CP del **vendedor**                             |
| `postalCodeDestination` | string         | ✔    | CP del comprador                                |
| `deliveredType`         | `"D"` \| `"S"` |      | domicilio / sucursal. Omitirlo devuelve las dos |
| `dimensions.weight`     | int            | ✔    | **gramos**, mín. 1, **máx. 25.000**             |
| `dimensions.height`     | int            | ✔    | cm, máx. 150                                    |
| `dimensions.width`      | int            | ✔    | cm, máx. 150                                    |
| `dimensions.length`     | int            | ✔    | cm, máx. 150                                    |

```json
{
  "customerId": "0000550997",
  "validTo": "2022-06-07T10:31:27.881-03:00",
  "rates": [
    { "deliveredType": "D", "productType": "CP", "productName": "Paq.ar Clásico", "price": 498.06 }
  ]
}
```

⚠️ **`validTo`: la cotización VENCE.** Importa para DEC-030: la orden congela el
`shipping_amount` al crearse, y hay que decidir qué pasa si el checkout se
completa después de esa fecha. Es una decisión de negocio, no técnica.

⚠️ **`price` viene decimal** (`498.06`) y el ERD exige `bigint` en centavos (§1).
La conversión es `Math.round(price * 100)` y hay que hacerla en el borde del
adaptador, nunca arrastrar el float al dominio.

⚠️ **El tope de 25 kg es una restricción real de producto**, no del transporte
solamente: una publicación que exceda ese peso **no se puede enviar por acá**, y
eso hay que validarlo antes de cotizar, no descubrirlo con un 402.

⚠️ Los ejemplos del manual sólo muestran `CP` / "Paq.ar Clásico". El manual dice
que devuelve "los precios de cada servicio habilitado en tu cuenta", así que
**puede** haber más productos, pero 🔵 **cuáles, no está documentado**.

⚠️ **No hay `estimatedDays`** en el contrato oficial, aunque circula en material
de terceros. No prometer plazos de entrega en la UI apoyándose en esto.

⚠️ **La fórmula de peso volumétrico (`largo×ancho×alto/6000`) NO está en ningún
manual oficial.** Circula en blogs. No hace falta: se mandan las dimensiones y
Correo cotiza. **No replicarla del lado nuestro**, porque si su divisor cambia
cobraríamos distinto que ellos.

### 2.3 `POST /shipping/import` — importar el envío

Campos principales: `customerId` ✔, `extOrderId` ✔ (nuestro id de orden),
`orderNumber`, `sender.*` (con `originAddress`), `recipient.*` (`name` y `email`
obligatorios) y `shipping.*` con `deliveryType` ✔, `agency` (obligatorio si es a
sucursal), `address.*`, `weight` ✔ (gramos), `declaredValue` ✔, `height` ✔,
`length` ✔, `width` ✔.

⚠️ **`deliveryType` acá, `deliveredType` en `/rates`.** El **mismo concepto con
dos nombres distintos dentro de la misma API**. Es exactamente la clase de
detalle que hace que un adaptador copiado a ojo falle.

⚠️ **La respuesta NO trae número de seguimiento**:

```json
{ "createdAt": "2022-06-07T16:15:04.996-03:00" }
```

Es un hallazgo importante: **importar a MiCorreo no devuelve un tracking
number**, así que `getTracking()` no se puede cablear desde MiCorreo sola. Refuerza
que hacen falta las dos APIs.

⚠️ El manual lista los mensajes de error crudos que devuelve "WCP" (el sistema de
atrás), en español y sin códigos: _"Peso no valido"_, _"Tipo de entrega
invalido"_, _"Verifique la sucursal de destino"_, _"El alto debe estar entre 0 y
255"_… ⚠️ **Ese "0 y 255" contradice el máximo de 150 cm** que el mismo manual
declara en `/rates`. Hay que probarlo.

### 2.4 `GET /agencies` — sucursales

Query: `customerId` ✔, `provinceCode` ✔, `services` opcional
(`package_reception`, `pickup_availability`).

Devuelve código, nombre, email, teléfono, dirección completa, **latitud y
longitud**, **horarios por día** y `status`. Es información suficiente para un
selector de sucursal decente.

⚠️ **Es POR PROVINCIA**: no hay listado global. Y el `code` de la sucursal
(`"B0107"`) es lo que después va en `shipping.agency`.

### 2.5 `POST /register` y `POST /users/validate`

`/register` da de alta un usuario de MiCorreo (DNI o CUIT). `/users/validate`
recibe email + password y devuelve el `customerId`.

⚠️ **Acá hay una decisión de diseño abierta 🟡, y no menor.** `/rates` exige
`customerId` y `postalCodeOrigin`, y el origen es el domicilio **del vendedor**.
Entonces: ¿el `customerId` es uno solo de Offside, o cada vendedor necesita su
propia alta en MiCorreo?

- **Uno de Offside** — simple, pero cotizamos con la cuenta de Offside usando el
  CP del vendedor. Hay que confirmar que Correo lo acepte y qué tarifa aplica.
- **Uno por vendedor** — `/register` lo permite, pero implica pedirle la
  password de MiCorreo al vendedor (`/users/validate` la exige), lo cual es
  **inaceptable**: sería pedir la credencial de un tercero. Habría que ver si
  Correo ofrece otro camino.

**No se decide desde el código.** Va junto con la pregunta comercial de §1.

---

## 3. PAQ.AR 2.0

### 3.1 Autenticación

Headers `Authorization: Apikey <key>` y `agreement: <id de acuerdo comercial>`.
`GET /v1/auth` valida (204 = ok). Sin JWT y sin vencimiento.

⚠️ Textual del manual: _"La gestión de estas se hace previamente con el área
Comercial de Correo Argentino."_ **Sin acuerdo comercial no hay ni sandbox.**

### 3.2 `POST /v1/orders` — alta de orden

Campos: `sellerId`, `trackingNumber`, y dentro de `order`: `senderData`,
`shippingData`, `parcels[]` (con `dimensions`, `productWeight`,
`productCategory`, `declaredValue`), `deliveryType` ✔, `agencyId`, `saleDate` ✔,
`shipmentClientId`, `serviceType` ✔.

- **`sellerId`** — _"está apuntado a los clientes tipo **marketplace** que a su
  vez tienen otro código seller interno"_. ⚠️ PAQ.AR **contempla explícitamente
  el modelo de marketplace**, que es el nuestro. Vale explorarlo con Correo.
- **`trackingNumber`** — opcional; si no se manda, **Correo lo genera y lo
  devuelve**. Encaja con `shipments.tracking_number` del ERD.
- **`deliveryType`** — ⚠️ acá los valores son `homeDelivery`, `agency`, `locker`
  (que mapean a `D`/`S`/`B` del SOAP viejo). **Distintos de los `"D"`/`"S"` de
  MiCorreo.** Dos APIs, dos vocabularios para lo mismo.
- **`agencyId`** — obligatorio salvo `homeDelivery`. Se obtiene de
  `/v1/agencies`, y ⚠️ _"no todos tienen todas las sucursales habilitadas"_: la
  cobertura depende de la cuenta.
- **`saleDate`** ✔ — formato `YYYY-MM-DDTHH:mm:ss-03:00`.
- **`serviceType`** ✔ — string de 2 letras (ej. `CP`). 🔵 **El manual no enumera
  los válidos.**
- **`shipmentClientId`** — ⚠️ _"dato no funcional en la versión inicial"_.

### 3.3 `POST /v1/labels` — rótulo

Parámetro `labelFormat` (ej. `"10x15"`). ⚠️ Era `GET` hasta la v1.3: prueba de
que el manual va detrás de la API.

### 3.4 `GET /v1/tracking` — seguimiento

Recibe `extClient` opcional y **un array de `trackingNumber`**. Devuelve, por
cada uno, un array de `event` con `facilityCode`, `facility`, `statusId`,
`status`, `date` y `sign`.

⚠️ **NO HAY WEBHOOKS. Es polling** — y cierra OQ-G2 en negativo. Lo bueno: acepta
**N tracking numbers por llamada**, así que un job de BullMQ puede barrer todos
los envíos abiertos en pocas requests en vez de una por envío.

⚠️ **EL MANUAL NUNCA ENUMERA LOS ESTADOS, Y ES EL BLOQUEO REAL DE ESTE MÓDULO.**
Sólo aparecen tres en ejemplos:

| `statusId` | `status`                  |
| ---------- | ------------------------- |
| `PRE`      | PREIMPOSICION             |
| `CAN`      | EN PROCESO DE CANCELACION |
| `CAU`      | caduco                    |

**No hay ningún código documentado para "entregado"** — justo el que mueve la
orden a `DELIVERED` (`shipping.md` §5) y el que **SH-002** necesita como
evidencia central en las disputas de "producto no recibido".

Consecuencia directa: **SH-003 (el mapeo de estados) no se puede escribir desde
el papel.** Hay que descubrir el vocabulario contra el ambiente de test, lo que
exige credenciales. Es la razón por la que el adaptador real no puede empezar
todavía y el adaptador fake sí.

⚠️ El formato de `date` es inconsistente **dentro del mismo manual**:
`"2017-06-27T10:00:00-03:00"` en un ejemplo y `"28-06-2022 11:53"` en otro. El
parser tiene que tolerar los dos, o probar cuál devuelve de verdad.

### 3.5 Otros

- `PATCH /v1/orders/{trackingNumber}/cancel` — cancela.
- `GET /v1/agencies` — sucursales.
- ⚠️ La API es un **wrapper sobre un servicio SOAP** y el manual lo admite:
  varias validaciones quedan delegadas al "vertical" y **no están documentadas**.
  Esperar errores no descritos.

---

## 4. Cómo cae esto sobre lo que ya está decidido

| Requisito de `docs/`                             | Estado tras el relevamiento                                                                   |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `quote()` (`shipping.md` §3.2, SH-011, BS-070)   | ✅ **implementable** vía MiCorreo `/rates`                                                    |
| `createShipment()`                               | ✅ las dos APIs lo ofrecen, con contratos distintos                                           |
| `getLabel()`                                     | ✅ sólo PAQ.AR                                                                                |
| `getTracking()`                                  | ✅ sólo PAQ.AR, **por polling**                                                               |
| `handleWebhook()`                                | ❌ **no existe**. La operación del puerto sobra, o se reinterpreta como "ingesta del polling" |
| Estados internos + mapeo (§5, SH-003)            | 🔵 **bloqueado**: falta el vocabulario del proveedor                                          |
| Cobertura y modalidades (SH-015, OQ-G4)          | 🟡 parcial: `D`/`S` (+`locker` en PAQ.AR). Cobertura **por cuenta**, se consulta              |
| El ERD (`shipments`, `shipment_tracking_events`) | ✅ **aguanta sin cambios** — ver §5                                                           |

### Preguntas cerradas por este relevamiento

- **OQ-G1** (endpoints, auth, formatos) — ✅ **resuelta**.
- **OQ-G2** (webhooks o polling) — ✅ **resuelta: polling**.

### Preguntas que siguen abiertas

- **OQ-G3** (mapeo de estados) — 🔵 requiere el ambiente de test.
- **OQ-G4** (cobertura geográfica) — 🔵 depende de la cuenta.
- **SH-014** (quién paga la devolución) — 🔴 decisión del owner, ninguna API la responde.
- **Modelo de costos** (§5.b) — 🟡 ahora es una decisión de negocio normal, ya no
  está forzada por ausencia de API.
- **`customerId` de MiCorreo: uno o por vendedor** — 🟡 nueva, ver §2.5.

---

## 5. Qué significa para el ERD y para el puerto

**El ERD no necesita cambios.** `shipments` (§13.1) ya tiene `provider`,
`tracking_number`, `label_ref`, `origin`/`destination`/`package_info` jsonb,
`cost_amount` + `currency` y `raw`; `shipment_tracking_events` (§13.2) ya tiene
`provider_status text` 🌐 **y** `raw`. Esa separación entre el estado crudo del
proveedor y nuestro enum normalizado es exactamente lo que hace falta acá, y es
la misma decisión que DEC-035 tomó para Mercado Pago.

**El puerto se diseña con esto a la vista:**

- `quote()` devuelve **varias** tarifas (por `deliveredType` y `productType`),
  no una, y **con vencimiento**.
- `createShipment()` puede o no devolver tracking number según la plataforma.
- `getTracking()` es **por lote** y se invoca desde un job, no desde un request.
- `handleWebhook()` **no va**: no hay webhooks. Poner la operación en el puerto
  sería modelar una capacidad que el proveedor no tiene.
- Las dos APIs usan nombres distintos para el mismo concepto (`deliveredType` vs
  `deliveryType`; `"D"` vs `homeDelivery`). El puerto expone **un** vocabulario
  interno y cada adaptador traduce. Es justamente lo que `shipping.md` §3.2 pide.

---

## 6. Lo que hay que pedirle a Correo Argentino

Ordenado por lo que más destraba:

1. **Credenciales de test** — sin esto no se prueba nada. Las dos plataformas.
2. **¿Qué plataforma habilita nuestro acuerdo: MiCorreo, PAQ.AR, o las dos?**
   Cotizar y trackear viven en APIs distintas (§1).
3. **La lista de `statusId` de tracking**, y en particular **cuál significa
   entregado**. Es lo único que bloquea SH-003 y SH-002.
4. **Los `serviceType` válidos** y qué productos tiene habilitada la cuenta.
5. **El modelo de `customerId` para un marketplace** (§2.5): uno de Offside con
   el CP del vendedor como origen, o uno por vendedor.
6. Confirmación del límite de dimensiones: **150 cm o 255 cm** (§2.3).
