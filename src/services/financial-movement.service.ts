import { models } from "../models/index";

export interface FinancialMovementInput {
  direccion: "ingreso" | "egreso";
  base: "devengado" | "caja";
  origen: "gestion" | "envio" | "factura" | "caja" | "gasto" | "pago" | "venta";
  origenId: string;
  concepto: string;
  categoria: string;
  monto: number;
  estado?: "pendiente" | "confirmado" | "anulado";
  fechaOperacion?: Date;
  fechaPago?: Date;
  clienteId?: unknown;
  proveedorId?: unknown;
  asesorId?: unknown;
  creadoPor: unknown;
  metadata?: Record<string, unknown>;
}

export async function postFinancialMovement(input: FinancialMovementInput) {
  if (!Number.isFinite(input.monto) || input.monto < 0) throw new Error("Monto financiero inválido");
  const movement = await models.movimientosFinancieros.findOneAndUpdate(
    { origen: input.origen, origenId: input.origenId, concepto: input.concepto },
    { $setOnInsert: { ...input, fechaOperacion: input.fechaOperacion ?? new Date() } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  ).lean();
  if (movement.direccion !== input.direccion || movement.base !== input.base || movement.categoria !== input.categoria || movement.monto !== input.monto) {
    throw new Error(`El movimiento ${input.origen}/${input.origenId}/${input.concepto} ya existe con valores diferentes; debe reversarse`);
  }
  return movement;
}

export async function reverseFinancialMovements(origen: FinancialMovementInput["origen"], origenId: string, creadoPor: unknown) {
  const originals = await models.movimientosFinancieros.find({
    origen,
    origenId,
    estado: "confirmado",
    "metadata.isReversal": { $ne: true },
    "metadata.reversedBy": { $exists: false },
  }).lean();
  for (const original of originals) {
    const reversal = await postFinancialMovement({
      direccion: original.direccion === "ingreso" ? "egreso" : "ingreso",
      base: original.base,
      origen,
      origenId,
      concepto: `reverso:${String(original._id)}`,
      categoria: original.categoria,
      monto: original.monto,
      estado: "confirmado",
      fechaOperacion: new Date(),
      clienteId: original.clienteId,
      proveedorId: original.proveedorId,
      asesorId: original.asesorId,
      creadoPor,
      metadata: { isReversal: true, reversesMovementId: String(original._id) },
    });
    await models.movimientosFinancieros.updateOne(
      { _id: original._id, "metadata.reversedBy": { $exists: false } },
      { $set: { "metadata.reversedBy": String(reversal._id), "metadata.reversedAt": new Date() } }
    );
  }
}

export async function resumenFinanciero(desde: Date, hasta: Date, base: "devengado" | "caja" = "devengado") {
  const rows = await models.movimientosFinancieros.aggregate([
    { $match: { base, estado: "confirmado", fechaOperacion: { $gte: desde, $lt: hasta } } },
    { $group: { _id: "$direccion", total: { $sum: "$monto" }, cantidad: { $sum: 1 } } },
  ]);
  const ingresos = Number(rows.find((item: any) => item._id === "ingreso")?.total || 0);
  const egresos = Number(rows.find((item: any) => item._id === "egreso")?.total || 0);
  return { ingresos, egresos, utilidad: ingresos - egresos };
}
