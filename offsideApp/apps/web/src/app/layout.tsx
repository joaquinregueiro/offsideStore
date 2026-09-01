import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';

import './tokens.css';

/**
 * Las dos familias del sistema visual, con los roles que la identidad les
 * asigna (`design/Offside Identidad.dc.html` §03).
 *
 * ⚠️ BIG NOODLE TITLING ES UNA FUENTE PROPIA, no está en Google Fonts. Vive en
 * `./fonts/` porque `design/` es sólo lectura y además no se sirve al
 * navegador. Los archivos originales son `.ttf`; se convirtieron a **woff2**,
 * que pesa un tercio (54 KB → 18 KB) y soportan todos los navegadores
 * modernos.
 *
 * ⚠️ NO SON DOS PESOS, SON DOS ESTILOS: la identidad dice "regular y oblicua".
 * Se declaran como `normal` e `italic` de la MISMA familia, así el navegador
 * usa la oblicua real en vez de inclinar la regular por su cuenta —que es lo
 * que haría si sólo declaráramos una.
 */
const bigNoodle = localFont({
  src: [
    { path: './fonts/big_noodle_titling.woff2', weight: '400', style: 'normal' },
    { path: './fonts/big_noodle_titling_oblique.woff2', weight: '400', style: 'italic' },
  ],
  variable: '--font-titulo',
  display: 'swap',
  // Sin esto, el salto al cargar la fuente es notorio: Big Noodle es muy
  // condensada y el fallback ocupa bastante más ancho.
  adjustFontFallback: 'Arial',
  fallback: ['Arial Narrow', 'Arial', 'sans-serif'],
});

/**
 * Inter para cuerpo, fichas de producto y UI, pesos 400-600.
 *
 * `next/font/google` la **auto-hospeda**: se sirve desde nuestro dominio y el
 * navegador del visitante nunca le pide nada a Google.
 */
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-texto',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Offside Store',
  // La bajada es la de la identidad de marca, no una inventada.
  description: 'Compra y venta de camisetas de fútbol para coleccionistas.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR" className={`${bigNoodle.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
