# Rediseño sobrio del frontend (2026-11-06)

Pedido del dueño: optimizar el diseño tomando la estructura de Mercado Libre, con
**claridad, minimalismo y profesionalidad**. Diseño de referencia:
[canvas del rediseño](https://claude.ai/artifact/MixobDkaJRiwpGFywDovfH) (privado).

⚠️ **Revierte a propósito el rediseño del 2026-09-10** (glow, vidrio, mallas,
animaciones, radios de 12 a 28 px). Quien lea
`frontend-rediseno-2026-09-10.md` y `frontend-movimiento.md` está leyendo un
sistema que ya no existe.

## Qué se toma de Mercado Libre y qué no

Se toma la **estructura**: barra de dos filas de borde a borde, banner corto con
tarjetas que lo pisan, filtros como lista de texto, ficha en tres zonas con caja de
compra, panel con barra lateral.

No se toma su identidad: el color, el logo y la tipografía son de Offside.

⚠️ **Tampoco se copian funciones que Offside no tiene.** "Compra protegida",
cuotas, envío gratis, "Enviar a", ofertas y cupones prometerían algo falso. Los
avisos "Envío a convenir" y "La autenticidad la declara el vendedor" siguen visibles.

## El sistema

| Elemento        | Valor                                                       |
| --------------- | ----------------------------------------------------------- |
| Ancho máximo    | 1200 px                                                     |
| Canal lateral   | 24 px, 16 px en teléfono                                    |
| Barra superior  | 64 + 44 px; en teléfono, una fila y el buscador abajo       |
| Fondo de página | `--color-neutro-suave`; las tarjetas son blancas            |
| Radios          | 6 px controles, 8 px tarjetas, 4 px detalles                |
| Sombra          | `--sombra-1` en reposo, `--sombra-3` en hover. Solo esas    |
| Tipografía      | Inter en todo. Big Noodle solo en el logo, el titular de    |
|                 | portada y los precios                                       |
| Movimiento      | ninguno, salvo color y sombra al pasar el cursor            |

⚠️ **Apartamiento de `design/`.** La identidad asigna Big Noodle a todos los
titulares. Pasar los títulos a Inter lo decidió el dueño al aprobar el canvas.

## Decisiones técnicas

- **Sin transiciones entre pantallas.** `Pantalla`, `LlegaContenido` y
  `SeVaElEsqueleto` quedan como paso directo porque las usan unas sesenta pantallas.
- **Barra lateral de vuelta, sin duplicar.** El 2026-09-12 se sacó porque convivía
  con el cajón. Ahora el cajón existe solo en teléfono y la barra (`barra-lateral.tsx`)
  solo en escritorio. Las dos leen `itemsDelPanel`.
- **`enlace-lateral.tsx` es el único Client Component nuevo**, por `usePathname`.
  La sesión y los conteos siguen en el servidor.
- **Filtros de `/buscar`.** En escritorio el `<details>` se fuerza abierto con
  `::details-content`; en teléfono se pliega.
- **Galería de la ficha.** Scroll-snap con miniaturas que son anclas: anda sin
  JavaScript.
- **Las franjas verdes de encabezado se fueron.** `sup-cancha` queda solo en la barra
  y en el banner de portada. El logo es blanco: en las pantallas de servicio va sobre
  un recuadro verde.
- **Modo oscuro:** los bloques siguen dormidos en `tokens.css` y `check:tema` los
  verifica. No se repasaron contra este sistema, así que encenderlo requiere revisión.

## Cómo se hizo y qué falta

La limpieza de las hojas se hizo con un script de una sola vez (PostCSS) sobre los 21
módulos, y a mano en barra, pie, cajón, tarjeta, portada, búsqueda y ficha.

⚠️ **Deuda que queda:** las hojas que no se reescribieron a mano (`vendedor`,
`admin`, `resumen`, `cuenta`, `form`, `ui`) conservan declaraciones sin efecto y
comentarios `⚠️` que todavía hablan del sistema anterior. Se borraron los que
mencionaban glow o animación, pero conviene una pasada de limpieza por archivo.

## Verificación

Docker Desktop no arrancó en la máquina de trabajo. Se verificó en el navegador con
PostgreSQL embebido (PGlite) y un Redis falso, con publicaciones cargadas a mano y
**sin fotos**: nada de eso se commiteó.

Vistas a 1280 px: portada, búsqueda, ficha, ingreso, cuenta, panel de vendedor,
publicaciones, publicar, confirmar compra, cómo funciona y back-office. A 375 px:
portada, ficha y cuenta, sin desborde.

No se vieron: fotos reales en tarjetas, galería y banner; checkout con orden creada;
detalle de ventas y reclamos; el worker de BullMQ; **los tests de integración no se
corrieron**.

⚠️ **Revisar antes de desplegar:** en `next dev --webpack` la pantalla 404 mostró la barra superior sin sus estilos, y no se pudo comprobar en un build de producción porque el servidor no arranca sin Redis. Mirar `/no-existe` con la app corriendo normalmente.
