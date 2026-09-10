import type { Metadata } from 'next';

import { Campo, Formulario, Seleccion } from '@/components/form';
<<<<<<< HEAD
import { Pantalla } from '@/components/movimiento';
import { Aviso, BotonEnlace, FilaDeDatos, Seccion } from '@/components/ui';
=======
import { Aviso, BotonEnlace } from '@/components/ui';
>>>>>>> origin/main
import { requireSellerSessionUser } from '@/lib/session';
import { getMyTaxProfile } from '@/modules/sellers/services/seller-tax-profile.service';

import { declararIdentidadFiscal } from '../../acciones';
<<<<<<< HEAD
import { Chapa } from '../../chapa';
import { NavDelVendedor } from '../../nav';
import estilos from '../../vendedor.module.css';

export const metadata: Metadata = { title: 'Identificación fiscal' };
=======
import estilos from '../../vendedor.module.css';

export const metadata: Metadata = { title: 'Identificación fiscal — Offside Store' };
>>>>>>> origin/main
export const dynamic = 'force-dynamic';

/**
 * Identidad fiscal del vendedor.
 *
 * ⚠️ ALCANCE: IDENTIFICAR, NO TRIBUTAR. SS-022 y DEC-011 dejan el modelo fiscal
<<<<<<< HEAD
 * —quién emite comprobante, monotributo o responsable inscripto, percepciones—
 * pendiente de asesoramiento profesional. Esta pantalla pide un identificador y
 * nada más; no deriva ninguna consecuencia impositiva de él.
 *
 * ⚠️ NO SE VERIFICA CONTRA ARCA. No hay integración. El número puede ser
 * sintácticamente perfecto y no ser de quien lo carga, y eso se dice en la
=======
 * —quien emite comprobante, monotributo o responsable inscripto, percepciones—
 * pendiente de asesoramiento profesional. Esta pantalla pide un identificador y
 * nada mas; no deriva ninguna consecuencia impositiva de el.
 *
 * ⚠️ NO SE VERIFICA CONTRA ARCA. No hay integracion. El número puede ser
 * sintacticamente perfecto y no ser de quien lo carga, y eso se dice en la
>>>>>>> origin/main
 * pantalla en vez de dejar que se lea como una verificación real.
 */
export default async function IdentificacionFiscal() {
  const user = await requireSellerSessionUser('/vendedor/fiscal');
  const perfil = await getMyTaxProfile(user);

<<<<<<< HEAD
  const declarada = perfil !== null;

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <Chapa
          rotulo="Identidad"
          titulo="Identificación fiscal"
          chica
          /*
            ⚠️ EL CHIP DICE "DECLARADA", NUNCA "VERIFICADA" SOLO. La distinción
            es el punto entero de esta pantalla: se comprueba el formato y el
            dígito verificador, no la titularidad.
          */
          estado={{
            texto: declarada ? 'Declarada' : 'Falta declarar',
            tono: declarada ? 'marca' : 'alerta',
          }}
        />

        <NavDelVendedor activo="fiscal" />

        <p className={estilos.bajada}>
          Es uno de los tres requisitos para poder vender, junto con el email verificado y Mercado
          Pago conectado. Aceptamos CUIT, CUIL o CDI, con guiones o sin ellos.
        </p>

        {perfil !== null && (
          <Seccion titulo="Lo que tenemos cargado">
            <div className={`${estilos.tarjeta} entra-acerca`}>
              {/*
                ⚠️ EL NUMERO VA EN MONOESPACIADA (`.dato`). Son once dígitos que
                alguien va a cotejar contra su constancia: con una tipografía
                proporcional, un 1 y un 7 mal tipeados no se distinguen de un
                vistazo.
              */}
              <FilaDeDatos concepto="Identificación">
                {perfil.taxIdType} <code className={estilos.dato}>{perfil.taxId}</code>
              </FilaDeDatos>
              <FilaDeDatos concepto="Verificación">
                {perfil.verificationStatus === 'VERIFIED'
                  ? 'Formato y dígito verificador válidos'
                  : 'Sin verificar'}
              </FilaDeDatos>
            </div>
          </Seccion>
        )}

        <Seccion titulo={declarada ? 'Reemplazar la identificación' : 'Declarar tu identificación'}>
          <Formulario
            accion={declararIdentidadFiscal}
            enviar={declarada ? 'Reemplazar' : 'Guardar'}
          >
            <div className={estilos.par}>
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
                inputMode="numeric"
                autoComplete="off"
                ayuda="11 dígitos. Verificamos el formato y el dígito verificador."
              />
            </div>
          </Formulario>

          {declarada && (
            <Aviso>
              Reemplazar la identificación cierra la anterior y guarda la nueva. El historial se
              conserva: no se pierde nada.
            </Aviso>
          )}
        </Seccion>

        {declarada && (
=======
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
>>>>>>> origin/main
          <div className={estilos.acciones}>
            <BotonEnlace href="/vendedor" variante="secundario">
              Volver al panel
            </BotonEnlace>
          </div>
<<<<<<< HEAD
        )}

        {/*
          ⚠️ LA ADVERTENCIA MAS IMPORTANTE DE LA PANTALLA ESTABA EN GRIS DE 13px
          AL PIE. Que el número se valide y no se verifique contra ARCA es
          exactamente lo que alguien podría entender al revés — y entenderlo al
          revés es creer que Offside comprobó una titularidad que no comprobó.
        */}
        <div className={`${estilos.cierre} sup-2 patron-vivo diagonales-vivas`}>
          <p className={estilos.nota}>
            Verificamos que el número sea válido, no que sea tuyo: todavía no consultamos a ARCA.
            Cargar una identificación que no te pertenece es motivo de suspensión. El modelo fiscal
            —qué comprobante corresponde, qué régimen— todavía no está definido y esta pantalla no
            deriva ninguna consecuencia impositiva.
          </p>
        </div>
      </main>
    </Pantalla>
=======
        </>
      )}
    </main>
>>>>>>> origin/main
  );
}
