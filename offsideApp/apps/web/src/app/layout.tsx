import type { Metadata, Viewport } from 'next';
import { Inter, Poppins } from 'next/font/google';
import type { ReactNode } from 'react';

import { atributoDeTema } from '@/lib/tema';

import './tokens.css';
/*
 * ⚠️ EL ORDEN IMPORTA POR DOS RAZONES, NO POR UNA:
 *
 *   1. `movimiento.css` usa los tokens de duracion y curva de `tokens.css`.
 *   2. Lo que se importa DESPUES gana ante la misma especificidad. Las
 *      superficies (`.sup-*::before`, el filo de luz) viven en `tokens.css` y
 *      las utilidades de patron (`.patron-vivo::before`) en `movimiento.css`:
 *      poner las dos clases en UN MISMO elemento apaga el filo en silencio, sin
 *      ningun error. Por eso todo patron en movimiento va en una capa anidada
 *      propia, nunca compartiendo elemento con una `.sup-*`.
 *
 * ⚠️ Lo mismo pasa entre `.con-grano::after`, `.destello::after` y
 * `.esqueleto::after`: son el MISMO pseudo. Dos de esas clases en un elemento
 * son una sola declaracion y gana la ultima.
 *
 * ⚠️ NO HAY BARRA DE LECTURA GLOBAL, Y NO ES UN OLVIDO. `.barra-lectura` de
 * `movimiento.css` esta MUERTA: `@keyframes barrer-x` declara solo `from {
 * transform: scaleX(0) }`, asi que su `to` implicito toma el valor subyacente
 * del elemento — y la clase declara `transform: scaleX(0)` en su regla base. La
 * animacion interpola scaleX(0) → scaleX(0) y no pinta nada, sin dar error.
 * (`.revela-linea` usa el mismo keyframe y SI funciona, porque su elemento no
 * tiene transform propio y el `to` implicito resuelve a `none` = escala 1.)
 * Ademas un progreso de lectura sobre una vitrina de catalogo no significa nada
 * y en `--z-superpuesto` se dibujaria encima de la barra verde. La barra vive
 * en `/como-funciona` —la unica pantalla larga de lectura del sitio—, con
 * keyframe propio y `to` explicito.
 */
import './movimiento.css';

/**
 * Las dos familias del sistema visual, con los roles que la identidad les
 * asigna (`design/Offside Identidad.dc.html` §03).
 *
 * Poppins para el titular de portada y los precios, pesos 600 y 700. Reemplaza a
 * Big Noodle Titling por decision del dueño (2026-11-10). Es mucho mas ancha que
 * Big Noodle, asi que los tamaños de esos textos se achicaron en la misma pasada.
 */
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-titulo',
  display: 'swap',
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

/**
 * ⚠️ SE LEE `process.env` DIRECTO Y NO `getEnv()`. `metadata` se evalua al
 * cargar el modulo —o sea, tambien durante `next build`—, y `getEnv()` valida
 * el entorno ENTERO y tira si falta cualquier variable. Un build no deberia
 * romperse porque no esta configurado Mercado Pago. Aca solo hace falta una
 * URL base, y si no esta, localhost sirve.
 */
const URL_BASE = process.env.APP_URL ?? 'http://localhost:3000';

/**
 * ⚠️ `metadataBase` ES LO QUE FALTABA PARA QUE ANDE COMPARTIR UN ENLACE. Sin
 * el, Next arma las URLs de Open Graph relativas y WhatsApp, Twitter o
 * Instagram no resuelven nada: la ficha de una camiseta compartida por
 * WhatsApp —que es COMO se comparte una publicacion en Argentina— aparecia
 * como un enlace pelado, sin titulo, sin bajada y sin imagen.
 *
 * ⚠️ NO HAY IMAGEN DE OPEN GRAPH TODAVIA. Poner una generica de marca en cada
 * publicacion seria peor que no poner ninguna: todas las camisetas se
 * compartirian con la misma estampa. La correcta es la portada de la
 * publicacion, y eso se resuelve en `p/[id]`, no aca. Queda pendiente.
 */
export const metadata: Metadata = {
  metadataBase: new URL(URL_BASE),
  title: {
    default: 'Offside Store — camisetas de fútbol para coleccionistas',
    // Cada pantalla pone lo suyo y hereda el sufijo, en vez de repetirlo.
    template: '%s',
  },
  // La bajada es la de la identidad de marca, no una inventada.
  description: 'Compra y venta de camisetas de fútbol para coleccionistas.',
  applicationName: 'Offside Store',
  openGraph: {
    type: 'website',
    siteName: 'Offside Store',
    locale: 'es_AR',
    title: 'Offside Store — camisetas de fútbol para coleccionistas',
    description: 'Compra y venta de camisetas de fútbol para coleccionistas.',
  },
  /*
   * ⚠️ `noarchive` NO ES `noindex`. Se quiere que Google indexe la vitrina; lo
   * que no se quiere es que guarde una copia en cache de una publicacion que
   * ya se vendio y la siga mostrando.
   */
  robots: { index: true, follow: true, noarchive: true },
};

/**
 * ⚠️ `themeColor` PINTA LA BARRA DEL NAVEGADOR EN ANDROID. Sin el, la barra
 * queda blanca sobre la barra verde del sitio y se ve un corte.
 *
 * ⚠️ `viewport` VA APARTE DE `metadata` en esta version de Next: declararlo
 * adentro de `metadata` no hace nada y no avisa.
 *
 * ⚠️ `viewportFit: 'cover'` ES LO QUE ENCIENDE TODOS LOS `env(safe-area-inset-*)`
 * DEL SITIO. Con el valor por defecto (`auto`) esas variables resuelven a CERO
 * en todos lados, asi que el
 * `padding-bottom: max(var(--espacio-3), env(safe-area-inset-bottom, 0px))` que
 * la tarjeta de accion de `p/[id]` ya tiene escrito era inerte: en un iPhone con
 * barra de gestos, el boton de pagar —la accion mas importante del sitio— podia
 * quedar debajo de esa barra. Next lo emite como `viewport-fit=cover` en el meta.
 *
 * ⚠️ NO ES GRATIS: con `cover` el documento pasa a ocupar TAMBIEN las zonas de
 * recorte, asi que en horizontal, sobre un telefono con notch, cualquier
 * superficie a ancho completo cuyo padding lateral sea menor que el inset
 * (24px de `--espacio-6` contra ~44px de recorte) se mete debajo del notch. Las
 * dos superficies a ancho completo del sitio son la barra y el pie, y sus hojas
 * pertenecen a otro modulo: el arreglo lateral queda anotado ahi, no aca.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0f7a45',
};

/**
 * ⚠️ EL `return` NO LLEVA NI UN DIV DE FONDO, Y NO ES UNA OMISION. La malla de
 * papel y el grano llegan solos desde `body::before` y `body::after`
 * (`tokens.css`), los dos `position: fixed` con `z-index: -1`: son pseudos, asi
 * que no hay marcado que escribir y no hay una capa mas que un modulo pueda
 * pisar sin querer. Se hacen con pseudos fijos y no con
 * `background-attachment: fixed` porque en iOS un fondo fijo sobre el body se
 * repinta en cada cuadro de scroll y el sitio se arrastra.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  /*
   * ⚠️ EL TEMA ES FIJO (claro) Y SE ESCRIBE EN EL SERVIDOR: el atributo es lo
   * que impide que un sistema operativo en oscuro active el bloque dormido de
   * `tokens.css`. Ver `lib/tema.ts`.
   */
  const tema = atributoDeTema();

  return (
    <html lang="es-AR" className={`${poppins.variable} ${inter.variable}`} {...tema}>
      <body>{children}</body>
    </html>
  );
}
