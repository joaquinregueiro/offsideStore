import type { TonoEtiqueta } from '@/components/ui';

/**
 * Formateo para la interfaz. Funciones PURAS, sin dependencias de React ni de
 * Next: se pueden testear sin montar nada.
 *
 * ⚠️ LA UNICA IMPORTACION ES UN TIPO. `TonoEtiqueta` viene de `components/ui`
 * con `import type`, asi que se borra al compilar y no crea dependencia en
 * tiempo de ejecucion: estas funciones se siguen pudiendo llamar desde un test
 * sin React. Se importa el tipo y no se redeclara para que agregar un tono
 * rompa acá si alguien se olvida de mapearlo.
 *
 * ⚠️ ESTO ES PRESENTACION, NO DOMINIO. Los enums vienen del ERD y no se tocan;
 * aca solo se los vuelve legibles.
 */

/**
 * Centavos (como string) a precio argentino.
 *
 * ⚠️ CONVIERTE A `number`, Y SOLO PARA MOSTRAR. El dinero viaja como string de
 * centavos justamente para no perder precision en el camino; aca ya no se opera
 * con el, se dibuja. `Number.MAX_SAFE_INTEGER` son mas de 90 mil millones de
 * pesos: no hay riesgo real.
 *
 * ⚠️ NUNCA usar esto para calcular. El unico lugar donde se hacen cuentas con
 * dinero es el dominio, en `bigint`.
 */
export function precio(centavos: string, moneda = 'ARS'): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: moneda,
    maximumFractionDigits: 0,
  }).format(Number(centavos) / 100);
}

/** `COMO_NUEVO` -> `Como nuevo`. */
export function condicion(valor: string): string {
  const texto = valor.replaceAll('_', ' ').toLowerCase();

  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Tipo de camiseta (`kit_type`).
 *
 * ⚠️ ESTO ARREGLA UN TEXTO EN INGLES EN LA VITRINA. La ficha de producto
 * pasaba `kitType` por `condicion()`, que solo capitaliza: a un comprador
 * argentino le aparecia "Home" y "Away" en una pantalla donde todo lo demas
 * esta en castellano. Los valores del enum son tecnicos y estan bien asi en la
 * base; traducirlos es trabajo de presentacion.
 *
 * ⚠️ EL MAPA ESTABA DUPLICADO en `app/buscar/page.tsx`, declarado ahi adentro
 * como constante local. Dos listas del mismo enum en dos pantallas terminan
 * diciendo cosas distintas.
 */
const TIPOS_DE_CAMISETA: Record<string, string> = {
  home: 'Titular',
  away: 'Suplente',
  third: 'Tercera',
  goalkeeper: 'Arquero',
  special: 'Especial',
};

export function tipoDeCamiseta(valor: string): string {
  return TIPOS_DE_CAMISETA[valor] ?? condicion(valor);
}

/** Largo de manga (`sleeve`). Mismo caso que el tipo de camiseta. */
const MANGAS: Record<string, string> = {
  short: 'Mangas cortas',
  long: 'Mangas largas',
};

export function manga(valor: string): string {
  return MANGAS[valor] ?? condicion(valor);
}

/**
 * Estado de una orden, en palabras que le sirvan a una persona.
 *
 * ⚠️ Los nombres del enum son tecnicos (`PENDING_PAYMENT`) y estan bien asi en
 * la base. Un comprador no tiene por que leerlos.
 */
const ESTADOS_DE_ORDEN: Record<string, string> = {
  PENDING_PAYMENT: 'Esperando pago',
  PAID: 'Pagada',
  PROCESSING: 'En preparación',
  SHIPPED: 'Enviada',
  DELIVERED: 'Entregada',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
};

export function estadoDeOrden(valor: string): string {
  return ESTADOS_DE_ORDEN[valor] ?? valor;
}

/**
 * Estado de una publicacion, para el inventario del vendedor (SS-060).
 *
 * `draft` y `deleted` estan en el enum aunque hoy ningun flujo los produzca:
 * el listado los mostraria igual si aparecieran, en vez de imprimir el valor
 * crudo de la base.
 */
const ESTADOS_DE_PUBLICACION: Record<string, string> = {
  draft: 'Borrador',
  active: 'Activa',
  paused: 'Pausada',
  sold_out: 'Agotada',
  deleted: 'Eliminada',
};

export function estadoDePublicacion(valor: string): string {
  return ESTADOS_DE_PUBLICACION[valor] ?? valor;
}

/** Estado de la habilitacion del vendedor (seller-system.md §6). */
const ESTADOS_DE_VENDEDOR: Record<string, string> = {
  pending: 'Pendiente',
  approved: 'Aprobado',
  limited: 'Limitado',
  suspended: 'Suspendido',
  expelled: 'Expulsado',
};

export function estadoDeVendedor(valor: string): string {
  return ESTADOS_DE_VENDEDOR[valor] ?? valor;
}

/** Fecha corta en formato argentino: `1 sep 2026`. */
export function fecha(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

/**
 * Rol administrativo, en palabras.
 *
 * ⚠️ EL BACK-OFFICE IMPRIMIA `ADMIN` Y `FINANCE` CRUDOS, rompiendo la regla que
 * el resto del proyecto sostiene sin excepcion: los nombres del enum son
 * tecnicos y estan bien asi en la base; nadie tiene por que leerlos.
 */
const ROLES: Record<string, string> = {
  ADMIN: 'Administración general',
  FINANCE: 'Finanzas',
  MODERATOR: 'Moderación',
  SUPPORT: 'Soporte',
};

export function rolLegible(valor: string | null): string {
  if (valor === null) return 'Sin rol';

  return ROLES[valor] ?? valor;
}

/**
 * Estado de un pago, en palabras.
 *
 * ⚠️ ES EL ESTADO NORMALIZADO DE OFFSIDE, NO EL CRUDO DE MERCADO PAGO. El crudo
 * (`mp_status`) se conserva por DEC-035 y se muestra aparte, rotulado como tal:
 * son dos datos distintos y confundirlos en la consola de pagos es confundir lo
 * que Offside registro con lo que el proveedor dijo.
 */
const ESTADOS_DE_PAGO: Record<string, string> = {
  PENDING: 'Pendiente',
  APPROVED: 'Aprobado',
  REJECTED: 'Rechazado',
  CANCELLED: 'Cancelado',
  REFUNDED: 'Reembolsado',
  PARTIALLY_REFUNDED: 'Reembolsado en parte',
  CHARGED_BACK: 'Contracargo',
  IN_PROCESS: 'En proceso',
};

export function estadoDePago(valor: string): string {
  return ESTADOS_DE_PAGO[valor] ?? valor;
}

/* ------------------------------------------------------------------ tonos */

/**
 * Que tono de `Etiqueta` le corresponde a cada estado.
 *
 * ⚠️ ESTO ESTABA ESCRITO SIETE VECES, UNA POR PANTALLA, y con criterios
 * distintos: `checkout` marcaba en alerta sólo `CANCELLED`, `publicaciones`
 * marcaba todo lo que no fuera `active`, y `mis-compras` no pasaba tono
 * ninguno —ahí "Pagada" y "Cancelada" eran el MISMO chip gris—. Un estado no
 * puede verse distinto según en qué pantalla lo mires.
 *
 * ⚠️ EL TONO NO REEMPLAZA AL TEXTO. La etiqueta siempre dice el estado en
 * palabras; el color sólo acelera la lectura. Quien no distingue verde de
 * naranja lee exactamente lo mismo.
 */
const TONOS_DE_ORDEN: Record<string, TonoEtiqueta> = {
  PENDING_PAYMENT: 'alerta',
  PAID: 'exito',
  PROCESSING: 'marca',
  SHIPPED: 'marca',
  DELIVERED: 'exito',
  COMPLETED: 'exito',
  CANCELLED: 'alerta',
};

export function tonoDeOrden(valor: string): TonoEtiqueta {
  return TONOS_DE_ORDEN[valor] ?? 'neutro';
}

/**
 * ⚠️ `sold_out` VA EN NEUTRO Y NO EN EXITO. En el inventario del vendedor,
 * "Agotada" no es un logro que celebrar sino un dato: esa publicacion ya no
 * esta a la venta. `draft` va en alerta porque le falta algo —PS-010, una
 * foto— y el vendedor tiene que hacer algo al respecto.
 */
const TONOS_DE_PUBLICACION: Record<string, TonoEtiqueta> = {
  draft: 'alerta',
  active: 'marca',
  paused: 'alerta',
  sold_out: 'neutro',
  deleted: 'alerta',
};

export function tonoDePublicacion(valor: string): TonoEtiqueta {
  return TONOS_DE_PUBLICACION[valor] ?? 'neutro';
}

const TONOS_DE_VENDEDOR: Record<string, TonoEtiqueta> = {
  pending: 'alerta',
  approved: 'marca',
  limited: 'alerta',
  suspended: 'alerta',
  expelled: 'alerta',
};

/**
 * ⚠️ `PENDING` E `IN_PROCESS` VAN EN ALERTA Y NO EN NEUTRO. En una consola de
 * operaciones, un pago que quedo a mitad de camino es lo que hay que mirar
 * primero: pintarlo gris lo esconde entre los que ya se resolvieron.
 */
const TONOS_DE_PAGO: Record<string, TonoEtiqueta> = {
  PENDING: 'alerta',
  IN_PROCESS: 'alerta',
  APPROVED: 'exito',
  REJECTED: 'alerta',
  CANCELLED: 'alerta',
  REFUNDED: 'neutro',
  PARTIALLY_REFUNDED: 'alerta',
  CHARGED_BACK: 'alerta',
};

export function tonoDePago(valor: string): TonoEtiqueta {
  return TONOS_DE_PAGO[valor] ?? 'neutro';
}

export function tonoDeVendedor(valor: string): TonoEtiqueta {
  return TONOS_DE_VENDEDOR[valor] ?? 'neutro';
}

/**
 * Valida un destino de redireccion que vino de la URL.
 *
 * ⚠️ ESTO ES SEGURIDAD, NO PROLIJIDAD. El login acepta `?next=` para volver a
 * donde la persona queria ir. Sin validar, un enlace
 * `/ingresar?next=https://sitio-falso` convertiria nuestro login en un
 * REDIRECTOR ABIERTO: la victima ve nuestro dominio, se autentica, y termina en
 * un sitio ajeno. Es un vector clasico de phishing.
 *
 * Solo se aceptan rutas internas: empiezan con una barra y no con dos —`//otro`
 * es una URL protocol-relative y el navegador la trata como externa—.
 */
export function rutaInternaSegura(destino: string | undefined, porDefecto = '/'): string {
  if (destino === undefined || destino === '') return porDefecto;
  if (!destino.startsWith('/')) return porDefecto;
  if (destino.startsWith('//')) return porDefecto;
  // `/\` tambien lo interpretan algunos navegadores como externo.
  if (destino.startsWith('/\\')) return porDefecto;

  return destino;
}
