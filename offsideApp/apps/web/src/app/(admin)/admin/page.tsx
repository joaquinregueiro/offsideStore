import type { Metadata } from 'next';
import Link from 'next/link';

import { CAPABILITIES, hasCapability } from '@/lib/permissions';
import { requireAnyCapabilitySessionUser } from '@/lib/session';

import estilos from '../admin.module.css';

export const metadata: Metadata = { title: 'Administración — Offside Store' };
export const dynamic = 'force-dynamic';

/**
 * Índice del back-office (DEC-023).
 *
 * ⚠️ QUIEN NO TIENE NINGUNA CAPACIDAD RECIBE UN 404, no un 403. Para alguien que
 * no es administrador, el back-office no debería existir: un 403 le confirmaría
 * que la pantalla está ahí y qué hay detrás.
 *
 * ⚠️ ENTRAR ACÁ NO HABILITA NADA. Cada pantalla exige su propia capacidad, y
 * cada Server Action la vuelve a exigir. Este índice sólo decide QUÉ MOSTRAR:
 * ocultar una tarjeta es cortesía, no seguridad.
 *
 * ⚠️ SÓLO HAY DOS CAPACIDADES. `AR-006` lista nueve —usuarios, vendedores,
 * moderación, órdenes, disputas, bloqueos, audit logs—, pero la mayoría
 * pertenece a módulos que todavía no existen. No se muestran accesos a
 * funcionalidad inexistente.
 */
export default async function Administracion() {
  const admin = await requireAnyCapabilitySessionUser('/admin');

  const puedeConfigurar = hasCapability(admin.adminRole, CAPABILITIES.SYSTEM_CONFIG_MANAGE);
  const puedeReembolsar = hasCapability(admin.adminRole, CAPABILITIES.PAYMENTS_REFUND);

  return (
    <main className={estilos.pagina}>
      <span className={estilos.contexto}>Back-office</span>
      <h1 className={estilos.titulo}>Administración</h1>

      <p className={estilos.bajada}>
        Estás operando como <strong>{admin.adminRole}</strong>. Todo lo que hagas acá queda
        registrado en el log de auditoría con tu usuario.
      </p>

      <div className={estilos.accesos}>
        {puedeConfigurar && (
          <Link href="/admin/comision" className={estilos.acceso}>
            <span className={estilos.accesoTitulo}>Comisión</span>
            <span className={estilos.accesoDetalle}>
              La tasa que Offside retiene de cada venta.
            </span>
          </Link>
        )}

        {puedeReembolsar && (
          <Link href="/admin/pagos" className={estilos.acceso}>
            <span className={estilos.accesoTitulo}>Pagos y reembolsos</span>
            <span className={estilos.accesoDetalle}>
              Buscar una orden y devolver dinero, total o parcial.
            </span>
          </Link>
        )}
      </div>

      <p className={estilos.nota}>
        Los roles se asignan sólo por SQL: no hay forma de darse permisos desde acá ni desde la API.
        Es deliberado.
      </p>
    </main>
  );
}
