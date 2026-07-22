import crypto from "crypto";
import { models } from "../models/index.js";
import { env } from "../config/env.js";
import { getCurrentAuthUser } from "../middleware/auth.middleware.js";
import { sendGestionCompraConfirmacion, sendRecepcionBodegaCliente } from "./email.service.js";
import { enviarWebhookCompraRegistrada } from "./ghl-webhook.service.js";
import { calculateFee } from "./fee.service.js";

export type GestionCompraEstado = "borrador" | "activa" | "completado" | "cancelado";
export type GestionCompraStage = "solicitada" | "revisando" | "comprada" | "en_transito" | "entregada";

export interface GestionCompraFotoInput {
  url: string;
  title?: string;
  createdAt?: string | Date;
}

const ADMIN_ROLES = ["admin", "superadmin", "gerencia", "bodega"];

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
    valorTotal: input.valorTotal,
    valorReserva: input.valorReserva,
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

  // Fire-and-forget notifications
  sendNotificacionCliente(String(gestion._id)).catch((err) =>
    console.error("[gestion_compra] notification error:", err)
  );

  return gestion;
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
  } = {}
) {
  const filter: Record<string, any> = {};

  // Role-based filtering
  if (!ADMIN_ROLES.includes(role)) {
    filter.asesorId = userId;
  } else if (opts.asesorId) {
    filter.asesorId = opts.asesorId;
  }

  if (opts.estado) filter.estado = opts.estado;

  // Date filter for monthly view
  if (opts.mes !== undefined && opts.año !== undefined) {
    const start = new Date(opts.año, opts.mes - 1, 1);
    const end = new Date(opts.año, opts.mes, 1);
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
  return models.gestionesCompra
    .findOne({ viewToken: token })
    .populate("contactoId", "nombre email telefono")
    .populate("asesorId", "name email")
    .populate("cuentaBancariaId", "banco titular")
    .lean();
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
    stage: input.stage,
    notas: input.notas,
    estado: input.estado,
  };

  if (isAdmin) {
    if (input.valorTotal !== undefined) allowed.valorTotal = input.valorTotal;
    if (input.valorReserva !== undefined) allowed.valorReserva = input.valorReserva;
    if (input.cuentaBancariaId !== undefined) allowed.cuentaBancariaId = input.cuentaBancariaId;
    if (input.costoVenta !== undefined) allowed.costoVenta = input.costoVenta;
    if (input.valorComision !== undefined) allowed.valorComision = input.valorComision;
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
      { new: true }
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

export async function getEstadisticasMensuales(
  año: number,
  mes: number,
  asesorId?: string
): Promise<{
  totalGestiones: number;
  sumaValorTotal: number;
  sumaComision: number;
  sumaCostoVenta: number;
  porEstado: Record<string, number>;
}> {
  const start = new Date(año, mes - 1, 1);
  const end = new Date(año, mes, 1);

  const matchStage: Record<string, any> = {
    createdAt: { $gte: start, $lt: end },
    estado: { $ne: "cancelado" },
  };
  if (asesorId) matchStage.asesorId = asesorId;

  const [stats, porEstado] = await Promise.all([
    models.gestionesCompra.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalGestiones: { $sum: 1 },
          sumaValorTotal: { $sum: "$valorTotal" },
          sumaComision: { $sum: "$valorComision" },
          sumaCostoVenta: { $sum: "$costoVenta" },
        },
      },
    ]),
    models.gestionesCompra.aggregate([
      { $match: { createdAt: { $gte: start, $lt: end }, ...(asesorId ? { asesorId } : {}) } },
      { $group: { _id: "$estado", count: { $sum: 1 } } },
    ]),
  ]);

  const estadoMap: Record<string, number> = {};
  for (const item of porEstado) {
    estadoMap[item._id] = item.count;
  }

  const result = stats[0] ?? {
    totalGestiones: 0,
    sumaValorTotal: 0,
    sumaComision: 0,
    sumaCostoVenta: 0,
  };

  return {
    totalGestiones: result.totalGestiones,
    sumaValorTotal: result.sumaValorTotal,
    sumaComision: result.sumaComision,
    sumaCostoVenta: result.sumaCostoVenta,
    porEstado: estadoMap,
  };
}

export async function sendNotificacionCliente(gestionId: string): Promise<void> {
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

  // 1. Email
  if (contacto?.email) {
    await sendGestionCompraConfirmacion({
      to: contacto.email,
      clientName: contacto.nombre,
      gestionId: String(gestion._id),
      valorTotal: gestion.valorTotal,
      fechaEntregaTentativa: gestion.fechaEntregaTentativa,
      paginaCompra: gestion.paginaCompra,
      imagenCompraUrl: gestion.imagenCompraUrl,
      viewUrl,
      asesorNombre: asesor?.name ?? "Courier Box",
    });
  }

  // 2. GHL Webhook
  if (contacto?.telefono || contacto?.email) {
    await enviarWebhookCompraRegistrada({
      gestionId: String(gestion._id),
      clienteNombre: contacto.nombre,
      clienteTelefono: contacto?.telefono ?? "",
      clienteEmail: contacto?.email ?? "",
      valorTotal: gestion.valorTotal,
      fechaEntregaTentativa: gestion.fechaEntregaTentativa,
      viewUrl,
      asesorNombre: asesor?.name ?? "Courier Box",
    });
  }

  // Mark notification sent
  await models.gestionesCompra.findByIdAndUpdate(gestionId, {
    $set: { notificacionEnviada: true },
    $push: {
      auditLog: {
        timestamp: new Date(),
        action: "notificacion_enviada",
        userId: "system",
        userName: "Sistema",
        notes: `Notificación enviada a ${contacto?.email ?? contacto?.telefono ?? "cliente"}`,
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

  const set: Record<string, any> = { stage: "comprada" };
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
      await sendRecepcionBodegaCliente({
        to: contacto.email,
        clientName: contacto.nombre,
        fotos: fotos.length ? fotos : nuevasFotos.map((f) => f.url).filter(Boolean),
        viewUrl,
        asesorNombre: asesor?.name ?? "Courier Box",
        notas: input.notas,
        entregaEstimada: input.entregaEstimada,
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
