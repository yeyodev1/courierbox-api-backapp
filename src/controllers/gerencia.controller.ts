import type { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { models } from "../models/index";

const usuario = (req: Request) => (req.user as { email?: string } | undefined)?.email ?? "";
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function idValido(req: Request, res: Response): string | null {
  const id = String(req.params.id);
  if (!mongoose.isValidObjectId(id)) {
    res.status(404).json({ error: "Jornada no encontrada" });
    return null;
  }
  return id;
}

/** El listado no trae `datos`: puede pesar y la portada solo muestra el resumen. */
export async function getJornadas(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const jornadas = await models.jornadasGerenciales
      .find({}, { titulo: 1, fecha: 1, estado: 1, actualizadoPor: 1, createdAt: 1, updatedAt: 1, "datos.resumen": 1 })
      .sort({ fecha: -1, createdAt: -1 })
      .lean();
    res.status(200).json({ jornadas });
  } catch (err) {
    next(err);
  }
}

export async function getJornada(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = idValido(req, res);
    if (!id) return;
    const jornada = await models.jornadasGerenciales.findById(id).lean();
    if (!jornada) return void res.status(404).json({ error: "Jornada no encontrada" });
    res.status(200).json({ jornada });
  } catch (err) {
    next(err);
  }
}

export async function postJornada(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { titulo, fecha, datos } = req.body ?? {};
    if (typeof titulo !== "string" || !titulo.trim()) return void res.status(400).json({ error: "Falta el título" });
    if (typeof fecha !== "string" || !FECHA.test(fecha)) return void res.status(400).json({ error: "La fecha debe ser YYYY-MM-DD" });
    if (datos !== undefined && !esObjeto(datos)) return void res.status(400).json({ error: "Los datos deben ser un objeto" });

    const jornada = await models.jornadasGerenciales.create({ titulo, fecha, datos: datos ?? {}, actualizadoPor: usuario(req) });
    res.status(201).json({ jornada });
  } catch (err) {
    next(err);
  }
}

/** Autoguardado: el front manda el formulario completo cada vez que cambia. */
export async function putJornada(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = idValido(req, res);
    if (!id) return;
    const { titulo, fecha, estado, datos } = req.body ?? {};
    const cambios: Record<string, unknown> = { actualizadoPor: usuario(req) };

    if (titulo !== undefined) {
      if (typeof titulo !== "string" || !titulo.trim()) return void res.status(400).json({ error: "Falta el título" });
      cambios.titulo = titulo.trim();
    }
    if (fecha !== undefined) {
      if (typeof fecha !== "string" || !FECHA.test(fecha)) return void res.status(400).json({ error: "La fecha debe ser YYYY-MM-DD" });
      cambios.fecha = fecha;
    }
    if (estado !== undefined) {
      if (estado !== "borrador" && estado !== "cerrada") return void res.status(400).json({ error: "Estado inválido" });
      cambios.estado = estado;
    }
    if (datos !== undefined) {
      if (!esObjeto(datos)) return void res.status(400).json({ error: "Los datos deben ser un objeto" });
      cambios.datos = datos;
    }

    const jornada = await models.jornadasGerenciales
      .findByIdAndUpdate(id, { $set: cambios }, { new: true, projection: { datos: 0 } })
      .lean();
    if (!jornada) return void res.status(404).json({ error: "Jornada no encontrada" });
    res.status(200).json({ jornada });
  } catch (err) {
    next(err);
  }
}

export async function deleteJornada(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = idValido(req, res);
    if (!id) return;
    const borrada = await models.jornadasGerenciales.findByIdAndDelete(id).lean();
    if (!borrada) return void res.status(404).json({ error: "Jornada no encontrada" });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

const CLAVE_PLANTILLA = "gerencia.plantilla";

/** La plantilla con la que arrancan las jornadas nuevas; null = la del documento original. */
export async function getPlantilla(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const doc = await models.configuraciones.findOne({ clave: CLAVE_PLANTILLA }).lean();
    res.status(200).json({ plantilla: doc?.valor ?? null, actualizadoPor: doc?.actualizadoPor ?? "", actualizadaEn: doc?.updatedAt ?? null });
  } catch (err) {
    next(err);
  }
}

export async function putPlantilla(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { plantilla } = req.body ?? {};
    if (plantilla !== null && !esObjeto(plantilla)) return void res.status(400).json({ error: "Plantilla inválida" });
    await models.configuraciones.updateOne(
      { clave: CLAVE_PLANTILLA },
      { $set: { valor: plantilla, actualizadoPor: usuario(req) } },
      { upsert: true }
    );
    res.status(200).json({ plantilla });
  } catch (err) {
    next(err);
  }
}
