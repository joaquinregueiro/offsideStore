/**
 * Hooks de dominio de `listings`: lo que OTROS modulos quieren saber cuando
 * una publicacion cambia, sin que este modulo los importe.
 *
 * =============================================================================
 * ⚠️ POR QUE LISTENERS Y NO IMPORTS
 * =============================================================================
 *
 * `favorites` necesita enterarse de que un precio bajo para avisar a quien
 * guardo la publicacion, y de que se agoto para dejar de ofrecerla. Pero
 * `favorites` YA depende de `listings` (mira si la publicacion existe y de
 * quien es): si `listings` importara `favorites` habria un ciclo, y ademas
 * este modulo pasaria a conocer a cada consumidor futuro. Con un registro,
 * `listings` EMITE y no sabe quien escucha.
 *
 * El registro es en memoria y por proceso: se puebla al arrancar (por ejemplo
 * desde `instrumentation.ts`, donde ya se levantan los workers), igual que
 * cualquier suscripcion a eventos. No persiste nada: si el aviso se pierde,
 * se pierde un aviso, no un dato —el precio y el stock siguen en la base—.
 *
 * ⚠️ UN LISTENER QUE FALLA NO ABORTA LA OPERACION. Bajar el precio o vender la
 * ultima unidad ya paso y esta confirmado; que el aviso a favoritos explote no
 * puede deshacer una venta. Se registra y se sigue.
 */

export type PriceDropListener = (
  listingId: string,
  oldPrice: bigint,
  newPrice: bigint,
) => Promise<void> | void;

export type SoldOutListener = (listingId: string) => Promise<void> | void;

const priceDropListeners = new Set<PriceDropListener>();
const soldOutListeners = new Set<SoldOutListener>();

/**
 * Registra quien quiere enterarse de una BAJADA de precio (nunca de una suba:
 * a nadie le sirve un aviso de que algo se encarecio).
 *
 * Devuelve la funcion para desregistrarse, que es lo que un test necesita
 * para no contaminar al siguiente.
 */
export function registerPriceDropListener(fn: PriceDropListener): () => void {
  priceDropListeners.add(fn);

  return () => {
    priceDropListeners.delete(fn);
  };
}

/** Registra quien quiere enterarse de que una publicacion paso a `sold_out`. */
export function registerSoldOutListener(fn: SoldOutListener): () => void {
  soldOutListeners.add(fn);

  return () => {
    soldOutListeners.delete(fn);
  };
}

/**
 * Avisa a todos los listeners. Cada uno corre aislado: que uno falle no
 * impide que los demas reciban el aviso.
 */
async function emitir<T extends (...args: never[]) => Promise<void> | void>(
  listeners: ReadonlySet<T>,
  args: Parameters<T>,
  descripcion: string,
): Promise<void> {
  await Promise.all(
    [...listeners].map(async (listener) => {
      try {
        await listener(...args);
      } catch (error) {
        console.error(
          `[listings] un listener de ${descripcion} fallo:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }),
  );
}

/** Lo llama `listings` DESPUES de confirmar la bajada en la base. */
export async function emitPriceDrop(
  listingId: string,
  oldPrice: bigint,
  newPrice: bigint,
): Promise<void> {
  // Un "drop" con el precio igual o mayor es un bug del llamador, no un
  // evento: se ignora en vez de avisar algo falso.
  if (newPrice >= oldPrice) return;

  await emitir(priceDropListeners, [listingId, oldPrice, newPrice], 'bajada de precio');
}

/** Lo llama `listings` cuando la publicacion efectivamente paso a `sold_out`. */
export async function emitSoldOut(listingId: string): Promise<void> {
  await emitir(soldOutListeners, [listingId], 'agotado');
}

/** Solo para tests: deja el registro vacio. */
export function resetListingListeners(): void {
  priceDropListeners.clear();
  soldOutListeners.clear();
}
