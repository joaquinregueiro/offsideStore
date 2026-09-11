import { resetEnvCache } from '@offside/config';
import { afterAll, describe, expect, it } from 'vitest';

import type { EmailMessage } from './infrastructure/email/email-sender.port';
import { isOrderEmailJob, jobIdDe, type OrderEmailJobData } from './services/order-emails.service';
import * as templates from './templates/order.templates';

/**
 * Emails transaccionales de orden, reclamo, calificacion y nivel.
 *
 * Lo que se protege aca, en orden de importancia:
 *
 *   1. que NINGUN email lleve un token ni un enlace que abra algo solo;
 *   2. que no se crucen datos entre las partes (el comprador nunca ve lo que
 *      cobra el vendedor);
 *   3. que lo que escribio otra persona no entre al HTML sin escapar;
 *   4. que el texto no prometa lo que el sistema no hace: ni correo integrado,
 *      ni plazos legales, ni cuotas, ni a que medio devuelve Mercado Pago.
 */

const APP_URL = 'https://offside.test';
const ENTORNO_ORIGINAL = { ...process.env };

/**
 * ⚠️ AL CARGAR EL MODULO, no en `beforeAll`: varios `describe` construyen el
 * mensaje en su cuerpo, que corre al RECOLECTAR los tests, antes de cualquier
 * hook. Con el `APP_URL` en un hook, esos mensajes saldrian con el default.
 */
process.env.APP_URL = APP_URL;
resetEnvCache();

afterAll(() => {
  for (const clave of Object.keys(process.env)) {
    if (!(clave in ENTORNO_ORIGINAL)) delete process.env[clave];
  }
  Object.assign(process.env, ENTORNO_ORIGINAL);
  resetEnvCache();
});

const ORDEN: templates.OrdenEmail = {
  id: '6d3f2a1e-0000-4000-8000-000000000001',
  numero: 'OS-2026-000123',
  total: '1000000',
  moneda: 'ARS',
  articulos: [{ titulo: 'Camiseta River Plate 1996', cantidad: 1 }],
  importeVendedor: '940000',
};

const SEGUIMIENTO: templates.SeguimientoEmail = {
  numero: 'AR123456789XY',
  transportista: 'Andreani',
};

const DISPUTA: templates.DisputaEmail = {
  id: 'disputa-1',
  ordenId: ORDEN.id,
  ordenNumero: ORDEN.numero,
  motivo: 'not_received',
  respuestaHasta: '2026-09-20T12:00:00.000Z',
  resolucion: null,
  importeReembolsado: null,
  moneda: 'ARS',
};

const RESENA: templates.ResenaEmail = {
  ordenNumero: ORDEN.numero,
  puntaje: 4,
  comentario: 'Llegó impecable, tal cual la foto.',
};

const NIVEL: templates.NivelVendedorEmail = {
  codigo: 'AVANZADO',
  nombre: 'Vendedor avanzado',
  comisionBasisPoints: 500,
};

const A = 'destino@ejemplo.com';

/** Las diez, con datos completos, para las propiedades comunes. */
function todas(): { nombre: string; mensaje: EmailMessage }[] {
  return [
    { nombre: 'nuevaVenta', mensaje: templates.nuevaVenta(A, 'Ana', ORDEN) },
    { nombre: 'compraConfirmada', mensaje: templates.compraConfirmada(A, 'Ana', ORDEN) },
    {
      nombre: 'pedidoDespachado',
      mensaje: templates.pedidoDespachado(A, 'Ana', ORDEN, SEGUIMIENTO),
    },
    { nombre: 'confirmaRecepcion', mensaje: templates.confirmaRecepcion(A, 'Ana', ORDEN, 3) },
    { nombre: 'ventaCompletada', mensaje: templates.ventaCompletada(A, 'Ana', ORDEN) },
    {
      nombre: 'ordenCancelada',
      mensaje: templates.ordenCancelada(A, 'Ana', ORDEN, 'comprador', true),
    },
    { nombre: 'reclamoAbierto', mensaje: templates.reclamoAbierto(A, 'Ana', DISPUTA) },
    {
      nombre: 'reclamoResuelto',
      mensaje: templates.reclamoResuelto(
        A,
        'Ana',
        { ...DISPUTA, resolucion: 'full_refund', importeReembolsado: '1000000' },
        'comprador',
      ),
    },
    { nombre: 'calificacionRecibida', mensaje: templates.calificacionRecibida(A, 'Ana', RESENA) },
    {
      nombre: 'nivelDeVendedorActualizado',
      mensaje: templates.nivelDeVendedorActualizado(A, 'Ana', NIVEL),
    },
  ];
}

describe('propiedades comunes a las diez plantillas', () => {
  it('todas traen asunto, texto plano y HTML, al destinatario indicado', () => {
    for (const { nombre, mensaje } of todas()) {
      expect(mensaje.to, nombre).toBe(A);
      expect(mensaje.subject, nombre).toMatch(/— Offside Store$/);
      expect(mensaje.text.length, nombre).toBeGreaterThan(0);
      expect(mensaje.html, nombre).toBeDefined();
      expect(mensaje.html, nombre).toContain('<!doctype html>');
    }
  });

  it('todos los enlaces se construyen con APP_URL, y hay UNO solo', () => {
    for (const { nombre, mensaje } of todas()) {
      const enlaces = mensaje.text.match(/https?:\/\/\S+/g) ?? [];

      expect(enlaces, nombre).toHaveLength(1);
      expect(enlaces[0], nombre).toMatch(new RegExp(`^${APP_URL}/`));
    }
  });

  it('⚠️ NINGUNA lleva un token ni un enlace firmado', () => {
    // Un email se reenvia, se filtra y queda en casillas ajenas por anos: lo
    // que lleva adentro no puede abrir nada por si solo. Todos apuntan a
    // pantallas con sesion.
    for (const { nombre, mensaje } of todas()) {
      expect(mensaje.text, nombre).not.toMatch(/token/i);
      expect(mensaje.html, nombre).not.toMatch(/token/i);
      expect(mensaje.text, nombre).not.toMatch(/\?[a-z_]+=/i);
    }
  });

  it('⚠️ no prometen correo integrado, plazos legales ni cuotas', () => {
    for (const { nombre, mensaje } of todas()) {
      for (const prohibido of [
        /correo argentino/i,
        /días hábiles/i,
        /cuotas/i,
        /mismo medio de pago/i,
        /garant[ií]a legal/i,
        /ley/i,
        /seguimiento autom/i,
      ]) {
        expect(mensaje.text, `${nombre}: ${prohibido}`).not.toMatch(prohibido);
      }
    }
  });

  it('saluda por el nombre si lo hay, y sin el si no', () => {
    expect(templates.compraConfirmada(A, 'Ana', ORDEN).text).toContain('Hola, Ana.');
    expect(templates.compraConfirmada(A, '  Ana  ', ORDEN).text).toContain('Hola, Ana.');
    expect(templates.compraConfirmada(A, null, ORDEN).text).toContain('Hola.');
    expect(templates.compraConfirmada(A, '   ', ORDEN).text).toContain('Hola.');
  });

  it('el texto plano y el HTML dicen lo mismo: el numero de orden esta en los dos', () => {
    for (const { nombre, mensaje } of todas().filter(
      (t) => t.nombre !== 'nivelDeVendedorActualizado',
    )) {
      expect(mensaje.text, nombre).toContain(ORDEN.numero);
      expect(mensaje.html, nombre).toContain(ORDEN.numero);
    }
  });
});

describe('nuevaVenta — al vendedor', () => {
  const mensaje = templates.nuevaVenta(A, 'Ana', ORDEN);

  it('asunto con el numero de orden', () => {
    expect(mensaje.subject).toBe('Vendiste: orden OS-2026-000123 — Offside Store');
  });

  it('lleva orden, articulo, total, lo que le corresponde y el enlace a ventas', () => {
    expect(mensaje.text).toContain('Orden: OS-2026-000123');
    expect(mensaje.text).toContain('Camiseta River Plate 1996');
    expect(mensaje.text).toContain('10.000');
    expect(mensaje.text).toContain('Te corresponde');
    expect(mensaje.text).toContain('9.400');
    expect(mensaje.text).toContain(`${APP_URL}/vendedor/ventas`);
  });

  it('sin importe del vendedor, no inventa uno', () => {
    const sin = templates.nuevaVenta(A, 'Ana', { ...ORDEN, importeVendedor: null });

    expect(sin.text).not.toContain('Te corresponde');
  });

  it('le pide cargar transportista y seguimiento, sin prometer rastreo', () => {
    expect(mensaje.text).toContain('número de seguimiento');
    expect(mensaje.text).not.toMatch(/seguirla/);
  });
});

describe('compraConfirmada — al comprador', () => {
  const mensaje = templates.compraConfirmada(A, 'Ana', ORDEN);

  it('asunto y enlace a mis compras', () => {
    expect(mensaje.subject).toBe('Compra confirmada: orden OS-2026-000123 — Offside Store');
    expect(mensaje.text).toContain(`${APP_URL}/mis-compras`);
    expect(mensaje.text).toContain('10.000');
  });

  it('⚠️ NUNCA muestra lo que cobra el vendedor, aunque el snapshot lo traiga', () => {
    // `importeVendedor` viaja en el mismo `OrdenEmail`; que el comprador lo
    // vea seria filtrarle la comision del vendedor.
    expect(mensaje.text).not.toContain('Te corresponde');
    expect(mensaje.text).not.toContain('9.400');
    expect(mensaje.html).not.toContain('9.400');
  });
});

describe('pedidoDespachado — al comprador', () => {
  it('lleva numero de seguimiento y transportista como TEXTO, sin URL del transportista', () => {
    const mensaje = templates.pedidoDespachado(A, 'Ana', ORDEN, SEGUIMIENTO);

    expect(mensaje.subject).toContain('en camino');
    expect(mensaje.text).toContain('Seguimiento: AR123456789XY');
    expect(mensaje.text).toContain('Transportista: Andreani');
    // El unico enlace es el nuestro (propiedad comun); aca se fija ademas que
    // el seguimiento no se convierta en uno.
    expect(mensaje.html).not.toMatch(/href="[^"]*AR123456789XY/);
  });

  it('sin transportista, no muestra la fila', () => {
    const mensaje = templates.pedidoDespachado(A, 'Ana', ORDEN, {
      numero: 'X1',
      transportista: null,
    });

    expect(mensaje.text).toContain('Seguimiento: X1');
    expect(mensaje.text).not.toContain('Transportista');
  });

  it('un transportista en blanco cuenta como ninguno', () => {
    const mensaje = templates.pedidoDespachado(A, 'Ana', ORDEN, {
      numero: 'X1',
      transportista: '   ',
    });

    expect(mensaje.text).not.toContain('Transportista');
  });
});

describe('confirmaRecepcion — al comprador', () => {
  it('dice cuantos dias quedan, en singular y plural', () => {
    expect(templates.confirmaRecepcion(A, 'Ana', ORDEN, 3).text).toContain('Tenés 3 días');
    expect(templates.confirmaRecepcion(A, 'Ana', ORDEN, 1).text).toContain('Tenés 1 día para');
  });

  it('con cero (o menos) dice que vence hoy', () => {
    expect(templates.confirmaRecepcion(A, 'Ana', ORDEN, 0).text).toContain('vence hoy');
    expect(templates.confirmaRecepcion(A, 'Ana', ORDEN, -2).text).toContain('vence hoy');
    expect(templates.confirmaRecepcion(A, 'Ana', ORDEN, 2.9).text).toContain('Tenés 2 días');
  });

  it('el boton lleva a confirmar', () => {
    const mensaje = templates.confirmaRecepcion(A, 'Ana', ORDEN, 3);

    expect(mensaje.subject).toContain('¿Recibiste tu compra?');
    expect(mensaje.text).toContain(`Confirmar recepción:\n${APP_URL}/mis-compras`);
  });
});

describe('ventaCompletada — al vendedor', () => {
  it('avisa que ya cuenta para el nivel y enlaza a ventas', () => {
    const mensaje = templates.ventaCompletada(A, 'Ana', ORDEN);

    expect(mensaje.subject).toBe('Venta completada: orden OS-2026-000123 — Offside Store');
    expect(mensaje.text).toContain('nivel de vendedor');
    expect(mensaje.text).toContain('Te corresponde');
    expect(mensaje.text).toContain(`${APP_URL}/vendedor/ventas`);
  });
});

describe('ordenCancelada — a cualquiera de las partes', () => {
  it('al comprador con pago acreditado: reembolso por Mercado Pago, sin prometer medio ni plazo', () => {
    const mensaje = templates.ordenCancelada(A, 'Ana', ORDEN, 'comprador', true);

    expect(mensaje.subject).toBe('Orden cancelada: OS-2026-000123 — Offside Store');
    expect(mensaje.text).toContain('reembolso se gestiona a través de Mercado Pago');
    expect(mensaje.text).not.toMatch(/mismo medio/);
    expect(mensaje.text).not.toMatch(/\d+ días/);
    expect(mensaje.text).toContain(`${APP_URL}/mis-compras`);
  });

  it('al comprador sin pago: no se le cobro nada', () => {
    const mensaje = templates.ordenCancelada(A, 'Ana', ORDEN, 'comprador', false);

    expect(mensaje.text).toContain('No se te cobró nada');
    expect(mensaje.text).not.toContain('reembolso');
  });

  it('al vendedor: no hace falta despachar, y enlaza a ventas', () => {
    const conPago = templates.ordenCancelada(A, 'Ana', ORDEN, 'vendedor', true);
    const sinPago = templates.ordenCancelada(A, 'Ana', ORDEN, 'vendedor', false);

    expect(conPago.text).toContain('No hace falta que despaches');
    expect(conPago.text).toContain('Mercado Pago');
    expect(sinPago.text).toContain('el pago nunca se acreditó');
    expect(conPago.text).toContain(`${APP_URL}/vendedor/ventas`);
  });
});

describe('reclamoAbierto — al vendedor', () => {
  it('traduce el motivo y dice hasta cuando responder', () => {
    const mensaje = templates.reclamoAbierto(A, 'Ana', DISPUTA);

    expect(mensaje.subject).toBe('Reclamo sobre la orden OS-2026-000123 — Offside Store');
    expect(mensaje.text).toContain('Motivo: Producto no recibido');
    expect(mensaje.text).toContain('Respondé antes del');
    expect(mensaje.text).toContain('2026');
    expect(mensaje.text).toContain(`${APP_URL}/vendedor/ventas`);
  });

  it('⚠️ no afirma que pasa si no responde: TS-052 sigue pendiente', () => {
    const mensaje = templates.reclamoAbierto(A, 'Ana', DISPUTA);

    expect(mensaje.text).not.toMatch(/pasa a revisi/i);
    expect(mensaje.text).not.toMatch(/en tu contra/i);
  });

  it('sin plazo, invita a responder sin fecha', () => {
    const mensaje = templates.reclamoAbierto(A, 'Ana', { ...DISPUTA, respuestaHasta: null });

    expect(mensaje.text).not.toContain('Respondé antes del');
    expect(mensaje.text).toContain('Podés responder');
  });

  it('un motivo desconocido se muestra tal cual antes que romper el email', () => {
    expect(templates.motivoDeReclamo('motivo_nuevo')).toBe('motivo_nuevo');
    expect(templates.resolucionDeReclamo('otra')).toBe('otra');
  });
});

describe('reclamoResuelto — a las dos partes', () => {
  const resuelta: templates.DisputaEmail = {
    ...DISPUTA,
    resolucion: 'partial_refund',
    importeReembolsado: '250000',
  };

  it('traduce la resolucion y muestra el reembolso', () => {
    const mensaje = templates.reclamoResuelto(A, 'Ana', resuelta, 'comprador');

    expect(mensaje.subject).toBe('Reclamo resuelto: orden OS-2026-000123 — Offside Store');
    expect(mensaje.text).toContain('Resolución: Reembolso parcial al comprador');
    expect(mensaje.text).toContain('Reembolso:');
    expect(mensaje.text).toContain('2.500');
    expect(mensaje.text).toContain(`${APP_URL}/mis-compras`);
  });

  it('al vendedor enlaza a ventas y habla del reembolso al comprador', () => {
    const mensaje = templates.reclamoResuelto(A, 'Ana', resuelta, 'vendedor');

    expect(mensaje.text).toContain('reembolso al comprador');
    expect(mensaje.text).toContain(`${APP_URL}/vendedor/ventas`);
  });

  it('sin reembolso no menciona Mercado Pago; sin resolucion dice "Sin detalle"', () => {
    const mensaje = templates.reclamoResuelto(
      A,
      'Ana',
      { ...DISPUTA, resolucion: null, importeReembolsado: null },
      'comprador',
    );

    expect(mensaje.text).not.toContain('Mercado Pago');
    expect(mensaje.text).toContain('Resolución: Sin detalle');
  });
});

describe('calificacionRecibida — al vendedor', () => {
  it('lleva puntaje y comentario', () => {
    const mensaje = templates.calificacionRecibida(A, 'Ana', RESENA);

    expect(mensaje.subject).toBe(
      'Recibiste una calificación: orden OS-2026-000123 — Offside Store',
    );
    expect(mensaje.text).toContain('Puntaje: 4 de 5');
    expect(mensaje.text).toContain('Comentario: Llegó impecable, tal cual la foto.');
    expect(mensaje.text).toContain(`${APP_URL}/vendedor/ventas`);
  });

  it('sin comentario, no muestra la fila', () => {
    const mensaje = templates.calificacionRecibida(A, 'Ana', { ...RESENA, comentario: null });

    expect(mensaje.text).not.toContain('Comentario');
  });

  it('⚠️ ESCAPA el comentario en el HTML: es texto escrito por otra persona', () => {
    // Sin escapar, quien escribe un enlace en su comentario consigue que
    // Offside se lo mande al vendedor desde su propio remitente.
    const mensaje = templates.calificacionRecibida(A, 'Ana', {
      ...RESENA,
      comentario: '<a href="https://sitio-falso.example">click</a> & "comillas"',
    });

    expect(mensaje.html).not.toContain('<a href="https://sitio-falso.example">');
    expect(mensaje.html).toContain('&lt;a href=&quot;https://sitio-falso.example&quot;&gt;');
    expect(mensaje.html).toContain('&amp; &quot;comillas&quot;');
    // El texto plano no es HTML: va tal cual.
    expect(mensaje.text).toContain('<a href="https://sitio-falso.example">click</a>');
  });

  it('escapa tambien el titulo de la publicacion y el nombre', () => {
    const mensaje = templates.compraConfirmada(A, '<b>Ana</b>', {
      ...ORDEN,
      articulos: [{ titulo: 'Camiseta <script>alert(1)</script>', cantidad: 2 }],
    });

    expect(mensaje.html).not.toContain('<script>');
    expect(mensaje.html).toContain('&lt;script&gt;');
    expect(mensaje.html).not.toContain('<b>Ana</b>');
    expect(mensaje.text).toContain('Camiseta <script>alert(1)</script> (x2)');
  });
});

describe('nivelDeVendedorActualizado — al vendedor', () => {
  it('nombra el nivel y la comision en porcentaje', () => {
    const mensaje = templates.nivelDeVendedorActualizado(A, 'Ana', NIVEL);

    expect(mensaje.subject).toBe('Tu nivel de vendedor cambió: Vendedor avanzado — Offside Store');
    expect(mensaje.text).toContain('Nivel: Vendedor avanzado');
    expect(mensaje.text).toContain('Comisión: 5 %');
    expect(mensaje.text).toContain('Las órdenes anteriores mantienen la comisión');
    expect(mensaje.text).toContain(`${APP_URL}/vendedor`);
  });

  it('una tasa con decimales se escribe en castellano', () => {
    const mensaje = templates.nivelDeVendedorActualizado(A, 'Ana', {
      ...NIVEL,
      comisionBasisPoints: 550,
    });

    expect(mensaje.text).toContain('5,5 %');
  });

  it('⚠️ sin tasa propia, no inventa un numero', () => {
    const mensaje = templates.nivelDeVendedorActualizado(A, 'Ana', {
      ...NIVEL,
      comisionBasisPoints: null,
    });

    expect(mensaje.text).not.toContain('Comisión');
    expect(mensaje.text).not.toContain('%');
  });
});

describe('jobIdDe — un id por evento, para que un webhook repetido no mande dos veces', () => {
  const base = { to: A, nombre: null };

  it('es determinista y depende de la orden', () => {
    const job: OrderEmailJobData = { ...base, kind: 'order_new_sale', orden: ORDEN };

    expect(jobIdDe(job)).toBe(`order_new_sale-${ORDEN.id}`);
    expect(jobIdDe(job)).toBe(jobIdDe({ ...job, nombre: 'otro' }));
  });

  it('distingue las dos partes y los recordatorios', () => {
    const c = jobIdDe({
      ...base,
      kind: 'order_cancelled',
      orden: ORDEN,
      parte: 'comprador',
      pagoAcreditado: true,
    });
    const v = jobIdDe({
      ...base,
      kind: 'order_cancelled',
      orden: ORDEN,
      parte: 'vendedor',
      pagoAcreditado: true,
    });
    const d3 = jobIdDe({ ...base, kind: 'order_confirm_receipt', orden: ORDEN, diasRestantes: 3 });
    const d1 = jobIdDe({ ...base, kind: 'order_confirm_receipt', orden: ORDEN, diasRestantes: 1 });

    expect(c).not.toBe(v);
    expect(d3).not.toBe(d1);
  });

  it('el aviso de nivel no lleva la direccion en el id: es una clave de Redis', () => {
    const id = jobIdDe({
      ...base,
      kind: 'seller_tier_updated',
      nivel: NIVEL,
      to: 'ana@ejemplo.com',
    });

    expect(id).not.toContain('ana@ejemplo.com');
    expect(id).toMatch(/^seller_tier_updated-[0-9a-f]{16}-AVANZADO$/);
    // Estable y sin distinguir mayusculas, como `users.email`.
    expect(
      jobIdDe({ ...base, kind: 'seller_tier_updated', nivel: NIVEL, to: 'ANA@ejemplo.com' }),
    ).toBe(id);
  });

  it('⚠️ nunca lleva `:`, que BullMQ reserva', () => {
    const jobs: OrderEmailJobData[] = [
      { ...base, kind: 'order_new_sale', orden: ORDEN },
      { ...base, kind: 'order_shipped', orden: ORDEN, seguimiento: SEGUIMIENTO },
      { ...base, kind: 'dispute_opened', disputa: DISPUTA },
      { ...base, kind: 'dispute_resolved', disputa: DISPUTA, parte: 'vendedor' },
      { ...base, kind: 'review_received', resena: RESENA },
      { ...base, kind: 'seller_tier_updated', nivel: NIVEL, to: 'con:dos@puntos.test' },
    ];

    for (const job of jobs) expect(jobIdDe(job)).not.toContain(':');
  });
});

describe('isOrderEmailJob — separa estos jobs de los de auth', () => {
  it('reconoce los diez kinds y nada mas', () => {
    expect(isOrderEmailJob({ kind: 'order_new_sale' })).toBe(true);
    expect(isOrderEmailJob({ kind: 'seller_tier_updated' })).toBe(true);
    expect(isOrderEmailJob({ kind: 'email_verification' })).toBe(false);
    expect(isOrderEmailJob({ kind: 'password_reset' })).toBe(false);
    expect(isOrderEmailJob({ kind: 'inventado' })).toBe(false);
    expect(isOrderEmailJob(null)).toBe(false);
    expect(isOrderEmailJob('order_new_sale')).toBe(false);
    expect(isOrderEmailJob({})).toBe(false);
  });
});
