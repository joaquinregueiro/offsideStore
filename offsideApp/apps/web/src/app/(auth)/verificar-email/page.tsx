import type { Metadata } from 'next';

import estilos from '@/components/form.module.css';
import { BotonEnlace, EstadoVacio } from '@/components/ui';
import { verifyEmail } from '@/modules/auth/services/auth.service';

export const metadata: Metadata = { title: 'Verificar email — Offside Store' };

/**
 * Destino del enlace del email de verificación.
 *
 * ⚠️ ACÁ SÍ SE CONSUME EL TOKEN AL CARGAR, a diferencia del reset. Verificar no
 * pide ningún dato más a la persona, así que un formulario intermedio sólo
 * agregaría un clic sin aportar nada.
 */
export default async function VerificarEmail({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (token === undefined || token === '') {
    return (
      <main className={estilos.pagina}>
        <EstadoVacio titulo="Revisá tu email">
          <p style={{ marginBottom: 24 }}>
            Te mandamos un enlace para confirmar tu dirección. Abrilo desde tu casilla.
          </p>
          <BotonEnlace href="/" variante="secundario">
            Ir al catálogo
          </BotonEnlace>
        </EstadoVacio>
      </main>
    );
  }

  try {
    await verifyEmail(token);
  } catch {
    // ⚠️ No se distingue "vencido" de "inexistente" ni se muestra el error
    // crudo: sería información sobre tokens ajenos.
    return (
      <main className={estilos.pagina}>
        <EstadoVacio titulo="El enlace no sirve">
          <p style={{ marginBottom: 24 }}>
            Puede que ya lo hayas usado o que haya vencido. Ingresá y te mandamos otro.
          </p>
          <BotonEnlace href="/ingresar">Ingresar</BotonEnlace>
        </EstadoVacio>
      </main>
    );
  }

  return (
    <main className={estilos.pagina}>
      <EstadoVacio titulo="¡Listo! Tu email está verificado">
        <p style={{ marginBottom: 24 }}>Ya podés comprar y vender en Offside.</p>
        <BotonEnlace href="/ingresar">Ingresar</BotonEnlace>
      </EstadoVacio>
    </main>
  );
}
