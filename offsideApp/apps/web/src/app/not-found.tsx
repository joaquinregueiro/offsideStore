<<<<<<< HEAD
import type { Metadata } from 'next';
import Link from 'next/link';

import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import {
  BanderaIzada,
  PantallaDeServicio,
  TiraDeRecuperacion,
} from '@/components/pantalla-de-servicio';
import { BotonEnlace, FilaDeAcciones } from '@/components/ui';

import estilos from './not-found.module.css';

/**
 * 404. La usan tanto una URL inexistente como `notFound()`, que es lo que llama
 * el detalle cuando una publicacion no es comprable —vendida, pausada, dada de
 * baja o con el vendedor desconectado de Mercado Pago (SS-013)—.
 *
 * ⚠️ ES LA PANTALLA QUE MAS GENTE VE SIN HABERLA PEDIDO, y hasta hoy era un
 * `EstadoVacio` con una LUPA: el icono de "buscar", no el de "no está". Y
 * desperdiciaba el mejor regalo que tiene esta marca — el isotipo ES la bandera
 * del juez de linea y "fuera de juego" es literalmente lo que pasa acá.
 *
 * ⚠️ AHORA TIENE `metadata`. Sin ella, una URL rota se titulaba con el titulo
 * por defecto del sitio, asi que en el historial del navegador y en una pestaña
 * abierta parecia una pagina normal.
 */
export const metadata: Metadata = {
  title: 'Fuera de juego — página no encontrada',
  // Una pagina de error no aporta nada a un buscador.
  robots: { index: false, follow: true },
};

/**
 * ⚠️ LAS CUATRO SALIDAS SON RUTAS QUE EXISTEN, VERIFICADAS EN `app/`. Un 404
 * que ofrece "Ayuda" o "Contacto" manda a otro 404, y el segundo duele mas que
 * el primero.
 *
 * ⚠️ NO SE CONSULTA LA BASE PARA MOSTRAR CAMISETAS PARECIDAS, AUNQUE SERIA LO
 * MEJOR. Esta pantalla la renderiza tambien el error de una ruta rota: una
 * consulta acá se ejecuta en cada 404 —incluidos los de bots contra URLs que no
 * existen— y, si la base es justamente lo que fallo, el 404 se cae. Queda
 * anotado: con un Service que devuelva "ultimas publicadas" cacheado, esta tira
 * pasa a mostrar prendas.
 */
const SALIDAS = [
  {
    href: '/',
    titulo: 'Todo el catálogo',
    detalle: 'Las camisetas que están publicadas ahora mismo.',
  },
  {
    href: '/buscar',
    titulo: 'Buscar otra',
    detalle: 'Por club, selección, marca, temporada o talle.',
  },
  {
    href: '/como-funciona',
    titulo: 'Cómo funciona',
    detalle: 'Cómo se paga, cómo se cobra y qué falta todavía.',
  },
  {
    href: '/vendedor/empezar',
    titulo: 'Vender una camiseta',
    detalle: 'Publicá la tuya y cobrá en tu cuenta de Mercado Pago.',
  },
] as const;

=======
import { Header } from '@/components/header';
import { BotonEnlace, EstadoVacio } from '@/components/ui';

/**
 * 404. La usan tanto una URL inexistente como `notFound()`, que es lo que
 * llama el detalle cuando una publicacion no es comprable.
 */
>>>>>>> origin/main
export default function NoEncontrado() {
  return (
    <>
      <Header />
<<<<<<< HEAD

      <PantallaDeServicio
        codigo="404"
        titulo="Fuera de juego"
        ornamento={<BanderaIzada />}
        pie={
          <TiraDeRecuperacion titulo="Por dónde seguir">
            {SALIDAS.map((salida) => (
              <li key={salida.href}>
                {/*
                  `eleva destello` son las dos globales del sistema: la ficha se
                  levanta 4px y la cruza un barrido en el eje de 112°. Van acá y
                  no en el modulo porque el modulo no puede referenciar un
                  `@keyframes` global.
                */}
                <Link href={salida.href} className={`${estilos.salida} eleva destello`}>
                  <span className={estilos.marcador} aria-hidden="true" />
                  <span className={estilos.salidaTitulo}>{salida.titulo}</span>
                  <span className={estilos.salidaDetalle}>{salida.detalle}</span>
                </Link>
              </li>
            ))}
          </TiraDeRecuperacion>
        }
      >
        <p>
          Esta dirección no lleva a ninguna parte. Puede que la publicación ya no esté disponible
          —vendida, pausada o dada de baja— o que el enlace esté cortado. El error es un{' '}
          <strong>404</strong>.
        </p>

        {/*
          ⚠️ DOS SALIDAS ACÁ ARRIBA Y CUATRO ABAJO, Y NO ES REDUNDANTE: quien cae
          desde el enlace de una camiseta compartida por WhatsApp —un enlace que
          sobrevive al catalogo— no quiere la home, quiere otra camiseta. Estas
          dos son las que resuelven eso sin scrollear.
        */}
        <FilaDeAcciones centrada={false}>
          <BotonEnlace href="/buscar">Buscar otra camiseta</BotonEnlace>
          <BotonEnlace href="/" variante="secundario">
            Ir al catálogo
          </BotonEnlace>
        </FilaDeAcciones>
      </PantallaDeServicio>

      <Footer />
=======
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '80px 24px' }}>
        <EstadoVacio titulo="No encontramos esta página">
          <p style={{ marginBottom: 24 }}>
            Puede que la publicación ya no esté disponible o que el enlace esté mal.
          </p>
          <BotonEnlace href="/">Ir al catálogo</BotonEnlace>
        </EstadoVacio>
      </main>
>>>>>>> origin/main
    </>
  );
}
