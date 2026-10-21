import mongoose from "mongoose";
import { env } from "../config/env";
import { models } from "../models/index";
import type { IApunteAsistencia, IClienteAsistencia, IPendienteAsistencia, IRecordatorioGerencia } from "../models/asistencia.model";
import { armarResumen, hoyEcuador, leerAjustes as leerAjustesCuentas } from "./cuentas_cobrar.service";
import { sendRecordatoriosGerencia, sendResumenAsistencia, type FilaResumenPendiente } from "./email.service";

/**
 * Módulo de asistencia: pendientes, clientes con tarifas, bitácora y
 * recordatorios a gerencia. Lo usan la asistente y Oscar (que ve todo);
 * la asistente no ve nada del módulo de gerencia.
 */

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CLAVE_ALERTAS = "asistencia.alertas";
const CLAVE_ULTIMO_RESUMEN = "asistencia.ultimoResumen";
const CLAVE_GERENCIA = "asistencia.recordatorios.destinatarios";

class ErrorValidacion extends Error {
  status = 400;
}
const falla = (mensaje: string, status = 400) => Object.assign(new ErrorValidacion(mensaje), { status });

const redondear = (n: number) => Math.round(n * 100) / 100;

function texto(v: unknown, campo: string, max = 300) {
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw falla(`${campo} inválido`);
  const t = v.trim();
  if (t.length > max) throw falla(`${campo} es demasiado largo`);
  return t;
}

function fecha(v: unknown, campo: string) {
  if (v === undefined) return undefined;
  if (v === null || v === "") return "";
  if (typeof v !== "string" || !FECHA.test(v)) throw falla(`${campo} debe ser una fecha válida`);
  return v;
}

function booleano(v: unknown, campo: string) {
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") throw falla(`${campo} inválido`);
  return v;
}

/** Tarifa en USD: null (sin definir) o un número de 0 a 10.000. */
function tarifa(v: unknown, campo: string) {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 10_000) throw falla(`${campo} inválida`);
  return redondear(n);
}

const limpiar = (campos: Record<string, unknown>) => Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined));

function buscarId(id: string) {
  if (!mongoose.isValidObjectId(id)) throw falla("No encontrado", 404);
  return id;
}

// ——— Pendientes ———

export type EstadoPendiente = "pendiente" | "hoy" | "atrasado" | "hecho";

export function estadoPendiente(p: Pick<IPendienteAsistencia, "hecho" | "fechaEjecucion">, hoy = hoyEcuador()): EstadoPendiente {
  if (p.hecho) return "hecho";
  if (p.fechaEjecucion && p.fechaEjecucion < hoy) return "atrasado";
  if (p.fechaEjecucion === hoy) return "hoy";
  return "pendiente";
}

function serializarPendiente(doc: any) {
  const p = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return { ...p, estado: estadoPendiente(p) };
}

function camposPendiente(body: Record<string, unknown>) {
  const campos = {
    titulo: texto(body.titulo, "Pendiente", 200),
    detalle: texto(body.detalle, "Detalle", 2000),
    fechaEjecucion: fecha(body.fechaEjecucion, "Fecha de ejecución"),
    fechaRecordatorio: fecha(body.fechaRecordatorio, "Fecha de recordatorio"),
    hecho: booleano(body.hecho, "Hecho"),
  };
  return limpiar(campos);
}

export async function listarPendientes() {
  const docs = await models.pendientesAsistencia.find().sort({ hecho: 1, createdAt: -1 }).lean();
  return docs.map(serializarPendiente);
}

export async function crearPendiente(body: Record<string, unknown>, usuario: string) {
  const campos = camposPendiente(body);
  if (!campos.titulo) throw falla("Escribe el pendiente");
  const p = await models.pendientesAsistencia.create({ ...campos, creadoPor: usuario, actualizadoPor: usuario });
  return serializarPendiente(p);
}

export async function actualizarPendiente(id: string, body: Record<string, unknown>, usuario: string) {
  const p = await models.pendientesAsistencia.findById(buscarId(id));
  if (!p) throw falla("Pendiente no encontrado", 404);
  const campos = camposPendiente(body);
  if ("titulo" in campos && !campos.titulo) throw falla("El pendiente no puede quedar vacío");
  if ("hecho" in campos) (campos as any).hechoEn = campos.hecho ? hoyEcuador() : "";
  p.set({ ...campos, actualizadoPor: usuario });
  await p.save();
  return serializarPendiente(p);
}

export async function eliminarPendiente(id: string) {
  const p = await models.pendientesAsistencia.findById(buscarId(id));
  if (!p) throw falla("Pendiente no encontrado", 404);
  await p.deleteOne();
}

// ——— Clientes con tarifas ———

function serializarCliente(doc: any) {
  return typeof doc.toObject === "function" ? doc.toObject() : doc;
}

function camposCliente(body: Record<string, unknown>) {
  return limpiar({
    nombre: texto(body.nombre, "Nombre", 200),
    tarifaEstandar: tarifa(body.tarifaEstandar, "Tarifa estándar"),
    tarifaExpress: tarifa(body.tarifaExpress, "Tarifa express"),
    tarifaCboxExpress: tarifa(body.tarifaCboxExpress, "Tarifa CBOX express"),
    observaciones: texto(body.observaciones, "Observaciones", 2000),
    paquetesEnCurso: booleano(body.paquetesEnCurso, "Paquetes en curso"),
  });
}

export async function listarClientes() {
  const docs = await models.clientesAsistencia.find().sort({ nombre: 1 }).collation({ locale: "es", strength: 1 }).lean();
  return docs.map(serializarCliente);
}

export async function crearCliente(body: Record<string, unknown>, usuario: string) {
  const campos = camposCliente(body);
  if (!campos.nombre) throw falla("Escribe el nombre del cliente");
  const repetido = await models.clientesAsistencia.findOne({ nombre: new RegExp(`^${String(campos.nombre).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }).lean();
  if (repetido) throw falla("Ese cliente ya existe");
  const c = await models.clientesAsistencia.create({ ...campos, creadoPor: usuario, actualizadoPor: usuario });
  return serializarCliente(c);
}

export async function actualizarCliente(id: string, body: Record<string, unknown>, usuario: string) {
  const c = await models.clientesAsistencia.findById(buscarId(id));
  if (!c) throw falla("Cliente no encontrado", 404);
  const campos = camposCliente(body);
  if ("nombre" in campos && !campos.nombre) throw falla("El nombre no puede quedar vacío");
  c.set({ ...campos, actualizadoPor: usuario });
  await c.save();
  return serializarCliente(c);
}

export async function eliminarCliente(id: string) {
  const c = await models.clientesAsistencia.findById(buscarId(id));
  if (!c) throw falla("Cliente no encontrado", 404);
  await c.deleteOne();
}

// ——— Agenda / bitácora ———

function serializarApunte(doc: any) {
  return typeof doc.toObject === "function" ? doc.toObject() : doc;
}

export async function listarApuntes() {
  const docs = await models.apuntesAsistencia.find().sort({ fecha: -1, createdAt: -1 }).lean();
  return docs.map(serializarApunte);
}

export async function crearApunte(body: Record<string, unknown>, usuario: string) {
  const t = texto(body.texto, "Apunte", 5000);
  if (!t) throw falla("Escribe el apunte");
  const f = fecha(body.fecha, "Fecha") || hoyEcuador();
  const a = await models.apuntesAsistencia.create({ fecha: f, texto: t, creadoPor: usuario, actualizadoPor: usuario });
  return serializarApunte(a);
}

export async function actualizarApunte(id: string, body: Record<string, unknown>, usuario: string) {
  const a = await models.apuntesAsistencia.findById(buscarId(id));
  if (!a) throw falla("Apunte no encontrado", 404);
  const campos = limpiar({ texto: texto(body.texto, "Apunte", 5000), fecha: fecha(body.fecha, "Fecha") });
  if ("texto" in campos && !campos.texto) throw falla("El apunte no puede quedar vacío");
  if ("fecha" in campos && !campos.fecha) throw falla("El apunte necesita fecha");
  a.set({ ...campos, actualizadoPor: usuario });
  await a.save();
  return serializarApunte(a);
}

export async function eliminarApunte(id: string) {
  const a = await models.apuntesAsistencia.findById(buscarId(id));
  if (!a) throw falla("Apunte no encontrado", 404);
  await a.deleteOne();
}

// ——— Recordatorios a gerencia ———

function serializarRecordatorio(doc: any) {
  return typeof doc.toObject === "function" ? doc.toObject() : doc;
}

/** A quién le llegan los recordatorios de la asistente: Oscar, salvo que se configure otra cosa. */
export async function destinatariosGerencia(): Promise<string[]> {
  const doc = await models.configuraciones.findOne({ clave: CLAVE_GERENCIA }).lean();
  const v = doc?.valor;
  return Array.isArray(v) && v.length ? (v as string[]) : [env.SUPERADMIN_EMAIL];
}

export async function listarRecordatorios() {
  const docs = await models.recordatoriosGerencia.find().sort({ enviado: 1, fecha: 1, createdAt: -1 }).lean();
  return { recordatorios: docs.map(serializarRecordatorio), destinatarios: await destinatariosGerencia() };
}

export async function crearRecordatorio(body: Record<string, unknown>, usuario: string) {
  const mensaje = texto(body.mensaje, "Recordatorio", 1000);
  if (!mensaje) throw falla("Escribe el recordatorio");
  const f = fecha(body.fecha, "Fecha de aviso") || hoyEcuador();
  const r = await models.recordatoriosGerencia.create({ mensaje, fecha: f, creadoPor: usuario, actualizadoPor: usuario });
  return serializarRecordatorio(r);
}

export async function actualizarRecordatorio(id: string, body: Record<string, unknown>, usuario: string) {
  const r = await models.recordatoriosGerencia.findById(buscarId(id));
  if (!r) throw falla("Recordatorio no encontrado", 404);
  if (r.enviado) throw falla("Este recordatorio ya se envió; crea uno nuevo");
  const campos = limpiar({ mensaje: texto(body.mensaje, "Recordatorio", 1000), fecha: fecha(body.fecha, "Fecha de aviso") });
  if ("mensaje" in campos && !campos.mensaje) throw falla("El recordatorio no puede quedar vacío");
  if ("fecha" in campos && !campos.fecha) throw falla("El recordatorio necesita fecha de aviso");
  r.set({ ...campos, actualizadoPor: usuario });
  await r.save();
  return serializarRecordatorio(r);
}

export async function eliminarRecordatorio(id: string) {
  const r = await models.recordatoriosGerencia.findById(buscarId(id));
  if (!r) throw falla("Recordatorio no encontrado", 404);
  await r.deleteOne();
}

/** Botón "Avisar a gerencia ahora": manda este recordatorio ya, sin esperar al día. */
export async function enviarRecordatorioAhora(id: string, usuario: string) {
  const r = await models.recordatoriosGerencia.findById(buscarId(id));
  if (!r) throw falla("Recordatorio no encontrado", 404);
  if (r.enviado) throw falla("Este recordatorio ya se envió");
  const destinatarios = await destinatariosGerencia();
  const envio = await sendRecordatoriosGerencia({
    to: destinatarios,
    url: `${frontUrl()}/recordatorios`,
    de: usuario,
    recordatorios: [{ mensaje: r.mensaje, fecha: r.fecha }],
  });
  if (!envio.success) throw falla(`No se pudo enviar el correo: ${envio.error}`, 502);
  r.enviado = true;
  r.enviadoEn = new Date();
  r.actualizadoPor = usuario;
  await r.save();
  return { recordatorio: serializarRecordatorio(r), destinatarios };
}

/** Los recordatorios cuyo día llegó (o pasó) salen juntos en un solo correo a gerencia. */
export async function enviarRecordatoriosDelDia(hoy = hoyEcuador()) {
  const pendientes = await models.recordatoriosGerencia.find({ enviado: false, fecha: { $lte: hoy } }).sort({ fecha: 1 });
  if (!pendientes.length) return { enviado: false, motivo: "Sin recordatorios para hoy" };
  const destinatarios = await destinatariosGerencia();
  const envio = await sendRecordatoriosGerencia({
    to: destinatarios,
    url: `${frontUrl()}/recordatorios`,
    de: pendientes[0]?.creadoPor || "Tu asistente",
    recordatorios: pendientes.map((r) => ({ mensaje: r.mensaje, fecha: r.fecha })),
  });
  if (!envio.success) throw falla(`No se pudo enviar el correo: ${envio.error}`, 502);
  await models.recordatoriosGerencia.updateMany(
    { _id: { $in: pendientes.map((r) => r._id) } },
    { $set: { enviado: true, enviadoEn: new Date(), actualizadoPor: "cron" } }
  );
  return { enviado: true, destinatarios, recordatorios: pendientes.length };
}

// ——— Alertas: el resumen diario de la asistente ———

export interface ConfigAlertasAsistencia {
  activo: boolean;
  destinatarios: string[];
}

export async function leerAlertas(): Promise<ConfigAlertasAsistencia> {
  const doc = await models.configuraciones.findOne({ clave: CLAVE_ALERTAS }).lean();
  const v = (doc?.valor ?? {}) as Partial<ConfigAlertasAsistencia>;
  return {
    activo: v.activo !== false,
    destinatarios: Array.isArray(v.destinatarios) && v.destinatarios.length ? v.destinatarios : [env.ASISTENTE_EMAIL],
  };
}

export async function guardarAlertas(body: Record<string, unknown>, usuario: string): Promise<ConfigAlertasAsistencia> {
  const actual = await leerAlertas();
  const destinatarios = body.destinatarios === undefined ? actual.destinatarios : body.destinatarios;
  if (!Array.isArray(destinatarios)) throw falla("Destinatarios inválidos");
  const limpios = [...new Set(destinatarios.map((d) => String(d).trim().toLowerCase()).filter(Boolean))];
  if (!limpios.length) throw falla("Deja al menos un correo");
  if (limpios.length > 10) throw falla("Máximo 10 correos");
  const malo = limpios.find((d) => !EMAIL.test(d));
  if (malo) throw falla(`"${malo}" no es un correo válido`);
  const valor: ConfigAlertasAsistencia = { activo: body.activo === undefined ? actual.activo : body.activo === true, destinatarios: limpios };
  await models.configuraciones.updateOne({ clave: CLAVE_ALERTAS }, { $set: { valor, actualizadoPor: usuario } }, { upsert: true });
  return valor;
}

const filaPendiente = (p: any): FilaResumenPendiente => ({
  titulo: p.titulo,
  detalle: p.detalle,
  fechaEjecucion: p.fechaEjecucion,
});

/**
 * El correo diario de la asistente: pendientes con recordatorio o ejecución
 * hoy, pendientes atrasados y los cobros de su libreta. Desde la tarea diaria
 * no repite el mismo día ni manda correos vacíos; con `forzar` siempre sale.
 */
export async function enviarResumen(opciones: { forzar?: boolean } = {}) {
  const config = await leerAlertas();
  const hoy = hoyEcuador();
  if (!opciones.forzar) {
    if (!config.activo) return { enviado: false, motivo: "Alertas desactivadas" };
    const ultimo = await models.configuraciones.findOne({ clave: CLAVE_ULTIMO_RESUMEN }).lean();
    if (ultimo?.valor === hoy) return { enviado: false, motivo: "Ya se envió hoy" };
  }

  const pendientes = await models.pendientesAsistencia.find({ hecho: false }).lean();
  const pendientesHoy = pendientes.filter((p) => p.fechaRecordatorio === hoy || p.fechaEjecucion === hoy).map(filaPendiente);
  const pendientesAtrasados = pendientes
    .filter((p) => p.fechaEjecucion && p.fechaEjecucion < hoy)
    .sort((a, b) => a.fechaEjecucion.localeCompare(b.fechaEjecucion))
    .map(filaPendiente);

  const cuentas = await models.cuentasCobrar.find({ ambito: "asistencia" }).lean();
  const cobros = armarResumen(cuentas, hoy);
  // El correo muestra el nombre del tipo, no su clave interna.
  const { tipos } = await leerAjustesCuentas("asistencia");
  const etiqueta = <T extends { tipo: string }>(f: T) => ({ ...f, tipo: tipos.find((t) => t.valor === f.tipo)?.etiqueta ?? f.tipo });
  cobros.cobrarHoy = cobros.cobrarHoy.map(etiqueta);
  cobros.vencenHoy = cobros.vencenHoy.map(etiqueta);
  cobros.atrasadas = cobros.atrasadas.map(etiqueta);

  const hayAlgo = pendientesHoy.length + pendientesAtrasados.length + cobros.cobrarHoy.length + cobros.vencenHoy.length + cobros.atrasadas.length > 0;
  if (!hayAlgo && !opciones.forzar) return { enviado: false, motivo: "Nada para hoy" };

  const r = await sendResumenAsistencia({
    to: config.destinatarios,
    url: `${frontUrl()}/pendientes`,
    resumen: { ...cobros, hoy, pendientesHoy, pendientesAtrasados },
  });
  if (!r.success) throw falla(`No se pudo enviar el correo: ${r.error}`, 502);
  if (!opciones.forzar) {
    await models.configuraciones.updateOne({ clave: CLAVE_ULTIMO_RESUMEN }, { $set: { valor: hoy, actualizadoPor: "cron" } }, { upsert: true });
  }
  return { enviado: true, destinatarios: config.destinatarios, pendientes: pendientesHoy.length + pendientesAtrasados.length };
}

/** La tarea diaria del módulo: resumen a la asistente y recordatorios a gerencia. */
export async function correrCron() {
  const [asistente, gerencia] = await Promise.all([enviarResumen(), enviarRecordatoriosDelDia()]);
  return { asistente, gerencia };
}

function frontUrl() {
  return env.GERENCIA_URL.replace(/\/+$/, "");
}
