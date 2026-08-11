import mongoose from "mongoose";
import { models } from "../models/index";
import type { IRetiroItem } from "../models/retiro_counter.model";
import { logger } from "../utils/logger";
import { htmlToPdf } from "./pdf.service";
import { uploadComprobanteRetiro, uploadFirmaDataUrl } from "./upload.service";
import { createAndSendNotification } from "./notification.service";
import { env } from "../config/env";

export interface RetiroItemInput {
  paqueteId?: string;
  gestionCompraId?: string;
  envioDomicilioId?: string;
  referencia?: string;
  descripcion?: string;
  pesoLb?: number;
  valor?: number;
}

export interface CrearRetiroInput {
  masterClienteId?: string;
  contactoId?: string;
  clienteNombre: string;
  clienteIdentificacion?: string;
  clienteEmail?: string;
  clienteTelefono?: string;
  codigoCasillero?: string;
  items: RetiroItemInput[];
  /** `data:image/png;base64,...` straight from the signature canvas. */
  firmaDataUrl: string;
  retiradoPorNombre?: string;
  retiradoPorCedula?: string;
  retiradoPorParentesco?: string;
  observaciones?: string;
  atendidoPor: string;
  atendidoPorNombre?: string;
}

function money(n: number): string {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c] || c
  );
}

/**
 * Rejects packages already released on another signed retiro. Checked before
 * anything is written so a double-release fails loudly instead of silently
 * producing two receipts for the same box.
 */
async function assertPaquetesDisponibles(paqueteIds: string[]): Promise<void> {
  if (paqueteIds.length === 0) return;

  const yaRetirados = await models.retirosCounter
    .find({ estado: "firmado", "items.paqueteId": { $in: paqueteIds } })
    .select("items.paqueteId firmadoEn")
    .lean();

  if (yaRetirados.length === 0) return;

  const conflictivos = new Set<string>();
  for (const retiro of yaRetirados) {
    for (const item of retiro.items ?? []) {
      const id = item.paqueteId ? String(item.paqueteId) : "";
      if (id && paqueteIds.includes(id)) conflictivos.add(id);
    }
  }

  if (conflictivos.size > 0) {
    throw Object.assign(
      new Error(`Estos paquetes ya fueron retirados: ${[...conflictivos].join(", ")}`),
      { status: 409 }
    );
  }
}

export function buildComprobanteHtml(retiro: {
  _id: unknown;
  clienteNombre: string;
  clienteIdentificacion: string;
  codigoCasillero: string;
  items: IRetiroItem[];
  totalPaquetes: number;
  totalPesoLb: number;
  totalValor: number;
  retiradoPorNombre: string;
  retiradoPorCedula: string;
  retiradoPorParentesco: string;
  observaciones: string;
  firmaUrl: string;
  atendidoPorNombre: string;
  firmadoEn: Date;
}): string {
  const fecha = new Date(retiro.firmadoEn).toLocaleString("es-EC", {
    dateStyle: "long",
    timeStyle: "short",
  });
  const folio = String(retiro._id).slice(-8).toUpperCase();

  const filas = retiro.items
    .map(
      (item, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td><strong>${escapeHtml(item.referencia)}</strong></td>
          <td>${escapeHtml(item.descripcion)}</td>
          <td class="num">${(Number(item.pesoLb) || 0).toFixed(2)}</td>
          <td class="num">${money(item.valor)}</td>
        </tr>`
    )
    .join("");

  const retiradoPorBloque =
    retiro.retiradoPorNombre && retiro.retiradoPorNombre !== retiro.clienteNombre
      ? `<div class="row"><span>Retirado por</span><strong>${escapeHtml(retiro.retiradoPorNombre)}${
          retiro.retiradoPorCedula ? ` · CI ${escapeHtml(retiro.retiradoPorCedula)}` : ""
        }${retiro.retiradoPorParentesco ? ` (${escapeHtml(retiro.retiradoPorParentesco)})` : ""}</strong></div>`
      : "";

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: Helvetica, Arial, sans-serif; color: #111; margin: 0; padding: 28px; font-size: 12px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #F08A1F; padding-bottom: 14px; }
  .brand { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
  .brand small { display: block; font-size: 11px; font-weight: 400; color: #666; letter-spacing: 0.08em; text-transform: uppercase; }
  .folio { text-align: right; font-size: 11px; color: #444; }
  .folio strong { display: block; font-size: 16px; color: #111; }
  h1 { font-size: 15px; margin: 22px 0 10px; }
  .grid { display: flex; gap: 28px; margin-bottom: 18px; }
  .grid > div { flex: 1; }
  .row { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #eee; }
  .row span { color: #666; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th { text-align: left; background: #f6f6f6; padding: 7px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #555; border-bottom: 1px solid #ddd; }
  td { padding: 7px 8px; border-bottom: 1px solid #eee; }
  td.num, th.num { text-align: right; }
  tfoot td { font-weight: 700; background: #fbfbfb; }
  .sign { margin-top: 34px; display: flex; gap: 40px; align-items: flex-end; }
  .sign-box { flex: 1; text-align: center; }
  .sign-box img { max-height: 90px; max-width: 100%; }
  .sign-line { border-top: 1px solid #333; margin-top: 6px; padding-top: 5px; color: #555; }
  .notes { margin-top: 18px; padding: 10px 12px; background: #fff8ef; border-left: 3px solid #F08A1F; }
  .legal { margin-top: 22px; font-size: 9.5px; color: #777; line-height: 1.5; }
</style></head>
<body>
  <div class="head">
    <div class="brand">Courier Box<small>Logistics</small></div>
    <div class="folio">Comprobante de retiro<strong>#${folio}</strong>${escapeHtml(fecha)}</div>
  </div>

  <div class="grid">
    <div>
      <h1>Cliente</h1>
      <div class="row"><span>Nombre</span><strong>${escapeHtml(retiro.clienteNombre)}</strong></div>
      <div class="row"><span>Cédula / RUC</span><strong>${escapeHtml(retiro.clienteIdentificacion || "—")}</strong></div>
      <div class="row"><span>Casillero</span><strong>${escapeHtml(retiro.codigoCasillero || "—")}</strong></div>
      ${retiradoPorBloque}
    </div>
    <div>
      <h1>Resumen</h1>
      <div class="row"><span>Paquetes</span><strong>${retiro.totalPaquetes}</strong></div>
      <div class="row"><span>Peso total</span><strong>${retiro.totalPesoLb.toFixed(2)} lb</strong></div>
      <div class="row"><span>Valor declarado</span><strong>${money(retiro.totalValor)}</strong></div>
      <div class="row"><span>Atendido por</span><strong>${escapeHtml(retiro.atendidoPorNombre || "Counter")}</strong></div>
    </div>
  </div>

  <h1>Paquetes entregados</h1>
  <table>
    <thead><tr><th class="num">#</th><th>Referencia</th><th>Descripción</th><th class="num">Peso (lb)</th><th class="num">Valor</th></tr></thead>
    <tbody>${filas}</tbody>
    <tfoot><tr>
      <td colspan="3">Total</td>
      <td class="num">${retiro.totalPesoLb.toFixed(2)}</td>
      <td class="num">${money(retiro.totalValor)}</td>
    </tr></tfoot>
  </table>

  ${retiro.observaciones ? `<div class="notes"><strong>Observaciones:</strong> ${escapeHtml(retiro.observaciones)}</div>` : ""}

  <div class="sign">
    <div class="sign-box">
      ${retiro.firmaUrl ? `<img src="${escapeHtml(retiro.firmaUrl)}" alt="Firma" />` : "<div style='height:90px'></div>"}
      <div class="sign-line">${escapeHtml(retiro.retiradoPorNombre || retiro.clienteNombre)}<br />Firma de quien retira</div>
    </div>
    <div class="sign-box">
      <div style="height:90px"></div>
      <div class="sign-line">${escapeHtml(retiro.atendidoPorNombre || "Counter")}<br />Courier Box Logistics</div>
    </div>
  </div>

  <p class="legal">
    Al firmar, quien retira declara haber recibido conforme los paquetes detallados y verificado su estado exterior.
    Este comprobante se genera y archiva digitalmente; su folio (#${folio}) permite auditarlo en el sistema de Courier Box Logistics.
  </p>
</body></html>`;
}

export async function crearRetiro(input: CrearRetiroInput) {
  if (!input.items?.length) {
    throw Object.assign(new Error("Selecciona al menos un paquete para el retiro"), { status: 400 });
  }
  if (!input.firmaDataUrl) {
    throw Object.assign(new Error("La firma es obligatoria"), { status: 400 });
  }

  const paqueteIds = input.items
    .map((i) => i.paqueteId)
    .filter((id): id is string => Boolean(id) && mongoose.isValidObjectId(id));

  await assertPaquetesDisponibles(paqueteIds);

  const items: IRetiroItem[] = input.items.map((item) => ({
    paqueteId: item.paqueteId && mongoose.isValidObjectId(item.paqueteId)
      ? new mongoose.Types.ObjectId(item.paqueteId)
      : undefined,
    gestionCompraId: item.gestionCompraId && mongoose.isValidObjectId(item.gestionCompraId)
      ? new mongoose.Types.ObjectId(item.gestionCompraId)
      : undefined,
    envioDomicilioId: item.envioDomicilioId && mongoose.isValidObjectId(item.envioDomicilioId)
      ? new mongoose.Types.ObjectId(item.envioDomicilioId)
      : undefined,
    referencia: item.referencia ?? "",
    descripcion: item.descripcion ?? "",
    pesoLb: Number(item.pesoLb) || 0,
    valor: Number(item.valor) || 0,
  }));

  const firma = await uploadFirmaDataUrl(input.firmaDataUrl);

  const retiro = await models.retirosCounter.create({
    masterClienteId: input.masterClienteId && mongoose.isValidObjectId(input.masterClienteId)
      ? new mongoose.Types.ObjectId(input.masterClienteId)
      : undefined,
    contactoId: input.contactoId && mongoose.isValidObjectId(input.contactoId)
      ? new mongoose.Types.ObjectId(input.contactoId)
      : undefined,
    clienteNombre: input.clienteNombre,
    clienteIdentificacion: input.clienteIdentificacion ?? "",
    clienteEmail: input.clienteEmail ?? "",
    clienteTelefono: input.clienteTelefono ?? "",
    codigoCasillero: input.codigoCasillero ?? "",
    items,
    totalPaquetes: items.length,
    totalPesoLb: items.reduce((sum, i) => sum + i.pesoLb, 0),
    totalValor: items.reduce((sum, i) => sum + i.valor, 0),
    retiradoPorNombre: input.retiradoPorNombre || input.clienteNombre,
    retiradoPorCedula: input.retiradoPorCedula ?? "",
    retiradoPorParentesco: input.retiradoPorParentesco ?? "",
    firmaUrl: firma.url,
    firmaPublicId: firma.publicId,
    observaciones: input.observaciones ?? "",
    atendidoPor: new mongoose.Types.ObjectId(input.atendidoPor),
    atendidoPorNombre: input.atendidoPorNombre ?? "",
    firmadoEn: new Date(),
  });

  // Release the packages. Done after the signature is stored so a failed
  // upload never leaves packages marked as dispatched without proof.
  if (paqueteIds.length > 0) {
    await models.paquetes.updateMany(
      { _id: { $in: paqueteIds } },
      { $set: { estado: "despachado" } }
    );
  }

  // The receipt and the notification are best-effort: the signature is already
  // legally captured, so a PDF or mail hiccup must not fail the counter flow.
  try {
    const pdf = await htmlToPdf(buildComprobanteHtml(retiro.toObject() as never));
    const uploaded = await uploadComprobanteRetiro(pdf);
    retiro.comprobanteUrl = uploaded.url;
    retiro.comprobantePublicId = uploaded.publicId;
    await retiro.save();
  } catch (err) {
    logger.error("[retiro] No se pudo generar el comprobante PDF", { error: String(err) });
  }

  if (retiro.clienteEmail || retiro.clienteTelefono) {
    try {
      await createAndSendNotification({
        evento: "retiro_counter",
        destinatario: retiro.clienteEmail,
        destinatarioTelefono: retiro.clienteTelefono,
        destinatarioNombre: retiro.clienteNombre,
        operacionTipo: "envio",
        operacionId: String(retiro._id),
        payload: {
          to: retiro.clienteEmail,
          clienteNombre: retiro.clienteNombre,
          folio: String(retiro._id).slice(-8).toUpperCase(),
          totalPaquetes: retiro.totalPaquetes,
          totalPesoLb: retiro.totalPesoLb,
          totalValor: retiro.totalValor,
          comprobanteUrl: retiro.comprobanteUrl,
          firmaUrl: retiro.firmaUrl,
          retiradoPor: retiro.retiradoPorNombre,
          items: retiro.items.map((i) => ({
            referencia: i.referencia,
            descripcion: i.descripcion,
            pesoLb: i.pesoLb,
          })),
          portalUrl: `${env.FRONTEND_ORIGIN[0] ?? "https://courierboxlogistics.com"}/pagos`,
        },
      });
    } catch (err) {
      logger.error("[retiro] No se pudo notificar el retiro", { error: String(err) });
    }
  }

  return retiro.toObject();
}

/**
 * Packages the counter can hand over right now: in the warehouse, not yet
 * dispatched, and not already covered by a signed retiro.
 */
export async function paquetesDisponibles(q: string) {
  const term = (q ?? "").trim();
  if (term.length < 2) return [];

  const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const paquetes = await models.paquetes
    .find({
      estado: { $in: ["validado", "facturado", "pagado"] },
      $or: [{ wr: rx }, { sh: rx }, { trackingOriginal: rx }, { consigneeNombre: rx }, { consigneeLimpio: rx }],
    })
    .populate("masterClienteId", "nombre identificacion email telefono codigoCasillero")
    .sort({ createdAt: -1 })
    .limit(60)
    .lean();

  if (paquetes.length === 0) return [];

  const yaRetirados = await models.retirosCounter
    .find({ estado: "firmado", "items.paqueteId": { $in: paquetes.map((p) => p._id) } })
    .select("items.paqueteId")
    .lean();

  const bloqueados = new Set(
    yaRetirados.flatMap((r) => (r.items ?? []).map((i) => (i.paqueteId ? String(i.paqueteId) : "")))
  );

  return paquetes.filter((p) => !bloqueados.has(String(p._id)));
}

export async function listarRetiros(filters: {
  q?: string;
  desde?: string;
  hasta?: string;
  estado?: string;
  limit?: number;
}) {
  const query: Record<string, unknown> = {};
  if (filters.estado) query.estado = filters.estado;
  if (filters.q) {
    const rx = new RegExp(filters.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    query.$or = [
      { clienteNombre: rx },
      { clienteIdentificacion: rx },
      { codigoCasillero: rx },
      { "items.referencia": rx },
    ];
  }
  if (filters.desde || filters.hasta) {
    const range: Record<string, Date> = {};
    if (filters.desde) range.$gte = new Date(filters.desde);
    if (filters.hasta) {
      const hasta = new Date(filters.hasta);
      hasta.setHours(23, 59, 59, 999);
      range.$lte = hasta;
    }
    query.firmadoEn = range;
  }

  return models.retirosCounter
    .find(query)
    .sort({ firmadoEn: -1 })
    .limit(Math.min(Number(filters.limit) || 100, 300))
    .lean();
}

export async function obtenerRetiro(id: string) {
  if (!mongoose.isValidObjectId(id)) return null;
  return models.retirosCounter.findById(id).lean();
}

export async function anularRetiro(id: string, motivo: string, userId: string) {
  if (!mongoose.isValidObjectId(id)) {
    throw Object.assign(new Error("Retiro no encontrado"), { status: 404 });
  }
  if (!motivo?.trim()) {
    throw Object.assign(new Error("Indica el motivo de la anulación"), { status: 400 });
  }

  const retiro = await models.retirosCounter.findOneAndUpdate(
    { _id: id, estado: "firmado" },
    {
      $set: {
        estado: "anulado",
        anuladoMotivo: motivo.trim(),
        anuladoPor: new mongoose.Types.ObjectId(userId),
        anuladoEn: new Date(),
      },
    },
    { new: true }
  );
  if (!retiro) {
    throw Object.assign(new Error("Retiro no encontrado o ya anulado"), { status: 404 });
  }

  // Put the packages back so they can be released again on a corrected retiro.
  const paqueteIds = retiro.items
    .map((i) => i.paqueteId)
    .filter((id): id is mongoose.Types.ObjectId => Boolean(id));
  if (paqueteIds.length > 0) {
    await models.paquetes.updateMany({ _id: { $in: paqueteIds } }, { $set: { estado: "pagado" } });
  }

  return retiro.toObject();
}
