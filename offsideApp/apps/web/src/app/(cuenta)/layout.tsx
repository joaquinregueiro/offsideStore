import type { ReactNode } from 'react';

import { Footer } from '@/components/footer';
import { Header } from '@/components/header';

/**
 * El panel del comprador comparte barra y pie con el resto del sitio.
 *
 * ⚠️ LAS PESTAÑAS NO VIVEN ACA, viven en cada pantalla (`nav.tsx`). Marcar la
 * pestaña activa exige saber la ruta, y saberla en un layout obliga a
 * `usePathname`, que es un hook: convertiria este layout —y con el la barra y
 * el pie— en Client Component para resolver algo que cada pantalla ya sabe de
 * si misma. Es la misma decision que tomo el panel del vendedor.
 *
 * ⚠️ EL LAYOUT NO EXIGE SESION. Podria: todas las pantallas de adentro la
 * exigen. Pero un guard en el layout se ejecuta ANTES de saber a que pantalla
 * se iba, asi que el `?next=` del login quedaria vacio y volver despues de
 * ingresar dejaria a la persona en la home. Cada pantalla llama a
 * `requireVerifiedSessionUser` con su propia ruta.
 */
export default function LayoutDeCuenta({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      {children}
      <Footer />
    </>
  );
}
