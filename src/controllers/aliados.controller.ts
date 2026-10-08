import type { Request, Response, NextFunction } from "express";
import { actualizarAliado, crearAliado, listarAliados } from "../services/aliados.service";
import { uploadLogoAliado } from "../services/upload.service";

const usuario = (req: Request) => (req.user as { email?: string } | undefined)?.email ?? "";

/** Los errores de validación del servicio traen su status; el resto es un 500. */
function responderError(err: any, res: Response, next: NextFunction) {
  if (err?.status && err.status < 500) return void res.status(err.status).json({ error: err.message });
  next(err);
}

export async function getAliados(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json({ aliados: await listarAliados() });
  } catch (err) {
    next(err);
  }
}

export async function postAliado(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(201).json({ aliado: await crearAliado(req.body ?? {}, usuario(req)) });
  } catch (err) {
    responderError(err, res, next);
  }
}

export async function putAliado(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json({ aliado: await actualizarAliado(String(req.params.id), req.body ?? {}, usuario(req)) });
  } catch (err) {
    responderError(err, res, next);
  }
}

/** Sube el logo (PNG, JPG, WEBP o SVG, hasta 1 MB) y lo deja puesto en el aliado. */
export async function postLogoAliado(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const file = req.file;
    if (!file) return void res.status(400).json({ error: "Adjunta la imagen del logo" });
    if (!/^image\/(png|jpe?g|webp|svg\+xml)$/.test(file.mimetype)) {
      return void res.status(400).json({ error: "El logo debe ser PNG, JPG, WEBP o SVG" });
    }
    if (file.size > 1024 * 1024) return void res.status(400).json({ error: "El logo pesa más de 1 MB" });
    const subida = await uploadLogoAliado(file.buffer);
    if (!subida.url) return void res.status(503).json({ error: "No se pudo guardar la imagen (almacenamiento no configurado)" });
    res.status(200).json({ aliado: await actualizarAliado(String(req.params.id), { logoUrl: subida.url }, usuario(req)) });
  } catch (err) {
    responderError(err, res, next);
  }
}
