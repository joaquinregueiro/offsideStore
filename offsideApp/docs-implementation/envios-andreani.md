# Envío automático con Andreani PyME

Implementado el 2026-10-02. Describe **cómo quedó el código**; no reemplaza a
`docs/03-operations/shipping.md`, que sigue siendo la fuente de verdad.

## Qué hace

Desde la ficha de una venta en preparación, el vendedor carga peso y medidas y
aprieta **Generar envío con Andreani**. Offside:

1. reserva la fila de `shipments` (el índice único por orden impide un doble
   alta por doble clic);
2. da de alta el envío en Andreani con el domicilio de despacho del vendedor
   como origen y la dirección congelada en la orden como destino;
3. ofrece la etiqueta (`/vendedor/ventas/[orderId]/etiqueta`, PDF, sólo para
   el vendedor de esa venta, `Cache-Control: private, no-store`);
4. cada media hora (`shipments-sync`, minutos 10 y 40) pregunta a Andreani por
   todos los envíos abiertos y mueve la orden: **PROCESSING → SHIPPED** cuando
   el paquete está en camino y **SHIPPED → DELIVERED** cuando se entrega. Lo
   hace el sistema, que `marketplace-flow.md` §6 ya admite como actor de esas
   dos transiciones.

El despacho manual (transportista + número) sigue disponible para quien
despacha por su cuenta.

## De dónde sale la API

No es la API corporativa de `developers.andreani.com`: esa pide credenciales
que salen de un contrato comercial, y es lo que nunca respondieron. Es la API
**PyME**, la que usa el plugin oficial de WooCommerce (`andreani-shipping`
v1.6.4, GPL). Se relevó leyendo su código:

| Operación         | Llamada                                                |
| ----------------- | ------------------------------------------------------ |
| sesión            | `POST /api/v1/Login`, `Authorization: <Credencial ID>` |
| cotizar           | `POST /api/v1/Pyme/rates`                              |
| alta              | `POST /api/v1/Pyme/ShippingRegistration`               |
| estado por lote   | `POST /api/v1/Shipments/ByOrderNumbers` (hasta 100)    |
| etiqueta          | `POST /api/v1/Pyme/ticket` → bytes del PDF             |
| sucursales por CP | `GET /api/v1/Branch?postalCode=`                       |

Base: `https://woocommerce-api-acom.andreani.com`, constante en
`infrastructure/andreani/andreani.client.ts` (es parte del contrato del
proveedor, como las URLs de Mercado Pago). Las demás llamadas van con
`X-Auth-Token`, cacheado 6 h en Redis bajo un resumen de la credencial —nunca
la credencial—, con un único reintento ante 401/403.

⚠️ **Es el backend de un plugin, no una API publicada.** Puede cambiar sin
aviso, y sus términos de uso fuera del plugin no están claros 🔵. El adaptador
está detrás de `ShippingPort`, así que cambiar de proveedor no toca el dominio.

## Lo que NO es automático

⚠️ **En la cuenta PyME el envío nace "por pagar".** El alta lo deja en
`pymes.andreani.com/ver-envios` esperando que alguien lo pague con la cuenta de
Offside. Hasta entonces **no hay número de seguimiento ni etiqueta**, y la
ficha lo dice ("pendiente de pago"). El barrido detecta solo cuándo aparece el
número. Un envío 100% automático, sin ese paso, requiere la cuenta corporativa.

⚠️ **La plata del envío es una decisión de negocio abierta 🟡.** Andreani le
cobra a la cuenta de Offside, pero lo que pagó el comprador por el envío viaja
al vendedor en el split de Mercado Pago. Hoy no hay mecanismo que lo compense.

## Decisiones de implementación

- **Sin reintento del alta.** No es idempotente (el plugin tampoco reintenta).
  Ante un timeout la reserva **queda** con `raw.estado = 'incierto'` y el
  barrido encuentra el envío por su referencia; borrarla invitaría a duplicarlo.
  Ante un rechazo, la reserva se libera para corregir y reintentar.
- **La referencia del alta es el número de orden**, y el barrido busca por él,
  no por `labelRef`. Antes buscaba por `labelRef`, que en el simulado es el
  número de seguimiento: el barrido no encontraba nunca un envío simulado y
  nada fallaba. Lo fija `order-shipping.integration.test.ts`.
- **`lookupShipments` recibe referencia y número.** Andreani busca por
  referencia (no hay número hasta el pago); el simulado calcula la etapa desde
  el número, que lleva la fecha de creación adentro, y por eso **no guarda
  nada en memoria**. Con memoria, el worker —que Next empaqueta aparte de las
  Server Actions— miraba un mapa vacío.
- **Validación antes de llamar**: nombre y apellido del destinatario,
  teléfono (el de la dirección o, si falta, el de la cuenta), domicilio de
  despacho del vendedor, peso hasta 50 kg, lado hasta 165 cm y suma hasta
  300 cm.
- **Contratos**: se descartan "Llega hoy" (despacho antes del mediodía) y
  "Bigger" (más de 50 kg). Sólo envío a domicilio: el envío a sucursal
  necesita que el checkout ofrezca elegir una, y eso no existe.
- **Estados**: sin número es siempre `created`. "No entregado" se evalúa antes
  que "entregado", que es una subcadena suya.
- **El historial de la orden usa `clock_timestamp()`.** PAID y PROCESSING se
  escriben en la misma transacción; con `now()` empataban la hora y la ficha
  mostraba "Pagada (estado actual)" con la orden ya en preparación.

## Configuración

`ANDREANI_CREDENCIAL` (opcional, secreta): el **Credencial ID** que se genera
en andreani.com > Integraciones > WooCommerce. Con ella se usa Andreani; sin
ella, en desarrollo y tests se usa el simulado y en producción el botón no
aparece. ⚠️ No hay ambiente de pruebas: con la credencial cargada en un `.env`
local, cada alta es un envío real. Los tests de integración la borran del
entorno antes de arrancar.

El remitente que figura en la etiqueta es el que tenga configurado la cuenta
de Offside en Andreani.

## Pendiente

- Cotizar el envío en el checkout (SH-011/BS-070): el puerto y el adaptador ya
  cotizan, pero `listings` no tiene peso ni medidas (ERD) y la orden congela
  `shipping_amount` al crearse (DEC-030).
- Envío a sucursal.
- Quién paga el envío y cómo se compensa (ver arriba).
- Probarlo contra la cuenta real: hasta ahora se probó con el simulado y con
  tests del mapeo sobre las respuestas que guarda el plugin.
