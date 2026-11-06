/**
 * ¿El pago que Mercado Pago informa como APROBADO cubre lo que Offside cobro?
 *
 * =============================================================================
 * POR QUE EXISTE (auditoria de seguridad 2026-11-06)
 * =============================================================================
 *
 * El webhook reconsulta el pago a Mercado Pago —bien: nunca se confia en el
 * payload— y lo atribuye a una orden por `external_reference`. Pero hasta hoy
 * NO comparaba el importe: cualquier pago `approved` con ese
 * `external_reference` pasaba la orden a pagada, descontaba stock y arrancaba
 * el plazo de despacho.
 *
 * `external_reference` es texto libre que pone QUIEN CREA la preferencia o el
 * pago. Y el pago se consulta con el token del VENDEDOR, sobre la cuenta del
 * vendedor: la misma cuenta en la que el propio vendedor puede crear cobros
 * con sus credenciales. Un pago de $1 sobre esa cuenta con
 * `external_reference = <orden ajena o propia>` quedaba indistinguible de la
 * compra real si llegaba a procesarse —ventas fantasma que inflan la
 * reputacion, o una orden "pagada" sin la comision de Offside—. Si Mercado
 * Pago llega a notificar a la aplicacion de Offside por pagos de la cuenta
 * conectada que no creo Offside es comportamiento 🔵 no confirmado; este
 * control no depende de saberlo.
 *
 * =============================================================================
 *
 * QUE SE COMPARA: lo que Offside le pidio cobrar a Mercado Pago en la
 * preferencia —la suma de `unit_price × quantity` de los items de la orden—,
 * no `orders.total_amount`.
 *
 * ⚠️ Y LA DIFERENCIA NO ES COSMETICA. `total_amount` incluye `shipping_amount`,
 * pero la preferencia NO manda el envio como item. Comparar contra el total
 * rechazaria hoy toda orden con envio a cargo del comprador. Quien paga el
 * envio y como se cobra es decision abierta (🟡 `shipping.md` §5.b): queda
 * reportado, no se resuelve aca.
 *
 * `transaction_amount` es el importe de la operacion, sin el recargo por
 * cuotas (que va en `transaction_details.total_paid_amount`): debe coincidir
 * EXACTAMENTE con la preferencia. La prueba real del 2026-08-26 lo confirmo
 * (`100000` cobrado sobre una orden de `100000`).
 */

export interface ItemCobrado {
  unitPriceAmount: bigint;
  quantity: number;
  currency: string;
}

export type VerificacionDeImporte =
  | { ok: true }
  | {
      ok: false;
      motivo: 'importe_desconocido' | 'importe_distinto' | 'moneda_distinta';
      esperado: bigint;
      recibido: bigint | null;
    };

/** Lo que la preferencia le pidio cobrar a Mercado Pago, en centavos. */
export function importeDeLaPreferencia(items: readonly ItemCobrado[]): bigint {
  return items.reduce((total, item) => total + item.unitPriceAmount * BigInt(item.quantity), 0n);
}

/**
 * Falla CERRADO: sin importe o sin moneda informados, no se da por pagada. Un pago aprobado
 * que no se puede verificar va a revision manual, igual que el pagado sin
 * stock; nunca se aprueba "por las dudas".
 */
export function verificarImporte(
  pago: { amountCents: bigint | null; currency: string | null },
  items: readonly ItemCobrado[],
  monedaDeLaOrden: string,
): VerificacionDeImporte {
  const esperado = importeDeLaPreferencia(items);

  if (pago.amountCents === null) {
    return { ok: false, motivo: 'importe_desconocido', esperado, recibido: null };
  }

  if (pago.currency?.toUpperCase() !== monedaDeLaOrden.toUpperCase()) {
    return { ok: false, motivo: 'moneda_distinta', esperado, recibido: pago.amountCents };
  }

  if (pago.amountCents !== esperado) {
    return { ok: false, motivo: 'importe_distinto', esperado, recibido: pago.amountCents };
  }

  return { ok: true };
}
