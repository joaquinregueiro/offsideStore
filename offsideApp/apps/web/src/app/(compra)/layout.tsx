import type { ReactNode } from 'react';

<<<<<<< HEAD
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';

/**
 * Confirmar compra, checkout y mis compras comparten barra y pie.
 *
 * ⚠️ EL PIE SE AGREGA ACA, NO EN CADA PANTALLA. Antes el layout solo ponia la
 * barra y ninguna pantalla tenia pie: el documento terminaba en seco.
 */
=======
import { Header } from '@/components/header';

>>>>>>> origin/main
export default function LayoutDeCompra({ children }: { children: ReactNode }) {
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
