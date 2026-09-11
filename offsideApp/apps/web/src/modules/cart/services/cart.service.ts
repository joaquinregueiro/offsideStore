import type { PublicUser } from '../../auth/services/auth.service';
import { parseSettingValue } from '../../config/services/settings-registry';
import { coverUrls } from '../../listings/services/listing.service';
import {
  shippingSummaryFor,
  type ShippingSummary,
} from '../../listings/services/shipping-declaration';
import { createOrderForSeller, type PublicOrder } from '../../orders/services/order.service';
import * as errors from '../cart.errors';
import * as cartRepo from '../repositories/cart.repository';

/**
 * Carrito (BS-060/061/062, ERD §10) y su checkout (DEC-026).
 *
 * ⚠️ EL CARRITO NO RESERVA STOCK (MF-010, BS-060): agregar es guardar una
 * intencion. El stock se valida al agregar —para no dejar que alguien arme
 * algo imposible— y se REVALIDA al ir al checkout (BS-061 / MF-012), que es
 * cuando importa. Se descuenta recien con el pago aprobado (MF-022).
 *
 * ⚠️ `unit_price_snapshot` ES UNA REFERENCIA DE UX, NO EL PRECIO DE LA
 * ORDEN. Se guarda al agregar para poder decir "cambio desde que lo
 * agregaste"; la orden se crea con el precio ACTUAL de la publicacion, igual
 * que una compra directa. Congelar el precio del carrito seria dejar que
 * alguien compre a un precio que el vendedor ya cambio (BR-023).
 *
 * ⚠️ DEC-026: 1 ORDEN = 1 VENDEDOR. El checkout recorre el carrito y crea
 * las ordenes llamando a `orders.createOrder`, que es EXACTAMENTE lo que
 * hace la compra directa: snapshot economico, comision, historial, todo
 * igual. Una orden nacida del carrito no se distingue de una directa.
 *
 * ⚠️ HOY ES UNA ORDEN POR LINEA, NO POR VENDEDOR. `createOrder` recibe UNA
 * publicacion y una cantidad —no acepta varios items—, y este modulo no
 * puede escribir en `orders` por su cuenta (un modulo no importa el
 * repository de otro). Dos camisetas del mismo vendedor son hoy dos ordenes y
 * dos pagos. Sigue cumpliendo DEC-026 (ninguna orden mezcla vendedores), pero
 * no es la agrupacion que la decision describe. Cuando `createOrder` acepte
 * `items[]`, `checkoutCart` agrupa por vendedor sin cambiar nada mas.
 */

export const FEATURE_KEY = 'feature_cart';

/**
 * Unidades maximas de UNA publicacion por linea.
 *
 * ⚠️ ES UN TECHO DE SANIDAD, NO UN CUPO DE NEGOCIO: el limite real es el
 * stock de la publicacion, que se valida aparte. Esto solo impide que un
 * formulario mande 10.000 y el carrito lo guarde. Los cupos de compra son ⚙️
 * del Config Store y siguen 🟡.
 */
export const MAX_QUANTITY_PER_LINE = 99;

/** Una linea del carrito tal como la pinta la pantalla. */
export interface CartItemView {
  listingId: string;
  title: string;
  quantity: number;
  /** Precio ACTUAL de la publicacion, en centavos como string. Es el que manda. */
  unitPriceAmount: string;
  /** Precio que se vio al agregar. Solo para avisar si cambio. */
  unitPriceSnapshot: string;
  currency: string;
  /** `unitPriceAmount * quantity`. */
  subtotal: string;
  /** El precio actual difiere del que se vio al agregar. */
  precioCambio: boolean;
  /** Si HOY se puede comprar (ERD §9.1 + SS-013). */
  comprable: boolean;
  /** Cuantas quedan. Si es menor que `quantity`, no alcanza. */
  stockDisponible: number;
  coverUrl: string | null;
  /**
   * Como se resuelve el envio de ESTA publicacion, ya resumido.
   *
   * ⚠️ VA POR LINEA Y NO POR VENDEDOR, aunque el checkout cree una orden por
   * vendedor: dos publicaciones del mismo vendedor pueden declarar envios
   * distintos —una con el costo adentro del precio y otra a cargo del
   * comprador—, y mostrar uno solo para el grupo mentiria sobre la otra.
   */
  shipping: ShippingSummary;
  addedAt: string;
}

export interface CartSellerGroup {
  sellerId: string;
  sellerDisplayName: string;
  /** El vendedor puede recibir compras (aprobado + Mercado Pago conectado). */
  operativo: boolean;
  items: CartItemView[];
  /** Suma de los subtotales del grupo, en centavos como string. */
  subtotal: string;
}

export interface CartView {
  vendedores: CartSellerGroup[];
  /** Suma de todos los grupos, en centavos como string. */
  total: string;
  /** Lineas (publicaciones distintas). */
  cantidadItems: number;
  /** Unidades (suma de cantidades). */
  cantidadUnidades: number;
  /** Alguna linea no se puede comprar tal como esta: la pantalla lo destaca. */
  tieneProblemas: boolean;
}

/** Cantidad valida: entero entre 1 y `MAX_QUANTITY_PER_LINE`. FUNCION PURA. */
export function validateQuantity(quantity: number): number {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY_PER_LINE) {
    throw errors.invalidQuantity(MAX_QUANTITY_PER_LINE);
  }

  return quantity;
}

/** Los mismos predicados que `isPurchasable()` y `canSell()`, sobre la fila del carrito. */
function esComprable(fila: cartRepo.CartItemWithListingRow): boolean {
  return (
    fila.listingDeletedAt === null &&
    fila.status === 'active' &&
    fila.moderationStatus === 'APPROVED' &&
    fila.stock >= 1
  );
}

function vendedorOperativo(fila: cartRepo.CartItemWithListingRow): boolean {
  return fila.sellerStatus === 'approved' && fila.mpStatus === 'connected';
}

/**
 * Agrupa las lineas por vendedor y suma. FUNCION PURA, en `bigint`: el
 * dinero nunca pasa por `number`. Exportada para el test unitario.
 */
export function groupBySeller(
  filas: cartRepo.CartItemWithListingRow[],
  portadas: Map<string, string>,
): CartView {
  const grupos = new Map<string, CartSellerGroup & { acumulado: bigint }>();
  let total = 0n;
  let unidades = 0;
  let tieneProblemas = false;

  for (const fila of filas) {
    const subtotal = fila.priceAmount * BigInt(fila.quantity);
    const comprable = esComprable(fila) && vendedorOperativo(fila);
    const alcanza = fila.stock >= fila.quantity;
    if (!comprable || !alcanza) tieneProblemas = true;

    const grupo = grupos.get(fila.sellerId) ?? {
      sellerId: fila.sellerId,
      sellerDisplayName: fila.sellerDisplayName,
      operativo: vendedorOperativo(fila),
      items: [],
      subtotal: '0',
      acumulado: 0n,
    };

    grupo.items.push({
      listingId: fila.listingId,
      title: fila.title,
      quantity: fila.quantity,
      unitPriceAmount: fila.priceAmount.toString(),
      unitPriceSnapshot: fila.unitPriceSnapshot.toString(),
      currency: fila.listingCurrency,
      subtotal: subtotal.toString(),
      precioCambio: fila.priceAmount !== fila.unitPriceSnapshot,
      comprable,
      stockDisponible: fila.stock,
      coverUrl: portadas.get(fila.listingId) ?? null,
      shipping: shippingSummaryFor(fila),
      addedAt: fila.addedAt.toISOString(),
    });
    grupo.acumulado += subtotal;
    grupo.subtotal = grupo.acumulado.toString();
    grupos.set(fila.sellerId, grupo);

    total += subtotal;
    unidades += fila.quantity;
  }

  return {
    vendedores: [...grupos.values()].map(({ acumulado: _acumulado, ...grupo }) => grupo),
    total: total.toString(),
    cantidadItems: filas.length,
    cantidadUnidades: unidades,
    tieneProblemas,
  };
}

async function exigirHabilitado(): Promise<void> {
  const crudo = await cartRepo.findGlobalSetting(FEATURE_KEY);
  if (crudo === undefined) throw errors.settingNotConfigured(FEATURE_KEY);

  if (!parseSettingValue(FEATURE_KEY, crudo)) throw errors.cartDisabled();
}

/**
 * La misma perilla, pero como pregunta en vez de guarda.
 *
 * ⚠️ SI LA CLAVE NO ESTA CONFIGURADA DEVUELVE `false`, al reves que
 * `exigirHabilitado`, que lanza. Es deliberado: quien pregunta es la barra
 * superior —esta en las 22 pantallas— y una clave faltante no puede voltear
 * el sitio entero. Quien ESCRIBE en el carrito sigue pasando por la guarda,
 * que falla ruidosamente.
 */
async function habilitado(): Promise<boolean> {
  try {
    const crudo = await cartRepo.findGlobalSetting(FEATURE_KEY);

    return crudo !== undefined && parseSettingValue(FEATURE_KEY, crudo) === true;
  } catch {
    return false;
  }
}

/**
 * La fila de la publicacion tal como esta HOY, o el error que corresponde.
 * Es la revalidacion de BS-061, usada al agregar, al cambiar cantidad y al
 * ir al checkout: una sola regla, tres momentos.
 */
function exigirComprable(
  fila: cartRepo.CartItemWithListingRow,
  quantity: number,
  userId: string,
): void {
  if (fila.sellerUserId === userId) throw errors.cannotBuyOwnListing();
  if (!esComprable(fila)) throw errors.listingNotAvailable(fila.title);
  if (!vendedorOperativo(fila)) throw errors.sellerNotOperational(fila.title);
  if (fila.stock < quantity) throw errors.listingOutOfStock(fila.title, fila.stock);
}

/** Las lineas del carrito del usuario, o vacio si nunca tuvo carrito. */
async function lineasDe(userId: string): Promise<cartRepo.CartItemWithListingRow[]> {
  const cart = await cartRepo.findCartByUserId(userId);
  if (cart === undefined) return [];

  return cartRepo.findItemsWithListing(cart.id);
}

/**
 * Agrega unidades de una publicacion. Si ya estaba, SUMA a lo que habia.
 *
 * Valida stock contra la cantidad TOTAL resultante: agregar 3 a una linea
 * que ya tenia 3 con stock 5 se rechaza, no se guarda 6 para que explote en
 * el checkout.
 */
export async function addToCart(
  user: PublicUser,
  listingId: string,
  quantity = 1,
): Promise<CartItemView> {
  await exigirHabilitado();
  const cantidad = validateQuantity(quantity);

  const cart = await cartRepo.findOrCreateCart(user.id);

  // Se lee la publicacion con el MISMO join que la lista del carrito para
  // que "agregar" y "ver" apliquen la misma regla de comprabilidad.
  const [fila] = (await cartRepo.findItemsWithListing(cart.id)).filter(
    (f) => f.listingId === listingId,
  );
  const existente = fila ?? (await filaDeListing(cart.id, listingId));
  if (existente === undefined) throw errors.listingNotAvailable();

  const cantidadTotal = (fila?.quantity ?? 0) + cantidad;
  validateQuantity(cantidadTotal);
  exigirComprable(existente, cantidadTotal, user.id);

  await cartRepo.upsertItem({
    cartId: cart.id,
    listingId,
    quantity: cantidadTotal,
    unitPriceSnapshot: existente.priceAmount,
    currency: existente.listingCurrency,
  });
  await cartRepo.touch(cart.id);

  const [actualizada] = (await cartRepo.findItemsWithListing(cart.id)).filter(
    (f) => f.listingId === listingId,
  );
  if (actualizada === undefined) throw errors.itemNotInCart();

  return groupBySeller([actualizada], await coverUrls([listingId])).vendedores[0]!.items[0]!;
}

/**
 * La publicacion con la forma de una linea del carrito, aunque todavia no
 * este en el carrito. Se inserta una linea provisoria con cantidad 0 y se
 * lee con el join, en vez de duplicar la consulta de la publicacion.
 *
 * ⚠️ NO: eso dejaria lineas fantasma si algo falla en el medio. Se hace la
 * consulta directa a traves del repositorio del carrito, que ya conoce las
 * tablas involucradas.
 */
async function filaDeListing(
  cartId: string,
  listingId: string,
): Promise<cartRepo.CartItemWithListingRow | undefined> {
  const fila = await cartRepo.findListingAsCartRow(listingId);
  if (fila === undefined) return undefined;

  return {
    ...fila,
    itemId: '',
    quantity: 0,
    unitPriceSnapshot: fila.priceAmount,
    currency: fila.listingCurrency,
    addedAt: new Date(),
    cartId,
  } as cartRepo.CartItemWithListingRow;
}

/**
 * Cambia la cantidad de una linea. Cantidad 0 la saca del carrito.
 */
export async function updateQuantity(
  user: PublicUser,
  listingId: string,
  quantity: number,
): Promise<CartItemView | null> {
  await exigirHabilitado();

  if (quantity === 0) {
    await removeFromCart(user, listingId);
    return null;
  }

  const cantidad = validateQuantity(quantity);
  const cart = await cartRepo.findCartByUserId(user.id);
  if (cart === undefined) throw errors.itemNotInCart();

  const [fila] = (await cartRepo.findItemsWithListing(cart.id)).filter(
    (f) => f.listingId === listingId,
  );
  if (fila === undefined) throw errors.itemNotInCart();

  exigirComprable(fila, cantidad, user.id);

  await cartRepo.updateQuantity(cart.id, listingId, cantidad);
  await cartRepo.touch(cart.id);

  return groupBySeller([{ ...fila, quantity: cantidad }], await coverUrls([listingId]))
    .vendedores[0]!.items[0]!;
}

/** Saca una publicacion del carrito. Sacar lo que no esta NO es un error. */
export async function removeFromCart(user: PublicUser, listingId: string): Promise<void> {
  const cart = await cartRepo.findCartByUserId(user.id);
  if (cart === undefined) return;

  await cartRepo.removeItem(cart.id, listingId);
  await cartRepo.touch(cart.id);
}

/**
 * El carrito agrupado por vendedor, con subtotales y avisos.
 *
 * ⚠️ NO FILTRA LO QUE NO SE PUEDE COMPRAR: una linea agotada o de un
 * vendedor desconectado se muestra marcada, no desaparece. Que algo se
 * esfume del carrito sin explicacion es peor que verlo tachado.
 */
export async function getCart(user: PublicUser): Promise<CartView> {
  const filas = await lineasDe(user.id);
  const portadas = await coverUrls(filas.map((f) => f.listingId));

  return groupBySeller(filas, portadas);
}

/** Cuantas lineas tiene el carrito. Para el numerito del header. */
export async function countCartItems(user: PublicUser): Promise<number> {
  /*
   * ⚠️ CON LA PERILLA APAGADA DEVUELVE 0, y no es un detalle de la barra: el
   * icono del carrito cuelga de este numero, y `/carrito` con `feature_cart`
   * en `false` da 404. Sin esto, apagar la funcion dejaria en TODAS las
   * pantallas un icono con un numero que lleva a una pagina que no existe.
   */
  if (!(await habilitado())) return 0;

  const cart = await cartRepo.findCartByUserId(user.id);
  if (cart === undefined) return 0;

  return cartRepo.countItems(cart.id);
}

/** Vacia el carrito. */
export async function clearCart(user: PublicUser): Promise<void> {
  const cart = await cartRepo.findCartByUserId(user.id);
  if (cart === undefined) return;

  await cartRepo.clearItems(cart.id);
  await cartRepo.touch(cart.id);
}

/** Una linea que no se pudo convertir en orden. */
export interface CheckoutRejection {
  listingId: string;
  title: string;
  code: string;
  message: string;
}

export interface CheckoutCartResult {
  /** Las ordenes creadas, en el orden de las lineas. Todas `PENDING_PAYMENT`. */
  ordenes: PublicOrder[];
  /**
   * Lineas que quedaron en el carrito porque `createOrder` las rechazo
   * DESPUES de la revalidacion (alguien se llevo la ultima unidad en el
   * medio). Vacio en el caso normal.
   */
  rechazadas: CheckoutRejection[];
}

/**
 * Convierte el carrito en ordenes (BS-061, DEC-026) y lo vacia.
 *
 * DOS PASADAS, y el orden importa:
 *
 *  1. REVALIDA TODO ANTES DE CREAR NADA. Si una linea no se puede comprar
 *     —sin stock, pausada, vendedor desconectado— se lanza el error de ESA
 *     linea y no se crea ninguna orden: la persona arregla el carrito y
 *     vuelve. Crear tres ordenes y fallar en la cuarta dejaria tres pagos
 *     pendientes que nadie pidio todavia.
 *  2. CREA LAS ORDENES una por una con `orders.createOrder` —el mismo camino
 *     que la compra directa— y saca del carrito cada linea apenas su orden
 *     existe. Si `createOrder` rechaza una (carrera con otra compra), se
 *     detiene ahi: las ordenes ya creadas SON reales y se devuelven; las
 *     lineas no procesadas quedan en el carrito, con la rechazada en
 *     `rechazadas`.
 *
 * ⚠️ LA ORDEN Y LA LIMPIEZA DE SU LINEA NO SON ATOMICAS ENTRE SI:
 * `createOrder` no acepta una transaccion externa. Si el proceso muere entre
 * las dos, la linea queda en el carrito con la orden ya creada; el siguiente
 * checkout la revalida y, como mucho, crea una orden duplicada pendiente de
 * pago, que vence sola (DEC-033). No es plata cobrada dos veces.
 */
export async function checkoutCart(
  user: PublicUser,
  shippingAddress: Record<string, unknown>,
): Promise<CheckoutCartResult> {
  await exigirHabilitado();

  const cart = await cartRepo.findCartByUserId(user.id);
  const filas = cart === undefined ? [] : await cartRepo.findItemsWithListing(cart.id);
  if (cart === undefined || filas.length === 0) throw errors.cartEmpty();

  for (const fila of filas) exigirComprable(fila, fila.quantity, user.id);

  const ordenes: PublicOrder[] = [];
  const rechazadas: CheckoutRejection[] = [];

  for (const grupo of agruparParaOrdenes(filas)) {
    try {
      const orden = await createOrderForSeller(user, {
        items: grupo.map((fila) => ({ listingId: fila.listingId, quantity: fila.quantity })),
        shippingAddress,
      });
      ordenes.push(orden);
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error)) throw error;

      rechazadas.push({
        listingId: grupo[0]!.listingId,
        title: grupo[0]!.title,
        code: String(error.code),
        message: error.message,
      });
      break;
    }

    for (const fila of grupo) await cartRepo.removeItem(cart.id, fila.listingId);
  }

  await cartRepo.touch(cart.id);

  return { ordenes, rechazadas };
}

/**
 * Las lineas del carrito repartidas en las ordenes que se van a crear.
 *
 * ⚠️ UNA ORDEN POR VENDEDOR (DEC-026), CON UNA EXCEPCION: cada publicacion
 * PROMOCIONADA va en su propia orden, aunque sea del mismo vendedor. El
 * snapshot economico guarda UN multiplicador y UN `listing_promotion_id` por
 * orden; mezclar una promocionada con otras le cobraria comision agravada a
 * articulos que nadie promociono, o dejaria un `commission_rate_at_transaction`
 * que no reproduce el importe. Separandolas, el vendedor paga exactamente lo
 * que contrato sobre lo que contrato.
 *
 * El orden de las ordenes es estable: el mismo que trae el repositorio
 * (vendedor, y dentro de cada vendedor por cuando se agrego).
 */
function agruparParaOrdenes(
  filas: readonly cartRepo.CartItemWithListingRow[],
): cartRepo.CartItemWithListingRow[][] {
  const ahora = Date.now();
  const porVendedor = new Map<string, cartRepo.CartItemWithListingRow[]>();
  const solas: cartRepo.CartItemWithListingRow[][] = [];

  for (const fila of filas) {
    const promocionada = fila.promotedUntil !== null && fila.promotedUntil.getTime() > ahora;

    if (promocionada) {
      solas.push([fila]);
      continue;
    }

    const grupo = porVendedor.get(fila.sellerId);
    if (grupo === undefined) porVendedor.set(fila.sellerId, [fila]);
    else grupo.push(fila);
  }

  return [...porVendedor.values(), ...solas];
}
