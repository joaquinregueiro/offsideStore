import Link from 'next/link';

import { salir } from '@/app/(auth)/acciones';
import { capabilitiesFor } from '@/lib/permissions';
import { getSessionUser } from '@/lib/session';
import { getMySellerProfile } from '@/modules/sellers/services/seller.service';

import { IconoBuscar, IconoCampana, IconoCarrito, IconoLlave, IconoMenu } from './iconos';
import { conteosDelPanel, itemsDelPanel } from './panel';
import estilos from './cajon.module.css';

/**
 * CAJON: las tres rayitas de la izquierda y el panel que despliegan.
 *
 * ⚠️ ES EL UNICO MENU DEL SITIO (2026-09-12). Antes eran dos: este a la
 * izquierda con las secciones de la cuenta, y otro `<details>` a la derecha con
 * los enlaces globales. En un telefono quedaban DOS botones de tres rayitas, uno
 * en cada punta, sin nada que dijera cual era cual. Se fusionaron acá.
 *
 * ⚠️ SE DESPLIEGA HACIA ABAJO, COLGADO DE LA BARRA, no al costado. El primer
 * intento era un panel lateral y llegó a producción roto: `header.barra` tiene
 * `backdrop-filter`, que crea bloque contenedor para los `position: fixed`, así
 * que el panel quedó atrapado adentro de la barra. El detalle está en
 * `cajon.module.css`.
 *
 * ⚠️ LAS SECCIONES DE LA CUENTA NO SE REDEFINEN ACA: salen de `itemsDelPanel`,
 * la misma función que dibuja la barra lateral del área privada. Si se
 * definieran dos veces, agregar una sección la haría aparecer en un lado y no en
 * el otro —que es justamente el problema que ese panel vino a resolver—.
 *
 * ⚠️ SIN JAVASCRIPT. Es un `<details>`: el navegador ya sabe abrirlo con teclado
 * y anunciarlo a un lector de pantalla. Manejarlo con estado de React volvería
 * Client Component a toda la barra, y con ella se iría la sesión al bundle.
 */
export async function CajonDeCuenta() {
  const user = await getSessionUser();

  return (
    <details className={estilos.cajon}>
      <summary className={estilos.boton}>
        <IconoMenu tamanio={22} />
        {/*
          ⚠️ EL NOMBRE ACCESIBLE VA ACA, no en un `aria-label` del `<summary>`.
          Un `<summary>` con `aria-label` pisa su contenido en algunos lectores y
          deja de anunciar si está abierto o cerrado, que es la mitad de la
          información.
        */}
        <span className="solo-lectores">Menú y tu cuenta</span>
      </summary>

      <nav className={`${estilos.panel} sup-noche`} aria-label="Menú">
        {user === null ? <Invitado /> : <Sesion user={user} />}
      </nav>
    </details>
  );
}

/**
 * Sin sesión no se muestran las seis secciones vacías.
 *
 * ⚠️ UN CAJON CON "Mis compras" Y "Favoritos" PARA ALGUIEN QUE NO ENTRO es una
 * promesa que termina en la pantalla de login. Se ofrece lo único que se puede
 * hacer: explorar, entrar o crear la cuenta.
 */
function Invitado() {
  return (
    <>
      <div className={estilos.quien}>
        <span className={estilos.nombre}>Tu cuenta</span>
        <span className={estilos.correo}>Entrá para ver tus compras y favoritos</span>
      </div>

      <ul className={estilos.lista}>
        <li>
          <Link href="/buscar" className={estilos.item}>
            <span className={estilos.icono} aria-hidden="true">
              <IconoBuscar tamanio={20} />
            </span>
            <span className={estilos.texto}>Explorar</span>
          </Link>
        </li>
        <li>
          <Link href="/ingresar" className={estilos.item}>
            <span className={estilos.texto}>Ingresar</span>
          </Link>
        </li>
        <li>
          <Link href="/crear-cuenta" className={estilos.item}>
            <span className={estilos.texto}>Crear cuenta</span>
          </Link>
        </li>
        <li>
          <Link href="/como-funciona" className={estilos.item}>
            <span className={estilos.texto}>Cómo funciona</span>
          </Link>
        </li>
      </ul>
    </>
  );
}

async function Sesion({ user }: { user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>> }) {
  const [conteos, esVendedor] = await Promise.all([conteosDelPanel(user), vende(user.id)]);
  const items = itemsDelPanel(conteos, esVendedor);
  const esAdmin = capabilitiesFor(user.adminRole).length > 0;

  return (
    <>
      <div className={estilos.quien}>
        <span className={estilos.nombre}>{user.displayName ?? 'Tu cuenta'}</span>
        <span className={estilos.correo}>{user.email}</span>
      </div>

      <ul className={estilos.lista}>
        {items.map((item) => {
          const dato = item.dato ?? 0;

          return (
            <li key={item.clave}>
              {/*
                ⚠️ NO SE MARCA NINGUNA SECCION COMO ACTIVA, y es deliberado.
                Saber en qué ruta estamos exige `usePathname`, que es un hook:
                convertiría este componente —y con él la barra entera— en Client
                Component. La barra lateral del área privada sí la marca, porque
                cada pantalla le pasa su sección por prop; acá el cajón se abre
                desde cualquier lado y esa prop no existe.
              */}
              <Link href={item.href} className={estilos.item}>
                <span className={estilos.icono} aria-hidden="true">
                  {item.icono}
                </span>
                <span className={estilos.texto}>{item.texto}</span>
                {dato > 0 && (
                  <span className={estilos.dato}>
                    {dato > 99 ? '99+' : dato}
                    <span className="solo-lectores"> pendientes</span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      {/*
        ⚠️ SEGUNDO GRUPO, SEPARADO POR UNA LINEA, y la separación no es adorno.
        Arriba está TU CUENTA —cosas tuyas, con pendientes—; acá lo que es del
        SITIO. Mezclados en una sola lista, "Explorar" quedaba entre "Compras" y
        "Favoritos" como si fuera otra sección de la cuenta.

        No se repiten "Mi cuenta" ni "Vender": ya son dos de las seis secciones
        de arriba. Eso es exactamente lo que el menú de la derecha duplicaba.
      */}
      <ul className={`${estilos.lista} ${estilos.grupo}`}>
        <li>
          <Link href="/buscar" className={estilos.item}>
            <span className={estilos.icono} aria-hidden="true">
              <IconoBuscar tamanio={20} />
            </span>
            <span className={estilos.texto}>Explorar</span>
          </Link>
        </li>
        <li>
          <Link href="/carrito" className={estilos.item}>
            <span className={estilos.icono} aria-hidden="true">
              <IconoCarrito tamanio={20} />
            </span>
            <span className={estilos.texto}>Carrito</span>
            {conteos.enElCarrito > 0 && (
              <span className={estilos.dato}>
                {conteos.enElCarrito > 99 ? '99+' : conteos.enElCarrito}
                <span className="solo-lectores"> en el carrito</span>
              </span>
            )}
          </Link>
        </li>
        <li>
          <Link href="/cuenta/notificaciones" className={estilos.item}>
            <span className={estilos.icono} aria-hidden="true">
              <IconoCampana tamanio={20} />
            </span>
            <span className={estilos.texto}>Notificaciones</span>
            {conteos.sinLeer > 0 && (
              <span className={estilos.dato}>
                {conteos.sinLeer > 99 ? '99+' : conteos.sinLeer}
                <span className="solo-lectores"> sin leer</span>
              </span>
            )}
          </Link>
        </li>
        {esAdmin && (
          /*
            El acceso al back-office aparece SOLO para quien tiene alguna
            capacidad. No es una medida de seguridad —cada pantalla y cada Server
            Action exigen la suya—, sino la única forma de llegar sin escribir la
            URL a mano.
          */
          <li>
            <Link href="/admin" className={estilos.item}>
              <span className={estilos.icono} aria-hidden="true">
                <IconoLlave tamanio={20} />
              </span>
              <span className={estilos.texto}>Admin</span>
            </Link>
          </li>
        )}
      </ul>

      <div className={estilos.pie}>
        {!esVendedor && (
          <p className={estilos.nota}>
            ¿Querés vender? Con tu misma cuenta podés: verificás tu identidad una vez y publicás.
          </p>
        )}
        {/*
          ⚠️ SALIR ES UNA MUTACION: va en un `<form>` con POST, nunca en un
          enlace. Un GET que invalida la sesión se dispara con el prefetch del
          navegador o con una imagen incrustada en otro sitio.
        */}
        <form action={salir}>
          <button type="submit" className={estilos.salir}>
            Salir
          </button>
        </form>
      </div>
    </>
  );
}

/**
 * ¿Vende? Decide si el cajón muestra las secciones de vendedor.
 *
 * ⚠️ NO PROPAGA EL FALLO. Si la consulta falla, se muestra el cajón de
 * comprador —que toda cuenta tiene— en vez de romper la barra en todas las
 * pantallas del sitio. Esconder de más es recuperable; una barra caída, no.
 */
async function vende(userId: string): Promise<boolean> {
  try {
    return (await getMySellerProfile(userId)) !== null;
  } catch (error) {
    console.error(
      '[cajon] no se pudo resolver el perfil de vendedor:',
      error instanceof Error ? error.message : String(error),
    );

    return false;
  }
}
