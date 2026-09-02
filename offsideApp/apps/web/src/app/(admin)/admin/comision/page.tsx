import type { Metadata } from 'next';

import { Campo, Formulario } from '@/components/form';
import { Aviso, BotonEnlace } from '@/components/ui';
import { fecha } from '@/lib/formato';
import { CAPABILITIES } from '@/lib/permissions';
import { requireCapabilitySessionUser } from '@/lib/session';
import {
  basisPointsToPercent,
  findCurrentCommissionSetting,
  getCommissionRateBasisPoints,
} from '@/modules/config/services/settings.service';

import { cambiarComision } from '../../acciones';
import estilos from '../../admin.module.css';

export const metadata: Metadata = { title: 'Comisión — Offside Store' };
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
  );
}
