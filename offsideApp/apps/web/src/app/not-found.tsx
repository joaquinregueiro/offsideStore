import { Header } from '@/components/header';
import { BotonEnlace, EstadoVacio } from '@/components/ui';

/**
 * 404. La usan tanto una URL inexistente como `notFound()`, que es lo que
 * llama el detalle cuando una publicacion no es comprable.
 */
export default function NoEncontrado() {
  return (
    <>
      <Header />
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '80px 24px' }}>
        <EstadoVacio titulo="No encontramos esta página">
          <p style={{ marginBottom: 24 }}>
            Puede que la publicación ya no esté disponible o que el enlace esté mal.
          </p>
          <BotonEnlace href="/">Ir al catálogo</BotonEnlace>
        </EstadoVacio>
      </main>
    </>
  );
}
