import { cache } from 'react';
import type { ReactNode } from 'react';

import {
  Panel,
  Solapas,
  conteosDelPanel,
  type SeccionDelPanel,
  type Solapa,
} from '@/components/panel';
import type { PublicUser } from '@/modules/auth/services/auth.service';
import { getMySellerProfile } from '@/modules/sellers/services/seller.service';

/**
 * El armazón del área privada, resuelto una sola vez.
 *
 * ⚠️ EXISTE PARA QUE NINGUNA PANTALLA TENGA QUE ARMAR LA BARRA. Son veinte
 * pantallas repartidas en dos grupos de rutas: si cada una pidiera los conteos,
 * resolviera si la persona es vendedora y decidiera qué solapas dibujar, la
 * barra terminaría distinta en cada una —que es exactamente lo que pasaba con
 * el riel de pestañas que esto reemplaza, donde algunas mostraban el contador y
 * otras no—.
 *
 * ⚠️ NO VIVE EN EL `layout.tsx`, y no es por comodidad: para marcar la sección
 * activa hay que saber la ruta, y saberla en un layout obliga a `usePathname`,
 * que es un hook. Eso convertiría el layout —y con él la barra superior y el
 * pie— en Client Component, y mandaría la sesión entera al bundle. Cada
 * pantalla ya sabe dónde está parada: lo pasa por prop.
 *
 * ⚠️ SON DOS COMPONENTES Y NO UNO, para que la pantalla conserve el ORDEN de su
 * propio contenido. El armazón envuelve; las solapas se ponen donde
 * corresponde, debajo del encabezado y dentro del `<main>`. Con un solo
 * componente que dibujara las dos cosas, las solapas quedarían ARRIBA del
 * título de la pantalla y fuera del `<main>`, o sea que el enlace de saltar al
 * contenido se saltearía el `<h1>`.
 */

/** ¿Esta persona vende? Se pregunta en las dos mitades: se resuelve una vez. */
const esVendedora = cache(async (user: PublicUser): Promise<boolean> => {
  try {
    return (await getMySellerProfile(user.id)) !== null;
  } catch (error) {
    console.error(
      '[panel] no se pudo resolver el perfil de vendedor:',
      error instanceof Error ? error.message : String(error),
    );

    // Sin perfil confirmado se muestra el panel de comprador, que es el que
    // toda cuenta tiene. Esconder de mas es recuperable; mostrar de mas, no.
    return false;
  }
});

/** Las solapas de cada sección. Una sola definición para los dos grupos de rutas. */
const SOLAPAS: Partial<Record<SeccionDelPanel, Solapa[]>> = {
  cuenta: [
    { clave: 'resumen', texto: 'Resumen', href: '/cuenta' },
    { clave: 'datos', texto: 'Mis datos', href: '/cuenta/datos' },
    { clave: 'direcciones', texto: 'Direcciones', href: '/cuenta/direcciones' },
    { clave: 'avisos', texto: 'Avisos', href: '/cuenta/notificaciones' },
  ],
  compras: [
    { clave: 'historial', texto: 'Historial', href: '/cuenta/compras' },
    { clave: 'reclamos', texto: 'Reclamos', href: '/cuenta/reclamos' },
    { clave: 'resenas', texto: 'Reseñas', href: '/cuenta/resenas' },
  ],
  preguntas: [
    { clave: 'hechas', texto: 'Las que hiciste', href: '/cuenta/preguntas' },
    { clave: 'recibidas', texto: 'Las que te hacen', href: '/vendedor/preguntas' },
  ],
  publicaciones: [
    { clave: 'publicaciones', texto: 'Mis publicaciones', href: '/vendedor/publicaciones' },
    { clave: 'ventas', texto: 'Ventas', href: '/vendedor/ventas' },
    { clave: 'promociones', texto: 'Promociones', href: '/vendedor/promociones' },
    { clave: 'metricas', texto: 'Métricas', href: '/vendedor/metricas' },
  ],
};

/**
 * Las solapas que sólo existen para quien vende.
 *
 * ⚠️ NO SE LE MUESTRAN A QUIEN NO VENDE, y tampoco se le muestran vacías: una
 * solapa "Nivel y reputación" que lleva a una pantalla que dice "no tenés nada"
 * es peor que no tenerla. Lo que sí ve es el renglón de la barra que explica
 * que con la misma cuenta puede vender.
 */
const SOLAPAS_DE_VENDEDOR: Partial<Record<SeccionDelPanel, Solapa[]>> = {
  cuenta: [
    { clave: 'vender', texto: 'Vender en Offside', href: '/vendedor' },
    { clave: 'nivel', texto: 'Nivel y reputación', href: '/vendedor/nivel' },
  ],
};

const ETIQUETAS: Record<SeccionDelPanel, string> = {
  cuenta: 'Mi cuenta',
  compras: 'Compras',
  preguntas: 'Preguntas',
  publicaciones: 'Publicaciones',
  favoritos: 'Favoritos',
  vender: 'Vender',
};

/** El armazón: barra lateral a la izquierda, la pantalla a la derecha. */
export async function PanelDeCuenta({
  user,
  seccion,
  children,
}: {
  user: PublicUser;
  seccion: SeccionDelPanel;
  children: ReactNode;
}) {
  const [conteos, esVendedor] = await Promise.all([conteosDelPanel(user), esVendedora(user)]);

  return (
    <Panel seccion={seccion} conteos={conteos} esVendedor={esVendedor}>
      {children}
    </Panel>
  );
}

/** El segundo nivel. Va DENTRO del `<main>`, debajo del encabezado. */
export async function SolapasDeCuenta({
  user,
  seccion,
  activa,
}: {
  user: PublicUser;
  seccion: SeccionDelPanel;
  activa: string;
}) {
  const esVendedor = await esVendedora(user);

  const propias = SOLAPAS[seccion] ?? [];
  const deVendedor = esVendedor ? (SOLAPAS_DE_VENDEDOR[seccion] ?? []) : [];

  /*
   * "Las que te hacen" es la bandeja del vendedor: a quien no vende no se le
   * ofrece, porque nadie le pregunta nada.
   */
  const solapas =
    seccion === 'preguntas' && !esVendedor
      ? propias.filter((s) => s.clave !== 'recibidas')
      : [...propias, ...deVendedor];

  return <Solapas solapas={solapas} activa={activa} etiqueta={ETIQUETAS[seccion]} />;
}
