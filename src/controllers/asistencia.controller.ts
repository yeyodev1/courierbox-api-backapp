import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env";
import * as svc from "../services/asistencia.service";
import * as cuentasSvc from "../services/cuentas_cobrar.service";

const usuario = (req: Request) => (req.user as { email?: string } | undefined)?.email ?? "";

/** Los errores de validación del servicio traen su status; el resto es un 500. */
function responderError(err: any, res: Response, next: NextFunction) {
  if (err?.status && err.status < 500) return void res.status(err.status).json({ error: err.message });
  if (err?.status === 502) return void res.status(502).json({ error: err.message });
  next(err);
}

type Handler = (req: Request) => Promise<unknown>;

/** Casi todas las rutas son "llama al servicio y responde el JSON". */
const responder = (status: number, handler: Handler) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await handler(req);
      if (data === undefined) res.status(204).end();
      else res.status(status).json(data);
    } catch (err) {
      responderError(err, res, next);
    }
  };

// ——— Pendientes ———

export const getPendientes = responder(200, async () => ({ pendientes: await svc.listarPendientes() }));
export const postPendiente = responder(201, async (req) => ({ pendiente: await svc.crearPendiente(req.body ?? {}, usuario(req)) }));
export const putPendiente = responder(200, async (req) => ({ pendiente: await svc.actualizarPendiente(String(req.params.id), req.body ?? {}, usuario(req)) }));
export const deletePendiente = responder(204, async (req) => void (await svc.eliminarPendiente(String(req.params.id))));

// ——— Clientes ———

export const getClientes = responder(200, async () => ({ clientes: await svc.listarClientes() }));
export const postCliente = responder(201, async (req) => ({ cliente: await svc.crearCliente(req.body ?? {}, usuario(req)) }));
export const putCliente = responder(200, async (req) => ({ cliente: await svc.actualizarCliente(String(req.params.id), req.body ?? {}, usuario(req)) }));
export const deleteCliente = responder(204, async (req) => void (await svc.eliminarCliente(String(req.params.id))));

// ——— Agenda / bitácora ———

export const getApuntes = responder(200, async () => ({ apuntes: await svc.listarApuntes() }));
export const postApunte = responder(201, async (req) => ({ apunte: await svc.crearApunte(req.body ?? {}, usuario(req)) }));
export const putApunte = responder(200, async (req) => ({ apunte: await svc.actualizarApunte(String(req.params.id), req.body ?? {}, usuario(req)) }));
export const deleteApunte = responder(204, async (req) => void (await svc.eliminarApunte(String(req.params.id))));

// ——— Recordatorios a gerencia ———

export const getRecordatorios = responder(200, (_req) => svc.listarRecordatorios());
export const postRecordatorio = responder(201, async (req) => ({ recordatorio: await svc.crearRecordatorio(req.body ?? {}, usuario(req)) }));
export const putRecordatorio = responder(200, async (req) => ({ recordatorio: await svc.actualizarRecordatorio(String(req.params.id), req.body ?? {}, usuario(req)) }));
export const deleteRecordatorio = responder(204, async (req) => void (await svc.eliminarRecordatorio(String(req.params.id))));
export const postEnviarRecordatorio = responder(200, (req) => svc.enviarRecordatorioAhora(String(req.params.id), usuario(req)));

// ——— Cuentas por cobrar de la asistente (misma lógica, ámbito aparte) ———

export const getCuentas = responder(200, async () => ({ cuentas: await cuentasSvc.listarCuentas("asistencia") }));
export const postCuenta = responder(201, async (req) => ({ cuenta: await cuentasSvc.crearCuenta(req.body ?? {}, usuario(req), "asistencia") }));
export const putCuenta = responder(200, async (req) => ({ cuenta: await cuentasSvc.actualizarCuenta(String(req.params.id), req.body ?? {}, usuario(req), "asistencia") }));
export const deleteCuenta = responder(204, async (req) => void (await cuentasSvc.eliminarCuenta(String(req.params.id), "asistencia")));
export const postAbono = responder(201, async (req) => ({ cuenta: await cuentasSvc.registrarAbono(String(req.params.id), req.body ?? {}, usuario(req), "asistencia") }));
export const deleteAbono = responder(200, async (req) => ({ cuenta: await cuentasSvc.eliminarAbono(String(req.params.id), String(req.params.abonoId), usuario(req), "asistencia") }));
export const getAjustes = responder(200, async () => ({ ajustes: await cuentasSvc.leerAjustes("asistencia") }));
export const putAjustes = responder(200, async (req) => ({ ajustes: await cuentasSvc.guardarAjustes(req.body ?? {}, usuario(req), "asistencia") }));

// ——— Alertas (el resumen diario de la asistente) ———

export const getAlertas = responder(200, async () => ({ alertas: await svc.leerAlertas() }));
export const putAlertas = responder(200, async (req) => ({ alertas: await svc.guardarAlertas(req.body ?? {}, usuario(req)) }));
/** Botón "Enviar resumen ahora": sale aunque ya se haya enviado hoy. */
export const postEnviarResumen = responder(200, () => svc.enviarResumen({ forzar: true }));

/**
 * Tarea diaria de Vercel (08:00 Ecuador): resumen a la asistente y
 * recordatorios a gerencia. Firmada con `Authorization: Bearer <CRON_SECRET>`.
 */
export async function cronRecordatorios(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!env.CRON_SECRET || req.headers.authorization !== `Bearer ${env.CRON_SECRET}`) {
      return void res.status(401).json({ error: "Unauthorized" });
    }
    res.status(200).json(await svc.correrCron());
  } catch (err) {
    responderError(err, res, next);
  }
}
