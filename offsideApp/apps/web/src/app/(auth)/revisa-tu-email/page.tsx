import type { Metadata } from 'next';

import estilos from '@/components/form.module.css';
import { BotonEnlace, EstadoVacio } from '@/components/ui';

export const metadata: Metadata = { title: 'Revisá tu email — Offside Store' };

/** Confirmación después de crear cuenta o de pedir recuperar la contraseña. */
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
        <BotonEnlace href="/" variante="secundario">
          Ir al catálogo
        </BotonEnlace>
      </EstadoVacio>
    </main>
  );
}
