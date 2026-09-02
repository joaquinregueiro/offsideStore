import type { Metadata } from 'next';

import { Campo, Formulario } from '@/components/form';
import estilos from '@/components/form.module.css';
import { BotonEnlace, EstadoVacio } from '@/components/ui';

import { reenviarVerificacion } from '../acciones';

export const metadata: Metadata = { title: 'Revisá tu email — Offside Store' };

/**
 * Confirmación después de crear cuenta o de pedir recuperar la contraseña.
 *
 * ⚠️ ACÁ VIVE EL REENVÍO, y no es un adorno. Un email se pierde por motivos
 * triviales —spam, un corte de SES, el job agotando sus reintentos— y sin una
 * forma de pedir otro la cuenta queda muerta: no puede ingresar (BR-001) y no
 * hay token nuevo. El reenvío es lo que hace recuperable ese estado.
 *
 * ⚠️ El formulario NO se muestra en el caso de reset. Pedir la contraseña de
 * nuevo ya tiene su propia pantalla, y mezclar los dos caminos sólo confunde.
 */
export default async function RevisaTuEmail({
  searchParams,
}: {
  searchParams: Promise<{ motivo?: string }>;
}) {
  const { motivo } = await searchParams;
  const esReset = motivo === 'reset';

  return (
    <main className={estilos.pagina}>
      <EstadoVacio titulo="Revisá tu email">
        <p style={{ marginBottom: 24 }}>
          {esReset
            ? 'Si esa dirección está registrada, te mandamos un enlace para elegir una nueva contraseña.'
            : 'Te mandamos un enlace para confirmar tu dirección. Hace falta para poder comprar o vender.'}
        </p>

        {esReset ? (
          <BotonEnlace href="/" variante="secundario">
            Ir al catálogo
          </BotonEnlace>
        ) : (
          <>
            <p style={{ marginBottom: 16 }}>
              ¿No te llegó? Revisá el correo no deseado, o pedí que te lo mandemos de nuevo.
            </p>
            <Formulario accion={reenviarVerificacion} enviar="Reenviar el email">
              <Campo nombre="email" etiqueta="Tu email" tipo="email" autoComplete="email" />
            </Formulario>
          </>
        )}
      </EstadoVacio>
    </main>
  );
}
