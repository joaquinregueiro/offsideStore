import type { ReactNode } from 'react';

import { Header } from '@/components/header';

/** Todas las pantallas de autenticacion comparten la barra superior. */
export default function LayoutDeAutenticacion({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      {children}
    </>
  );
}
