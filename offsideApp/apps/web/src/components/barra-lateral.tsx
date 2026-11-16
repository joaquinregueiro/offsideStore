import type { ReactNode } from 'react';

import { capabilitiesFor } from '@/lib/permissions';
import { getSessionUser } from '@/lib/session';

import { EnlaceLateral } from './enlace-lateral';
import { IconoLlave } from './iconos';
import { conteosDelPanel, itemsDelPanel } from './panel';
import estilos from './panel.module.css';

/**
 * Armazon del area privada: barra lateral de secciones + contenido.
 *
 * ⚠️ VUELVE LA BARRA LATERAL QUE SE SACO EL 2026-09-12, SIN VOLVER AL PROBLEMA.
 * Aquella se veia junto al cajon de las tres rayitas: la misma navegacion dos
 * veces. Ahora el cajon existe solo en telefono y la barra solo en escritorio,
 * asi que en cada ancho hay una sola. Decision del dueño, 2026-11-06.
 *
 * Las secciones salen de `itemsDelPanel`, la misma lista que usa el cajon.
 */
export async function ArmazonPrivado({ children }: { children: ReactNode }) {
  const user = await getSessionUser();

  if (user === null) return <>{children}</>;

  const conteos = await conteosDelPanel(user);
  const items = itemsDelPanel(conteos, conteos.publicacionesActivas !== null);
  const esAdmin = capabilitiesFor(user.adminRole).length > 0;

  return (
    <div className={estilos.privado}>
      <nav className={estilos.lateral} aria-label="Tu cuenta">
        <ul className={estilos.lateralLista}>
          {items.map((item) => (
            <li key={item.clave}>
              <EnlaceLateral href={item.href} className={estilos.lateralEnlace}>
                {item.icono}
                <span className={estilos.lateralTexto}>{item.texto}</span>
                {(item.dato ?? 0) > 0 && (
                  <span className={estilos.lateralDato}>
                    {(item.dato ?? 0) > 99 ? '99+' : item.dato}
                    <span className="solo-lectores"> pendientes</span>
                  </span>
                )}
              </EnlaceLateral>
            </li>
          ))}
          {esAdmin && (
            <li>
              <EnlaceLateral href="/admin" className={estilos.lateralEnlace}>
                <IconoLlave tamanio={20} />
                <span className={estilos.lateralTexto}>Admin</span>
              </EnlaceLateral>
            </li>
          )}
        </ul>
      </nav>
      <div className={estilos.privadoContenido}>{children}</div>
    </div>
  );
}
