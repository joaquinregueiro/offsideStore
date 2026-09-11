import type { SanctionType } from '@/modules/trust/services/sanction.service';

/**
 * Vocabulario compartido entre las pantallas del back-office y sus acciones.
 *
 * =============================================================================
 * ⚠️ POR QUE ESTO NO VIVE EN `acciones.ts`
 * =============================================================================
 *
 * `acciones.ts` es un archivo `'use server'`, y un archivo `'use server'` SOLO
 * PUEDE EXPORTAR FUNCIONES ASINCRONAS. Exportar de ahí un array de constantes
 * no falla al compilar —TypeScript y el lint lo dan por bueno— sino al
 * RENDERIZAR, con "A 'use server' file can only export async functions, found
 * object", y se lleva puesta **toda pantalla que importe el módulo**: la de
 * sanciones, la de comisión, la de pagos y la de reportes al mismo tiempo,
 * aunque ninguna use la constante.
 *
 * Por eso el vocabulario vive en un módulo normal: lo importan tanto la Server
 * Action que lo valida como la pantalla que lo dibuja, y sigue habiendo UNA sola
 * definición.
 */

/**
 * Los cinco tipos de `sanction_type` (ERD §16.2).
 *
 * ⚠️ LA LISTA ESTA ESCRITA ACA PORQUE EL SERVICE NO LA EXPORTA. `SANCTION_TYPES`
 * es una `const` privada de `sanction.service.ts`; el TIPO sí es público, así
 * que el `satisfies` rompe el build si el enum pierde un valor. Queda reportado:
 * pertenece al Service, al lado del tipo.
 *
 * ⚠️ EL ORDEN ES DE MENOR A MAYOR GRAVEDAD, y no es cosmético: es el orden en el
 * que aparecen en el `<select>`, así que la opción preseleccionada —la primera—
 * es la más leve. Un desplegable que arranca en "expulsión" es un accidente
 * esperando.
 */
export const TIPOS_DE_SANCION = [
  'warning',
  'limitation',
  'penalty',
  'suspension',
  'expulsion',
] as const satisfies readonly SanctionType[];

/**
 * Si el id que vino en la URL tiene forma de UUID.
 *
 * =============================================================================
 * ⚠️ POR QUE ESTO EXISTE: UN ID MAL ESCRITO DABA "Tuvimos un problema"
 * =============================================================================
 *
 * Verificado contra el servidor: `/admin/vendedores/no-es-uuid` no daba 404,
 * daba el límite de error del grupo. Las columnas de id son `uuid` en
 * PostgreSQL, así que comparar contra un texto que no lo es hace que el MOTOR
 * lance `invalid input syntax for type uuid` antes de mirar ninguna fila. Esa
 * excepción no es "no existe": sube hasta `error.tsx` y la persona ve un error
 * genérico sin ninguna salida, cuando lo que pasó es que el enlace estaba roto.
 *
 * Un id que no puede existir se trata como lo que es: **no existe** → `notFound()`.
 *
 * ⚠️ NO VALIDA QUE EL ID EXISTA, sólo que la consulta se pueda hacer. Quien
 * llama igual tiene que atender el "no hay fila".
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function esUuid(valor: string): boolean {
  return UUID.test(valor);
}
