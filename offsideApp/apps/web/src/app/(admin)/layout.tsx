import type { ReactNode } from 'react';

import { Footer } from '@/components/footer';
import { Header } from '@/components/header';

/**
 * El back-office comparte barra y pie con el resto del sitio.
 *
 * ⚠️ EL PIE SE AGREGA ACA, NO EN CADA PANTALLA. Antes el layout solo ponia la
 * barra y ninguna pantalla tenia pie: el documento terminaba en seco.
 *
 * ⚠️ `seccion="admin"` PRENDE LA SEÑAL DE SECCION ACTIVA DE LA BARRA, que
 * existia y no la usaba nadie: `Header` traduce esa prop a `aria-current="page"`
 * y `header.module.css` cuelga de ese atributo el subrayado del enlace. Sin
 * esto, quien esta operando adentro del back-office ve la barra exactamente
 * igual que en la tienda —y esta pantalla es justo donde importa saber donde se
 * esta parado antes de apretar algo—. No cambia ninguna autorizacion: el enlace
 * "Admin" sigue apareciendo solo para quien tiene alguna capacidad, y cada
 * pantalla y cada Server Action vuelven a exigir la suya.
 */
export default function LayoutDeAdmin({ children }: { children: ReactNode }) {
  return (
    <>
      <Header seccion="admin" />
      {children}
      <Footer />
    </>
  );
}
