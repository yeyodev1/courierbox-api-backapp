import crypto from "crypto";
import { Types } from "mongoose";
import { models } from "../models/index.js";
import { env } from "../config/env.js";
import { getCurrentAuthUser } from "../middleware/auth.middleware.js";
import { createAndSendNotification } from "./notification.service.js";
import { postFinancialMovement } from "./financial-movement.service.js";
import { calculateFee } from "./fee.service.js";

export type GestionCompraEstado = "borrador" | "activa" | "completado" | "cancelado";
export type GestionCompraStage = "solicitada" | "revisando" | "comprada" | "en_transito" | "entregada";

export interface GestionCompraFotoInput {
  url: string;
  title?: string;
  createdAt?: string | Date;
}

const ADMIN_ROLES = ["admin", "superadmin", "gerencia"];
const ALL_RECORDS_ROLES = [...ADMIN_ROLES, "bodega"];

export interface CreateGestionCompraInput {
  asesorId: string;
  contactoId: string;
  valorTotal: number;
  valorReserva: number;
  cuentaBancariaId: string;
  costoVenta: number;
  valorComision: number;
  feeConfigId?: string;
  paginaCompra: string;
  fechaEntregaTentativa: string; // ISO string
  imagenCompraUrl?: string;
  fotosRelacionadas?: GestionCompraFotoInput[];
  stage?: GestionCompraStage;
  notas?: string;
  estado?: GestionCompraEstado;
  tipoServicio?: "logistica" | "compra_total";
  prioridad?: "normal" | "alta" | "urgente";
  fechaLimiteCompra?: string;
  productos?: Array<{
    tienda: string;
    enlace?: string;
    descripcion: string;
    cantidad?: number;
    variante?: string;
    valorUnitario?: number;
    valorEnvio?: number;
    peso?: number;
  }>;
  createdByUserId: string;
  createdByUserName: string;
}

export interface UpdateGestionCompraInput {
  // Financials — admin only
  valorTotal?: number;
  valorReserva?: number;
  cuentaBancariaId?: string;
  costoVenta?: number;
  valorComision?: number;
  // Asesor can edit these
  paginaCompra?: string;
  fechaEntregaTentativa?: string;
  imagenCompraUrl?: string;
  fotosRelacionadas?: GestionCompraFotoInput[];
  stage?: GestionCompraStage;
  notas?: string;
  estado?: GestionCompraEstado;
}

async function resolveAuthIdentity(input: CreateGestionCompraInput) {
  const authUser = getCurrentAuthUser() as {
    userId?: string;
    id?: string;
    _id?: string;
    email?: string;
    name?: string;
    fullName?: string;
  } | undefined;

  const directUserId = String(input.createdByUserId ?? authUser?.userId ?? authUser?.id ?? authUser?._id ?? "").trim();
  const directUserName = String(input.createdByUserName ?? authUser?.name ?? authUser?.fullName ?? authUser?.email ?? "").trim();

  if (!directUserId && !directUserName) return null;

  if (directUserId) {
    const user = await models.users.findById(directUserId).select("name email").lean();
    return {
      userId: String(user?._id ?? directUserId),
      userName: String(user?.name || user?.email || directUserName || "Usuario"),
    };
  }

  if (directUserName) {
    const user = await models.users.findOne({ email: directUserName.toLowerCase() }).select("_id name email").lean();
    if (user) {
      return {
        userId: String(user._id),
        userName: String(user.name || user.email || directUserName),
      };
    }
  }

  return null;
}

export async function createGestionCompra(input: CreateGestionCompraInput) {
  const auth = await resolveAuthIdentity(input);
  if (!auth) {
    throw new Error("Unauthorized: missing creator user");
  }

  const asesorId = String(input.asesorId ?? auth.userId ?? "").trim();
  if (!asesorId) {
    throw new Error("Unauthorized: missing asesor user");
  }

  const gestion = await models.gestionesCompra.create({
    asesorId,
    contactoId: input.contactoId,
    tipoServicio: input.tipoServicio ?? "compra_total",
    prioridad: input.prioridad ?? "normal",
    fechaLimiteCompra: input.fechaLimiteCompra ? new Date(input.fechaLimiteCompra) : undefined,
    productos: input.productos ?? [],
    valorTotal: input.valorTotal,
    valorReserva: input.valorReserva,
    valorPagado: 0,
    cuentaBancariaId: input.cuentaBancariaId,
    costoVenta: input.costoVenta,
    valorComision: input.valorComision,
    feeConfigId: input.feeConfigId,
    paginaCompra: input.paginaCompra,
    fechaEntregaTentativa: new Date(input.fechaEntregaTentativa),
    imagenCompraUrl: input.imagenCompraUrl,
    fotosRelacionadas: input.fotosRelacionadas?.map((photo) => ({
      url: photo.url,
      title: photo.title,
      createdAt: photo.createdAt ? new Date(photo.createdAt) : new Date(),
    })) ?? (input.imagenCompraUrl ? [{ url: input.imagenCompraUrl, title: "Imagen principal", createdAt: new Date() }] : []),
    stage: input.stage ?? "solicitada",
    estadoPago: "pendiente",
    estadoCompra: "pendiente",
    estadoBodega: "pendiente",
    estadoEntrega: "sin_envio",
    notas: input.notas,
    estado: input.estado ?? "activa",
    auditLog: [
      {
        timestamp: new Date(),
        action: "creado",
        userId: auth.userId,
        userName: auth.userName,
        notes: "Gestión de compra creada",
      },
    ],
  });

  try {
    await sendNotificacionCliente(String(gestion._id));
  } catch (err) {
    console.error("[gestion_compra] notification persistence error:", err);
  }

  return gestion;
}

/** Búsqueda libre por cliente (nombre, email, teléfono o cédula). Devuelve el filtro a mezclar en `contactoId`. */
export async function buildContactoSearchFilter(q?: string): Promise<Record<string, any>> {
  const term = (q ?? "").trim();
  if (!term) return {};
  const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const contactos = await models.contactos
    .find({ $or: [{ nombre: regex }, { email: regex }, { telefono: regex }, { cedula: regex }] })
    .select("_id")
    .lean();
  return { contactoId: { $in: contactos.map((c) => c._id) } };
}

export async function listGestiones(
  role: string,
  userId: string,
  opts: {
    page?: number;
    limit?: number;
    estado?: string;
    asesorId?: string;
    mes?: number;
    año?: number;
    q?: string;
  } = {}
) {
  const filter: Record<string, any> = { ...(await buildContactoSearchFilter(opts.q)) };

  // Role-based filtering
  if (!ALL_RECORDS_ROLES.includes(role)) {
    filter.asesorId = userId;
  } else if (opts.asesorId) {
    filter.asesorId = opts.asesorId;
  }

  if (opts.estado) filter.estado = opts.estado;

  // Date filter for monthly view
  if (opts.año !== undefined) {
    const start = opts.mes !== undefined ? new Date(opts.año, opts.mes - 1, 1) : new Date(opts.año, 0, 1);
    const end = opts.mes !== undefined ? new Date(opts.año, opts.mes, 1) : new Date(opts.año + 1, 0, 1);
    filter.createdAt = { $gte: start, $lt: end };
  }

  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(opts.limit ?? 20, 100);
  const skip = (page - 1) * limit;

  const [gestiones, total] = await Promise.all([
    models.gestionesCompra
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("contactoId", "nombre email telefono")
      .populate("asesorId", "name email")
      .populate("cuentaBancariaId", "banco numeroCuenta titular")
      .lean(),
    models.gestionesCompra.countDocuments(filter),
  ]);

  return { gestiones, total, page, limit, pages: Math.ceil(total / limit) };
}

export async function listAllGestionesForExport(
  role: string,
  userId: string,
  opts: {
    estado?: string;
    asesorId?: string;
    mes?: number;
    año?: number;
    q?: string;
  } = {}
) {
  const filter: Record<string, any> = { ...(await buildContactoSearchFilter(opts.q)) };

  if (!ALL_RECORDS_ROLES.includes(role)) {
    filter.asesorId = userId;
  } else if (opts.asesorId) {
    filter.asesorId = opts.asesorId;
  }

  if (opts.estado) filter.estado = opts.estado;

  if (opts.año !== undefined) {
    const start = opts.mes !== undefined ? new Date(opts.año, opts.mes - 1, 1) : new Date(opts.año, 0, 1);
    const end = opts.mes !== undefined ? new Date(opts.año, opts.mes, 1) : new Date(opts.año + 1, 0, 1);
    filter.createdAt = { $gte: start, $lt: end };
  }

  return models.gestionesCompra
    .find(filter)
    .sort({ createdAt: -1 })
    .populate("contactoId", "nombre email telefono")
    .populate("asesorId", "name email")
    .populate("cuentaBancariaId", "banco numeroCuenta titular")
    .lean();
}

export async function getGestionById(id: string) {
  return models.gestionesCompra
    .findById(id)
    .populate("contactoId", "nombre email telefono notas")
    .populate("asesorId", "name email")
    .populate("cuentaBancariaId", "banco numeroCuenta titular tipoCuenta")
    .populate("feeConfigId", "name ruleType fixedAmount percentage")
    .lean();
}

export async function getGestionByViewToken(token: string) {
  const gestion = await models.gestionesCompra
    .findOne({ viewToken: token })
    .populate("contactoId", "nombre email telefono")
    .populate("asesorId", "name email")
    .populate("cuentaBancariaId", "banco titular")
    .lean();
  if (!gestion) return null;
  if (gestion.viewTokenExpiresAt && new Date(gestion.viewTokenExpiresAt) <= new Date()) return null;
  if (!gestion.viewTokenExpiresAt) {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await models.gestionesCompra.findByIdAndUpdate(gestion._id, { $set: { viewTokenExpiresAt: expiresAt } });
    gestion.viewTokenExpiresAt = expiresAt;
  }
  return gestion;
}

export async function updateGestion(
  id: string,
  role: string,
  input: UpdateGestionCompraInput,
  userId: string,
  userName: string
) {
  const isAdmin = ADMIN_ROLES.includes(role);

  const allowed: Record<string, any> = {
    paginaCompra: input.paginaCompra,
    fechaEntregaTentativa: input.fechaEntregaTentativa
      ? new Date(input.fechaEntregaTentativa)
      : undefined,
    imagenCompraUrl: input.imagenCompraUrl,
    fotosRelacionadas: input.fotosRelacionadas,
    notas: input.notas,
  };

  if (isAdmin) {
    if (input.valorTotal !== undefined) allowed.valorTotal = input.valorTotal;
    if (input.valorReserva !== undefined) allowed.valorReserva = input.valorReserva;
    if (input.cuentaBancariaId !== undefined) allowed.cuentaBancariaId = input.cuentaBancariaId;
    if (input.costoVenta !== undefined) allowed.costoVenta = input.costoVenta;
    if (input.valorComision !== undefined) allowed.valorComision = input.valorComision;
    if (input.stage !== undefined) allowed.stage = input.stage;
    if (input.estado !== undefined) allowed.estado = input.estado;
  }

  const existing = await models.gestionesCompra.findById(id).select("valorTotal valorReserva").lean();
  if (!existing) return null;
  const resultingTotal = Number(input.valorTotal ?? existing.valorTotal);
  const resultingReservation = Number(input.valorReserva ?? existing.valorReserva);
  if (resultingReservation < 0 || resultingReservation > resultingTotal) {
    throw new Error("La reserva debe estar entre cero y el valor total");
  }

  // Remove undefined fields
  const update: Record<string, any> = {};
  for (const [k, v] of Object.entries(allowed)) {
    if (v !== undefined) update[k] = v;
  }

  const auditEntry = {
    timestamp: new Date(),
    action: "actualizado",
    userId,
    userName,
    notes: `Campos actualizados: ${Object.keys(update).join(", ")}`,
  };

  return models.gestionesCompra
    .findByIdAndUpdate(
      id,
      { $set: update, $push: { auditLog: auditEntry } },
      { new: true, runValidators: true }
    )
    .populate("contactoId", "nombre email telefono")
    .populate("asesorId", "name email")
    .populate("cuentaBancariaId", "banco numeroCuenta titular")
    .lean();
}

export async function confirmarReserva(id: string, userId: string, userName: string) {
  return models.gestionesCompra
    .findByIdAndUpdate(
      id,
      {
        $set: { reservaConfirmada: true },
        $push: {
          auditLog: {
            timestamp: new Date(),
            action: "reserva_confirmada",
            userId,
            userName,
            notes: "Reserva confirmada por administrador",
          },
        },
      },
      { new: true }
    )
    .lean();
}

/**
 * Register a payment against the balance.
 *
 * Payment used to be a single irreversible step: `confirmarPago` refused to run
 * twice, so a client who left a deposit and came back to settle up had nowhere to
 * put the second figure — the gestión kept reading as if the deposit were the
 * whole price, and "cuánto me deben por gestiones de compra" had no answer in the
 * data. Payments accumulate now, and the state follows the arithmetic: `parcial`
 * while something is still owed, `confirmado` once the balance reaches zero.
 *
 * Each abono posts its own income movement, dated when the money actually came
 * in, so the income statement tracks the cash rather than jumping the whole sale
 * on the day it happened to be settled. The commission posts once, when the
 * gestión is fully paid — it is earned on the sale, not on each instalment.
 */
export async function registrarAbono(
  id: string,
  input: {
    monto: number;
    fecha?: Date | string;
    metodo?: string;
    referencia?: string;
    notas?: string;
  },
  userId: string,
  userName: string
) {
  const monto = Math.round(Number(input.monto) * 100) / 100;
  if (!Number.isFinite(monto) || monto <= 0) {
    throw new Error("El abono debe ser mayor a cero");
  }

  const gestion = await models.gestionesCompra.findById(id).lean();
  if (!gestion) return null;
  if (gestion.estado === "cancelado") {
    throw new Error("No se pueden registrar abonos en una gestión cancelada");
  }

  const valorTotal = Number(gestion.valorTotal || 0);
  const pagadoPrevio = Number(gestion.valorPagado || 0);
  const saldo = Math.round((valorTotal - pagadoPrevio) * 100) / 100;
  if (saldo <= 0) {
    throw new Error("Esta gestión ya está pagada por completo");
  }
  if (monto > saldo) {
    throw new Error(`El abono supera el saldo pendiente de $${saldo.toFixed(2)}`);
  }

  const pagadoTotal = Math.round((pagadoPrevio + monto) * 100) / 100;
  const saldado = pagadoTotal >= valorTotal;
  const fecha = input.fecha ? new Date(input.fecha) : new Date();
  const abonoId = new Types.ObjectId();

  const set: Record<string, unknown> = {
    valorPagado: pagadoTotal,
    estadoPago: saldado ? "confirmado" : "parcial",
    // Any money in settles the reserve; there is nothing left to confirm separately.
    reservaConfirmada: true,
  };
  if (saldado) {
    set.pagoConfirmadoEn = new Date();
    set.pagoConfirmadoPor = userId;
  }

  // Guarded on the balance we read, so two people registering at once cannot
  // between them take the gestión past its own total.
  const updated = await models.gestionesCompra
    .findOneAndUpdate(
      { _id: id, valorPagado: pagadoPrevio },
      {
        $set: set,
        $push: {
          abonos: {
            _id: abonoId,
            monto,
            fecha,
            metodo: input.metodo ?? "transferencia",
            referencia: input.referencia ?? "",
            notas: input.notas ?? "",
            registradoPor: userId,
            registradoPorNombre: userName,
            createdAt: new Date(),
          },
          auditLog: {
            timestamp: new Date(),
            action: saldado ? "pago_completado" : "abono_registrado",
            userId,
            userName,
            notes: `Abono de $${monto.toFixed(2)}. Saldo pendiente: $${(valorTotal - pagadoTotal).toFixed(2)}`,
          },
        },
      },
      { new: true, runValidators: true }
    )
    .populate("contactoId", "nombre email telefono")
    .populate("asesorId", "name email")
    .lean();

  if (!updated) {
    throw new Error("El saldo cambió mientras registrabas el abono; vuelve a intentarlo");
  }

  const clienteId = typeof updated.contactoId === "object" ? (updated.contactoId as any)._id : updated.contactoId;
  const asesorRef = typeof updated.asesorId === "object" ? (updated.asesorId as any)._id : updated.asesorId;

  await postFinancialMovement({
    direccion: "ingreso",
    base: "devengado",
    origen: "gestion",
    origenId: id,
    // Unique per abono: movements are keyed by concepto, and a shared one would
    // silently collapse every instalment into the first.
    concepto: `abono:${String(abonoId)}`,
    categoria: "GESTION_COMPRA",
    monto,
    estado: "confirmado",
    fechaOperacion: fecha,
    fechaPago: fecha,
    clienteId,
    asesorId: asesorRef,
    creadoPor: userId,
    metadata: { abonoId: String(abonoId), saldoPendiente: Math.round((valorTotal - pagadoTotal) * 100) / 100 },
  });

  if (saldado) {
    await postFinancialMovement({
      direccion: "egreso",
      base: "devengado",
      origen: "gestion",
      origenId: id,
      concepto: "comision_asesor",
      categoria: "COMISION",
      monto: Number(updated.valorComision || 0),
      estado: "confirmado",
      fechaOperacion: updated.pagoConfirmadoEn ?? new Date(),
      asesorId: asesorRef,
      creadoPor: userId,
    });

    const contacto = updated.contactoId as any;
    if (contacto?.email) {
      await createAndSendNotification({
        evento: "pago_confirmado",
        destinatario: contacto.email,
        destinatarioTelefono: contacto.telefono || "",
        destinatarioNombre: contacto.nombre || "",
        operacionTipo: "gestion_compra",
        operacionId: id,
        payload: {
          to: contacto.email,
          clientName: contacto.nombre,
          subject: "Pago confirmado por Courier Box",
          title: "Pago confirmado",
          message: `Confirmamos tu pago de $${valorTotal.toFixed(2)}. Tu gestión continuará al proceso de compra.`,
          viewUrl: `${env.FRONTEND_ORIGIN[0] ?? "https://courierboxlogistics.com"}/compra/${updated.viewToken}`,
        },
      });
    }
  }

  return updated;
}

/**
 * Settle the whole outstanding balance in one entry. Kept as its own endpoint
 * because the screen offers it as a button, but it is an abono like any other —
 * one code path decides what a payment does to a gestión.
 */
export async function confirmarPago(id: string, monto: number, userId: string, userName: string) {
  const gestion = await models.gestionesCompra.findById(id).select("valorTotal valorPagado").lean();
  if (!gestion) return null;
  const saldo = Math.round((Number(gestion.valorTotal || 0) - Number(gestion.valorPagado || 0)) * 100) / 100;
  const importe = Number.isFinite(monto) && monto > 0 ? monto : saldo;
  return registrarAbono(id, { monto: importe }, userId, userName);
}

export async function asignarComprador(id: string, compradorId: string, userId: string, userName: string) {
  const comprador = await models.users.findOne({ _id: compradorId, activo: { $ne: false }, role: { $in: ["admin", "gerencia", "superadmin", "asesor"] } }).select("name email").lean();
  if (!comprador) throw new Error("Comprador no válido");
  return models.gestionesCompra.findByIdAndUpdate(
    id,
    {
      $set: { compradorAsignadoId: compradorId, estadoCompra: "asignada", stage: "revisando" },
      $push: { auditLog: { timestamp: new Date(), action: "comprador_asignado", userId, userName, notes: `Asignado a ${comprador.name || comprador.email}` } },
    },
    { new: true, runValidators: true }
  ).populate("compradorAsignadoId", "name email").lean();
}

export async function marcarComprada(id: string, numeroOrden: string, userId: string, userName: string) {
  const updated = await models.gestionesCompra.findOneAndUpdate(
    { _id: id, estadoCompra: { $in: ["asignada", "comprando", "pendiente"] } },
    {
      $set: { estadoCompra: "comprada", stage: "comprada" },
      $push: { auditLog: { timestamp: new Date(), action: "compra_realizada", userId, userName, notes: numeroOrden ? `Orden ${numeroOrden}` : "Compra realizada" } },
    },
    { new: true, runValidators: true }
  ).populate("contactoId", "nombre email telefono").lean();
  if (!updated) return null;
  const contacto = updated.contactoId as any;
  if (contacto?.email) {
    await createAndSendNotification({
      evento: "compra_realizada",
      destinatario: contacto.email,
      destinatarioTelefono: contacto.telefono || "",
      destinatarioNombre: contacto.nombre || "",
      operacionTipo: "gestion_compra",
      operacionId: id,
      payload: {
        to: contacto.email,
        clientName: contacto.nombre,
        subject: "Tu compra fue realizada",
        title: "Compra realizada",
        message: numeroOrden ? `Tu compra fue realizada con el número de orden ${numeroOrden}.` : "Tu compra fue realizada exitosamente.",
        viewUrl: `${env.FRONTEND_ORIGIN[0] ?? "https://courierboxlogistics.com"}/compra/${updated.viewToken}`,
      },
    });
  }
  return updated;
}

export async function getEstadisticasMensuales(
  año: number,
  mes?: number,
  asesorId?: string,
  q?: string
): Promise<{
  totalGestiones: number;
  sumaValorTotal: number;
  sumaComision: number;
  sumaCostoVenta: number;
  sumaMargenNeto: number;
  sumaValorPagado: number;
  sumaSaldoPendiente: number;
  ventasConfirmadas: number;
  comisionGanada: number;
  porEstado: Record<string, number>;
  porEstadoPago: Record<string, number>;
}> {
  const start = mes !== undefined ? new Date(año, mes - 1, 1) : new Date(año, 0, 1);
  const end = mes !== undefined ? new Date(año, mes, 1) : new Date(año + 1, 0, 1);

  // aggregate() no castea strings a ObjectId como lo hace find(); sin esto el
  // $match nunca coincide y los KPIs salen en 0 aunque el listado sí traiga filas.
  const asesorObjectId =
    asesorId && Types.ObjectId.isValid(asesorId) ? new Types.ObjectId(asesorId) : undefined;
  const asesorMatch = {
    ...(asesorObjectId ? { asesorId: asesorObjectId } : {}),
    ...(await buildContactoSearchFilter(q)),
  };

  const matchStage: Record<string, any> = {
    createdAt: { $gte: start, $lt: end },
    estado: { $ne: "cancelado" },
    ...asesorMatch,
  };

  const [stats, porEstado, porEstadoPago, confirmed] = await Promise.all([
    models.gestionesCompra.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalGestiones: { $sum: 1 },
          sumaValorTotal: { $sum: "$valorTotal" },
          sumaComision: { $sum: "$valorComision" },
          sumaCostoVenta: { $sum: "$costoVenta" },
          sumaValorPagado: { $sum: "$valorPagado" },
          // What is still owed on purchase management — the figure that had no
          // home while a gestión could only be unpaid or paid in full.
          sumaSaldoPendiente: {
            $sum: {
              $max: [0, { $subtract: ["$valorTotal", { $ifNull: ["$valorPagado", 0] }] }],
            },
          },
          sumaMargenNeto: {
            $sum: {
              $subtract: [
                { $subtract: ["$valorTotal", "$valorComision"] },
                "$costoVenta",
              ],
            },
          },
        },
      },
    ]),
    models.gestionesCompra.aggregate([
      { $match: { createdAt: { $gte: start, $lt: end }, ...asesorMatch } },
      { $group: { _id: "$estado", count: { $sum: 1 } } },
    ]),
    models.gestionesCompra.aggregate([
      { $match: matchStage },
      { $group: { _id: "$estadoPago", count: { $sum: 1 } } },
    ]),
    models.gestionesCompra.aggregate([
      { $match: { pagoConfirmadoEn: { $gte: start, $lt: end }, estadoPago: "confirmado", ...asesorMatch } },
      { $group: { _id: null, ventasConfirmadas: { $sum: "$valorPagado" }, comisionGanada: { $sum: "$valorComision" } } },
    ]),
  ]);

  const estadoMap: Record<string, number> = {};
  for (const item of porEstado) {
    estadoMap[item._id] = item.count;
  }
  const pagoMap: Record<string, number> = {};
  for (const item of porEstadoPago) pagoMap[item._id || "pendiente"] = item.count;

  const result = stats[0] ?? {
    totalGestiones: 0,
    sumaValorTotal: 0,
    sumaComision: 0,
    sumaCostoVenta: 0,
    sumaValorPagado: 0,
    sumaSaldoPendiente: 0,
    sumaMargenNeto: 0,
  };

  return {
    totalGestiones: result.totalGestiones,
    sumaValorTotal: result.sumaValorTotal,
    sumaComision: result.sumaComision,
    sumaCostoVenta: result.sumaCostoVenta,
    sumaMargenNeto: result.sumaMargenNeto,
    // Money actually received, instalments included. This was aliased to
    // `ventasConfirmadas`, which counts only gestiones paid in full — with
    // partial payments that reports every deposit taken as nothing received.
    // `ventasConfirmadas` still carries the settled-sales figure on its own key.
    sumaValorPagado: Number(result.sumaValorPagado || 0),
    sumaSaldoPendiente: Math.round(Number(result.sumaSaldoPendiente || 0) * 100) / 100,
    ventasConfirmadas: Number(confirmed[0]?.ventasConfirmadas || 0),
    comisionGanada: Number(confirmed[0]?.comisionGanada || 0),
    porEstado: estadoMap,
    porEstadoPago: pagoMap,
  };
}

export async function sendNotificacionCliente(gestionId: string, force = false): Promise<void> {
  const gestion = await models.gestionesCompra
    .findById(gestionId)
    .populate<{ contactoId: { nombre: string; email?: string; telefono?: string } }>(
      "contactoId",
      "nombre email telefono"
    )
    .populate<{ asesorId: { name: string; email: string } }>("asesorId", "name email")
    .lean();

  if (!gestion) return;

  const contacto = gestion.contactoId as any;
  const asesor = gestion.asesorId as any;

  const viewUrl = `${env.FRONTEND_ORIGIN[0] ?? "https://courierboxlogistics.com"}/compra/${gestion.viewToken}`;

  let emailSent = false;
  if (contacto?.email) {
    const notification = await createAndSendNotification({
      evento: "gestion_creada",
      destinatario: contacto.email,
      destinatarioTelefono: contacto.telefono || "",
      destinatarioNombre: contacto.nombre || "",
      operacionTipo: "gestion_compra",
      operacionId: String(gestion._id),
      force,
      payload: {
        to: contacto.email,
        clientName: contacto.nombre,
        gestionId: String(gestion._id),
        valorTotal: gestion.valorTotal,
        fechaEntregaTentativa: gestion.fechaEntregaTentativa,
        paginaCompra: gestion.paginaCompra,
        imagenCompraUrl: gestion.imagenCompraUrl,
        viewUrl,
        asesorNombre: asesor?.name ?? "Courier Box",
      },
    });
    emailSent = notification.estado === "enviada";
  }

  await models.gestionesCompra.findByIdAndUpdate(gestionId, {
    $set: { notificacionEnviada: emailSent },
    $push: {
      auditLog: {
        timestamp: new Date(),
        action: emailSent ? "notificacion_enviada" : "notificacion_fallida",
        userId: "system",
        userName: "Sistema",
        notes: emailSent
          ? `Correo enviado a ${contacto?.email}`
          : `Correo pendiente o fallido para ${contacto?.email ?? "cliente sin correo"}`,
      },
    },
  });
}

export async function registrarRecepcionBodega(
  id: string,
  input: { fotos?: GestionCompraFotoInput[]; notas?: string; enviarCorreo?: boolean; entregaEstimada?: string },
  userId: string,
  userName: string
) {
  const nuevasFotos = (input.fotos ?? []).map((photo) => ({
    url: photo.url,
    title: photo.title ?? "Recibido en bodega",
    createdAt: photo.createdAt ? new Date(photo.createdAt) : new Date(),
  }));

  const set: Record<string, any> = { stage: "comprada", estadoBodega: "recibida" };
  if (nuevasFotos[0]?.url) set.imagenCompraUrl = nuevasFotos[0].url;

  const updated = await models.gestionesCompra
    .findByIdAndUpdate(
      id,
      {
        $set: set,
        ...(nuevasFotos.length ? { $push: { fotosRelacionadas: { $each: nuevasFotos } } } : {}),
      },
      { new: true }
    )
    .populate<{ contactoId: { nombre: string; email?: string } }>("contactoId", "nombre email telefono")
    .populate<{ asesorId: { name: string } }>("asesorId", "name email")
    .lean();

  if (!updated) return null;

  // audit
  await models.gestionesCompra.findByIdAndUpdate(id, {
    $push: {
      auditLog: {
        timestamp: new Date(),
        action: "recepcion_bodega",
        userId,
        userName,
        notes: input.notas || "Producto recibido en bodega",
      },
    },
  });

  if (input.enviarCorreo !== false) {
    const contacto = updated.contactoId as any;
    const asesor = updated.asesorId as any;
    if (contacto?.email) {
      const viewUrl = `${env.FRONTEND_ORIGIN[0] ?? "https://courierboxlogistics.com"}/compra/${updated.viewToken}`;
      const fotos = (updated.fotosRelacionadas ?? []).map((f: any) => f.url).filter(Boolean);
      await createAndSendNotification({
        evento: "recepcion_bodega",
        destinatario: contacto.email,
        destinatarioTelefono: contacto.telefono || "",
        destinatarioNombre: contacto.nombre || "",
        operacionTipo: "gestion_compra",
        operacionId: String(updated._id),
        payload: {
          to: contacto.email,
          clientName: contacto.nombre,
          fotos: fotos.length ? fotos : nuevasFotos.map((f) => f.url).filter(Boolean),
          viewUrl,
          asesorNombre: asesor?.name ?? "Courier Box",
          notas: input.notas,
          entregaEstimada: input.entregaEstimada,
        },
      });
    }
  }

  return updated;
}

export async function calcularComisionPreview(
  valorTotal: number,
  feeConfigId?: string
): Promise<{ valorComision: number; feeConfigNombre: string }> {
  try {
    const result = await calculateFee({
      productValue: valorTotal,
      shippingValue: 0,
      configId: feeConfigId,
    });
    return {
      valorComision: result.feeAmount,
      feeConfigNombre: result.configName ?? "Regla por defecto",
    };
  } catch {
    return { valorComision: 0, feeConfigNombre: "Sin regla" };
  }
}
