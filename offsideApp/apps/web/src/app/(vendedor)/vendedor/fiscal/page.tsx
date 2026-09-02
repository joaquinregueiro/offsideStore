import type { Metadata } from 'next';

import { Campo, Formulario, Seleccion } from '@/components/form';
import { Aviso, BotonEnlace } from '@/components/ui';
import { requireSellerSessionUser } from '@/lib/session';
import { getMyTaxProfile } from '@/modules/sellers/services/seller-tax-profile.service';

import { declararIdentidadFiscal } from '../../acciones';
import estilos from '../../vendedor.module.css';

export const metadata: Metadata = { title: 'Identificación fiscal — Offside Store' };
export const dynamic = 'force-dynamic';

/**
 * Identidad fiscal del vendedor.
 *
 * ⚠️ ALCANCE: IDENTIFICAR, NO TRIBUTAR. SS-022 y DEC-011 dejan el modelo fiscal
 * —quien emite comprobante, monotributo o responsable inscripto, percepciones—
 * pendiente de asesoramiento profesional. Esta pantalla pide un identificador y
 * nada mas; no deriva ninguna consecuencia impositiva de el.
 *
 * ⚠️ NO SE VERIFICA CONTRA ARCA. No hay integracion. El número puede ser
 * sintacticamente perfecto y no ser de quien lo carga, y eso se dice en la
 * pantalla en vez de dejar que se lea como una verificación real.
 */
export default async function IdentificacionFiscal() {
  const user = await requireSellerSessionUser('/vendedor/fiscal');
  const perfil = await getMyTaxProfile(user);

  return (
    <main className={estilos.pagina}>
      <h1 className={estilos.titulo}>Identificación fiscal</h1>

      <p className={estilos.bajada}>
        Es uno de los tres requisitos para poder vender. Aceptamos CUIT, CUIL o CDI, con guiones o
        sin ellos.
      </p>

      {perfil !== null && (
        <div className={estilos.tarjeta}>
          <div className={estilos.linea}>
            <span className={estilos.concepto}>Cargado</span>
            <span>
              {perfil.taxIdType} {perfil.taxId}
            </span>
          </div>
          <div className={estilos.linea}>
            <span className={estilos.concepto}>Verificación</span>
            <span>{perfil.verificationStatus === 'VERIFIED' ? 'Verificada' : 'Sin verificar'}</span>
          </div>
        </div>
      )}

      <Formulario
        accion={declararIdentidadFiscal}
        enviar={perfil === null ? 'Guardar' : 'Reemplazar'}
      >
        <Seleccion
          nombre="taxIdType"
          etiqueta="Tipo"
          opciones={[
            { valor: 'CUIT', etiqueta: 'CUIT' },
            { valor: 'CUIL', etiqueta: 'CUIL' },
            { valor: 'CDI', etiqueta: 'CDI' },
          ]}
          defaultValue={perfil?.taxIdType ?? 'CUIT'}
        />

        <Campo
          nombre="taxId"
          etiqueta="Número"
          ayuda="11 dígitos. Verificamos el formato y el dígito verificador."
        />
      </Formulario>

      <p className={estilos.nota}>
        Verificamos que el número sea válido, no que sea tuyo: todavía no consultamos a ARCA. Cargar
        una identificación que no te pertenece es motivo de suspensión.
      </p>

      {perfil !== null && (
        <>
          <Aviso>
            Reemplazar la identificación cierra la anterior y guarda la nueva. El historial se
            conserva.
          </Aviso>
          <div className={estilos.acciones}>
            <BotonEnlace href="/vendedor" variante="secundario">
              Volver al panel
            </BotonEnlace>
          </div>
        </>
      )}
    </main>
  );
}
