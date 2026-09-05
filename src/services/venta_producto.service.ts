import { Types } from "mongoose";
import { models } from "../models/index";
import {
  VENTA_ABONO_METODOS,
  type ICuotaCredito,
  type IVentaProducto,
  type VentaAbonoMetodo,
  type VentaEstadoPago,
} from "../models/venta_producto.model";
import { postFinancialMovement, reverseFinancialMovements } from "./financial-movement.service";
import { toCalendarDate, todayAsCalendarDate } from "../utils/calendar-date";

/** Money is compared and stored to the cent; floating drift is not a balance. */
export function toMoney(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

/**
 * The sale form carries `metodoPago` as free text the operator typed or picked
 * ("TRANSFERENCIA", "Depósito"), so it is folded down to the enum rather than
 * rejected — an unrecognised method files as "otro" instead of losing the sale.
 */
export function normalizeMetodo(value: unknown, fallback: VentaAbonoMetodo = "efectivo"): VentaAbonoMetodo {
  const raw = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  if (!raw) return fallback;
  const match = VENTA_ABONO_METODOS.find((m) => m === raw);
  if (match) return match;
  if (raw.includes("transfer")) return "transferencia";
  if (raw.includes("tarjeta") || raw.includes("credito") || raw.includes("debito")) return "tarjeta";
  if (raw.includes("deposit")) return "deposito";
  if (raw.includes("efectiv") || raw.includes("cash")) return "efectivo";
  return "otro";
}

export function estadoPagoFor(total: number, pagado: number): VentaEstadoPago {
  if (pagado <= 0) return "pendiente";
  return pagado >= total ? "pagado" : "parcial";
}

/**
 * Which installments the money collected so far has actually covered.
 *
 * Installments schedule the deferred part of a sale, so what settles them is
 * whatever was paid *beyond* the amount that was due at the till — otherwise a
 * deposit would tick off the first instalment it happened to be large enough
 * for and the collection panel would stop chasing money still owed.
 */
export function settleCuotas(cuotas: ICuotaCredito[], total: number, pagado: number): ICuotaCredito[] {
  const ordered = [...cuotas].sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());
  const programado = ordered.reduce((sum, c) => sum + toMoney(c.monto), 0);
  let disponible = toMoney(Math.max(pagado - Math.max(total - programado, 0), 0));

  return ordered.map((cuota) => {
    const monto = toMoney(cuota.monto);
    if (disponible + 0.005 >= monto && monto > 0) {
      disponible = toMoney(disponible - monto);
      return { ...cuota, pagada: true };
    }
    return { ...cuota, pagada: false };
  });
}

/** The commission the seller earns on this sale, as an amount. */
export function comisionTotalDe(venta: Pick<IVentaProducto, "comisionUnitaria" | "cantidad">): number {
  return toMoney(Number(venta.comisionUnitaria || 0) * Number(venta.cantidad || 0));
}

/**
 * The seller's commission is earned on the sale, not on each instalment, so it
 * posts once — when the balance reaches zero — and is withdrawn again if a
 * payment is later corrected away or the sale is re-priced below what it was.
 */
export async function syncComisionMovement(
  venta: IVentaProducto | (Record<string, any> & { _id: unknown }),
  userId: string
): Promise<void> {
  const ventaId = String(venta._id);
  const comision = comisionTotalDe(venta as IVentaProducto);
  // Movements are keyed by concepto and cannot be rewritten in place, so a
  // re-priced sale posts under a new suffixed concepto. The lookup therefore
  // matches the family rather than one exact string — checking for the bare
  // "comision_vendedor" would never find what was actually written and would
  // post a second commission on every edit.
  const existing = await models.movimientosFinancieros
    .findOne({
      origen: "venta",
      origenId: ventaId,
      concepto: { $regex: /^comision_vendedor/ },
      estado: "confirmado",
    })
    .lean();

  const shouldExist = venta.estadoPago === "pagado" && comision > 0;

  if (shouldExist && existing && toMoney(existing.monto) === comision) return;
  if (!shouldExist && !existing) return;

  if (existing) {
    // `postFinancialMovement` refuses to rewrite a movement in place, so the old
    // figure is retired with its own reversal rather than edited.
    await models.movimientosFinancieros.updateOne(
      { _id: existing._id },
      { $set: { estado: "anulado", "metadata.reversedBy": userId, "metadata.reversedAt": new Date() } }
    );
  }

  if (!shouldExist) return;

  // Keyed per amount so a re-priced sale posts a fresh movement instead of
  // colliding with the one just annulled.
  const concepto = `comision_vendedor:${Math.round(comision * 100)}`;

  // A sale re-priced back to a figure it already carried would land on the
  // movement annulled on the way out. `postFinancialMovement` only ever inserts,
  // so it would find that annulled row, leave it alone and report success while
  // the commission quietly went missing — it is revived here instead.
  const previous = await models.movimientosFinancieros.findOne({ origen: "venta", origenId: ventaId, concepto }).lean();
  if (previous) {
    await models.movimientosFinancieros.updateOne(
      { _id: previous._id },
      {
        $set: { estado: "confirmado", fechaOperacion: venta.pagoCompletadoEn ?? new Date() },
        $unset: { "metadata.reversedBy": "", "metadata.reversedAt": "" },
      }
    );
    return;
  }

  await postFinancialMovement({
    direccion: "egreso",
    base: "devengado",
    origen: "venta",
    origenId: ventaId,
    concepto,
    categoria: "COMISION",
    monto: comision,
    estado: "confirmado",
    fechaOperacion: venta.pagoCompletadoEn ?? new Date(),
    asesorId: venta.vendedorId,
    creadoPor: userId,
    metadata: { ventaId, comisionUnitaria: venta.comisionUnitaria, cantidad: venta.cantidad },
  });
}

export interface RegistrarAbonoVentaInput {
  monto: number;
  fecha?: Date | string;
  metodo?: string;
  referencia?: string;
  notas?: string;
}

/**
 * Record money received against a sale.
 *
 * Payments accumulate: the deposit taken at the till is the first abono and a
 * client settling up later adds another, so the balance is always the total
 * minus what has actually come in. Each abono posts its own income movement,
 * dated when the money arrived, so the income statement follows the cash rather
 * than jumping the whole sale on the day it was finally settled.
 */
export async function registrarAbonoVenta(
  id: string,
  input: RegistrarAbonoVentaInput,
  userId: string,
  userName: string
) {
  const monto = toMoney(input.monto);
  if (monto <= 0) throw new Error("El abono debe ser mayor a cero");

  const venta = await models.ventasProducto.findById(id).lean();
  if (!venta) return null;

  const total = toMoney(venta.total);
  const pagadoPrevio = toMoney(venta.valorPagado);
  const saldo = toMoney(total - pagadoPrevio);
  if (saldo <= 0) throw new Error("Esta venta ya está pagada por completo");
  if (monto > saldo) throw new Error(`El abono supera el saldo pendiente de $${saldo.toFixed(2)}`);

  const pagadoTotal = toMoney(pagadoPrevio + monto);
  const estadoPago = estadoPagoFor(total, pagadoTotal);
  const saldado = estadoPago === "pagado";
  const fecha = toCalendarDate(input.fecha) ?? todayAsCalendarDate();
  const abonoId = new Types.ObjectId();

  const set: Record<string, unknown> = {
    valorPagado: pagadoTotal,
    saldo: toMoney(total - pagadoTotal),
    estadoPago,
    pagoConfirmado: saldado,
    cuotas: settleCuotas(venta.cuotas || [], total, pagadoTotal),
    updatedBy: userId,
  };
  if (saldado) set.pagoCompletadoEn = new Date();

  // Guarded on the balance we read, so two people collecting at once cannot
  // between them take the sale past its own total.
  const updated = await models.ventasProducto
    .findOneAndUpdate(
      { _id: id, valorPagado: pagadoPrevio },
      {
        $set: set,
        $push: {
          abonos: {
            _id: abonoId,
            monto,
            fecha,
            metodo: normalizeMetodo(input.metodo),
            referencia: input.referencia ?? "",
            notas: input.notas ?? "",
            registradoPor: userId,
            registradoPorNombre: userName,
            createdAt: new Date(),
          },
        },
      },
      { new: true, runValidators: true }
    )
    .lean();

  if (!updated) {
    throw new Error("El saldo cambió mientras registrabas el abono; vuelve a intentarlo");
  }

  await postFinancialMovement({
    direccion: "ingreso",
    base: "devengado",
    origen: "venta",
    origenId: String(id),
    // Unique per abono: movements are keyed by concepto, and a shared one would
    // silently collapse every instalment into the first.
    concepto: `abono:${String(abonoId)}`,
    categoria: "VENTA_PRODUCTO",
    monto,
    estado: "confirmado",
    fechaOperacion: fecha,
    fechaPago: fecha,
    clienteId: updated.clienteId,
    asesorId: updated.vendedorId,
    creadoPor: userId,
    metadata: { ventaId: String(id), abonoId: String(abonoId), saldoPendiente: toMoney(total - pagadoTotal) },
  });

  await syncComisionMovement(updated as any, userId);

  return updated;
}

/**
 * Undo one payment — the correction half of "editar pagos". An abono entered for
 * the wrong amount is removed and its income movement reversed, rather than
 * being patched in place, so the ledger keeps both the entry and its retraction.
 */
export async function eliminarAbonoVenta(id: string, abonoId: string, userId: string) {
  const venta = await models.ventasProducto.findById(id).lean();
  if (!venta) return null;

  const abono = (venta.abonos || []).find((a) => String(a._id) === String(abonoId));
  if (!abono) throw new Error("Abono no encontrado en esta venta");

  const total = toMoney(venta.total);
  const pagadoPrevio = toMoney(venta.valorPagado);
  const pagadoTotal = toMoney(Math.max(pagadoPrevio - toMoney(abono.monto), 0));
  const estadoPago = estadoPagoFor(total, pagadoTotal);

  const updated = await models.ventasProducto
    .findOneAndUpdate(
      { _id: id, valorPagado: pagadoPrevio },
      {
        $set: {
          valorPagado: pagadoTotal,
          saldo: toMoney(total - pagadoTotal),
          estadoPago,
          pagoConfirmado: estadoPago === "pagado",
          cuotas: settleCuotas(venta.cuotas || [], total, pagadoTotal),
          updatedBy: userId,
        },
        $unset: estadoPago === "pagado" ? {} : { pagoCompletadoEn: "" },
        $pull: { abonos: { _id: new Types.ObjectId(abonoId) } },
      },
      { new: true, runValidators: true }
    )
    .lean();

  if (!updated) {
    throw new Error("El saldo cambió mientras eliminabas el abono; vuelve a intentarlo");
  }

  const movimiento = await models.movimientosFinancieros
    .findOne({ origen: "venta", origenId: String(id), concepto: `abono:${String(abonoId)}`, estado: "confirmado" })
    .lean();

  if (movimiento) {
    await postFinancialMovement({
      direccion: "egreso",
      base: movimiento.base,
      origen: "venta",
      origenId: String(id),
      concepto: `reverso:abono:${String(abonoId)}`,
      categoria: movimiento.categoria,
      monto: toMoney(movimiento.monto),
      estado: "confirmado",
      fechaOperacion: new Date(),
      clienteId: movimiento.clienteId,
      asesorId: movimiento.asesorId,
      creadoPor: userId,
      metadata: { isReversal: true, reversesMovementId: String(movimiento._id), abonoId: String(abonoId) },
    });
    await models.movimientosFinancieros.updateOne(
      { _id: movimiento._id },
      { $set: { "metadata.reversedBy": userId, "metadata.reversedAt": new Date() } }
    );
  }

  await syncComisionMovement(updated as any, userId);

  return updated;
}

export { reverseFinancialMovements };

/* ------------------------------------------------------------------ */
/* Migrating sales filed before the paid/owed split                    */
/* ------------------------------------------------------------------ */

/**
 * Exactly the fields the backfill overwrites — so a backup captures what it is
 * about to change and nothing else, and a restore knows what to put back.
 */
export const CAMPOS_PAGO_MIGRABLES = [
  "valorPagado",
  "saldo",
  "estadoPago",
  "pagoConfirmado",
  "pagoCompletadoEn",
  "abonos",
  "cuotas",
] as const;

export type CampoPagoMigrable = (typeof CAMPOS_PAGO_MIGRABLES)[number];

/**
 * Read the payment intent out of the old fields.
 *
 * A credit sale kept its deposit in `abono`; a cash sale said only whether it
 * had been settled, via `pagoConfirmado`. Everything else was handed over
 * without the money and reported `saldo: 0` — the debt that had no home.
 */
export function planPagoMigrado(venta: {
  total?: unknown;
  abono?: unknown;
  saldo?: unknown;
  esCredito?: unknown;
  pagoConfirmado?: unknown;
}): { total: number; valorPagado: number; saldo: number; estadoPago: VentaEstadoPago; deudaOculta: number } {
  const total = toMoney(venta.total);
  const esCredito = Boolean(venta.esCredito);
  const bruto = esCredito ? toMoney(venta.abono) : venta.pagoConfirmado ? total : 0;
  const valorPagado = toMoney(Math.min(Math.max(bruto, 0), total));
  const saldo = toMoney(Math.max(total - valorPagado, 0));

  return {
    total,
    valorPagado,
    saldo,
    estadoPago: estadoPagoFor(total, valorPagado),
    // What the old record was hiding: money owed while it reported nothing owed.
    deudaOculta: saldo > 0 && toMoney(venta.saldo) === 0 ? saldo : 0,
  };
}

/**
 * The update that puts one backed-up sale back as it was. A field missing from
 * the backup was missing on the document too, so it is unset rather than
 * written as null — which would be a third state, not the old one.
 */
export function updateDesdeRespaldo(fila: Record<string, unknown>): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  const unset: Record<string, unknown> = {};

  for (const campo of CAMPOS_PAGO_MIGRABLES) {
    if (campo in fila && fila[campo] !== undefined) set[campo] = fila[campo];
    else unset[campo] = "";
  }

  const update: Record<string, unknown> = {};
  if (Object.keys(set).length) update.$set = set;
  if (Object.keys(unset).length) update.$unset = unset;
  return update;
}
