# Legal & Fiscal — OFFSIDE STORE

> ⚠️ **Estado global: 🔴 REQUIERE ASESORAMIENTO PROFESIONAL.**
> Este documento es un **placeholder estructurado**: enumera los temas legales y
> fiscales que **deben** resolverse, **sin** tomar decisiones ni inventar
> respuestas. **Debe ser revisado por profesionales (abogado y contador) antes del
> lanzamiento comercial real.** Actualizado 2026-08-19.

## 1. Propósito

Dejar registrado, como fuente de verdad, todo lo legal/fiscal pendiente, para que
no se implemente nada que dependa de estas definiciones sin resolverlas primero.

## 2. Bloque fiscal — 🔴 (DEC-011)

Offside **todavía no tiene definida** su estructura jurídica, inscripción fiscal
ni régimen impositivo. Quedan **pendientes de contador/asesor fiscal**:

- Estructura jurídica.
- IVA.
- Ingresos Brutos.
- Ganancias.
- Régimen de percepción de plataformas.
- Facturación de **nuestra comisión**.
- Facturación del **vendedor**.
- Quién emite comprobante.
- Datos fiscales requeridos.
- Monotributo / Responsable Inscripto.
- Percepciones.
- Retenciones.
- Reportes fiscales.

> **Nota (obligatoria):** *"Este bloque deberá ser definido junto con un
> contador/asesor fiscal antes del lanzamiento comercial real."*
>
> **No** se modifica el modelo de datos fiscal para tomar decisiones que todavía no
> existen. La comisión ya define que es **IVA incluido** (DEC-014), pero eso **no**
> reemplaza el análisis fiscal completo.

## 3. Bloque legal — 🔴 (Bloque 15)

Pendiente de **abogado**:

- Términos y condiciones.
- Política de privacidad.
- Política de devoluciones.
- Política de disputas.
- Política de vendedores.
- Política de autenticidad.
- Productos prohibidos.
- Propiedad intelectual.
- Uso de logos/escudos de clubes y marcas.
- Responsabilidad de Offside.
- Responsabilidad del vendedor.
- Suspensión de cuentas.
- Fraude.
- Falsificaciones.

## 4. Impacto en el sistema

- Ninguna tabla fiscal (facturación/comprobantes) se modela hasta cerrar el §2.
- Las políticas legales (§3) alimentarán textos y reglas de negocio (refunds,
  disputas, autenticidad) que **ya** están diseñadas como **configurables** (⚙️),
  pero cuyos **valores por defecto** deben alinearse con lo que definan los
  profesionales.

## 5. Decisiones

- 🔴 **DEC-011:** modelo fiscal e impuestos — requiere contador.
- 🔴 Marco legal — requiere abogado.

## 6. Riesgos

Ver `RISKS.md`: RISK-L1 (claridad fiscal), RISK-L2 (responsabilidad por
falsificaciones), RISK-L3 (defensa del consumidor / protección de datos).
