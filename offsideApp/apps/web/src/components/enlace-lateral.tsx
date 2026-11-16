'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * Enlace de la barra lateral que sabe si es la seccion actual.
 *
 * ⚠️ ES CLIENTE SOLO ESTE ENLACE, NO LA BARRA. La seccion activa vive en la URL y
 * un layout no se vuelve a renderizar al navegar, asi que hace falta
 * `usePathname`. La sesion y los conteos siguen del lado del servidor. Sin
 * JavaScript el enlace funciona igual y solo falta el resaltado.
 */
export function EnlaceLateral({
  href,
  className,
  children,
}: {
  href: string;
  className: string | undefined;
  children: ReactNode;
}) {
  const ruta = usePathname();
  const activo =
    ruta === href ||
    (href !== '/cuenta' && ruta.startsWith(`${href}/`) && ruta !== '/vendedor/publicaciones/nueva');

  return (
    <Link href={href} className={className} aria-current={activo ? 'page' : undefined}>
      {children}
    </Link>
  );
}
