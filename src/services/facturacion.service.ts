import mongoose from "mongoose";
import { models } from "../models/index";
import { contificoService, type EmisionResult } from "./contifico.service";
import { enviarWebhookFactura } from "./ghl-webhook.service";
import { createAndSendNotification } from "./notification.service";
import { logger } from "../utils/logger";
import { env } from "../config/env";
import type { EstadoSri, IFactura } from "../models/factura.model";
import { IVA_PORCENTAJE_DEFECTO, obtenerIvaPorcentaje } from "./configuracion_facturacion.service";

const TARIFA_FLETE_LB = 6.50;
const TARIFA_ARANCEL_LB = 1.99;
/** Sólo como respaldo; el vigente sale de la configuración global. */
const IVA = IVA_PORCENTAJE_DEFECTO / 100;

/** Hasta este total el SRI admite facturar a consumidor final sin identificación. */
export const TOPE_CONSUMIDOR_FINAL = 50;
export const RUC_CONSUMIDOR_FINAL = "9999999999999";

/** Published so the counter screen can show live totals as packages are ticked. */
export const TARIFAS = {
  fleteLb: TARIFA_FLETE_LB,
  arancelLb: TARIFA_ARANCEL_LB,
  iva: IVA,
} as const;

export interface Tarifas {
  fleteLb: number;
  arancelLb: number;
  /** Fracción (0.15) para las cuentas. */
  iva: number;
  /** Porcentaje (15) para mostrarlo y para la línea de Contifico. */
  ivaPorcentaje: number;
}

/** Las tarifas vigentes: flete y arancel fijos, IVA según la configuración global. */
export async function obtenerTarifas(): Promise<Tarifas> {
  const ivaPorcentaje = await obtenerIvaPorcentaje();
  return { fleteLb: TARIFA_FLETE_LB, arancelLb: TARIFA_ARANCEL_LB, iva: ivaPorcentaje / 100, ivaPorcentaje };
}

export interface TotalesFactura {
  pesoTotalLb: number;
  totalFlete: number;
  totalArancel: number;
  subtotal: number;
  totalIva: number;
  totalGeneral: number;
}

/** Single source of truth for the tariff maths, shared by preview and emission. */
export function calcularTotales(pesos: number[], iva: number = IVA): TotalesFactura {
  const pesoTotalLb = pesos.reduce((sum, p) => sum + (Number(p) || 0), 0);
  const totalFlete = parseFloat((pesoTotalLb * TARIFA_FLETE_LB).toFixed(2));
  const totalArancel = parseFloat((pesoTotalLb * TARIFA_ARANCEL_LB).toFixed(2));
  const subtotal = parseFloat((totalFlete + totalArancel).toFixed(2));
  // Only the freight line carries IVA, matching the Contifico item breakdown.
  const totalIva = parseFloat((totalFlete * iva).toFixed(2));
  const totalGeneral = parseFloat((subtotal + totalIva).toFixed(2));
  return { pesoTotalLb, totalFlete, totalArancel, subtotal, totalIva, totalGeneral };
}

// ---------------------------------------------------------------------------
// Identificación ecuatoriana
// ---------------------------------------------------------------------------

const soloDigitos = (s: unknown) => String(s ?? "").replace(/\D+/g, "");

function provinciaValida(id: string) {
  const p = Number(id.slice(0, 2));
  return (p >= 1 && p <= 24) || p === 30;
}

/** Cédula: módulo 10 con pesos 2,1,2,1… sobre los 9 primeros dígitos. */
export function cedulaValida(raw: string): boolean {
  const id = soloDigitos(raw);
  if (id.length !== 10 || !provinciaValida(id) || Number(id[2]) > 5) return false;
  let suma = 0;
  for (let i = 0; i < 9; i++) {
    let v = Number(id[i]) * (i % 2 === 0 ? 2 : 1);
    if (v > 9) v -= 9;
    suma += v;
  }
  const verificador = (10 - (suma % 10)) % 10;
  return verificador === Number(id[9]);
}

/**
 * RUC: persona natural (cédula válida + 001), sociedad pública (3er dígito 6,
 * sufijo 0001) o privada (9, sufijo 001). A las sociedades no se les aplica el
 * módulo 11 clásico: el SRI dejó de asignar RUCs con ese dígito verificador y
 * el propio RUC de Courier Box (0993388549001) no lo cumple. Formato y sufijo
 * bastan; si el número no existe, el SRI lo rechaza al autorizar.
 */
export function rucValido(raw: string): boolean {
  const id = soloDigitos(raw);
  if (id === RUC_CONSUMIDOR_FINAL) return true;
  if (id.length !== 13 || !provinciaValida(id)) return false;
  const tercer = Number(id[2]);
  if (tercer < 6) return cedulaValida(id.slice(0, 10)) && id.slice(10) === "001";
  if (tercer === 6) return id.slice(9) === "0001";
  if (tercer === 9) return id.slice(10) === "001";
  return false;
}

export function identificacionValida(raw: string): boolean {
  const id = soloDigitos(raw);
  return id.length === 13 ? rucValido(id) : cedulaValida(id);
}

// ---------------------------------------------------------------------------
// Datos faltantes
// ---------------------------------------------------------------------------

export interface DatoFaltante {
  campo: "cedulaRuc" | "nombreOficial" | "email" | "telefono" | "direccion";
  mensaje: string;
  /** Sin esto el SRI rechaza o Contifico no acepta; lo demás sólo mejora la factura. */
  requerido: boolean;
}

export interface ClienteFacturable {
  id: string;
  nombreOficial: string;
  cedulaRuc: string;
  email: string;
  telefono: string;
  direccion: string;
  codigoCasillero: string;
}

/**
 * Lo que le falta al cliente para que la factura salga y el SRI la autorice.
 * La identificación manda: sin cédula o RUC válido sólo queda consumidor final,
 * y eso el SRI lo admite únicamente hasta $50.
 */
export function validarClienteParaFactura(
  cliente: Partial<ClienteFacturable>,
  totalGeneral: number
): { faltantes: DatoFaltante[]; consumidorFinalPosible: boolean; listo: boolean } {
  const faltantes: DatoFaltante[] = [];
  const id = soloDigitos(cliente.cedulaRuc);
  const consumidorFinalPosible = totalGeneral <= TOPE_CONSUMIDOR_FINAL;

  if (!id) {
    faltantes.push({
      campo: "cedulaRuc",
      requerido: true,
      mensaje: consumidorFinalPosible
        ? "Sin cédula o RUC. Puedes facturar a consumidor final porque el total no pasa de $50, o completar la identificación."
        : `Sin cédula o RUC. El SRI no admite consumidor final por más de $${TOPE_CONSUMIDOR_FINAL}.`,
    });
  } else if (!identificacionValida(id)) {
    faltantes.push({
      campo: "cedulaRuc",
      requerido: true,
      mensaje: `"${cliente.cedulaRuc}" no es una cédula ni un RUC válido. Corrígelo o el SRI rechaza la factura.`,
    });
  }

  if (!String(cliente.nombreOficial ?? "").trim()) {
    faltantes.push({ campo: "nombreOficial", requerido: true, mensaje: "Sin nombre o razón social." });
  }

  const email = String(cliente.email ?? "").trim();
  if (!email) {
    faltantes.push({ campo: "email", requerido: false, mensaje: "Sin correo: la factura no le llegará por email." });
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    faltantes.push({ campo: "email", requerido: false, mensaje: `"${email}" no parece un correo válido.` });
  }

  if (!soloDigitos(cliente.telefono)) {
    faltantes.push({ campo: "telefono", requerido: false, mensaje: "Sin teléfono para avisarle por WhatsApp." });
  }

  if (!String(cliente.direccion ?? "").trim()) {
    faltantes.push({ campo: "direccion", requerido: false, mensaje: "Sin dirección; el RIDE sale sin ella." });
  }

  return { faltantes, consumidorFinalPosible, listo: !faltantes.some((f) => f.requerido) };
}

export function clienteFacturable(c: any): ClienteFacturable {
  return {
    id: String(c?._id ?? ""),
    nombreOficial: String(c?.nombreOficial ?? ""),
    cedulaRuc: String(c?.cedulaRuc ?? ""),
    email: String(c?.email ?? ""),
    telefono: String(c?.telefono ?? ""),
    direccion: String(c?.direccion ?? ""),
    codigoCasillero: String(c?.codigoCasillero ?? ""),
  };
}

/**
 * Completa los datos de facturación del cliente desde el counter. La cédula o
 * RUC se valida como lo hará el SRI, y no puede pertenecer a otro cliente.
 */
export async function completarDatosCliente(
  id: string,
  datos: Partial<Pick<ClienteFacturable, "nombreOficial" | "cedulaRuc" | "email" | "telefono" | "direccion">>
): Promise<{ exito: true; cliente: ClienteFacturable } | { exito: false; error: string }> {
  if (!mongoose.isValidObjectId(id)) return { exito: false, error: "Cliente inválido" };
  const set: Record<string, string> = {};

  if (datos.cedulaRuc !== undefined) {
    const idn = soloDigitos(datos.cedulaRuc);
    if (idn && !identificacionValida(idn)) return { exito: false, error: "Esa cédula o RUC no es válido." };
    if (idn) {
      const otro = await models.masterClientes.findOne({ cedulaRuc: idn, _id: { $ne: id } }).lean();
      if (otro) {
        return { exito: false, error: `Esa cédula/RUC ya pertenece a ${(otro as any).nombreOficial} (${(otro as any).codigoCasillero}).` };
      }
    }
    set.cedulaRuc = idn;
  }
  if (datos.nombreOficial !== undefined) {
    const n = String(datos.nombreOficial).trim();
    if (!n) return { exito: false, error: "El nombre no puede quedar vacío." };
    set.nombreOficial = n;
  }
  if (datos.email !== undefined) {
    const email = String(datos.email).trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return { exito: false, error: `"${email}" no es un correo válido. Revísalo o déjalo vacío.` };
    }
    set.email = email;
  }
  if (datos.telefono !== undefined) set.telefono = String(datos.telefono).trim();
  if (datos.direccion !== undefined) set.direccion = String(datos.direccion).trim();

  const actualizado = await models.masterClientes.findByIdAndUpdate(id, { $set: set }, { new: true }).lean();
  if (!actualizado) return { exito: false, error: "Cliente no encontrado" };
  return { exito: true, cliente: clienteFacturable(actualizado) };
}

// ---------------------------------------------------------------------------
// Facturables y emisión
// ---------------------------------------------------------------------------

/**
 * Packages the counter can invoice right now: already validated, still without
 * an invoice, and attached to a master client.
 */
export async function listarFacturables(q: string) {
  const term = (q ?? "").trim();
  const tarifas = await obtenerTarifas();

  // Sin búsqueda, el counter ve lo último que entró y sigue sin factura: para
  // elegir una caja no hace falta saber de antemano qué escribir.
  if (term.length < 2) {
    const paquetes = await models.paquetes
      .find({ estado: { $in: ["importado", "validado", "pendiente_validacion"] }, facturaId: null, masterClienteId: { $ne: null } })
      .populate("masterClienteId", "nombreOficial cedulaRuc email telefono direccion codigoCasillero")
      .sort({ createdAt: -1 })
      .limit(60)
      .lean();
    return { paquetes, tarifas };
  }

  const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  // También por casillero o nombre oficial del cliente: es como el counter
  // llega desde Ingreso de carga ("Facturar" trae el casillero), y como busca
  // cuando el manifiesto escribió el nombre distinto al registrado.
  const clientes = await models.masterClientes
    .find({ $or: [{ codigoCasillero: rx }, { nombreOficial: rx }] })
    .select("_id")
    .limit(50)
    .lean();
  const clienteIds = clientes.map((c) => c._id);
  const paquetes = await models.paquetes
    .find({
      estado: { $in: ["importado", "validado", "pendiente_validacion"] },
      facturaId: null,
      masterClienteId: { $ne: null },
      $or: [
        { wr: rx },
        { sh: rx },
        { trackingOriginal: rx },
        { consigneeNombre: rx },
        { consigneeLimpio: rx },
        ...(clienteIds.length ? [{ masterClienteId: { $in: clienteIds } }] : []),
      ],
    })
    .populate("masterClienteId", "nombreOficial cedulaRuc email telefono direccion codigoCasillero")
    .sort({ createdAt: -1 })
    .limit(60)
    .lean();

  return { paquetes, tarifas };
}

async function cargarSeleccion(paqueteIds: string[]) {
  const paquetes = await models.paquetes.find({ _id: { $in: paqueteIds } }).lean();
  if (!paquetes.length) return { error: "No se encontraron paquetes" as const };

  const masterId = paquetes[0].masterClienteId;
  for (const p of paquetes) {
    if (p.masterClienteId?.toString() !== masterId?.toString()) {
      return { error: "Todos los paquetes deben pertenecer al mismo cliente" as const };
    }
  }
  const cliente = masterId ? await models.masterClientes.findById(masterId).lean() : null;
  if (!cliente) return { error: "Cliente no encontrado" as const };

  const tarifas = await obtenerTarifas();
  return { paquetes, cliente, tarifas, totales: calcularTotales(paquetes.map((p) => p.pesoLb || 0), tarifas.iva) };
}

/** Lo que el counter necesita ver antes de emitir: cliente, totales y qué falta. */
export async function validarSeleccion(paqueteIds: string[]) {
  const sel = await cargarSeleccion(paqueteIds);
  if ("error" in sel) return { exito: false as const, error: String(sel.error) };
  const cliente = clienteFacturable(sel.cliente);
  const yaFacturado = sel.paquetes.filter((p) => p.facturaId);
  const validacion = validarClienteParaFactura(cliente, sel.totales.totalGeneral);
  return {
    exito: true as const,
    cliente,
    totales: sel.totales,
    tarifas: sel.tarifas,
    ...validacion,
    listo: validacion.listo && yaFacturado.length === 0,
    yaFacturados: yaFacturado.map((p) => p.wr || p.sh || String(p._id)),
  };
}

export interface FacturaEmitida {
  facturaId: string;
  numeroFactura: string;
  estadoSri: EstadoSri;
  autorizacionSri: string;
  pdfUrl: string;
  xmlUrl: string;
  mensajeSri: string;
  totalGeneral: number;
  clienteNombre: string;
}

function resumenFactura(f: any, clienteNombre: string): FacturaEmitida {
  return {
    facturaId: String(f._id),
    numeroFactura: f.numeroFactura,
    estadoSri: f.estadoSri,
    autorizacionSri: f.autorizacionSri,
    pdfUrl: f.pdfUrl,
    xmlUrl: f.xmlUrl,
    mensajeSri: f.mensajeSri,
    totalGeneral: f.totalGeneral,
    clienteNombre,
  };
}

/**
 * Emite la factura electrónica. Antes se guardaba la factura y se marcaban los
 * paquetes como facturados aunque Contifico hubiera fallado, con un número
 * TEMP-…; ahora, si Contifico no la acepta, no queda nada a medias.
 */
export async function facturarPaquetes(
  paqueteIds: string[],
  opciones: { consumidorFinal?: boolean } = {}
): Promise<
  | { exito: true; factura: FacturaEmitida }
  | { exito: false; error: string; faltantes?: DatoFaltante[]; consumidorFinalPosible?: boolean }
> {
  const sel = await cargarSeleccion(paqueteIds);
  if ("error" in sel) return { exito: false, error: String(sel.error) };
  const { paquetes, cliente, totales, tarifas } = sel;

  if (paquetes.some((p) => p.facturaId)) {
    return { exito: false, error: "Alguno de esos paquetes ya tiene factura. Actualiza la búsqueda." };
  }

  const datos = clienteFacturable(cliente);
  const validacion = validarClienteParaFactura(datos, totales.totalGeneral);
  const usaConsumidorFinal = Boolean(opciones.consumidorFinal) && !soloDigitos(datos.cedulaRuc);
  if (usaConsumidorFinal && !validacion.consumidorFinalPosible) {
    return { exito: false, error: `El SRI no admite consumidor final por más de $${TOPE_CONSUMIDOR_FINAL}. Completa la cédula o RUC.` };
  }
  const requeridos = validacion.faltantes.filter((f) => f.requerido && !(usaConsumidorFinal && f.campo === "cedulaRuc"));
  if (requeridos.length) {
    return {
      exito: false,
      error: "Faltan datos del cliente para facturar.",
      faltantes: validacion.faltantes,
      consumidorFinalPosible: validacion.consumidorFinalPosible,
    };
  }

  const { pesoTotalLb: pesoTotal, totalFlete, totalArancel, totalIva, totalGeneral } = totales;
  const referencias = paquetes.map((p) => p.wr || p.sh || p.trackingOriginal).filter(Boolean);
  const descripcion = [
    `${pesoTotal.toFixed(2)} lb · ${paquetes.length} paquete(s)`,
    referencias.join(", "),
    `Casillero ${datos.codigoCasillero}`,
  ].join("\n");

  const emision: EmisionResult = await contificoService.emitirFactura({
    cliente: {
      identificacion: usaConsumidorFinal ? RUC_CONSUMIDOR_FINAL : datos.cedulaRuc,
      razonSocial: datos.nombreOficial,
      email: datos.email,
      telefono: datos.telefono,
      direccion: datos.direccion,
    },
    lineas: [
      { codigoProducto: env.CONTIFICO_PRODUCTO_FLETE, cantidad: pesoTotal, precio: TARIFA_FLETE_LB, porcentajeIva: tarifas.ivaPorcentaje },
      { codigoProducto: env.CONTIFICO_PRODUCTO_ARANCEL, cantidad: pesoTotal, precio: TARIFA_ARANCEL_LB, porcentajeIva: 0 },
    ],
    descripcion,
  });

  if (!emision.exito) {
    return { exito: false, error: `Contifico rechazó la factura: ${emision.error}` };
  }

  const factura = await models.facturas.create({
    numeroFactura: emision.numero,
    contificoId: emision.id,
    autorizacionSri: emision.autorizacion,
    estadoSri: emision.estadoSri,
    mensajeSri: emision.mensaje,
    autorizadaEn: emision.estadoSri === "autorizado" ? new Date() : null,
    sriRevisadoEn: new Date(),
    masterClienteId: cliente._id,
    paquetes: paqueteIds,
    pesoTotalLb: pesoTotal,
    totalFlete,
    totalArancel,
    totalGeneral,
    iva: totalIva,
    pdfUrl: emision.urlRide,
    xmlUrl: emision.urlXml,
    contificoResponse: emision.raw || {},
    estado: "pendiente",
  });

  await models.paquetes.updateMany(
    { _id: { $in: paqueteIds } },
    { $set: { estado: "facturado", facturaId: factura._id } }
  );

  // Legacy CRM webhook: no-ops when its URL is unset, which it now is.
  enviarWebhookFactura({
    facturaId: factura._id.toString(),
    numeroFactura: factura.numeroFactura,
    totalAmount: factura.totalGeneral,
    pdfUrl: factura.pdfUrl,
    clienteNombre: datos.nombreOficial,
    clienteTelefono: datos.telefono,
    clienteEmail: datos.email,
    codigoCasillero: datos.codigoCasillero,
  }).catch((err) => logger.error("[facturacion] webhook error:", err));

  // The real channel: the shared ledger, so the invoice reaches the client by
  // email and leaves a ready-to-send WhatsApp message like every other event.
  if (datos.email || datos.telefono) {
    createAndSendNotification({
      evento: "factura_emitida",
      destinatario: datos.email,
      destinatarioTelefono: datos.telefono,
      destinatarioNombre: datos.nombreOficial,
      operacionTipo: "factura",
      operacionId: factura._id.toString(),
      payload: {
        to: datos.email,
        clienteNombre: datos.nombreOficial,
        numeroFactura: factura.numeroFactura,
        codigoCasillero: datos.codigoCasillero,
        pesoTotalLb: pesoTotal,
        totalFlete,
        totalArancel,
        totalIva,
        totalGeneral: factura.totalGeneral,
        pdfUrl: factura.pdfUrl,
        paquetes: paquetes.map((p) => ({
          referencia: p.wr || p.sh || p.trackingOriginal,
          descripcion: p.contenido,
          pesoLb: p.pesoLb,
        })),
        portalUrl: `${env.FRONTEND_ORIGIN[0] ?? "https://courierboxlogistics.com"}/pagos`,
      },
    }).catch((err) => logger.error("[facturacion] notificación error:", err));
  }

  return { exito: true, factura: resumenFactura(factura, datos.nombreOficial) };
}

/**
 * Vuelve a preguntar a Contifico cómo va la factura en el SRI y, si sigue sin
 * enviarse, la reenvía. Sirve para el botón "Actualizar estado" y para las que
 * quedaron en proceso cuando se emitieron.
 */
export async function sincronizarFacturaSri(facturaId: string): Promise<{ exito: true; factura: FacturaEmitida } | { exito: false; error: string }> {
  if (!mongoose.isValidObjectId(facturaId)) return { exito: false, error: "Factura inválida" };
  const factura = await models.facturas.findById(facturaId);
  if (!factura) return { exito: false, error: "Factura no encontrada" };
  if (!factura.contificoId) return { exito: false, error: "Esta factura no se emitió en Contifico." };

  try {
    let doc = await contificoService.consultarDocumento(factura.contificoId);
    if (doc.estadoSri === "sin_enviar" || doc.estadoSri === "rechazado") {
      await contificoService.enviarSri(factura.contificoId);
      doc = await contificoService.consultarDocumento(factura.contificoId);
    }
    aplicarDocumento(factura, doc);
    await factura.save();
    const cliente = await models.masterClientes.findById(factura.masterClienteId).select("nombreOficial").lean();
    return { exito: true, factura: resumenFactura(factura, String((cliente as any)?.nombreOficial ?? "")) };
  } catch (err: any) {
    factura.estadoSri = "error";
    factura.mensajeSri = String(err?.message ?? err);
    factura.sriRevisadoEn = new Date();
    await factura.save();
    return { exito: false, error: factura.mensajeSri };
  }
}

function aplicarDocumento(factura: IFactura, doc: Awaited<ReturnType<typeof contificoService.consultarDocumento>>) {
  factura.estadoSri = doc.estadoSri;
  factura.mensajeSri = doc.mensaje;
  factura.autorizacionSri = doc.autorizacion || factura.autorizacionSri;
  factura.pdfUrl = doc.urlRide || factura.pdfUrl;
  factura.xmlUrl = doc.urlXml || factura.xmlUrl;
  if (doc.numero) factura.numeroFactura = doc.numero;
  factura.sriRevisadoEn = new Date();
  if (doc.estadoSri === "autorizado" && !factura.autorizadaEn) factura.autorizadaEn = new Date();
}

/** Al confirmar el pago, el cobro también queda en Contifico; si falla no bloquea. */
export async function registrarCobroContifico(factura: IFactura): Promise<void> {
  if (!factura.contificoId) return;
  const forma = /efectivo|cash/i.test(factura.referenciaPago) ? "EF" : "TRA";
  await contificoService.registrarCobro(factura.contificoId, {
    forma,
    monto: factura.totalGeneral,
    comprobante: factura.referenciaPago,
  });
}
