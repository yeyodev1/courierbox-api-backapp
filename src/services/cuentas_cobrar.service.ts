import mongoose from "mongoose";
import { env } from "../config/env";
import { models } from "../models/index";
import { TIPOS_CUENTA_COBRAR, type ICuentaCobrar, type TipoCuentaCobrar } from "../models/cuenta_cobrar.model";
import { sendResumenCobros, type FilaResumenCobro } from "./email.service";

export type EstadoCuentaCobrar = "pendiente" | "abonado" | "atrasado" | "pagado";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const CLAVE_ALERTAS = "cuentasCobrar.alertas";
const CLAVE_ULTIMO_RESUMEN = "cuentasCobrar.ultimoResumen";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class ErrorValidacion extends Error {
  status = 400;
}
const falla = (mensaje: string, status = 400) => Object.assign(new ErrorValidacion(mensaje), { status });

/** Hoy en Ecuador como YYYY-MM-DD: las fechas de la libreta no llevan hora. */
export function hoyEcuador(ahora = new Date()) {
  return ahora.toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
}

const redondear = (n: number) => Math.round(n * 100) / 100;

type CuentaPlana = Pick<ICuentaCobrar, "monto" | "fechaPago"> & { abonos: { monto: number }[] };

/** Saldo y estado salen de los abonos: nadie tiene que acordarse de cambiarlos. */
export function calcularEstado(c: CuentaPlana, hoy = hoyEcuador()) {
  const abonado = redondear(c.abonos.reduce((s, a) => s + a.monto, 0));
  const saldo = redondear(Math.max(0, c.monto - abonado));
  let estado: EstadoCuentaCobrar;
  if (saldo <= 0) estado = "pagado";
  else if (c.fechaPago && c.fechaPago < hoy) estado = "atrasado";
  else if (abonado > 0) estado = "abonado";
  else estado = "pendiente";
  return { abonado, saldo, estado };
}

function serializar(doc: any) {
  const c = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return { ...c, ...calcularEstado(c) };
}

function texto(v: unknown, campo: string, max = 200) {
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

function monto(v: unknown, campo: string, minimo = 0) {
  if (v === undefined) return undefined;
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  if (!Number.isFinite(n) || n < minimo || n > 10_000_000) throw falla(`${campo} inválido`);
  return redondear(n);
}

function leerCampos(body: Record<string, unknown>) {
  const tipo = body.tipo;
  if (tipo !== undefined && !TIPOS_CUENTA_COBRAR.includes(tipo as TipoCuentaCobrar)) throw falla("Tipo inválido");
  const campos: Record<string, unknown> = {
    cliente: texto(body.cliente, "Cliente"),
    tipo,
    monto: monto(body.monto, "Monto"),
    fechaPago: fecha(body.fechaPago, "Fecha de pago"),
    fechaCobro: fecha(body.fechaCobro, "Fecha de cobro"),
    asesor: texto(body.asesor, "Asesor", 80),
    notas: texto(body.notas, "Notas", 2000),
  };
  return Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined));
}

async function buscar(id: string) {
  if (!mongoose.isValidObjectId(id)) throw falla("Cuenta no encontrada", 404);
  const c = await models.cuentasCobrar.findById(id);
  if (!c) throw falla("Cuenta no encontrada", 404);
  return c;
}

export async function listarCuentas() {
  const docs = await models.cuentasCobrar.find().sort({ createdAt: -1 }).lean();
  return docs.map(serializar);
}

export async function crearCuenta(body: Record<string, unknown>, usuario: string) {
  const campos = leerCampos(body);
  if (!campos.cliente) throw falla("Escribe el cliente");
  if (campos.monto === undefined || (campos.monto as number) <= 0) throw falla("El monto debe ser mayor a 0");
  const c = await models.cuentasCobrar.create({ ...campos, creadoPor: usuario, actualizadoPor: usuario });
  return serializar(c);
}

export async function actualizarCuenta(id: string, body: Record<string, unknown>, usuario: string) {
  const c = await buscar(id);
  const campos = leerCampos(body);
  if ("cliente" in campos && !campos.cliente) throw falla("El cliente no puede quedar vacío");
  if ("monto" in campos && (campos.monto as number) <= 0) throw falla("El monto debe ser mayor a 0");
  c.set({ ...campos, actualizadoPor: usuario });
  await c.save();
  return serializar(c);
}

export async function eliminarCuenta(id: string) {
  const c = await buscar(id);
  await c.deleteOne();
}

export async function registrarAbono(id: string, body: Record<string, unknown>, usuario: string) {
  const c = await buscar(id);
  const valor = monto(body.monto, "Monto del abono", 0.01);
  if (valor === undefined) throw falla("Escribe el monto del abono");
  const { saldo } = calcularEstado(c);
  if (saldo <= 0) throw falla("Esta cuenta ya está pagada");
  if (valor > saldo + 0.001) throw falla(`El abono supera el saldo pendiente ($${saldo.toFixed(2)})`);
  c.abonos.push({
    fecha: fecha(body.fecha, "Fecha del abono") || hoyEcuador(),
    monto: valor,
    nota: texto(body.nota, "Nota", 300) ?? "",
    registradoPor: usuario,
  } as any);
  c.actualizadoPor = usuario;
  await c.save();
  return serializar(c);
}

export async function eliminarAbono(id: string, abonoId: string, usuario: string) {
  const c = await buscar(id);
  const abono = c.abonos.id(abonoId);
  if (!abono) throw falla("Abono no encontrado", 404);
  abono.deleteOne();
  c.actualizadoPor = usuario;
  await c.save();
  return serializar(c);
}

// ——— Alertas por correo ———

export interface ConfigAlertas {
  activo: boolean;
  destinatarios: string[];
}

export async function leerAlertas(): Promise<ConfigAlertas> {
  const doc = await models.configuraciones.findOne({ clave: CLAVE_ALERTAS }).lean();
  const v = (doc?.valor ?? {}) as Partial<ConfigAlertas>;
  return {
    activo: v.activo !== false,
    destinatarios: Array.isArray(v.destinatarios) && v.destinatarios.length ? v.destinatarios : [env.SUPERADMIN_EMAIL],
  };
}

export async function guardarAlertas(body: Record<string, unknown>, usuario: string): Promise<ConfigAlertas> {
  const actual = await leerAlertas();
  const destinatarios = body.destinatarios === undefined ? actual.destinatarios : body.destinatarios;
  if (!Array.isArray(destinatarios)) throw falla("Destinatarios inválidos");
  const limpios = [...new Set(destinatarios.map((d) => String(d).trim().toLowerCase()).filter(Boolean))];
  if (!limpios.length) throw falla("Deja al menos un correo");
  if (limpios.length > 10) throw falla("Máximo 10 correos");
  const malo = limpios.find((d) => !EMAIL.test(d));
  if (malo) throw falla(`"${malo}" no es un correo válido`);
  const valor: ConfigAlertas = { activo: body.activo === undefined ? actual.activo : body.activo === true, destinatarios: limpios };
  await models.configuraciones.updateOne(
    { clave: CLAVE_ALERTAS },
    { $set: { valor, actualizadoPor: usuario } },
    { upsert: true }
  );
  return valor;
}

/** Qué entra en el correo del día: a quién cobrar hoy, qué vence hoy y lo atrasado. */
export function armarResumen(cuentas: any[], hoy = hoyEcuador()) {
  const conSaldo = cuentas.map((c) => ({ ...c, ...calcularEstado(c, hoy) })).filter((c) => c.saldo > 0);
  const fila = (c: any): FilaResumenCobro => ({
    cliente: c.cliente,
    tipo: c.tipo,
    asesor: c.asesor,
    saldo: c.saldo,
    fechaPago: c.fechaPago,
    fechaCobro: c.fechaCobro,
  });
  const cobrarHoy = conSaldo.filter((c) => c.fechaCobro === hoy);
  const ids = new Set(cobrarHoy.map((c) => String(c._id)));
  const vencenHoy = conSaldo.filter((c) => c.fechaPago === hoy && !ids.has(String(c._id)));
  vencenHoy.forEach((c) => ids.add(String(c._id)));
  const atrasadas = conSaldo
    .filter((c) => c.estado === "atrasado" && !ids.has(String(c._id)))
    .sort((a, b) => b.saldo - a.saldo);
  return {
    hoy,
    cobrarHoy: cobrarHoy.map(fila),
    vencenHoy: vencenHoy.map(fila),
    atrasadas: atrasadas.map(fila),
    totalPendiente: redondear(conSaldo.reduce((s, c) => s + c.saldo, 0)),
    totalAtrasado: redondear(conSaldo.filter((c) => c.estado === "atrasado").reduce((s, c) => s + c.saldo, 0)),
  };
}

/**
 * Manda el resumen a los destinatarios configurados. Desde la tarea diaria no
 * repite el mismo día ni manda correos vacíos; desde el botón "Enviar ahora"
 * siempre sale.
 */
export async function enviarResumen(opciones: { forzar?: boolean } = {}) {
  const config = await leerAlertas();
  const hoy = hoyEcuador();
  if (!opciones.forzar) {
    if (!config.activo) return { enviado: false, motivo: "Alertas desactivadas" };
    const ultimo = await models.configuraciones.findOne({ clave: CLAVE_ULTIMO_RESUMEN }).lean();
    if (ultimo?.valor === hoy) return { enviado: false, motivo: "Ya se envió hoy" };
  }
  const resumen = armarResumen(await models.cuentasCobrar.find().lean(), hoy);
  const hayAlgo = resumen.cobrarHoy.length + resumen.vencenHoy.length + resumen.atrasadas.length > 0;
  if (!hayAlgo && !opciones.forzar) return { enviado: false, motivo: "Nada que cobrar hoy" };

  const r = await sendResumenCobros({ to: config.destinatarios, resumen, url: `${frontUrl()}/admin/cuentas-por-cobrar` });
  if (!r.success) throw falla(`No se pudo enviar el correo: ${r.error}`, 502);
  if (!opciones.forzar) {
    await models.configuraciones.updateOne({ clave: CLAVE_ULTIMO_RESUMEN }, { $set: { valor: hoy, actualizadoPor: "cron" } }, { upsert: true });
  }
  return {
    enviado: true,
    destinatarios: config.destinatarios,
    cuentas: resumen.cobrarHoy.length + resumen.vencenHoy.length + resumen.atrasadas.length,
  };
}

function frontUrl() {
  const prod = env.FRONTEND_ORIGIN.find((o) => /courierboxlogistics\.com/.test(o));
  return (prod || "https://courierboxlogistics.com").replace(/\/+$/, "");
}
