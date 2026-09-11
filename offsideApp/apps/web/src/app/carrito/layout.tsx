import type { ReactNode } from 'react';

import { Footer } from '@/components/footer';
import { Header } from '@/components/header';

/**
 * El carrito comparte barra y pie con el resto del sitio.
 *
 * ⚠️ VIVE ACA Y NO EN EL LAYOUT RAIZ, igual que en los demas grupos: el layout
 * raiz solo declara `<html>` y `<body>`, y cada tramo pone su propia barra. Sin
 * este archivo, el carrito seria la unica pantalla del sitio sin forma de
 * navegar a ningun lado.
 */
export default function LayoutDelCarrito({ children }: { children: ReactNode }) {
  return (
    <>
      <Header seccion="compras" />
      {children}
      <Footer />
    </>
  );
}
