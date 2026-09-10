import type { Metadata } from 'next';
import Link from 'next/link';

<<<<<<< HEAD
import { IconoAutenticado, IconoEtiqueta, IconoIntercambio } from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import { Seccion } from '@/components/ui';
import { CAPABILITIES, hasCapability } from '@/lib/permissions';
import { requireAnyCapabilitySessionUser } from '@/lib/session';

import { Consola } from '../consola';
import estilos from '../admin.module.css';

export const metadata: Metadata = { title: 'Administración' };
export const dynamic = 'force-dynamic';

/**
 * ⚠️ LAS SIETE CAPACIDADES QUE FALTAN SE DIBUJAN, NO SE CUENTAN EN UNA NOTA AL
 * PIE. `AR-006` define nueve y existen dos. Una grilla con dos tarjetas y un
 * parrafo gris se lee como un back-office terminado; siete fichas fantasma
 * comunican hoja de ruta y evitan que alguien busque en el lugar equivocado.
 *
 * ⚠️ NO SON CONTROLES Y NO LO PARECEN: son `<div>` sin `href` ni `tabindex`, no
 * elevan y no responden al hover. Prometer un enlace que no existe es peor que
 * no listar nada.
 */
const PENDIENTES: { nombre: string; detalle: string }[] = [
  { nombre: 'Usuarios', detalle: 'Buscar, suspender y revisar el historial de una cuenta.' },
  { nombre: 'Vendedores', detalle: 'Revisar identidad fiscal y estado de aprobación.' },
  { nombre: 'Moderación', detalle: 'Bajar una publicación y resolver reportes.' },
  { nombre: 'Órdenes', detalle: 'Ver y destrabar una compra que quedó a mitad de camino.' },
  { nombre: 'Disputas', detalle: 'El módulo entero: no hay reclamos todavía.' },
  { nombre: 'Bloqueos', detalle: 'Listas de bloqueo y parámetros de riesgo.' },
  { nombre: 'Auditoría', detalle: 'Leer el log que hoy sólo se consulta por SQL.' },
];

/**
=======
import { CAPABILITIES, hasCapability } from '@/lib/permissions';
import { requireAnyCapabilitySessionUser } from '@/lib/session';

import estilos from '../admin.module.css';

export const metadata: Metadata = { title: 'Administración — Offside Store' };
export const dynamic = 'force-dynamic';

/**
>>>>>>> origin/main
 * Índice del back-office (DEC-023).
 *
 * ⚠️ QUIEN NO TIENE NINGUNA CAPACIDAD RECIBE UN 404, no un 403. Para alguien que
 * no es administrador, el back-office no debería existir: un 403 le confirmaría
 * que la pantalla está ahí y qué hay detrás.
 *
 * ⚠️ ENTRAR ACÁ NO HABILITA NADA. Cada pantalla exige su propia capacidad, y
 * cada Server Action la vuelve a exigir. Este índice sólo decide QUÉ MOSTRAR:
 * ocultar una tarjeta es cortesía, no seguridad.
<<<<<<< HEAD
=======
 *
 * ⚠️ SÓLO HAY DOS CAPACIDADES. `AR-006` lista nueve —usuarios, vendedores,
 * moderación, órdenes, disputas, bloqueos, audit logs—, pero la mayoría
 * pertenece a módulos que todavía no existen. No se muestran accesos a
 * funcionalidad inexistente.
>>>>>>> origin/main
 */
export default async function Administracion() {
  const admin = await requireAnyCapabilitySessionUser('/admin');

  const puedeConfigurar = hasCapability(admin.adminRole, CAPABILITIES.SYSTEM_CONFIG_MANAGE);
  const puedeReembolsar = hasCapability(admin.adminRole, CAPABILITIES.PAYMENTS_REFUND);

  return (
<<<<<<< HEAD
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <Consola
          rol={admin.adminRole}
          email={admin.email}
          activo="inicio"
          titulo="Administración"
        />

        <div className={estilos.hoja}>
          <p className={estilos.bajada}>
            {/*
              ⚠️ ESTE TEXTO DECIA QUE *TODO* QUEDA EN EL LOG DE AUDITORIA, Y ES
              FALSO. `setCommissionRateBasisPoints` NO escribe en `audit_log`: su
              propio comentario explica por qué —`app_settings` ya es versionada y
              cada cambio deja su fila con `updated_by`—. Los reembolsos SÍ pasan
              por `audit`. Son dos mecanismos distintos y prometer uno solo para
              los dos es exactamente el tipo de afirmación que después nadie
              verifica.
              ⚠️ SE SACO EL ROL DE ACA: la banda ya dice con qué rol y con qué
              cuenta se está operando, en las tres pantallas.
            */}
            Cada acción queda registrada con tu usuario: los reembolsos en el log de auditoría, y la
            comisión como una versión nueva de la configuración.
          </p>

          <Seccion titulo="Qué podés hacer">
            {/*
              ⚠️ `escalona` REEMPLAZA A `revela-grilla`, Y NO ES UN CAMBIO DE
              GUSTO. `revela-grilla` es `animation-timeline: view()` y estas
              tarjetas están ARRIBA DEL PLIEGUE: una animación dirigida por scroll
              sobre contenido que ya se ve arranca a mitad de su rango o no
              arranca nunca. `escalona` corre contra el reloj al primer pintado.

              ⚠️⚠️ LA ENTRADA VA EN EL ENVOLTORIO Y LA ELEVACION EN LA TARJETA, Y
              SI SE JUNTAN EL HOVER DEJA DE FUNCIONAR. `.escalona > *` declara
              `animation: … both`, y `both` incluye `forwards`: la animación sigue
              aplicando `transform` para siempre, y una propiedad bajo control de
              una animación que rellena NO transiciona. Con las dos clases en el
              mismo elemento, `.eleva` saltaría de golpe y el `:active` no se
              percibiría.

              ⚠️ `escalona` CORTA EN EL HIJO 12. Acá son 2 + 7 = 9.
            */}
            <div className={`${estilos.accesos} escalona`}>
              {puedeConfigurar && (
                <div className={estilos.celda}>
                  <Link href="/admin/comision" className={`${estilos.acceso} eleva`}>
                    <span className={estilos.accesoIcono} aria-hidden="true">
                      <IconoEtiqueta tamanio={22} />
                    </span>
                    <span className={estilos.accesoTitulo}>Comisión</span>
                    <span className={estilos.accesoDetalle}>
                      La tasa que Offside retiene de cada venta, con su historial de versiones.
                    </span>
                  </Link>
                </div>
              )}

              {puedeReembolsar && (
                <div className={estilos.celda}>
                  <Link href="/admin/pagos" className={`${estilos.acceso} eleva`}>
                    <span className={estilos.accesoIcono} aria-hidden="true">
                      <IconoIntercambio tamanio={22} />
                    </span>
                    <span className={estilos.accesoTitulo}>Pagos y reembolsos</span>
                    <span className={estilos.accesoDetalle}>
                      Buscar una orden y devolver dinero, total o parcial.
                    </span>
                  </Link>
                </div>
              )}

              {PENDIENTES.map((pendiente) => (
                <div key={pendiente.nombre} className={estilos.celda}>
                  <div className={estilos.accesoFantasma}>
                    <span className={estilos.fantasmaMarca}>Todavía no</span>
                    <span className={estilos.fantasmaTitulo}>{pendiente.nombre}</span>
                    <span className={estilos.accesoDetalle}>{pendiente.detalle}</span>
                  </div>
                </div>
              ))}
            </div>
          </Seccion>
        </div>

        {/*
          ⚠️ LA ADVERTENCIA SALE DE LA NOTA AL PIE Y PASA A SER UN PLANO. Estaba
          en gris, al final, del mismo tamaño que una firma. Acá es una tira
          oscura a sangre: le da ritmo vertical a la pantalla y le da a la
          advertencia el peso que tiene.

          ⚠️ ADENTRO SOLO MARCADO PROPIO: ningún componente de `ui.tsx` puede ir
          en una superficie oscura (escriben `--color-tinta` literal en su color
          de texto).
        */}
        <div className={`${estilos.cierre} sup-noche con-grano`}>
          <div className={estilos.consolaCentro}>
            <p className={estilos.cierreCuerpo}>
              <IconoAutenticado tamanio={18} />
              <span>
                Son 2 de las 9 capacidades que define <code>AR-006</code>. Las otras siete
                pertenecen a módulos que todavía no existen. Los roles se asignan sólo por SQL: no
                hay forma de darse permisos desde acá ni desde la API, y es deliberado.
              </span>
            </p>
          </div>
        </div>
      </main>
    </Pantalla>
=======
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
>>>>>>> origin/main
  );
}
