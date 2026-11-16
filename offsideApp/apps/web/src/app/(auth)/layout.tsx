import type { ReactNode } from 'react';

import { Footer } from '@/components/footer';
import { Header } from '@/components/header';

import estilos from './auth.module.css';

/**
 * Pantallas de cuenta: una tarjeta centrada y nada mas.
 *
 * Quien llega aca viene a entrar o a registrarse. Desde el 2026-11-06 no hay panel
 * lateral con argumentos de venta: compiten con el formulario, que es lo unico
 * que importa en esta pantalla.
 */
export default function LayoutDeAutenticacion({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <main id="contenido" className={estilos.marco}>
        <div className={estilos.columna}>{children}</div>
      </main>
      <Footer />
    </>
  );
}
