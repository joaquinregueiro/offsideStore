import type { ReactNode } from 'react';

<<<<<<< HEAD
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';

/**
 * El panel del vendedor comparte barra y pie con el resto del sitio.
 *
 * ⚠️ EL PIE SE AGREGA ACA, NO EN CADA PANTALLA. Antes el layout solo ponia la
 * barra y ninguna pantalla tenia pie: el documento terminaba en seco.
 */
=======
import { Header } from '@/components/header';

>>>>>>> origin/main
export default function LayoutDeVendedor({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      {children}
<<<<<<< HEAD
      <Footer />
=======
>>>>>>> origin/main
    </>
  );
}
