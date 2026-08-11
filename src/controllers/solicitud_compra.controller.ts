import type { Request, Response, NextFunction } from "express";
import {
  actualizarEstadoSolicitud,
  cotizar,
  crearSolicitud,
  listarSolicitudes,
  listarTiendasPermitidas,
} from "../services/solicitud_compra.service";
import { SOLICITUD_ESTADOS, type SolicitudEstado } from "../models/solicitud_compra.model";

/** Public: live quote as the visitor types, before anything is stored. */
export async function cotizarPublico(req: Request, res: Response, next: NextFunction) {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) {
      res.status(400).json({ error: "Agrega al menos un producto" });
      return;
    }
    const cotizacion = await cotizar(items);
    res.json(cotizacion);
  } catch (error) {
    next(error);
  }
}

/** Public: stores the request and acknowledges it to the client. */
export async function crear(req: Request, res: Response, next: NextFunction) {
  try {
    const solicitud = await crearSolicitud({
      ...req.body,
      origenIp: (req.ip ?? req.socket.remoteAddress ?? "").toString(),
    });
    res.status(201).json({
      solicitud: {
        _id: solicitud._id,
        folio: String(solicitud._id).slice(-8).toUpperCase(),
        subtotal: solicitud.subtotal,
        comisionEstimada: solicitud.comisionEstimada,
        totalEstimado: solicitud.totalEstimado,
        clienteEmail: solicitud.clienteEmail,
      },
    });
  } catch (error) {
    next(error);
  }
}

/** Public: the store list the form validates against, so the UI can show it. */
export async function tiendas(_req: Request, res: Response) {
  res.json({ tiendas: listarTiendasPermitidas() });
}

export async function listar(req: Request, res: Response, next: NextFunction) {
  try {
    const solicitudes = await listarSolicitudes({
      estado: req.query.estado ? String(req.query.estado) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ solicitudes });
  } catch (error) {
    next(error);
  }
}

export async function cambiarEstado(req: Request, res: Response, next: NextFunction) {
  try {
    const estado = String(req.body?.estado ?? "");
    if (!SOLICITUD_ESTADOS.includes(estado as SolicitudEstado)) {
      res.status(400).json({ error: `Estado inválido: ${estado}` });
      return;
    }
    const user = (req as any).user;
    const solicitud = await actualizarEstadoSolicitud(
      String(req.params.id),
      estado as SolicitudEstado,
      user?.userId ?? user?.id,
      req.body?.notasInternas
    );
    res.json({ solicitud });
  } catch (error) {
    next(error);
  }
}
