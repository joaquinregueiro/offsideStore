# Auditoría del frontend — 2026-09-09

> Documentación de **implementación** (CLAUDE.md §13). No reemplaza a `docs/`.
> Los cambios que salieron de acá están en `frontend-design-system.md`.

---

## 1. Método y números

Doce auditorías independientes sobre el mismo código, una por dimensión, cada
una obligada a citar archivo y evidencia. Cada lote de hallazgos pasó después
por un **verificador adversarial** cuya única tarea era refutarlos: abrir el
archivo citado, comprobar que el problema existe, y descartar todo lo que fuera
opinión, duplicado, o una propuesta que rompiera una decisión documentada.

|                                           |                                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Dimensiones auditadas                     | 12                                                                                                                              |
| Hallazgos **confirmados**                 | **251**                                                                                                                         |
| Hallazgos **descartados** en verificación | **39**                                                                                                                          |
| Severidad                                 | 6 críticos · 45 altos · 104 medios · 96 bajos                                                                                   |
| Categoría                                 | 73 funcionalidad faltante · 46 UX · 40 consistencia · 27 copy · 26 accesibilidad · 14 responsive · 13 performance · 12 estética |

**Las doce dimensiones:** fidelidad al sistema visual · estética y UX de las tres
pantallas públicas · estética y UX de auth y compra · estética y UX de vendedor y
admin · accesibilidad WCAG 2.1 AA · responsive y móvil · idiomas de Next.js y
performance · biblioteca de componentes · funcionalidad de producto faltante ·
copy y contenido · manejo de estados y errores · navegación y arquitectura de
información.

**Ejemplos de lo descartado** (para que no vuelva a proponerse):

- _"El comprador no recibe información sobre autenticidad."_ La propuesta
  implementaba una decisión abierta: DEC-025 sigue 🟡 y `trust-and-safety.md`
  §4.4 registra que el conjunto documentado difiere del enum del ERD.
- _"'sólo' y 'ésta' con tilde."_ La RAE lo desaconseja pero no lo considera
  incorrecto, y está aplicado de forma consistente.
- _"El paso 'Email verificado' del panel nunca puede estar pendiente."_ Es
  cierto que el CTA es inalcanzable, pero mostrar el checklist completo de
  TS-001 le comunica al vendedor cuáles son los tres requisitos.

---

## 2. Lo que YA estaba bien (no rehacer)

Vale decirlo primero, porque el resto del documento habla de lo que falta:

- **Disciplina de tokens**: cero hex hardcodeado en los diez `*.module.css`.
- **Progressive enhancement de verdad**: los formularios funcionan sin
  JavaScript, y el único Client Component del sitio es el que no puede no serlo.
- **Toda búsqueda viaja en la URL**: se comparte, se guarda en favoritos y
  vuelve con el botón atrás.
- **`?next=` saneado contra open redirect**, con doble validación (pantalla y
  acción) y test.
- **Formularios accesibles en la base**: `htmlFor`/`id`, `aria-describedby`,
  `required`, `enctype` siempre presente, protección contra doble envío.
- **`prefers-reduced-motion`** global, y cero `outline: none` en todo el código.
- **El estado nunca se comunica sólo con color** en el checklist del vendedor:
  hay símbolo y texto.
- **Autorización por capacidad**: el índice del back-office oculta lo que no
  corresponde, y cada pantalla y cada Server Action lo vuelven a exigir.

---

## 3. Las fases

Leyenda: ✅ hecho el 2026-09-09 · ⬜ pendiente · 🔒 bloqueado por decisión.

### FASE 1 — Fundaciones visuales

_Objetivo: cerrar el sistema de componentes para que las fases siguientes no
tengan que inventar CSS suelto._ El diagnóstico fue que **la disciplina de
tokens era excelente pero la superficie de primitivas demasiado chica**, y el
hueco se tapaba con CSS copiado entre módulos y 19 estilos inline.

|     | Tarea                                                                                                                                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅  | Contraste: tres colores que no llegaban a AA (§1.1 de `frontend-design-system.md`)                                                                                                                                                                                    |
| ✅  | Botón: variantes `fantasma` y `peligro`, tres tamaños, `:active`, `cargando` con `aria-busy`, icono                                                                                                                                                                   |
| ✅  | Botones legibles sobre superficies oscuras (el primario era invisible en la portada)                                                                                                                                                                                  |
| ✅  | `Etiqueta` y `Aviso` con tono semántico; 24 puntos de uso migrados                                                                                                                                                                                                    |
| ✅  | `Formulario` propaga variante y tamaño — Eliminar, Borrar foto y Emitir reembolso salían con el mismo verde que Publicar                                                                                                                                              |
| ✅  | Mapa único estado→tono (`tonoDeOrden`, `tonoDePublicacion`, `tonoDeVendedor`): estaba escrito 7 veces con criterios distintos                                                                                                                                         |
| ✅  | `Campo` acepta `min`/`max`/`step`/`inputMode`; aplicado en comisión, precio, stock y reembolso                                                                                                                                                                        |
| ✅  | Primitivas nuevas: `Contenedor`, `Tarjeta`, `FilaDeAcciones`, `Esqueleto`                                                                                                                                                                                             |
| ✅  | `EstadoVacio` con icono y nivel de encabezado (5 pantallas no tenían `h1`)                                                                                                                                                                                            |
| ✅  | Tokens: elevación, transiciones, capas, alto de control, anchos, patrón de rombos                                                                                                                                                                                     |
| ✅  | `text-align: left` en `.campo` (el centrado del estado vacío se filtraba al formulario de reenvío)                                                                                                                                                                    |
| ✅  | `--peso-semi` en los 3 lugares con `font-weight: 600` literal                                                                                                                                                                                                         |
| ⬜  | **Primitivas `Tarjeta` (con elemento configurable) y `FilaDeDatos`** — el bloque `.acceso` está **byte a byte idéntico** entre `vendedor.module.css` y `admin.module.css`, con la grilla ya divergida (220px vs 240px); `.linea` + `.concepto` están triplicados      |
| ⬜  | **Errores por campo** — los cuatro `mensajeDeError` devuelven `issues[0]?.message` y descartan `path` y el resto. Extender el estado con `campos` y `valores` arregla dos cosas de una: **el formulario que se vacía** al fallar y **el error que no dice qué campo** |
| ⬜  | **Sacar `noValidate`** del formulario — hoy todos los `required` del sitio son decorativos y cada campo vacío cuesta un viaje al servidor. Va junto con lo anterior                                                                                                   |
| ⬜  | Mover `EstadoFormulario` de `app/(auth)/acciones` a `lib/`: la biblioteca de componentes depende de una ruta                                                                                                                                                          |

### FASE 2 — Navegación y chrome

_Objetivo: el sitio tenía **un solo** mecanismo de navegación y estaba roto en
móvil._ Fue la fase de mayor impacto visible por unidad de trabajo.

|     | Tarea                                                                                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅  | **Barra superior responsive** — desbordaba entre 185 y 290px en todo teléfono, en las 21 pantallas                                                                                                                                                                                              |
| ✅  | Menú de teléfono con `<details>`, sin JavaScript                                                                                                                                                                                                                                                |
| ✅  | **Pie del sitio** — no existía en ninguna pantalla                                                                                                                                                                                                                                              |
| ✅  | Enlace de saltar al contenido + `<main id="contenido">` en las 28 páginas                                                                                                                                                                                                                       |
| ✅  | Foco visible sobre la barra verde (era invisible: 1.00:1)                                                                                                                                                                                                                                       |
| ✅  | Áreas táctiles de 44px en enlaces, botón de lupa y opciones de faceta                                                                                                                                                                                                                           |
| ✅  | Buscador y selector de orden a 16px — abajo de eso iOS hace zoom y no lo deshace                                                                                                                                                                                                                |
| ✅  | El buscador conserva lo que se buscó                                                                                                                                                                                                                                                            |
| ✅  | Nada enlazaba a `/buscar`: ahora lo hacen la barra, la portada, la grilla y el pie                                                                                                                                                                                                              |
| ✅  | Logo real (isotipo + wordmark), favicon y `apple-icon`                                                                                                                                                                                                                                          |
| ✅  | `metadataBase`, Open Graph, `title.template`, `themeColor`, `robots`                                                                                                                                                                                                                            |
| ✅  | Open Graph de la ficha con la portada real de la publicación                                                                                                                                                                                                                                    |
| ✅  | `loading.tsx` en la raíz y en los cuatro grupos                                                                                                                                                                                                                                                 |
| ✅  | `/vendedor/fiscal` dejaba de ser alcanzable en cuanto se completaba                                                                                                                                                                                                                             |
| ⬜  | **Grupo de rutas `(vitrina)`** — el `Header` se declara en 4 lugares porque home, `/p/[id]` y `/buscar` no comparten layout. Es la causa raíz de que su `loading.tsx` tenga que dibujar una barra falsa. **No se hizo para no mover archivos que otra persona puede estar tocando en paralelo** |
| ⬜  | **Barra de secciones** en el panel del vendedor y en el back-office — los cuatro layouts de grupo son idénticos                                                                                                                                                                                 |
| ⬜  | **`error.tsx` por grupo de rutas** — hoy el único límite está en la raíz, así que un fallo en `(compra)` se lleva puesto el layout del grupo **y la barra con él**, justo cuando el comprador no sabe si el pago pasó                                                                           |
| ⬜  | `next` se pierde al cruzar entre pantallas de auth ("Creá una" desde `/ingresar?next=/p/xxx` tira el destino)                                                                                                                                                                                   |
| ⬜  | `robots.ts` y `sitemap.ts`                                                                                                                                                                                                                                                                      |

### FASE 3 — Pantallas públicas

_Objetivo: vitrina, ficha y búsqueda funcionan pero están inconclusas como
e-commerce._ Casi todo lo que faltaba **son datos que ya se consultan y se
descartan en el mapper**.

|     | Tarea                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅  | **Paginación de la búsqueda** — el Service ya la soportaba entera y la pantalla nunca leía el parámetro: imprimía "N publicaciones" y entregaba 24                         |
| ✅  | Pastillas de filtro activo + "Limpiar todo"                                                                                                                                |
| ✅  | Filtros plegables en teléfono — a ≤900px los diez grupos empujaban el primer producto fuera de la pantalla                                                                 |
| ✅  | Cambiar el orden ya no borra los filtros                                                                                                                                   |
| ✅  | Ficha: en teléfono, **encabezado → fotos → compra** (el precio quedaba debajo de hasta 8 fotos)                                                                            |
| ✅  | Ficha: `aspect-ratio` en la galería (ocho fotos = ocho saltos de página)                                                                                                   |
| ✅  | Ficha: "Home"/"Away" → "Titular"/"Suplente"; se agregó el largo de manga                                                                                                   |
| ✅  | Ficha: migas de pan en vez de un "volver" que mentía                                                                                                                       |
| ✅  | Portada con dos llamadas a la acción y camino para vender sin sesión                                                                                                       |
| ✅  | Grilla que baja a 150px en teléfono (a 320px daba **una** columna)                                                                                                         |
| ✅  | Estado vacío de la vitrina con acción                                                                                                                                      |
| ✅  | "Más recientes" aparecía dos veces en el selector de orden                                                                                                                 |
| ✅  | Comentarios que mentían (CSS y el JSDoc de `listing.service.ts`)                                                                                                           |
| ⬜  | **Filtro de precio** — `precioMin`/`precioMax` llegan hasta el SQL y **no tienen ningún control en pantalla**. PS-023 lo pide                                              |
| ⬜  | **Club, marca y temporada en la ficha** — se filtra por "Adidas", se entra al resultado y la ficha no menciona la marca. Requiere sumarlos al `SELECT` de `findPublicById` |
| ⬜  | **"Última unidad" en la ficha del catálogo** — `stock` se consulta y se descarta en el mapper, así que la grilla no distingue la de una unidad de la de diez               |
| ⬜  | **`srcset`/`sizes`** — se generan tres variantes y siempre se sirve una; el detalle manda la de 1600px a una columna de ~327px, hasta ocho veces                           |
| ⬜  | `React.cache()` en `getSessionUser` y `findPublicListing` — `/p/[id]` hace 4 consultas donde alcanzan 2                                                                    |

### FASE 4 — Flujos privados (auth, compra, vendedor, admin)

_Objetivo: auth y compra están bien pensados; el panel del vendedor y el
back-office fallan como **herramienta**._ Esta fase quedó **casi entera para el
amigo**: sólo se tocaron los dos bugs y lo que arrastraba la Fase 1.

|     | Tarea                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅  | 🔴 Los Server Actions se tragaban `redirect()` y `notFound()` (§5.2 del otro documento)                                                                                                           |
| ✅  | 🔴 Editar una publicación borraba los catálogos en silencio (§5.1)                                                                                                                                |
| ✅  | Variante destructiva en Eliminar, Borrar foto y Emitir reembolso                                                                                                                                  |
| ✅  | Cuarta tarjeta de acceso a identidad fiscal                                                                                                                                                       |
| ⬜  | **`?status=pending` de Mercado Pago no está contemplado** — es alcanzable (Rapipago y Pago Fácil vuelven así) y la persona no ve **ningún** mensaje; además sigue ofrecido el botón de pagar      |
| ⬜  | **"Mis compras" no dice qué compraste**: es una lista de códigos `OFF-XXXXXXXXXX`. `order_items.title_snapshot` ya está congelado                                                                 |
| ⬜  | **La foto del producto desaparece justo al confirmar la compra** — `coverUrl` ya viene recortado al tamaño necesario                                                                              |
| ⬜  | **Un error de validación en la compra borra la dirección entera** y sólo muestra el primer error (depende de "errores por campo", Fase 1)                                                         |
| ⬜  | **Publicar con fotos fallidas** deja la publicación creada, devuelve error rojo y el formulario listo para duplicarla                                                                             |
| ⬜  | **`findByBuyerId` / `findBySellerId` sin `ORDER BY`** — Postgres reordena al hacer UPDATE: pausar una publicación reordena la lista                                                               |
| ⬜  | **El vendedor acepta y opera sin ver nunca la comisión** ⚠️ leerla del Config Store, jamás escribir el número                                                                                     |
| ⬜  | **La consola de pagos esconde `mpPaymentId`**, que es el único dato con el que se busca en Mercado Pago — y la pantalla dice "verificá en Mercado Pago"                                           |
| ⬜  | **Ortografía y voseo de ~50 mensajes de error** ("Email o contrasena incorrectos" en una pantalla cuya etiqueta dice "Contraseña"); sacar "(BR-001)" del texto visible; mensajes de Zod en inglés |
| ⬜  | **Estados de conexión de MP**: `expired` y `revoked` se muestran como "Sin conectar", igual que nunca conectada, justo en la pantalla que existe para gestionarla                                 |
| ⬜  | **Avisos de consecuencia debajo del botón** que ejecuta la acción — el de la comisión ("rige para órdenes nuevas") es el malentendido más caro posible                                            |
| ⬜  | **Confirmación en dos pasos** para Eliminar y Emitir reembolso ⚠️ sin `window.confirm` ⚠️ desvincular MP **no** va acá: es reversible por diseño                                                  |
| ⬜  | **`id` duplicado** en los formularios de reembolso dentro del `map`                                                                                                                               |
| ⬜  | **El motivo del reembolso es opcional** mientras la pantalla promete trazabilidad ⚠️ texto libre obligatorio sí, select de causales no (la política sigue 🟡)                                     |
| ⬜  | **`adminRole` y `paymentStatus` crudos en pantalla** (`ADMIN`, `APPROVED`) ⚠️ el crudo de MP sí se conserva, por DEC-035                                                                          |
| ⬜  | **El formulario de publicar son 15 controles planos** — tres `fieldset` con `legend`                                                                                                              |
| ⬜  | **El panel del vendedor no muestra nada operativo** una vez aprobado ⚠️ con `COUNT` en el repositorio                                                                                             |
| ⬜  | **`bio` y `shippingPolicy` se piden una vez y no se muestran nunca**, ni al propio vendedor                                                                                                       |
| ⬜  | **El enlace de verificación se consume con un GET** y los escáneres de correo lo queman antes que la persona — `restablecer-password` ya resolvió esto bien y sirve de modelo                     |

### FASE 5 — Producto faltante

_Dato duro: **52 tablas migradas, 25 en uso**._ Lo importante de esta fase es la
división entre lo que **la documentación ya decidió** —se puede construir— y lo
que sigue 🟡/🔵/🔴, que **no se toca sin el owner**.

**5.A — Decidido ✅, construible sin escalar:** favoritos (`favorites` migrada, y
el icono ya está dibujado) · carrito (`carts`/`cart_items` migradas; ⚠️ DEC-026
nunca se ejerció) · perfil público del vendedor · libreta de direcciones (⚠️ el
snapshot de dirección ya está bien diseñado y no hay que tocarlo) · los 9
atributos de dominio de BR-010, que **ya son columnas y nunca se capturan** ·
notificaciones de orden y pago (la cola y SES ya funcionan; hay 2 de 9 emails) ·
**ciclo de vida de la orden** (DEC-029 fija siete estados y existen dos; los
plazos son 🟡, van al Config Store) · cancelación y ventana de pago · reordenar
fotos · moderación reactiva · registrar chargebacks · normalizar talles ·
`catalog_change_requests` (la mitad del vendedor) · tres capacidades más de
back-office · historial de usuario.

**5.B — Bloqueado 🔒:** envíos completos · disputas · fórmula de reputación ·
autenticidad declarada · términos y privacidad · modelo fiscal (DEC-011) ·
refund sin saldo del vendedor (el escenario exacto de RISK-F1) · búsquedas
guardadas y follows (no están en el ERD) · mensajería (fuera del MVP por
DEC-024).

⚠️ **Los seis hallazgos críticos** eran: el desborde del header ✅, los dos bugs
✅ ✅, y tres de Fase 5 —envíos, ciclo de vida de la orden y disputas— que son
módulos enteros y no se tocaron.

---

## 4. Qué se recomienda hacer primero

En orden, y sabiendo que el trabajo se reparte entre dos personas:

1. **Fase 1 ⬜** — `Tarjeta`/`FilaDeDatos` y errores por campo. Es un bloque
   coherente y grande, y desbloquea buena parte de la Fase 4.
2. **Fase 2 ⬜** — el grupo `(vitrina)` y los `error.tsx` por grupo. Son
   estructurales: cuanto antes, menos código hay que mover.
3. **Fase 4 ⬜** — empezando por `?status=pending` y "Mis compras", que son los
   dos lugares donde hoy alguien que ya pagó se queda sin saber qué pasó.
4. **Fase 5.A** — el **ciclo de vida de la orden** antes que nada: sin él una
   orden pagada queda en `PAID` para siempre, nunca corre el plazo de despacho,
   nunca se cierra, y por lo tanto nunca se habilita la calificación. **Todo el
   modelo de confianza cuelga de un cierre que no llega.**

---

## 5. Bloqueos que necesitan decisión del owner (formato CLAUDE.md §4)

### BLOQUEO 1 — El archivo de identidad que el código cita como fuente de verdad no existe

1. **Qué encontré:** `tokens.css` y `layout.tsx` citan
   `design/Offside Identidad.dc.html` como fuente de verdad. En `design/` hay
   **un solo** archivo: `Offside Identidad Visual.html`, que contradice al
   código —usa Big Shoulders Display y una terracota `#C4562E`, y **no contiene
   el naranja `#FF902D`**—. `tokens.css` ya declara ese archivo como la versión
   vieja, pero el reemplazo no está en el repositorio.
2. **Documentos:** `apps/web/src/app/tokens.css` §encabezado; `design/` (§3, solo lectura).
3. **Impacto:** el sistema visual no se puede validar contra nada del repo. Quien
   siga CLAUDE.md §2 —`design/` manda sobre el código— abre el archivo presente
   y encuentra otra tipografía y otro acento. **Atenuante:** CLAUDE.md §19
   documenta "Big Noodle + Inter, Verde Cancha" como lo implementado, así que el
   código no está huérfano; falta el archivo de detalle.
4. **Decisión necesaria:** (a) commitear `Offside Identidad.dc.html`; o (b)
   confirmar por escrito que el vigente es el archivo presente **y decidir qué
   pasa con tipografía y acento**. Mientras tanto **no alinear `tokens.css` al
   archivo presente**: sería revertir a un sistema que §19 declara superado.
   ⚠️ **Regla operativa que se siguió en esta sesión: se cambian USOS de tokens,
   nunca las definiciones de color de identidad.**

### BLOQUEO 2 — Se hace aceptar términos y privacidad que no existen

1. **Qué encontré:** el alta de cuenta y el alta de vendedor piden aceptar cinco
   documentos **como texto plano, sin enlace**. No hay rutas legales. El
   consentimiento **sí se guarda** (`acceptedTermsAt`), sobre un documento
   inexistente.
2. **Documentos:** `docs/01-business/legal.md`, estado global 🔴 REQUIERE
   ASESORAMIENTO PROFESIONAL; §3 lista 13 documentos pendientes de abogado.
3. **Impacto:** consentimiento sin objeto en un sitio que ya cobra dinero real
   (RISK-L3, Ley 25.326). BS-002/SS-002 cumplidos a medias. **El código hizo lo
   correcto al no inventar el texto.**
4. **Decisión necesaria:** ¿se publican textos provisorios firmados por el
   owner, o se deja el hueco declarado hasta el abogado? Y: ¿se **versiona** qué
   versión aceptó cada usuario? Hoy sólo se guarda la fecha. **El andamiaje
   —rutas, pie y enlaces— se puede construir ya; el contenido no.**

### BLOQUEO 3 — Autenticidad declarada: el estado de DEC-025 es ambiguo

1. **Qué encontré:** TS-032 exige comunicar que la autenticidad es "declarada
   por el vendedor, no verificada". **En ninguna pantalla del sitio aparece la
   palabra autenticidad**, aunque el repositorio ya selecciona el campo. Sobre
   si se puede implementar hay **dos lecturas verificadas y opuestas**: una
   compara el enum del ERD con `product-specification.md` §4 y encuentra que
   coinciden uno a uno; la otra cita que DEC-025 sigue 🟡 y que
   `trust-and-safety.md` §4.4 **registra explícitamente que el conjunto
   documentado difiere del enum**.
2. **Impacto:** es el cuarto eje de confianza **sin ninguna presencia en el
   producto**, en un marketplace cuyo riesgo central es la falsificación.
3. **Decisión necesaria:** confirmar si DEC-025 quedó cerrada y si el enum del
   ERD es el conjunto vigente. Si sí: selector para el vendedor ⚠️ **sin
   `VERIFICADA` / `SOSPECHOSA` / `FALSIFICACION`**, que son moderación interna,
   más la leyenda de TS-032 en la ficha. **En esta sesión no se implementó nada.**

### BLOQUEO 4 — La descripción es obligatoria en un documento y opcional en el otro

1. **Qué encontré:** `product-specification.md` §4 la marca ✅ obligatoria;
   BR-011 enumera los campos mínimos y **no la incluye**. El código la trata como
   opcional.
2. **Impacto:** define si se puede publicar una camiseta usada **sin una palabra
   sobre su estado real**, que es materia prima de los reclamos "estado distinto
   al declarado".
3. **Decisión necesaria:** (a) obligatoria con mínimo de caracteres —menos
   disputas, más fricción, **y rompe las publicaciones existentes al
   editarlas**—; o (b) opcional, alineando `product-specification.md`. **Hasta
   que se decida no se cambió la validación.**

### BLOQUEO 5 — El total de la compra no menciona el envío

1. **Qué encontré:** la pantalla se titula "¿A dónde lo enviamos?", pide seis
   campos de dirección y muestra un Total **sin ninguna línea de envío**.
   `createOrder` documenta "no calcula envío; `shipping_amount` queda en 0".
2. **Documentos:** `docs/03-operations/shipping.md` §5.b — **quién paga el envío
   es 🟡**; SH-014 es 🔴.
3. **Impacto:** la lectura natural es "envío gratis". Si el vendedor pide el
   flete después, el comprador siente que le cambiaron el precio **una vez
   pagado** — y el módulo de disputas no existe.
4. **Decisión necesaria:** qué texto exacto va. ⚠️ Lo único seguro de escribir
   hoy es **el hecho** ("el total no incluye envío"); escribir "a coordinar con
   el vendedor" sería inventar la política desde la interfaz.

### BLOQUEO 6 — El copy dice "camisetas" y hay seis categorías

1. **Qué encontré:** todo el texto habla de camisetas y la ficha dice "**Vendida**
   por" en femenino fijo, mientras la migración `0004` carga seis categorías
   —camisetas, shorts, buzos, camperas, conjuntos, entrenamiento— que el filtro
   ofrece todas.
2. **Impacto:** a quien vende camperas se le dice "publicá tu primera camiseta";
   a quien compra un short, "Vendida por".
3. **Decisión necesaria:** **prácticamente ninguna** — `business-model.md` ya
   dice "camisetas **e indumentaria**". Se lista sólo para confirmar el criterio
   antes de tocar unos ocho textos. ⚠️ **La bajada de la portada no se toca: es
   literal de la identidad.**
