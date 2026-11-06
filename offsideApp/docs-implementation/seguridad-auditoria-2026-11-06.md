# Auditoría de seguridad — 2026-11-06

Auditoría de seguridad de aplicación sobre el código real de `offsideApp/`. El
contexto que se dio al empezar mencionaba **Fastify**: **no existe**. El backend
es Next.js 16 (Route Handlers + Server Actions), tal como fija DEC-012. Tampoco
hay integración con OCA: los envíos son Andreani PyME y un adaptador simulado de
Correo Argentino.

## Qué se corrigió

Cada arreglo tiene un test que **falla con el código anterior** (se comprobó
revirtiendo el archivo) y pasa con el nuevo.

### 1. Next.js con un RCE sin autenticación — CRÍTICO

`next@16.3.1` estaba dentro del rango vulnerable `16.0.0 – 16.4.0`:
GHSA-2464-fhr4-w9xw (RCE en Image Optimization con SVG), GHSA-673q-mjm6-r5xr
(RCE en `use cache`), GHSA-cjq9-62q9-8jv4 (SSRF), GHSA-p3m5-59mp-jv5r (DoS en
Server Actions). Además `sharp <0.35.5` (librsvg), `zod <4.6.6` (agotamiento de
memoria al validar) y `source-map-js 1.2.1`.

- `next` → `^16.4.3` (y `@next/eslint-plugin-next` a la par), `sharp` →
  `^0.35.5`, `zod` → `^4.6.7`, `overrides.source-map-js` → `^1.2.2`.
- **`npm audit --omit=dev`: 0 vulnerabilidades.**
- ⚠️ Quedan avisos **sólo de desarrollo** (`vite`, `launch-editor`, vía
  `vitest`). No viajan a la imagen de producción. `npm audit fix` falla con un
  bug interno de npm (`edgesOut`); se resuelve subiendo `vitest` cuando haya
  versión que lo arrastre.

### 2. Redirector abierto con una tabulación — ALTO

`rutaInternaSegura()` (`lib/formato.ts`) rechazaba `//x`, `/\x` y URLs
absolutas, pero **no los caracteres de control**. El parser de URL del
navegador (WHATWG) borra TAB/LF/CR en cualquier posición, así que
`/ingresar?next=%2F%09%2Fsitio-falso` producía un `Location: /<TAB>/sitio-falso`
que el navegador resuelve como `//sitio-falso`. El tab es válido en una
cabecera HTTP: llega intacto. Phishing desde nuestro propio login.

Arreglo: se rechaza cualquier carácter C0 o DEL y, como última red, se resuelve
el destino contra un origen ficticio y se descarta si sale de él. Verificado
contra el servidor de producción: el campo `next` del formulario queda en `/`.

### 3. Un pago aprobado por $1 daba por pagada la orden — ALTO (fraude)

El webhook reconsulta el pago —bien— y lo atribuye a la orden por
`external_reference`, pero **no comparaba el importe ni la moneda**. Ese campo
lo escribe quien crea el cobro, y el pago se consulta con el token del vendedor
sobre la cuenta del vendedor: la misma en la que él puede crear cobros propios.
Resultado posible: órdenes "pagadas" con $1, ventas fantasma que inflan la
reputación, comisión evadida. Si Mercado Pago le notifica a la aplicación de
Offside pagos de la cuenta conectada que Offside no creó es 🔵 sin confirmar; el
control no depende de saberlo.

Arreglo (`payments/services/payment-amount.ts`): un pago `approved` tiene que
coincidir **exactamente** con lo que pidió la preferencia (Σ precio × cantidad)
y en la moneda de la orden. Si no, se conserva el estado crudo de MP (DEC-035)
pero la orden **no avanza**, no se registra reparto, no se descuenta stock y
queda `PAYMENT_AMOUNT_MISMATCH` en `audit_log` para revisión manual —mismo
criterio que `ORDER_PAID_WITHOUT_STOCK`—. Falla cerrado sin importe o moneda.

### 4. Inundación de emails de reset por la API — MEDIO

La Server Action de "olvidé mi contraseña" limitaba por cuenta; el endpoint
`POST /api/auth/password/forgot` **sólo por IP**. Rotando IPs se podía mandar
emails de reset sin techo a la casilla de cualquiera (y dañar la reputación de
envío de SES). Ahora consume el mismo cupo, **con la misma clave de Redis** que
la pantalla.

### 5. Sin cabeceras de seguridad: clickjacking — MEDIO

No había ninguna. Cualquier sitio podía embeber `offside.com.ar` en un iframe
invisible y hacerle apretar a la víctima "Pagar", "Desvincular Mercado Pago" o
"Reembolsar". `SameSite=Lax` no protege eso. `lib/security-headers.ts`, aplicado
desde `next.config.ts` a todas las rutas:

| Cabecera                     | Valor                                                        |
| ---------------------------- | ------------------------------------------------------------ |
| `Content-Security-Policy`    | `frame-ancestors 'none'; base-uri 'self'; object-src 'none'` |
| `X-Frame-Options`            | `DENY`                                                       |
| `X-Content-Type-Options`     | `nosniff`                                                    |
| `Referrer-Policy`            | `strict-origin-when-cross-origin`                            |
| `Strict-Transport-Security`  | `max-age=31536000` (sin `includeSubDomains`)                 |
| `Permissions-Policy`         | cámara, micrófono, ubicación y topics apagados               |
| `Cross-Origin-Opener-Policy` | `same-origin`                                                |

Y `poweredByHeader: false`. ⚠️ **No** hay `script-src` (exige nonces por
request; mal hecho deja la página en blanco) ni `form-action` (Chrome lo aplica
a los redirects posteriores a un POST y rompería el paso a Mercado Pago). Los
dos quedan fijados por test.

### 6. Cookie mal codificada → 500 — BAJO

`readSessionToken` llamaba a `decodeURIComponent` sin `try`: una cookie `%`
hacía fallar cualquier endpoint con 500. Ahora es "sin sesión" (401).

## Lo que se revisó y está bien

Autorización por dueño en direcciones, notificaciones, preguntas, órdenes,
checkout y etiqueta (todo filtra por `user.id` de la sesión, nunca del cuerpo);
las 61 Server Actions revalidan sesión y cupo (salvo `salir`, que no lo necesita); capacidades del back-office;
tokens de sesión/verificación/reset hasheados y de un solo uso; argon2id con
techo de longitud; reset que cierra todas las sesiones; firma HMAC de MP en
tiempo constante y fail-closed; SNS con validación del certificado antes del
fetch (anti-SSRF); `state` OAuth de un solo uso con PKCE; tokens de MP cifrados;
procesamiento de imágenes con techo de píxeles, sin EXIF y recodificado; SQL
parametrizado (los tres `sql.raw` sólo interpolan números o nombres de columna
de una lista fija); `.env` fuera del repo; contenedor sin root.

## Pendiente — requiere decisión, no se tocó

⚠️ **BLOQUEO DE DOCUMENTACIÓN — el envío no se cobra.**

1. Qué encontré: `orders.total_amount = producto + shipping_amount`, pero
   `createPreference` sólo manda los items. Con `shipping_mode = buyer_pays` y
   costo > 0, la pantalla muestra un total y Mercado Pago cobra menos.
2. Documento(s): `docs/03-operations/shipping.md` §5.b (quién paga, 🟡);
   DEC-030 (snapshot).
3. Impacto: el vendedor no cobra el envío que el comprador vio. Por eso el
   control del punto 3 compara contra la preferencia y no contra el total.
4. Decisión necesaria: (a) mandar el envío como item de la preferencia —toca la
   integración de MP y la base de la comisión—; (b) `shipments.cost` de MP
   (🔵, no verificado); (c) dejar de sumar el envío al total mientras sea "a
   convenir".

Otros, por orden de prioridad:

- **CSP de scripts con nonces** (defensa contra XSS). Hoy no hay
  `dangerouslySetInnerHTML` ni HTML de usuario renderizado, así que el riesgo
  inmediato es bajo.
- **Cuerpo de 48 MB en TODAS las Server Actions**, incluidas las públicas
  (login). Next no permite el límite por acción. Mitigar en Traefik/Coolify
  (límite de cuerpo y de conexiones por IP) —es configuración de despliegue—.
- **`x-forwarded-for` se toma del primer elemento.** Correcto detrás de
  Traefik, que descarta los `X-Forwarded-*` de orígenes no confiables; si el
  puerto 3000 quedara expuesto, el límite por IP sería falsificable. Verificar
  en Coolify que el puerto no esté publicado.
- **Webhook de MP sin ventana de frescura del `ts`.** Un replay es inocuo hoy
  (se reconsulta el pago y todo es idempotente), pero conviene rechazar `ts`
  viejos cuando se confirme la tolerancia de reloj de MP 🔵.
- **HSTS con `includeSubDomains`/`preload`**: decisión del owner.
- Dependencias de desarrollo (`vite`) con avisos moderados/altos.

## Verificación

- `npm run verify` en verde: format, chequeos CSS, lint, typecheck y **1036
  tests** —unitarios y de integración contra PostgreSQL 16 y Redis reales—.
  Antes de tocar pagos, la integración daba 409/409; ahora 411/411.
- `npm run build` en verde, y con `next start` se comprobó que las siete
  cabeceras salen en `/` y en `/api/*`, que no sale `X-Powered-By` y que una
  cookie mal codificada da 401.
