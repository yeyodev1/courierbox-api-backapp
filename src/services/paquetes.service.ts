import mongoose from "mongoose";
import { models } from "../models/index";
import type { EstadoPaquete } from "../models/paquete.model";

/**
 * Warehouses: la lista de todas las cajas que entraron, como la tenía la
 * plataforma anterior (Multitrack). Cada caja es un "warehouse" identificado
 * por su WR. Desde aquí se busca, se revisa el detalle y se imprimen las
 * etiquetas 4×6 de bodega.
 */

const ESTADOS: EstadoPaquete[] = ["importado", "pendiente_validacion", "validado", "facturado", "pagado", "despachado"];

export interface FiltrosPaquetes {
  q?: string;
  estado?: string;
  agencia?: string;
  /** "si" | "no": con factura o pendiente de facturar. */
  facturado?: string;
  desde?: string;
  hasta?: string;
  mg?: string;
  page?: number;
  limit?: number;
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Fecha "YYYY-MM-DD" a medianoche de Ecuador (UTC-5, sin horario de verano). */
function inicioDiaEcuador(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const d = new Date(`${ymd}T00:00:00-05:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Arma el filtro de Mongo. Separado para poder probarlo sin base de datos. */
export async function construirFiltro(
  f: FiltrosPaquetes,
  buscarClientes: (rx: RegExp) => Promise<mongoose.Types.ObjectId[]>
): Promise<Record<string, unknown>> {
  const filtro: Record<string, unknown> = {};

  if (f.estado && ESTADOS.includes(f.estado as EstadoPaquete)) filtro.estado = f.estado;
  if (f.agencia?.trim()) {
    const partes = f.agencia.trim().split(/\s+/).map(escapar).join("\\s+");
    filtro.agencia = new RegExp(`^\\s*${partes}\\s*$`, "i");
  }
  if (f.mg) filtro.mg = new RegExp(escapar(f.mg.trim()), "i");
  if (f.facturado === "si") filtro.facturaId = { $ne: null };
  if (f.facturado === "no") filtro.facturaId = null;

  const desde = f.desde ? inicioDiaEcuador(f.desde) : null;
  const hastaInicio = f.hasta ? inicioDiaEcuador(f.hasta) : null;
  if (desde || hastaInicio) {
    const rango: Record<string, Date> = {};
    if (desde) rango.$gte = desde;
    if (hastaInicio) rango.$lt = new Date(hastaInicio.getTime() + 24 * 60 * 60 * 1000);
    // Las importaciones antiguas no traen fecha de ingreso: para ellas cuenta la de creación.
    filtro.$and = [
      { $or: [{ fechaIngreso: rango }, { fechaIngreso: null, createdAt: rango }] },
    ];
  }

  const term = (f.q ?? "").trim();
  if (term.length >= 2) {
    const rx = new RegExp(escapar(term), "i");
    const clienteIds = await buscarClientes(rx);
    const or: Record<string, unknown>[] = [
      { wr: rx },
      { sh: rx },
      { mg: rx },
      { trackingOriginal: rx },
      { consigneeNombre: rx },
      { contenido: rx },
    ];
    if (clienteIds.length) or.push({ masterClienteId: { $in: clienteIds } });
    filtro.$or = or;
  }

  return filtro;
}

const CAMPOS_CLIENTE = "nombreOficial codigoCasillero cedulaRuc telefono email direccion";
const CAMPOS_FACTURA = "numeroFactura estado estadoSri totalGeneral createdAt";

export async function listarPaquetes(f: FiltrosPaquetes) {
  const page = Math.max(1, Math.floor(Number(f.page) || 1));
  const limit = Math.min(200, Math.max(1, Math.floor(Number(f.limit) || 50)));

  const filtro = await construirFiltro(f, async (rx) => {
    const clientes = await models.masterClientes
      .find({ $or: [{ codigoCasillero: rx }, { nombreOficial: rx }, { cedulaRuc: rx }] })
      .select("_id")
      .limit(100)
      .lean();
    return clientes.map((c) => c._id as mongoose.Types.ObjectId);
  });

  const [paquetes, total, resumen, agencias] = await Promise.all([
    models.paquetes
      .find(filtro)
      .populate("masterClienteId", CAMPOS_CLIENTE)
      .populate("facturaId", CAMPOS_FACTURA)
      .sort({ fechaIngreso: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    models.paquetes.countDocuments(filtro),
    models.paquetes.aggregate([
      { $match: filtro },
      { $group: { _id: null, pesoLb: { $sum: "$pesoLb" }, sinFactura: { $sum: { $cond: [{ $eq: ["$facturaId", null] }, 1, 0] } } } },
    ]),
    models.paquetes.distinct("agencia"),
  ]);

  return {
    paquetes,
    total,
    page,
    limit,
    pesoTotalLb: Number((resumen[0]?.pesoLb ?? 0).toFixed(2)),
    sinFactura: resumen[0]?.sinFactura ?? 0,
    agencias: normalizarAgencias(agencias as string[]),
  };
}

/** "COURIER BOX ", "courier box" y "COURIER BOX" son la misma agencia en el filtro. */
export function normalizarAgencias(valores: string[]): string[] {
  const vistas = new Map<string, string>();
  for (const v of valores) {
    const limpio = String(v ?? "").trim().replace(/\s+/g, " ");
    if (!limpio) continue;
    const clave = limpio.toUpperCase();
    if (!vistas.has(clave)) vistas.set(clave, limpio.toUpperCase());
  }
  return [...vistas.values()].sort();
}

export async function detallePaquete(id: string) {
  if (!mongoose.isValidObjectId(id)) return null;
  return models.paquetes
    .findById(id)
    .populate("masterClienteId", CAMPOS_CLIENTE)
    .populate("facturaId", CAMPOS_FACTURA)
    .lean();
}

/** Lo que va impreso en cada etiqueta, en el orden en que se pidieron. */
export async function datosEtiquetas(ids: string[]) {
  const validos = ids.filter((id) => mongoose.isValidObjectId(id)).slice(0, 500);
  if (!validos.length) return [];
  const paquetes = await models.paquetes
    .find({ _id: { $in: validos } })
    .populate("masterClienteId", "nombreOficial codigoCasillero telefono direccion")
    .lean();
  const porId = new Map(paquetes.map((p) => [String(p._id), p]));
  return validos.map((id) => porId.get(id)).filter(Boolean);
}
