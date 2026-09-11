# El marketplace completo: niveles, promociones, ciclo de la orden, reputación y reclamos — 2026-09-11

> El dueño pidió terminar la página "de punta a punta, todo real, nada mock":
> reputación por ventas y tiempo de entrega, publicaciones promocionadas a
> cambio del triple de comisión, tres niveles de vendedor con comisión
> decreciente, y los paneles de comprador y vendedor con pestañas. Esta entrada
> documenta qué se construyó, qué decisiones se tomaron y qué sigue sin existir.

## Qué hay ahora que antes no

| Módulo nuevo | Qué hace                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------- |
| `disputes`   | reclamos con ventana por estado, respuesta del vendedor con plazo, resolución y escalada |
| `reviews`    | calificación 1..5 del comprador con respuesta única del vendedor                         |
| `reputation` | proyección de métricas crudas, score derivado y nivel de usuario (DEC-020)               |
| `favorites`  | favoritos con alerta de baja de precio y aviso de vendido                                |
| `addresses`  | libreta de direcciones con las 24 jurisdicciones y una predeterminada                    |
| `questions`  | preguntas públicas en la ficha, con respuesta del vendedor                               |
| `cart`       | carrito multi-vendedor, una orden por vendedor (DEC-026)                                 |
| `reports`    | denuncias de publicaciones, una por persona y publicación                                |
| `trust`      | sanciones sobre el vendedor, con vigencia y efecto sobre la venta                        |

Y en los módulos que ya existían: el Config Store pasó a tener lectores
tipados de todas sus claves con precedencia por ámbito; `sellers` ganó niveles
y modo vacaciones; `listings` ganó promociones, envío declarado, orden por
precio y por reputación; `orders` ganó el ciclo completo de DEC-029.

## Las cinco decisiones que sostienen todo esto

### 1. La comisión se resuelve adentro de `orders`, no en la pantalla

`createOrder` consulta el nivel del vendedor y la promoción vigente de la
publicación, y congela el resultado. La pantalla de comprar y el carrito sólo
dicen qué publicación y cuántas unidades.

⚠️ **Si la pantalla tuviera que resolverlo, el día que alguien llame a
`createOrder` desde otro lado se cobraría la tasa equivocada sin que nada
falle.** La orden guarda además `commission_source` —general, nivel o
promocionada—, porque dentro de seis meses la respuesta a "por qué esta venta
cobró 18 %" está repartida entre tres tablas que pueden haber cambiado.

### 2. La promoción se congela al contratarla, no al vender

`listing_promotions.commission_multiplier_snapshot` guarda el multiplicador
del día en que el vendedor promocionó. Si Admin lo sube de 3 a 4 el martes, la
promoción del lunes sigue cobrando 3.

⚠️ **Y no se puede cancelar antes de tiempo.** Es la regla que evita el abuso
obvio: promocionar para figurar primero, recibir las visitas y cancelar antes
de vender para no pagar la comisión agravada. Sólo un administrador puede
terminarla, con motivo y auditoría. Asumido el 2026-09-11, a confirmar.

### 3. `PAID` es un instante, no un estado

El pago aprobado deja la orden en `PROCESSING` dentro de la misma transacción,
siempre que el descuento de stock no haya dejado faltantes. Con faltantes la
orden se queda en `PAID` y **no** corre el plazo de despacho: es el caso
"pagada sin stock", que aparece en el back-office porque necesita una persona.

Tres tests de integración que fijaban `PAID` como estado final se
actualizaron. No fue un ajuste al test: fue que el ciclo pasó a existir.

### 4. El despacho exige transportista y número de seguimiento

No hay integración con Correo Argentino —las credenciales salen de un acuerdo
comercial y el vocabulario de estados no está documentado—, así que el envío lo
declara el vendedor. `markShipped` exige los dos datos, y el transportista se
valida contra la lista ⚙️ `shipping_carriers`.

⚠️ **La reputación por tiempo de despacho se apoya en eso**: sin la fecha real
de despacho, `avg_dispatch_hours` no significa nada. Y ninguna pantalla promete
seguimiento automático: el texto dice que lo actualiza el transportista en su
propio sitio.

### 5. Los avisos y la confianza se enganchan, no se llaman

`orders` anuncia cada transición y no sabe quién escucha. Los avisos in-app y
los correos viven en `notifications`; los hechos de confianza y la reputación,
en `reputation`; el nivel del vendedor, en `sellers`. Los tres se registran
desde el arranque del servidor.

⚠️ **Ninguno puede romper una transición**: cuando corren, la orden ya está
commiteada. Un correo que no sale no puede hacer que una venta no haya
ocurrido. Y el orden importa: primero los hechos y la reputación, después los
avisos, porque el nivel del vendedor se calcula sobre los hechos que el paso
anterior acaba de escribir.

## Una orden por vendedor, con una excepción

DEC-026 dice que una orden es de un solo vendedor, porque cada una se cobra
sobre la cuenta de Mercado Pago de ese vendedor. El carrito agrupa por
vendedor y crea una orden por grupo.

⚠️ **Cada publicación promocionada va en su propia orden, aunque sea del mismo
vendedor.** El snapshot guarda un multiplicador y una promoción por orden:
mezclar una promocionada con otras le cobraría comisión agravada a artículos
que nadie promocionó, o dejaría una tasa congelada que no reproduce el importe
cobrado. Separándolas, el vendedor paga exactamente lo que contrató sobre lo
que contrató.

⚠️ **El envío no se suma por artículo**: se cobra el mayor de los declarados.
Mandar dos camisetas en el mismo paquete no cuesta dos envíos. Asumido, a
confirmar.

## Reclamos

La ventana de reclamo depende del estado:

- Enviada, entregada o completada, dentro de `dispute_window_days` contados
  desde la entrega, o desde el despacho si el comprador nunca confirmó.
- En preparación con el plazo de despacho vencido, y sólo por "no lo recibí"
  (BR-032). Reclamar que el producto no es lo publicado cuando todavía no se
  despachó no tiene sentido.

Se puede reclamar sobre una orden ya completada dentro de esa ventana: el
cierre automático ocurre solo, y no puede ser la forma de quedarse sin reclamo.

⚠️ **Las evidencias son sólo texto y enlaces.** El bucket de fotos es público
por diseño: subir ahí la foto de un documento sería una fuga con dirección
adivinable.

⚠️ **Quien resuelve no puede ser parte.** No alcanza con la capacidad: un
administrador que además es el comprador o el vendedor de esa orden no puede
resolver su propio reclamo.

⚠️ **Un reembolso rechazado por Mercado Pago no deshace la resolución.** La
decisión ya se tomó; lo que falló es el cobro. Queda en auditoría y **no** se
crea una deuda del vendedor: la deuda existe cuando Offside pagó y el vendedor
no, no cuando Mercado Pago rechaza.

## Capacidades nuevas

`disputes:resolve` y `trust:moderate`, las dos sólo para administración. Otorgar
el nivel TIENDA pasó a `trust:moderate`: es una decisión sobre la confianza de
una cuenta, no un cambio de configuración, y se opera desde la pantalla de
moderación. Hoy los dos mapas dan los mismos roles; el día que se separen, esa
pantalla no puede mostrar un formulario que el servidor rechaza.

Cambiar el nivel de un vendedor a mano ahora exige un motivo, que va a la
auditoría: cambia la comisión que se le cobra a una persona.

## Pantallas

**Comprador** (`/cuenta`, nueve pestañas): resumen con nivel y contadores,
compras con filtro por estado, detalle con cronología y la dirección congelada
de la orden, calificar, reclamar, reclamos, favoritos, direcciones,
notificaciones, preguntas, reseñas y datos.

**Vendedor** (once pestañas): panel con cifras vivas, ventas por estado,
detalle con el origen de la comisión, publicaciones con envío declarado,
promocionar con cotización sobre su propia tasa, promociones, reputación,
nivel, preguntas, tienda, vacaciones y métricas.

**Compra**: `/comprar/[id]` con cantidad, direcciones guardadas y envío
declarado; `/checkout/[orderId]` con cronología y confirmación de recepción;
`/carrito` agrupado por vendedor y `/carrito/listo`.

**Back-office** (diez pestañas, movimiento mínimo): configuración de todas las
claves con historial, niveles, comisión, pagos, disputas, vendedores, órdenes,
reportes e ingresos por origen de comisión.

**Públicas**: promocionadas en la home y en la búsqueda con su distintivo,
filtro de precio con el rango real, orden por precio y por reputación, ficha
con el vendedor y sus preguntas, tienda pública y `/como-funciona` ampliada.

⚠️ **El distintivo dice "Promocionada" y no "Destacada".** Destacada sugeriría
que la eligió Offside; la eligió el vendedor y pagó por eso.

## Qué NO existe, y por qué

- **Envío con etiqueta y seguimiento automático.** Correo Argentino necesita un
  acuerdo comercial. El vendedor carga el número a mano.
- **Compra protegida legal, cuotas propias y chat entre partes.** No están
  construidos y ninguna pantalla los promete.
- **Reseñas ocultas por moderación.** `reviews` no tiene `hidden_at` ni
  `hidden_by`; usar la auditoría como filtro sería convertir un registro de
  decisiones en estado de negocio. Requiere migración.
- **Nombre de usuario para la tienda.** `users.username` existe y es opcional,
  pero no hay flujo que lo asigne: la tienda se direcciona por id de vendedor.
- **Edición del nombre y el email de la cuenta.** `users` no expone la acción.
- **Baja de cuenta.** Alcance legal, DEC-011 sigue 🔴.
- **Overrides de configuración por ámbito editables.** Se ven y no se editan.
- **Refunds probados contra Mercado Pago real.** Siguen sin ejecutarse nunca.

## Verificado

- **545 tests unitarios y 360 de integración**, contra PostgreSQL y Redis
  reales. Sin drift entre Drizzle y las migraciones.
- `format`, `lint`, `typecheck` y `check:css` en verde.
- **Seed de desarrollo ampliado e idempotente**: dos publicaciones
  promocionadas (una se vende para que exista la comisión agravada, la otra
  queda en vidriera), venta completada con reseña y respuesta, venta en camino
  con reclamo abierto, reclamo resuelto, dos preguntas, tres favoritos, tres
  direcciones, carrito de dos vendedores, un vendedor de vacaciones y una
  sanción.
- **En el navegador**: home, panel del vendedor, nivel, ventas y detalle de
  venta a 1440. El detalle muestra la comisión del 18 % con su explicación
  ("la promoción multiplica tu comisión ×3"), el neto rotulado "antes del costo
  de Mercado Pago", la cronología de los siete estados, el envío con
  transportista y seguimiento, y el reclamo asociado. Cero desborde, un solo
  `<main>`, cero controles por debajo de 24px.
