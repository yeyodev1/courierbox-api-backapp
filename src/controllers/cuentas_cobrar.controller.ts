import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env";
import * as svc from "../services/cuentas_cobrar.service";

const usuario = (req: Request) => (req.user as { email?: string } | undefined)?.email ?? "";

/** Los errores de validación del servicio traen su status; el resto es un 500. */
function responderError(err: any, res: Response, next: NextFunction) {
  if (err?.status && err.status < 500) return void res.status(err.status).json({ error: err.message });
  if (err?.status === 502) return void res.status(502).json({ error: err.message });
  next(err);
}

export async function getCuentas(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json({ cuentas: await svc.listarCuentas() });
  } catch (err) {
    next(err);
  }
}

export async function postCuenta(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(201).json({ cuenta: await svc.crearCuenta(req.body ?? {}, usuario(req)) });
  } catch (err) {
    responderError(err, res, next);
  }
}

export async function putCuenta(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json({ cuenta: await svc.actualizarCuenta(String(req.params.id), req.body ?? {}, usuario(req)) });
  } catch (err) {
    responderError(err, res, next);
  }
}

export async function deleteCuenta(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await svc.eliminarCuenta(String(req.params.id));
    res.status(204).end();
  } catch (err) {
    responderError(err, res, next);
  }
}

export async function postAbono(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(201).json({ cuenta: await svc.registrarAbono(String(req.params.id), req.body ?? {}, usuario(req)) });
  } catch (err) {
    responderError(err, res, next);
  }
}

export async function deleteAbono(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json({ cuenta: await svc.eliminarAbono(String(req.params.id), String(req.params.abonoId), usuario(req)) });
  } catch (err) {
    responderError(err, res, next);
  }
}

export async function getAjustes(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json({ ajustes: await svc.leerAjustes() });
  } catch (err) {
    next(err);
  }
}

export async function putAjustes(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json({ ajustes: await svc.guardarAjustes(req.body ?? {}, usuario(req)) });
  } catch (err) {
    responderError(err, res, next);
  }
}

/** Saldos que ya están en la plataforma (facturas, ventas, gestiones), solo lectura. */
export async function getPlataforma(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json({ cuentas: await svc.cuentasDePlataforma() });
  } catch (err) {
    next(err);
  }
}

export async function getAlertas(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json({ alertas: await svc.leerAlertas() });
  } catch (err) {
    next(err);
  }
}

export async function putAlertas(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json({ alertas: await svc.guardarAlertas(req.body ?? {}, usuario(req)) });
  } catch (err) {
    responderError(err, res, next);
  }
}

/** Botón "Enviar resumen ahora": sale aunque ya se haya enviado hoy. */
export async function postEnviarResumen(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await svc.enviarResumen({ forzar: true }));
  } catch (err) {
    responderError(err, res, next);
  }
}

/**
 * Tarea diaria de Vercel (08:00 Ecuador). Vercel firma la llamada con
 * `Authorization: Bearer <CRON_SECRET>`; sin ese secreto configurado no corre.
 */
export async function cronRecordatorios(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!env.CRON_SECRET || req.headers.authorization !== `Bearer ${env.CRON_SECRET}`) {
      return void res.status(401).json({ error: "Unauthorized" });
    }
    res.status(200).json(await svc.enviarResumen());
  } catch (err) {
    responderError(err, res, next);
  }
}
