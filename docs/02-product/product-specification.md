# Product Specification — OFFSIDE STORE

## 1. Propósito

Definir **cómo se modela un producto** en OFFSIDE STORE. La riqueza del modelo de
datos de la camiseta/indumentaria es **uno de los dos diferenciales** del
producto (el otro es la búsqueda/filtros que se apoya en este modelo). Un
desarrollador debe poder construir el esquema de datos, los formularios de
publicación y el motor de búsqueda a partir de este documento.

## 2. Alcance

Incluye: categorías habilitadas, el modelo de datos especializado (atributos,
tipos, obligatoriedad), taxonomías/vocabularios controlados, fotografías, y el
diseño de búsqueda y filtros especializados.

No incluye: el flujo de publicación paso a paso (ver `seller-system.md`) ni el
flujo de compra (ver `marketplace-flow.md`).

## 3. Conceptos principales

### 3.1 Principio rector

> Una camiseta **NO** se modela como `nombre + precio + descripción`.
> Se modela con **atributos estructurados** propios del dominio del fútbol, de
> forma que la búsqueda y los filtros puedan ser tan precisos como los que
> necesita un coleccionista.

### 3.2 Categorías habilitadas (alcance inicial del catálogo)

✅ **DECISIÓN:** el marketplace se especializa inicialmente en:

- camisetas
- shorts
- buzos
- camperas
- conjuntos
- ropa de entrenamiento
- indumentaria de clubes
- indumentaria de selecciones
- productos vintage/retro

> Nota: "indumentaria de clubes/selecciones" y "vintage/retro" se cruzan con las
> anteriores (una camiseta puede ser de club, de selección, y retro a la vez).
> Por eso el modelo trata **tipo de prenda** y **atributos** por separado (ver
> 3.3). Productos fuera de este alcance se rechazan (BR-016).

### 3.3 Entidades del modelo

Para evitar duplicar datos y permitir filtros consistentes, se separan:

| Entidad | Rol |
|---------|-----|
| **Product / Listing (publicación)** | El artículo puesto a la venta por un vendedor: precio, stock, fotos, estado, y el conjunto de atributos. |
| **Category (tipo de prenda)** | camiseta, short, buzo, campera, conjunto, ropa de entrenamiento. Define qué atributos son obligatorios. |
| **Attributes (atributos de dominio)** | club, selección, temporada, etc. (ver 4). |
| **Catálogos controlados** | Listas normalizadas: clubes, selecciones, marcas, competiciones, temporadas. Evitan texto libre inconsistente. |

💡 **RECOMENDACIÓN:** modelar los atributos de fútbol como campos estructurados
con **vocabulario controlado** (catálogos) siempre que sea posible (club, marca,
competición), y sólo dejar texto libre donde es inevitable (descripción,
medidas). Esto es lo que habilita filtros potentes.

## 4. Modelo de datos del producto (atributos)

Cada publicación puede/soporta los siguientes atributos. La columna
**Obligatorio** indica el mínimo para publicar; puede variar por categoría
(configurable).

| Atributo | Tipo | Vocabulario | Obligatorio | Notas |
|----------|------|-------------|-------------|-------|
| categoría (tipo de prenda) | enum | camiseta/short/buzo/campera/conjunto/entrenamiento | ✅ | Determina atributos requeridos. |
| título | texto | libre | ✅ | Generable a partir de atributos. |
| **club** | ref | catálogo de clubes | condicional | Obligatorio si es indumentaria de club. |
| **selección** | ref | catálogo de selecciones | condicional | Obligatorio si es indumentaria de selección. |
| **temporada** | texto/enum | p. ej. "2022/23" | 🟡 recomendado | Clave para coleccionistas. |
| **año** | entero | — | 🟡 recomendado | Útil para retro sin temporada clara. |
| **marca** | ref | catálogo (Adidas, Nike, Puma, …) | 🟡 recomendado | — |
| **modelo** | texto | libre/semi | opcional | Nombre del modelo si aplica. |
| **versión** | enum | jugador (authentic) / hincha (replica) / match-worn / otra | 🟡 recomendado | Muy relevante para valor. |
| **local/visitante/tercera** | enum | local / visitante / tercera / arquero / especial | condicional | Para camisetas. |
| **manga** | enum | corta / larga | condicional | Para camisetas/buzos. |
| **jugador** | texto | libre (opcional catálogo) | opcional | Ej. "Messi". |
| **número** | entero | — | opcional | Dorsal. |
| **sponsor** | texto/ref | libre/catálogo | opcional | Sponsor principal de la prenda. |
| **competición** | ref | catálogo (Champions, Libertadores, Mundial, liga local…) | opcional | Parche/edición de competición. |
| **talle** | enum | S/M/L/XL/…, **talle argentino**, **talle internacional**, **talle infantil** | ✅ | Normalizado por tabla de talles + **tabla de equivalencias** (🟡, DEC-025/OQ-F3). |
| **medidas** | estructura | **pecho**, **largo** (cm) | 🟡 recomendado | Reduce disputas por talle. |
| **estado** | enum | **NUEVO / COMO NUEVO / EXCELENTE / MUY BUENO / BUENO / ACEPTABLE** | 🟡 (DEC-025) | Conjunto **nuevo** propuesto; **descripción exacta de cada estado pendiente**. Reemplaza el set previo — ver 4.0. |
| **país de fabricación** | ref | catálogo de países | opcional | Señal de autenticidad. |
| **autenticidad** | enum | **No especificada / Original declarada / Réplica oficial / Verificada / Sospechosa / Falsificación** | 🟡 (DEC-025) | Conjunto **ampliado**; evidencia por categoría **pendiente** (TS-031). Reemplaza el set previo — ver 4.0. |
| **descripción** | texto largo | libre | ✅ | — |
| **fotografías** | lista de imágenes | — | ✅ (≥1) | Ver 4.2. |
| precio | dinero | — | ✅ | Ver business-rules BR-020. |
| stock | entero | — | ✅ | Normalmente 1 para usados/únicos. |

> **4.0 — Conjuntos actualizados 2026-08-19 (DEC-025). Contradicción señalada.**
> Los conjuntos de **estado del producto** y **autenticidad** fueron **ampliados**
> por el owner y **difieren de los enums del ERD** (`item_condition`,
> `authenticity` en `database-design.md`). **Se prioriza el nuevo conjunto**, pero
> **el ERD NO se modifica todavía** porque las **descripciones/evidencia de cada
> valor están pendientes** (🟡). Impacto registrado en
> `04-technical/open-decisions-impact.md`.
>
> - **Estado del producto:** NUEVO, COMO NUEVO, EXCELENTE, MUY BUENO, BUENO,
>   ACEPTABLE. (Descripción exacta de cada uno: 🟡.)
> - **Autenticidad:** No especificada, Original declarada, Réplica oficial,
>   Verificada, Sospechosa, Falsificación. (Evidencia por categoría: 🟡.)

### 4.1 Reglas de obligatoriedad condicional

- Si `categoría = camiseta` ⇒ obligatorios: local/visitante/tercera, manga,
  además de los mínimos generales.
- Si es **indumentaria de club** ⇒ `club` obligatorio.
- Si es **indumentaria de selección** ⇒ `selección` obligatorio.
- **vintage/retro** no es una categoría separada sino un **flag** (`es_retro`)
  y/o un rango de `año`/`temporada`.

🟡 **PENDIENTE:** la matriz exacta "categoría → atributos obligatorios" debe
cerrarse (equilibrio fricción vs calidad del dato). Aquí se deja el marco.

🟡 **PENDIENTE — Vintage / Retro (DEC-025).** Falta definir **qué consideramos
vintage**, **qué consideramos retro**, la **diferencia entre ambos**, qué es un
**remake oficial** y qué es una **réplica moderna de una camiseta histórica**.
Estas definiciones condicionan el flag `es_retro`, la búsqueda y la política de
autenticidad. **No inventar** las definiciones.

### 4.2 Fotografías

- **PS-010:** al menos 1 foto obligatoria; 🟡 recomendado exigir varias (frente,
  dorso, etiqueta interna, detalles/defectos).
- **PS-011:** para usados y retro, foto de la **etiqueta** es fuertemente
  recomendada (señal de autenticidad).
- **PS-012:** almacenamiento de imágenes: servicio de storage + CDN (ver
  `04-technical/architecture.md`). Se guardan metadatos (orden, alt, hash).

### 4.3 Catálogos controlados (taxonomías)

Se mantienen catálogos normalizados y versionados para: **clubes, selecciones,
marcas, competiciones, países, temporadas, tabla de talles**. Beneficios:
filtros consistentes, evitar duplicados ("River" vs "River Plate"), analítica.

🟡 **HIPÓTESIS:** los catálogos se semillan (seed) para el MVP con los clubes,
selecciones y marcas más frecuentes de Argentina + principales ligas/copas
internacionales. Alta de nuevos ítems: propuesta del vendedor → aprobación admin
(para no ensuciar el catálogo). Mecanismo fino 🟡 a definir.

### 4.4 Configuración de publicaciones vs datos de la publicación — ⚙️ (DEC-013)

Se distingue (Bloque 6):

- **Configuración administrativa (⚙️, global):** cantidad máxima de fotos, tamaño
  máximo, formatos, compresión, si se admite **video**, atributos **obligatorios**,
  reglas de **moderación**, si se permite **edición posterior** y **cambios de
  precio**, etc. Se gobiernan desde Admin (ver `configuration-registry.md`).
- **Datos propios de cada publicación:** foto principal y orden, descripción,
  precio, stock, estado, autenticidad, historial de cambios, pausar/eliminar.
  **No** son configuración global; son datos del listing.

> **Enfoque (DEC-032 "simple por defecto, configurable cuando sea necesario"):** en
> el MVP se parte de una **configuración inicial razonable y simple** (defaults de
> fotos/tamaños/formatos/atributos obligatorios/estados), con una **arquitectura que
> permita modificarla** después desde Admin. **No** se construye ahora un motor
> complejo de reglas dinámicas. Los defaults concretos del MVP se listan en
> `04-technical/configuration-registry.md`.

🟡 **PENDIENTE:** "qué ocurre si un producto se vende **fuera** de Offside" (cómo
se marca/retira la publicación) — a definir.

## 5. Búsqueda y filtros especializados

> Este es un **diferencial central** (junto con el modelo de datos). La búsqueda
> debe permitir lo que un marketplace generalista no puede.

### 5.1 Filtros esperados (facetas)

Derivados directamente de los atributos: **club, selección, temporada/año, marca,
versión (jugador/hincha), local/visitante/tercera, manga, jugador, número,
competición, talle, estado, autenticidad declarada, país de fabricación, rango de
precio, condición retro/vintage, nivel de confianza del vendedor**.

### 5.2 Requisitos de búsqueda — ampliado 2026-08-19 (Bloque 9)

Estrategia inicial en **PostgreSQL** (DEC-012). Debe soportar:

- **PS-020:** búsqueda **full-text** por texto libre + **filtros por facetas**
  combinables.
- **PS-020.b:** **tolerancia a errores** (typos) y **sinónimos** (club, jugador,
  marca, temporada). Ejemplo obligatorio: **`"river 96 adidas"`** debe encontrar
  **"River Plate 1996 Adidas"**.
- **PS-021 (ranking configurable):** ordenar por **relevancia, precio, popularidad,
  recencia, reputación** y **publicaciones destacadas**. (Los pesos/orden son
  ⚙️ configurables — `configuration-registry.md`.)
- **PS-022:** las facetas muestran **conteos** por valor.
- **PS-023 (filtros):** club, selección, año, temporada, marca, talle, estado,
  precio, jugador, autenticidad, vintage (además de los del §5.1).
- **PS-024:** sinónimos/alias en catálogos (River = River Plate = CARP), resueltos
  al construir el índice y al parsear la query.
- **PS-025 (SHOULD):** guardar búsquedas / alertas (ver
  `02-product/notifications-and-engagement.md`).

### 5.3 Implementación (referencia; detalle en architecture.md / tech-stack.md)

✅ **DECIDIDO (DEC-012):** búsqueda inicial en **PostgreSQL** (full-text `tsvector`
+ índices + filtros). La **tolerancia a typos y sinónimos** se implementa con
recursos de PostgreSQL (p. ej. `pg_trgm`, diccionarios/alias) — 🔵 técnica fina a
validar. El **motor de búsqueda externo** queda **fuera del MVP** (`mvp-scope.md`);
el modelo se mantiene preparado para migrar.

## 6. Casos de uso

- **UC-PS-1:** Vendedor publica una camiseta retro de River 1986, manga larga,
  versión hincha, talle L, usada-excelente, auténtica declarada, con 5 fotos
  incluida la etiqueta. El sistema valida obligatoriedad condicional (club, tipo
  local/visitante, manga) y la indexa para búsqueda facetada.
- **UC-PS-2:** Comprador filtra por club=River, es_retro=true, manga=larga,
  talle=L, autenticidad=auténtica. Obtiene resultados con conteos por faceta.
- **UC-PS-3:** Vendedor intenta cargar "club: Riber" (typo). El catálogo
  controlado sugiere "River Plate"; se evita un duplicado.

## 7. Estados

Publicación: `BORRADOR → ACTIVA → PAUSADA → AGOTADA → ELIMINADA` (alineado con
BR-014; `BORRADOR` para publicaciones incompletas aún no publicadas).

## 8. Dependencias

- Interna: `seller-system.md` (formulario de publicación), `marketplace-flow.md`
  (compra), `trust-and-safety.md` (autenticidad declarada vs verificada),
  `04-technical/architecture.md` (search + storage de imágenes).
- Externa: ninguna directa (los catálogos son internos). El storage/CDN es
  infra, no un tercero de negocio.

## 9. Decisiones tomadas

- ✅ Modelo de producto especializado (no "nombre+precio+descripción").
- ✅ Conjunto de atributos de dominio (club, selección, temporada, año, marca,
  modelo, versión, local/visitante/tercera, manga, jugador, número, sponsor,
  competición, talle, medidas, estado, país, autenticidad, descripción, fotos).
- ✅ Categorías habilitadas iniciales.
- ✅ Búsqueda/filtros especializados como diferencial.

## 10. Decisiones pendientes (DECISION REQUIRED)

- 🔴 Matriz fina "categoría → atributos obligatorios".
- 🔴 Gestión/gobierno de catálogos controlados (alta de clubes/marcas nuevos).
- 🔴 Tabla de talles canónica y su normalización.
- 🔴 Definición precisa del flag retro/vintage y sus requisitos (ligado a
  DEC-010 autenticidad).
- 🔴 Motor de búsqueda concreto (ligado a DEC-012 stack).

## 11. Riesgos

- **Datos sucios:** si se permite texto libre donde debería haber catálogo, los
  filtros pierden valor (mata el diferencial).
- **Fricción de publicación:** demasiados campos obligatorios ahuyentan
  vendedores; muy pocos degradan la búsqueda. Balance en DECISION REQUIRED.
- **Autenticidad declarada mal comunicada:** si el comprador cree que "auténtica"
  = verificada por OFFSIDE, hay riesgo reputacional (ver trust-and-safety).
