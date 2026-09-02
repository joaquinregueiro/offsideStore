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
          <BotonEnlace href="/revisa-tu-email" variante="secundario">
            No me llegó
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
          {/*
            ⚠️ ESTE TEXTO DECIA "Ingresá y te mandamos otro" Y ERA FALSO: no
            existia ningun reenvio, y quien llegaba acá con un token vencido no
            tenia salida —ingresar esta bloqueado sin verificar (BR-001)—.
            Ahora manda al reenvio, que si existe.
          */}
          <p style={{ marginBottom: 24 }}>
            Puede que ya lo hayas usado o que haya vencido. Pedinos uno nuevo.
          </p>
          <BotonEnlace href="/revisa-tu-email">Reenviar el email</BotonEnlace>
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
