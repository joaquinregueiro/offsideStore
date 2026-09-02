/**
 * Formateo para la interfaz. Funciones PURAS, sin dependencias de React ni de
 * Next: se pueden testear sin montar nada.
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
