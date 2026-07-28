import type { Request, Response, NextFunction } from "express";
import { listNotifications, retryNotification } from "../services/notification.service";

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const notificaciones = await listNotifications({
      estado: req.query.estado ? String(req.query.estado) : undefined,
      operacionTipo: req.query.operacionTipo ? String(req.query.operacionTipo) : undefined,
      operacionId: req.query.operacionId ? String(req.query.operacionId) : undefined,
    });
    res.json({ notificaciones });
  } catch (error) {
    next(error);
  }
}

export async function retry(req: Request, res: Response, next: NextFunction) {
  try {
    const notificacion = await retryNotification(String(req.params.id));
    res.json({ notificacion });
  } catch (error) {
    next(error);
  }
}
