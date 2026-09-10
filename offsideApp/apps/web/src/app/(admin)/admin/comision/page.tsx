import type { Metadata } from 'next';

import { Campo, Formulario } from '@/components/form';
<<<<<<< HEAD
import { Pantalla } from '@/components/movimiento';
import { Aviso, BotonEnlace, CeldaNumero, EncabezadoNumero, Tabla } from '@/components/ui';
import { fecha, precio } from '@/lib/formato';
=======
import { Aviso, BotonEnlace } from '@/components/ui';
import { fecha } from '@/lib/formato';
>>>>>>> origin/main
import { CAPABILITIES } from '@/lib/permissions';
import { requireCapabilitySessionUser } from '@/lib/session';
import {
  basisPointsToPercent,
<<<<<<< HEAD
  findCommissionHistory,
=======
>>>>>>> origin/main
  findCurrentCommissionSetting,
  getCommissionRateBasisPoints,
} from '@/modules/config/services/settings.service';

import { cambiarComision } from '../../acciones';
<<<<<<< HEAD
import { Consola } from '../../consola';
import estilos from '../../admin.module.css';

export const metadata: Metadata = { title: 'Comisión' };
=======
import estilos from '../../admin.module.css';

export const metadata: Metadata = { title: 'Comisión — Offside Store' };
>>>>>>> origin/main
export const dynamic = 'force-dynamic';

/**
 * Config Store: la comisión por defecto (DEC-013 / DEC-038).
 *
 * ⚠️ ESTO CAMBIA UNA REGLA DE NEGOCIO PARA TODA LA PLATAFORMA, sin redeploy y
 * sin SQL. Por eso pide `system_config:manage` y no simplemente "ser admin".
 *
 * ⚠️ NO RECALCULA NADA. La comisión vive en `app_settings`, `orders` la lee UNA
 * vez al crear la orden y la congela en el snapshot (DEC-030). Las órdenes que
 * ya existen conservan la tasa con la que se crearon: cambiarla acá no las
 * toca, y eso es lo correcto —el precio de una venta no se reescribe después—.
<<<<<<< HEAD
 *
 * ⚠️ `<Pantalla>` VA EN EL `page.tsx`, NUNCA EN EL `layout.tsx`: un layout
 * persiste entre navegaciones del grupo y ahí el enter/exit no se dispara. Esta
 * pantalla no lo tenía.
 */
export default async function Comision() {
  const admin = await requireCapabilitySessionUser(
    CAPABILITIES.SYSTEM_CONFIG_MANAGE,
    '/admin/comision',
  );

  const [basisPoints, fila, historial] = await Promise.all([
    getCommissionRateBasisPoints(),
    findCurrentCommissionSetting(),
    findCommissionHistory(8),
  ]);

  const sobreCienMil = precio(String(Math.round((100_000 * 100 * basisPoints) / 10_000)), 'ARS');

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <Consola rol={admin.adminRole} email={admin.email} activo="comision" titulo="Comisión" />

        <div className={estilos.hoja}>
          <p className={estilos.bajada}>
            Es lo que Offside retiene de cada venta. Se envía a Mercado Pago como{' '}
            <code>marketplace_fee</code> y sale del pago; el vendedor cobra el resto en su propia
            cuenta.
          </p>

          {/*
            ⚠️ ESTO REEMPLAZA A `<Cifras>`, Y NO ES CAPRICHO: ES LA UNICA SALIDA.
            `.cifra` es una caja con borde de 1px que no se puede reencuadrar
            desde `admin.module.css`: sus clases son de CSS Module y se hashean,
            así que `:global(.cifra)` apunta a un nombre que no existe en el DOM.

            ⚠️ ABSORBE LA TARJETA DE CONTEXTO. Antes `Cifras` decía "Versión N ·
            desde el {fecha}" y cuatro líneas más abajo una tarjeta repetía
            "Vigente desde {fecha}", en la pantalla más corta del grupo.
          */}
          <section
            className={`${estilos.marcador} sup-noche con-grano`}
            aria-labelledby="marcador-comision"
          >
            <p className={estilos.marcadorRotulo} id="marcador-comision">
              Comisión vigente
            </p>

            {/*
              ⚠️ LA UNICA ANIMACION PERMITIDA SOBRE UN NUMERO DE PLATA: entra una
              vez, muestra el valor FINAL desde el primer cuadro y termina quieta.
              Nada de contar hacia arriba — un importe en movimiento se lee como
              un importe que todavía se está calculando.
            */}
            <p className={`${estilos.marcadorCifra} cifra-entra`}>
              <span>{basisPointsToPercent(basisPoints)}</span>
            </p>

            <dl className={estilos.marcadorDatos}>
              <div>
                <dt>Versión</dt>
                <dd>{fila?.version ?? '—'}</dd>
              </div>
              <div>
                {/*
                  ⚠️ SE MUESTRA `createdAt`, NO `updatedAt`. Cada cambio inserta
                  una FILA NUEVA con la versión siguiente; nunca se edita una
                  existente, así que `updated_at` queda siempre en NULL y
                  mostrarlo daba un guión eterno.
                */}
                <dt>Vigente desde</dt>
                <dd>{fila === undefined ? '—' : fecha(fila.createdAt.toISOString())}</dd>
              </div>
              <div>
                {/*
                  ⚠️ LOS BASIS POINTS NO SON REDUNDANCIA: son la FUENTE DE VERDAD
                  que se persiste (600 = 6%) y el número con el que se compara
                  contra la base o contra `marketplace_fee` cuando algo no cierra.
                  Van acá y NO como cuarta columna del historial: en 288px útiles
                  esa columna convertía la tabla en algo que hay que arrastrar
                  para llegar a la fecha.
                */}
                <dt>Basis points</dt>
                <dd>{basisPoints}</dd>
              </div>
              <div>
                <dt>Sobre una venta de $100.000</dt>
                <dd>{sobreCienMil}</dd>
              </div>
            </dl>
          </section>

          {/*
            ⚠️ EL FORMULARIO VIVE ADENTRO DE UNA FICHA, Y NO ES DECORACION. Es el
            único control del back-office que cambia una regla de negocio de toda
            la plataforma, y estaba suelto sobre el papel entre dos párrafos: nada
            decía dónde empieza y dónde termina la operación. Encuadrado, la
            pantalla se lee como marcador → acción → historial, que es el orden en
            el que se la usa.

            ⚠️ EL AVISO Y LA NOTA VAN ADENTRO, con el control al que se refieren.
            Afuera eran dos textos sobre papel a la misma altura visual que la
            bajada, tres bloques más arriba.
          */}
          <section className={estilos.tarjeta} aria-labelledby="cambiar-comision">
            <div className={estilos.tarjetaCabecera}>
              <h2 id="cambiar-comision" className={estilos.tituloDeFicha}>
                Cambiar la comisión
              </h2>
            </div>

            <Formulario accion={cambiarComision} enviar="Guardar comisión">
              {/*
                ⚠️ SIN `step` EL NAVEGADOR RECHAZA 6,5. El `step` por defecto de un
                `type="number"` es 1, así que la ayuda prometía dos decimales y el
                control no los aceptaba. El rango 0–100 replica el invariante TÉCNICO
                que ya valida el schema —no un límite comercial: DEC-014 dice
                explícitamente "sin mínimo ni máximo"— para que el error aparezca
                donde la persona escribe y no después de mandar el formulario.
              */}
              <Campo
                nombre="porcentaje"
                etiqueta="Nueva comisión (%)"
                tipo="number"
                ayuda="Hasta dos decimales. 6 = 6%, 6.5 = 6,5%. Se guarda como entero en basis points."
                defaultValue={basisPointsToPercent(basisPoints).replace('%', '')}
                min={0}
                max={100}
                step={0.01}
                inputMode="decimal"
              />
            </Formulario>

            {/*
              ⚠️ `avisoNeutro` PINTA `--superficie-2`, o sea que sobre la ficha
              blanca se sigue leyendo como un bloque aparte y no se disuelve.
            */}
            <div className={estilos.avisoDeFicha}>
              <Aviso>
                El cambio rige para las órdenes <strong>nuevas</strong>. Las que ya existen
                conservan la comisión con la que se crearon.
              </Aviso>
            </div>

            <p className={estilos.nota}>
              {/*
                ⚠️ El rango 0–100% NO es un límite comercial: DEC-014 dice
                explícitamente "sin mínimo ni máximo". Es un invariante TÉCNICO —una
                tasa mayor al total haría que `marketplace_fee` supere el importe y
                Mercado Pago rechace la preferencia—.
              */}
              <span>
                El límite de 0 a 100% es técnico, no comercial: por encima del total, Mercado Pago
                rechaza la preferencia.
              </span>
            </p>
          </section>

          {/*
            ⚠️ EL HISTORIAL YA ESTABA EN LA BASE Y NADIE LO LEIA. `app_settings` es
            versionada: cada cambio inserta una fila con su versión, su `updated_by`
            y su fecha. La pantalla mostraba sólo la vigente, así que "¿desde cuándo
            cobramos 6%?" se contestaba con una consulta SQL a mano.

            ⚠️ FALTA EL EMAIL DE QUIEN LO CAMBIO: la fila guarda `updated_by` con el
            id del usuario, y resolverlo a un email requiere una consulta cruzada
            que el Service todavía no hace. Queda reportado.

            ⚠️ `CeldaNumero` / `EncabezadoNumero` NO SON ADORNO: `.tabla .numero`
            vive en `ui.module.css`, que es un CSS Module, así que desde
            `admin.module.css` esa clase no se puede escribir. Sin ellos, una
            columna de tasas no alinea sus comas.
          */}
          {historial.length > 1 && (
            <div className={estilos.historial}>
              <Tabla titulo="Historial de la comisión" tituloVisible>
                <thead>
                  <tr>
                    <EncabezadoNumero>Versión</EncabezadoNumero>
                    <EncabezadoNumero>Tasa</EncabezadoNumero>
                    <th scope="col">Desde</th>
                  </tr>
                </thead>
                <tbody>
                  {historial.map((version) => (
                    <tr key={version.id}>
                      <CeldaNumero>{version.version}</CeldaNumero>
                      <CeldaNumero>
                        {typeof version.value === 'number'
                          ? basisPointsToPercent(version.value)
                          : String(version.value)}
                      </CeldaNumero>
                      <td>{fecha(version.createdAt.toISOString())}</td>
                    </tr>
                  ))}
                </tbody>
              </Tabla>
            </div>
          )}

          {/*
            ⚠️ EL BOTON SALE DEL PARRAFO DE TEXTO TENUE. `.nota` estaba haciendo
            de envoltorio de un control: un `<p>` con `color:
            var(--color-neutro-tenue)` y `display: flex` conteniendo un botón.
          */}
          <div className={estilos.pie}>
            <BotonEnlace href="/admin" variante="secundario">
              Volver
            </BotonEnlace>
          </div>
        </div>
      </main>
    </Pantalla>
=======
 */
export default async function Comision() {
  await requireCapabilitySessionUser(CAPABILITIES.SYSTEM_CONFIG_MANAGE, '/admin/comision');

  const [basisPoints, fila] = await Promise.all([
    getCommissionRateBasisPoints(),
    findCurrentCommissionSetting(),
  ]);

  return (
    <main className={estilos.pagina}>
      <span className={estilos.contexto}>Back-office</span>
      <h1 className={estilos.titulo}>Comisión</h1>

      <p className={estilos.bajada}>
        Es lo que Offside retiene de cada venta. Se envía a Mercado Pago como{' '}
        <code>marketplace_fee</code> y sale del pago; el vendedor cobra el resto en su propia
        cuenta.
      </p>

      <div className={estilos.tarjeta}>
        <div className={estilos.linea}>
          <span className={estilos.concepto}>Vigente</span>
          <span className={estilos.dato}>
            <strong>{basisPointsToPercent(basisPoints)}</strong> ({basisPoints} bp)
          </span>
        </div>
        <div className={estilos.linea}>
          <span className={estilos.concepto}>Versión</span>
          <span className={estilos.dato}>{fila?.version ?? '—'}</span>
        </div>
        {/*
          ⚠️ SE MUESTRA `createdAt`, NO `updatedAt`. Cada cambio inserta una FILA
          NUEVA con la version siguiente; nunca se edita una existente, así que
          `updated_at` queda siempre en NULL y mostrarlo daba un guión eterno.
          La fecha del cambio es cuándo nació la versión vigente.
        */}
        <div className={estilos.linea}>
          <span className={estilos.concepto}>Vigente desde</span>
          <span className={estilos.dato}>
            {fila === undefined ? '—' : fecha(fila.createdAt.toISOString())}
          </span>
        </div>
      </div>

      <Formulario accion={cambiarComision} enviar="Guardar comisión">
        <Campo
          nombre="porcentaje"
          etiqueta="Nueva comisión (%)"
          tipo="number"
          ayuda="Hasta dos decimales. 6 = 6%, 6.5 = 6,5%. Se guarda como entero en basis points."
          defaultValue={basisPointsToPercent(basisPoints).replace('%', '')}
        />
      </Formulario>

      {/*
        ⚠️ El rango 0–100% NO es un límite comercial: DEC-014 dice explícitamente
        "sin mínimo ni máximo". Es un invariante TÉCNICO — una tasa mayor al
        total haría que `marketplace_fee` supere el importe y Mercado Pago
        rechace la preferencia.
      */}
      <Aviso>
        El cambio rige para las órdenes <strong>nuevas</strong>. Las que ya existen conservan la
        comisión con la que se crearon.
      </Aviso>

      <p className={estilos.nota}>
        El límite de 0 a 100% es técnico, no comercial: por encima del total, Mercado Pago rechaza
        la preferencia.
      </p>

      <p className={estilos.nota}>
        <BotonEnlace href="/admin" variante="secundario">
          Volver
        </BotonEnlace>
      </p>
    </main>
>>>>>>> origin/main
  );
}
