import { cache } from 'react';
import type { ReactNode } from 'react';

import { Panel, Solapas, type SeccionDelPanel, type Solapa } from '@/components/panel';
import type { PublicUser } from '@/modules/auth/services/auth.service';
import { getMySellerProfile } from '@/modules/sellers/services/seller.service';

/**
 * El armazón del área privada y sus solapas.
 *
 * ⚠️ LA BARRA LATERAL DE SECCIONES SE FUE (2026-09-12). Las mismas seis
 * secciones estaban a la vez en el cajón de las tres rayitas y como columna al
 * costado de cada pantalla privada: la misma navegación dos veces, y 15.5rem de
 * ancho menos para el historial de compras y el inventario, que son listas.
 *
 * ⚠️ `PanelDeCuenta` SOBREVIVE COMO ARMAZON, y no es inercia: es lo que les da a
 * las 31 pantallas privadas el mismo ancho máximo y el mismo canal lateral. Lo
 * que dejó de hacer es CONSULTAR: antes resolvía los conteos y el perfil de
 * vendedor en cada una de esas pantallas sólo para dibujar los numeritos de la
 * barra. Eso hoy lo paga el cajón, una vez.
 *
 * ⚠️ LAS SOLAPAS SE QUEDAN Y SIGUEN SIENDO DOS COMPONENTES. Son el segundo nivel
 * —Historial / Reclamos / Reseñas— y el cajón no las reemplaza. Van DENTRO del
 * `<main>`, debajo del encabezado: si el armazón las dibujara, quedarían arriba
 * del `<h1>` y el enlace de saltar al contenido se saltearía el título.
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

/** El armazón: ancho, centrado y aire para toda pantalla privada. */
export function PanelDeCuenta({ children }: { children: ReactNode }) {
  return <Panel>{children}</Panel>;
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
