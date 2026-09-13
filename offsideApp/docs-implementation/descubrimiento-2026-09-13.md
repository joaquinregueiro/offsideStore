# Descubrimiento y navegación — 2026-09-13

> Fase 2 del plan de mejora que salió de la auditoría de UX/UI. Lo anterior
> (Fase 1) quedó en los commits del mismo día: `srcset`, relacionadas en la
> ficha y la protección al comprador visible.
>
> ⚠️ **Todo se verificó contra un build de producción**, con PostgreSQL y Redis
> reales y la base sembrada. Las capturas se tomaron con el Chromium que ya trae
> el entorno.

---

## 1. Lo que ya estaba y no se tocó

**La búsqueda ya paginaba.** `/buscar` acota la página pedida, maneja el fuera de
rango y resetea la paginación al cambiar un filtro. Se comprobó antes de escribir
nada: el plan la listaba como pendiente y no lo era.

La vitrina corta en 60 y enlaza a la búsqueda. No es un hueco: es una portada
curada, y el catálogo completo vive en `/buscar`, que sí pagina.

---

## 2. Pantallas de catálogo (`/club/[slug]`, `/marca/[slug]`)

En un marketplace de nicho la búsqueda orgánica es la puerta de entrada, y no
había ninguna página que la recibiera: a las facetas por club y marca sólo se
llegaba por `/buscar?club=<uuid>`.

- **Una sola implementación** para las dos (`(catalogo)/landing.tsx`). Son la
  misma pantalla con distinto sustantivo.
- **No son un buscador nuevo**: llaman a `searchListings` con un filtro fijo, así
  que usan el mismo filtro de visibilidad que la vitrina. Con consulta propia, el
  día que ese filtro cambie estas pantallas ofrecerían lo que la compra rechaza.
- **Sin tocar el ERD.** Las seis tablas de catálogo ya tenían `slug` UNIQUE
  (ERD §8). Se busca por slug y no por id porque es una URL pública: un uuid no
  significa nada y cambia si algún día se resiembra el catálogo.
- `findActiveBySlug` filtra por `is_active`: dar de baja una entrada apaga
  también su pantalla, en vez de dejarla indexada ofreciendo algo retirado.
- **Canónica a sí mismas**: el mismo contenido es alcanzable por
  `/buscar?club=<uuid>` y sin eso los dos compiten por la misma consulta.
- El **estado vacío no se disfraza de error**. Un club sembrado sin
  publicaciones es lo normal hoy, y la pantalla es alcanzable desde un buscador:
  ofrece salida (catálogo completo o publicar). Su descripción tampoco promete
  catálogo: dice que todavía no hay.

## 3. Descubribilidad

Una landing a la que no apunta nadie no sirve. No existía ni `sitemap.ts` ni
`robots.ts`.

- **`sitemap.ts`**: portada, búsqueda, cómo funciona, las landings y las fichas.
  ⚠️ El tope de publicaciones **no** es el default de `listPublicCatalog` (60, el
  de la vitrina): eso dejaría fuera del índice todo lo que no entra en la portada.
- **`robots.ts`**: bloquea cuenta, vendedor, back-office, carrito, checkout y
  `/api`. ⚠️ **No es una medida de seguridad** —`robots.txt` es una petición que
  se puede ignorar—: lo que protege esas pantallas son las guardas de sesión.
- Los atajos y las dos bandas de la portada dejaron de apuntar a
  `/buscar?club=<uuid>`. Para eso las facetas ahora traen `slug`
  (`nombresPorId` → `entradasPorId`, que tenía un solo consumidor).

Medido: la portada pasó a tener 10 enlaces `/club/…` y 7 `/marca/…`, con **cero**
`/buscar?club=<uuid>` restantes. `sitemap.xml` devuelve 74 URLs.

---

## 4. Barra inferior en teléfono

Abajo de 900px `header.module.css` apaga `.acciones`, así que el carrito, las
notificaciones y la cuenta quedaban a **dos toques**. El carrito es el camino a
la compra.

- **No es una navegación nueva**: es `.acciones` movida al pulgar, encendida en
  la misma media query que la apaga arriba. El cajón de la izquierda sigue siendo
  el de la cuenta y por eso "Cuenta" **no** está en la barra: repetir las mismas
  secciones en dos lados es el error que esta base ya corrigió una vez.
- El quinto lugar es **Favoritos** porque no se alcanzaba en un toque desde
  ningún lado, y en segunda mano es el motor del regreso.

### ⚠️ Dos cosas que sólo aparecieron al mirar

1. **La barra se dibujaba tapando el buscador, no al pie.** El header es de
   vidrio, y un ancestro con `backdrop-filter` **crea un bloque contenedor** para
   sus descendientes `position: fixed`: dentro del `<header>`, la barra se
   anclaba al header. Se arregló sacándola del `<header>` —sigue saliendo del
   mismo componente, que ya tiene sesión, contador y `seccion`, pero como
   hermano—. Ningún chequeo automático lo habría encontrado.
2. **La barra de compra de la ficha quedaba tapada.** Con `bottom: 0` caía justo
   debajo de la navegación y el botón de comprar —la única acción de esa
   pantalla— terminaba abajo de los iconos. Ahora se despega
   `--alto-nav-inferior` (token nuevo, lo leen tres lugares) y arriba de 900px el
   corrimiento se anula.

### Cómo se verificó, y una trampa del método

⚠️ **`--window-size` de Chromium headless no fija el viewport**: recorta el PNG
pero la página se sigue maquetando a otro ancho. Una captura directa a 375px
sugería que el header desbordaba; **medido, `desborda: false` con scrollWidth
360**. Se estuvo a punto de reportar un bug que no existía.

El método que sí sirve: renderizar la página **dentro de un iframe de ancho
fijo** y medir desde la página contenedora (mismo origen). Con eso se confirmó a
375px reales: barra al pie a ancho completo, cuatro ítems repartidos, sin
desborde, y la barra de compra por encima de la navegación.

---

## 5. Lo que queda anotado

### 5.1 "Vistos recientemente" — decisión pendiente 🟡

La otra mitad de "favoritos más visibles" **ya está** (Favoritos a un toque en la
barra). Falta "vistos recientemente", y **no se implementó a propósito**: las
tres salidas chocan con la arquitectura y ninguna es gratis.

| Opción         | Costo                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `localStorage` | Obliga a un Client Component y a un **fetch desde el cliente** contra un endpoint nuevo: sería el primero en una app que es Server Components + Server Actions |
| Cookie         | No se puede escribir durante el render de un GET en Next; necesita igual JS o un route handler                                                                 |
| Tabla propia   | Cambio de ERD → **ARQUITECTÓNICO**, requiere autorización del owner                                                                                            |

Recomendación si algún día se retoma: la de `localStorage`, acotada, con el
bloque apareciendo sólo con JS y el sitio funcionando igual sin él. Pero
introduce un patrón nuevo y esa decisión es del owner.

### 5.2 ⚠️ Contraste del titular de la ficha en modo oscuro

Al revisar capturas **en modo oscuro** apareció que el `<h1>` de la ficha, que
compone `titular-degradado`, se lee con muy poco contraste sobre la superficie
oscura. **Es preexistente** —no lo introdujo este trabajo— y no se midió con la
fórmula WCAG: se vio. Queda anotado para medirlo y, si confirma, ajustar el
degradado en oscuro como ya se hizo con los otros tokens.
