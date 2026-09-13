import Link from 'next/link';

import { salir } from '@/app/(auth)/acciones';
import { getSessionUser } from '@/lib/session';
import { getMySellerProfile } from '@/modules/sellers/services/seller.service';

import { IconoMenu } from './iconos';
import { conteosDelPanel, itemsDelPanel } from './panel';
import estilos from './cajon.module.css';

/**
 * CAJON DE CUENTA: las tres rayitas de la izquierda y el panel que despliegan.
 *
 * ⚠️ SE DESPLIEGA HACIA ABAJO, COLGADO DE LA BARRA, no al costado. El primer
 * intento era un panel lateral y llego a produccion roto: `header.barra` tiene
 * `backdrop-filter`, que crea bloque contenedor para los `position: fixed`, asi
 * que el panel quedo atrapado adentro de la barra. El detalle esta en
 * `cajon.module.css`.
 *
 * ⚠️ ES LA MISMA NAVEGACION QUE EL PANEL DEL AREA PRIVADA, DISPONIBLE DESDE
 * CUALQUIER PANTALLA. Hasta ahora las seis secciones de la cuenta sólo existían
 * ADENTRO de `/cuenta` y `/vendedor`: desde la vitrina, la ficha de un producto
 * o el carrito no había forma de llegar a "Mis compras" sin pasar por el menú
 * de la barra. Esto las pone a un toque en todo el sitio.
 *
 * ⚠️ LAS SECCIONES NO SE REDEFINEN ACA: salen de `itemsDelPanel`, que es la
 * misma función que dibuja la barra lateral del área privada. Si se definieran
 * dos veces, agregar una sección la haría aparecer en un lado y no en el otro
 * —que es justamente el problema que ese panel vino a resolver—.
 *
 * ⚠️ SIN JAVASCRIPT. Es un `<details>`, como el menú de teléfono de la barra: el
 * navegador ya sabe abrirlo con teclado y anunciarlo a un lector de pantalla.
 * Manejarlo con estado de React volvería Client Component a toda la barra, y con
 * ella se iría la sesión al bundle.
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
        <span className="solo-lectores">Tu cuenta y menú</span>
      </summary>

      <nav className={`${estilos.panel} sup-noche`} aria-label="Tu cuenta">
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
 * hacer: entrar o crear la cuenta.
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
