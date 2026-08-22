import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Los 33 enums del ERD v1.0 §3, en el mismo orden y con los mismos valores.
 *
 * ⚠️ NO agregar, quitar ni renombrar valores. El ERD §26.1 marca como riesgo
 * alterar enums despues de migrar (`ALTER TYPE`): quedan definitivos.
 * Los estados CRUDOS de terceros (Mercado Pago, Correo Argentino) NO son enums:
 * van en columnas `text` (`mp_status`, `provider_status`, ...).
 */

export const userStatus = pgEnum('user_status', ['active', 'suspended', 'deleted']);

/** DEC-020. Trayectoria/confianza del usuario. Umbrales 🟦 PENDING. */
export const userLevel = pgEnum('user_level', [
  'NUEVO',
  'CONFIABLE',
  'DESTACADO',
  'COLECCIONISTA',
  'TIENDA',
]);

/** DEC-021. Vive en `users`, no en `seller_profiles`. Umbrales 🟦 PENDING. */
export const riskLevel = pgEnum('risk_level', ['NORMAL', 'RIESGO', 'RESTRINGIDO', 'SUSPENDIDO']);

/** DEC-023. Reemplaza al viejo `is_admin`. Permisos granulares fuera del MVP. */
export const adminRole = pgEnum('admin_role', [
  'SUPER_ADMIN',
  'ADMIN',
  'MODERATOR',
  'SUPPORT',
  'FINANCE',
]);

export const identityStatus = pgEnum('identity_status', [
  'unverified',
  'pending',
  'verified',
  'rejected',
]);

export const sellerStatus = pgEnum('seller_status', [
  'pending',
  'approved',
  'limited',
  'suspended',
  'expelled',
]);

export const mpConnectionStatus = pgEnum('mp_connection_status', [
  'connected',
  'expired',
  'revoked',
  'disconnected',
]);

export const listingStatus = pgEnum('listing_status', [
  'draft',
  'active',
  'paused',
  'sold_out',
  'deleted',
]);

/** Independiente de `listing_status` (decision Fase 2 §6). */
export const moderationStatus = pgEnum('moderation_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
]);

export const garmentCategory = pgEnum('garment_category', [
  'camiseta',
  'short',
  'buzo',
  'campera',
  'conjunto',
  'entrenamiento',
]);

export const kitType = pgEnum('kit_type', ['home', 'away', 'third', 'goalkeeper', 'special']);

export const sleeve = pgEnum('sleeve', ['short', 'long']);

export const versionType = pgEnum('version_type', ['player', 'fan', 'match_worn', 'other']);

/** DEC-025. 🟦 Las descripciones de cada nivel quedan PENDING. */
export const itemCondition = pgEnum('item_condition', [
  'NUEVO',
  'COMO_NUEVO',
  'EXCELENTE',
  'MUY_BUENO',
  'BUENO',
  'ACEPTABLE',
]);

/** DEC-025. 🟦 La evidencia exigida por categoria queda PENDING. */
export const authenticity = pgEnum('authenticity', [
  'NO_ESPECIFICADA',
  'ORIGINAL_DECLARADA',
  'REPLICA_OFICIAL',
  'VERIFICADA',
  'SOSPECHOSA',
  'FALSIFICACION',
]);

/** DEC-029/034. Ciclo LOGISTICO. Refund y disputa NO son estados de Order. */
export const orderStatus = pgEnum('order_status', [
  'PENDING_PAYMENT',
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
]);

/** DEC-028/035. Estado NORMALIZADO; el crudo de MP va en `payments.mp_status`. */
export const paymentStatus = pgEnum('payment_status', [
  'PENDING',
  'IN_PROCESS',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'CHARGED_BACK',
]);

export const refundType = pgEnum('refund_type', ['FULL', 'PARTIAL']);

/** DEC-031. */
export const refundStatus = pgEnum('refund_status', [
  'REQUESTED',
  'UNDER_REVIEW',
  'APPROVED',
  'PROCESSING',
  'COMPLETED',
  'REJECTED',
]);

/** Aprobado en Fase 2. Soporta saldos parciales via `settled_amount`. */
export const sellerLiabilityStatus = pgEnum('seller_liability_status', [
  'OPEN',
  'PARTIALLY_SETTLED',
  'SETTLED',
  'WRITTEN_OFF',
]);

export const shipmentStatus = pgEnum('shipment_status', [
  'created',
  'dispatched',
  'in_transit',
  'delivered',
  'delivery_issue',
  'returned',
]);

export const disputeReason = pgEnum('dispute_reason', [
  'not_received',
  'different_from_listing',
  'counterfeit',
  'condition_mismatch',
  'size_mismatch',
  'damaged',
  'wrong_description',
  'other',
]);

/** DEC-009. El 2do estado es `WAITING_SELLER` (prevalece sobre el viejo `SELLER_RESPONSE`). */
export const disputeStatus = pgEnum('dispute_status', [
  'OPEN',
  'WAITING_SELLER',
  'UNDER_REVIEW',
  'RESOLVED',
]);

export const disputeResolution = pgEnum('dispute_resolution', [
  'no_action',
  'partial_refund',
  'full_refund',
  'return_required',
  'seller_penalty',
  'seller_suspended',
]);

export const sanctionType = pgEnum('sanction_type', [
  'warning',
  'limitation',
  'suspension',
  'expulsion',
  'penalty',
]);

export const actorType = pgEnum('actor_type', ['user', 'seller', 'admin', 'system']);

export const evidenceUploader = pgEnum('evidence_uploader', ['buyer', 'seller', 'admin']);

/**
 * DEC-036/040. SOLO HECHOS OBJETIVOS — sin interpretacion de riesgo.
 * Las señales de riesgo (`HIGH_RISK`, `FRAUD`, ...) viven en `risk_type`.
 * 🟦 lista ampliable.
 */
export const historyEventType = pgEnum('history_event_type', [
  'USER_REGISTERED',
  'PURCHASE_COMPLETED',
  'SALE_COMPLETED',
  'ORDER_CANCELLED',
  'DISPUTE_OPENED',
  'DISPUTE_RESOLVED',
  'REFUND_CREATED',
  'REFUND_COMPLETED',
  'REVIEW_RECEIVED',
  'POLICY_VIOLATION_CONFIRMED',
  'ACCOUNT_SUSPENDED',
]);

/** DEC-040. Señales de riesgo (interpretacion), no hechos. 🟦 ampliable. */
export const riskType = pgEnum('risk_type', [
  'HIGH_CANCELLATION_RATE',
  'EXCESSIVE_DISPUTES',
  'CONFIRMED_COUNTERFEIT',
  'UNUSUAL_ACTIVITY',
  'MULTIPLE_ACCOUNTS',
  'CHARGEBACK_PATTERN',
]);

export const riskSeverity = pgEnum('risk_severity', ['LOW', 'MEDIUM', 'HIGH']);

export const riskSource = pgEnum('risk_source', ['SYSTEM', 'ADMIN']);

export const notificationType = pgEnum('notification_type', [
  'order',
  'payment',
  'shipment',
  'dispute',
  'price_alert',
  'system',
]);

/** DEC-038. Alcance de un parametro del Config Store. */
export const configScope = pgEnum('config_scope', ['global', 'seller_tier', 'category']);

/**
 * DEC-041 (ERD v1.1) — estado de una solicitud de alta de catalogo.
 *
 * ⚠️ NO reutiliza `moderation_status`: moderar una publicacion y gobernar el
 * catalogo son conceptos distintos, y `SUSPENDED` no aplica a una solicitud.
 */
export const catalogRequestStatus = pgEnum('catalog_request_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
]);

/**
 * DEC-041 (ERD v1.1) — a que catalogo controlado apunta una solicitud.
 *
 * Son exactamente los catalogos controlados de `product-specification.md` §4.3.
 * NO incluye `category`: es un conjunto fijo respaldado por `garment_category`,
 * no se propone.
 */
/**
 * Tipo de identificador fiscal argentino declarado por el vendedor.
 *
 * ⚠️ NO se asume que todo vendedor tenga CUIT: una persona fisica sin actividad
 * comercial puede tener CUIL, y CDI aplica a quienes no tienen ninguno de los
 * dos. Por eso el campo es `tax_id_type` + `tax_id`, y no una columna `cuit`.
 */
export const taxIdType = pgEnum('tax_id_type', ['CUIT', 'CUIL', 'CDI']);

/**
 * Estado de la verificacion fiscal CONTRA LA FUENTE OFICIAL.
 *
 * ⚠️ NO confundir con la validacion sintactica. Que un identificador tenga
 * formato y digito verificador correctos NO significa que la autoridad fiscal
 * haya confirmado nada: son dos cosas distintas y esta columna representa solo
 * la segunda.
 *
 * `PENDING` es el unico estado alcanzable hoy: la integracion con la fuente
 * fiscal todavia no existe. `VERIFIED` y `REJECTED` se declaran ahora para no
 * tener que hacer `ALTER TYPE` despues (riesgo que el ERD §26.1 marca).
 */
export const taxVerificationStatus = pgEnum('tax_verification_status', [
  'PENDING',
  'VERIFIED',
  'REJECTED',
]);

export const catalogTargetType = pgEnum('catalog_target_type', [
  'club',
  'national_team',
  'brand',
  'competition',
  'country',
  'season',
  'size_chart',
]);
