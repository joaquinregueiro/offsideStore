import type { Metadata } from 'next';
import Link from 'next/link';

import {
  IconoAjustes,
  IconoAutenticado,
  IconoBandera,
  IconoCamion,
  IconoEtiqueta,
  IconoIntercambio,
  IconoMedalla,
  IconoRayo,
  IconoTienda,
} from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import { Seccion } from '@/components/ui';
import { CAPABILITIES, hasCapability, type Capability } from '@/lib/permissions';
import { requireAnyCapabilitySessionUser } from '@/lib/session';
import { listOpenForAdmin } from '@/modules/disputes/services/dispute.service';
import { listPaidWithoutStock } from '@/modules/orders/services/order.service';
import { countOpenReports } from '@/modules/reports/services/report.service';

import { Consola } from '../consola';
import estilos from '../admin.module.css';

export const metadata: Metadata = { title: 'Administración' };
export const dynamic = 'force-dynamic';

/**
 * Las pantallas que existen, con la capacidad que cada una exige.
 *
 * ⚠️ LA CAPACIDAD SE DECLARA ACA JUNTO AL ACCESO, no en un `if` suelto: así
 * agregar una pantalla es agregar una fila, y no hay forma de olvidarse de
 * filtrarla. Mostrar u ocultar sigue siendo CORTESIA: cada pantalla vuelve a
 * exigir la suya, y cada Server Action también.
 */
const ACCESOS: {
  nombre: string;
  href: string;
  detalle: string;
  capacidad: Capability;
  icono:
    'ajustes' | 'medalla' | 'etiqueta' | 'intercambio' | 'bandera' | 'tienda' | 'camion' | 'rayo';
}[] = [
  {
    nombre: 'Configuración',
    href: '/admin/configuracion',
    detalle: 'Las claves del Config Store: plazos, límites, interruptores y pesos.',
    capacidad: CAPABILITIES.SYSTEM_CONFIG_MANAGE,
    icono: 'ajustes',
  },
  {
    nombre: 'Niveles',
    href: '/admin/niveles',
    detalle: 'Los niveles de vendedor y su comisión, y a quién se le asigna cuál.',
    capacidad: CAPABILITIES.SYSTEM_CONFIG_MANAGE,
    icono: 'medalla',
  },
  {
    nombre: 'Comisión',
    href: '/admin/comision',
    detalle: 'La tasa que Offside retiene de cada venta, con su historial de versiones.',
    capacidad: CAPABILITIES.SYSTEM_CONFIG_MANAGE,
    icono: 'etiqueta',
  },
  {
    nombre: 'Pagos y reembolsos',
    href: '/admin/pagos',
    detalle: 'Buscar una orden y devolver dinero, total o parcial.',
    capacidad: CAPABILITIES.PAYMENTS_REFUND,
    icono: 'intercambio',
  },
  {
    nombre: 'Disputas',
    href: '/admin/disputas',
    detalle: 'Los reclamos: leer la evidencia y resolver, con reembolso o con sanción.',
    capacidad: CAPABILITIES.DISPUTES_RESOLVE,
    icono: 'bandera',
  },
  {
    nombre: 'Vendedores',
    href: '/admin/vendedores',
    detalle: 'Reputación, sanciones, nivel de cuenta y promociones de un vendedor.',
    capacidad: CAPABILITIES.TRUST_MODERATE,
    icono: 'tienda',
  },
  {
    nombre: 'Órdenes',
    href: '/admin/ordenes',
    detalle: 'Buscar una compra, ver su recorrido y destrabar las que quedaron a mitad.',
    capacidad: CAPABILITIES.SYSTEM_CONFIG_MANAGE,
    icono: 'camion',
  },
  {
    nombre: 'Reportes',
    href: '/admin/reportes',
    detalle: 'Las denuncias sobre publicaciones, para atender o descartar.',
    capacidad: CAPABILITIES.TRUST_MODERATE,
    icono: 'bandera',
  },
  {
    nombre: 'Ingresos',
    href: '/admin/ingresos',
    detalle: 'Comisión cobrada por mes y por origen, leída de los snapshots.',
    capacidad: CAPABILITIES.SYSTEM_CONFIG_MANAGE,
    icono: 'rayo',
  },
];

const ICONOS = {
  ajustes: IconoAjustes,
  medalla: IconoMedalla,
  etiqueta: IconoEtiqueta,
  intercambio: IconoIntercambio,
  bandera: IconoBandera,
  tienda: IconoTienda,
  camion: IconoCamion,
  rayo: IconoRayo,
};

/**
 * ⚠️ LO QUE FALTA SE DIBUJA, NO SE CUENTA EN UNA NOTA AL PIE. `AR-006` define
 * nueve capacidades; hoy existen cuatro. Una grilla completa y un párrafo gris
 * se leen como un back-office terminado; las fichas fantasma comunican hoja de
 * ruta y evitan que alguien busque en el lugar equivocado.
 *
 * ⚠️ NO SON CONTROLES Y NO LO PARECEN: son `<div>` sin `href` ni `tabindex`, no
 * elevan y no responden al hover.
 */
const PENDIENTES: { nombre: string; detalle: string }[] = [
  {
    nombre: 'Usuarios',
    detalle: 'Buscar una cuenta que no es vendedora, suspenderla, leer su historial.',
  },
  {
    nombre: 'Aprobación de vendedores',
    detalle: 'Hoy es automática (TS-001/TS-010): no hay revisión manual.',
  },
  {
    nombre: 'Moderar publicaciones',
    detalle: 'Bajar una publicación. Cerrar su denuncia no la baja.',
  },
  { nombre: 'Bloqueos y riesgo', detalle: 'Listas de bloqueo y umbrales de riesgo (TS-042, 🟡).' },
  { nombre: 'Auditoría', detalle: 'Leer el `audit_log`, que hoy sólo se consulta por SQL.' },
];

/**
 * Índice del back-office (DEC-023).
 *
 * ⚠️ QUIEN NO TIENE NINGUNA CAPACIDAD RECIBE UN 404, no un 403. Para alguien que
 * no es administrador, el back-office no debería existir: un 403 le confirmaría
 * que la pantalla está ahí y qué hay detrás.
 *
 * ⚠️ ENTRAR ACÁ NO HABILITA NADA. Cada pantalla exige su propia capacidad, y
 * cada Server Action la vuelve a exigir. Este índice sólo decide QUÉ MOSTRAR.
 *
 * ⚠️ LOS PENDIENTES SE CUENTAN SOLO PARA QUIEN PUEDE ATENDERLOS. `countOpenReports`
 * y `listOpenForAdmin` LANZAN sin la capacidad —fallan cerrado, que es lo
 * correcto—, así que preguntarlos sin mirar el rol tiraría la pantalla de un
 * FINANCE. Sin capacidad no se pide el número y no se muestra la tarjeta.
 */
export default async function Administracion() {
  const admin = await requireAnyCapabilitySessionUser('/admin');

  const puedeResolver = hasCapability(admin.adminRole, CAPABILITIES.DISPUTES_RESOLVE);
  const puedeModerar = hasCapability(admin.adminRole, CAPABILITIES.TRUST_MODERATE);
  const puedeConfigurar = hasCapability(admin.adminRole, CAPABILITIES.SYSTEM_CONFIG_MANAGE);

  const [disputas, reportes, trabadas] = await Promise.all([
    puedeResolver
      ? listOpenForAdmin(admin, {
          statuses: ['OPEN', 'WAITING_SELLER', 'UNDER_REVIEW'],
          limit: 100,
        })
      : Promise.resolve([]),
    puedeModerar ? countOpenReports(admin) : Promise.resolve(0),
    puedeConfigurar ? listPaidWithoutStock(50) : Promise.resolve([]),
  ]);

  const accesos = ACCESOS.filter((acceso) => hasCapability(admin.adminRole, acceso.capacidad));

  /*
   * ⚠️ SOLO SE MUESTRA LO QUE TIENE ALGO PENDIENTE. Una tarjeta en cero es
   * ruido: la cola vacía ya se ve dentro de cada pantalla, y acá lo único que
   * importa es que algo espera.
   */
  const colas = [
    {
      clave: 'disputas',
      cantidad: disputas.length,
      singular: 'reclamo abierto',
      plural: 'reclamos abiertos',
      detalle: 'Sólo se resuelven los que están en revisión.',
      href: '/admin/disputas?estado=revision',
      visible: puedeResolver,
    },
    {
      clave: 'reportes',
      cantidad: reportes,
      singular: 'denuncia sin revisar',
      plural: 'denuncias sin revisar',
      detalle: 'Sobre publicaciones. Cerrarlas no baja la publicación.',
      href: '/admin/reportes',
      visible: puedeModerar,
    },
    {
      clave: 'ordenes',
      cantidad: trabadas.length,
      singular: 'orden pagada sin stock',
      plural: 'órdenes pagadas sin stock',
      detalle: 'Plata cobrada contra algo que no se puede entregar.',
      href: '/admin/ordenes',
      visible: puedeConfigurar,
    },
  ].filter((cola) => cola.visible && cola.cantidad > 0);

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <Consola
          rol={admin.adminRole}
          email={admin.email}
          activo="inicio"
          titulo="Administración"
          pendientes={{
            ...(puedeResolver ? { disputas: disputas.length } : {}),
            ...(puedeModerar ? { reportes } : {}),
          }}
        />

        <div className={estilos.hoja}>
          <p className={estilos.bajada}>
            Cada acción queda registrada con tu usuario: los reembolsos, las sanciones, las
            resoluciones y las denuncias en el log de auditoría, y la configuración como una versión
            nueva de la clave que cambiaste.
          </p>

          {colas.length > 0 && (
            <Seccion titulo="Pendientes">
              <div className={estilos.pendientes}>
                {colas.map((cola) => (
                  <Link key={cola.clave} href={cola.href} className={`${estilos.pendiente} eleva`}>
                    <span className={estilos.pendienteNumero}>{cola.cantidad}</span>
                    <span className={estilos.pendienteTexto}>
                      {cola.cantidad === 1 ? cola.singular : cola.plural}
                    </span>
                    <span className={estilos.accesoDetalle}>{cola.detalle}</span>
                  </Link>
                ))}
              </div>
            </Seccion>
          )}

          <Seccion titulo="Qué podés hacer">
            {/*
              ⚠️ `escalona` Y NO `revela-grilla`: estas tarjetas están ARRIBA DEL
              PLIEGUE, y una animación dirigida por scroll sobre contenido que ya
              se ve arranca a mitad de su rango o no arranca nunca.

              ⚠️ LA ENTRADA VA EN EL ENVOLTORIO Y LA ELEVACION EN LA TARJETA. Si
              se juntan, el hover deja de funcionar: `.escalona > *` declara
              `animation: … both`, y una propiedad bajo control de una animación
              que rellena NO transiciona.

              ⚠️ `escalona` CORTA EN EL HIJO 12. Acá son como mucho 9 + 5 = 14, y
              las últimas simplemente aparecen sin escalonar.
            */}
            <div className={`${estilos.accesos} escalona`}>
              {accesos.map((acceso) => {
                const Icono = ICONOS[acceso.icono];

                return (
                  <div key={acceso.href} className={estilos.celda}>
                    <Link href={acceso.href} className={`${estilos.acceso} eleva`}>
                      <span className={estilos.accesoIcono} aria-hidden="true">
                        <Icono tamanio={22} />
                      </span>
                      <span className={estilos.accesoTitulo}>{acceso.nombre}</span>
                      <span className={estilos.accesoDetalle}>{acceso.detalle}</span>
                    </Link>
                  </div>
                );
              })}

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
          ⚠️ LA ADVERTENCIA ES UN PLANO, NO UNA NOTA AL PIE. Es una tira oscura a
          sangre: le da ritmo vertical a la pantalla y le da a la advertencia el
          peso que tiene.

          ⚠️ ADENTRO SOLO MARCADO PROPIO: ningún componente de `ui.tsx` puede ir
          en una superficie oscura (escriben `--color-tinta` literal).
        */}
        <div className={`${estilos.cierre} sup-noche con-grano`}>
          <div className={estilos.consolaCentro}>
            <p className={estilos.cierreCuerpo}>
              <IconoAutenticado tamanio={18} />
              <span>
                Son 4 de las 9 capacidades que define <code>AR-006</code>. Las otras cinco
                pertenecen a módulos que todavía no existen. Los roles se asignan sólo por SQL: no
                hay forma de darse permisos desde acá ni desde la API, y es deliberado.
              </span>
            </p>
          </div>
        </div>
      </main>
    </Pantalla>
  );
}
