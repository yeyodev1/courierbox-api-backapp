import type { Request, Response, NextFunction } from "express";
import {
  listNotifications,
  marcarEntregaEnviada,
  retryNotification,
} from "../services/notification.service";
import { NOTIFICACION_CANALES, type NotificacionCanal } from "../models/notificacion.model";

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const notificaciones = await listNotifications({
      estado: req.query.estado ? String(req.query.estado) : undefined,
      operacionTipo: req.query.operacionTipo ? String(req.query.operacionTipo) : undefined,
      operacionId: req.query.operacionId ? String(req.query.operacionId) : undefined,
      canal: req.query.canal ? String(req.query.canal) : undefined,
    });
    res.json({ notificaciones });
  } catch (error) {
    next(error);
  }
}

/** Records that an operator sent the composed WhatsApp message by hand. */
export async function marcarEnviada(req: Request, res: Response, next: NextFunction) {
  try {
    const value = String(req.body?.canal ?? req.query.canal ?? "whatsapp");
    if (!NOTIFICACION_CANALES.includes(value as NotificacionCanal)) {
      res.status(400).json({ error: `Canal inválido: ${value}` });
      return;
    }
    const user = (req as any).user;
    const notificacion = await marcarEntregaEnviada(
      String(req.params.id),
      value as NotificacionCanal,
      user?.userId ?? user?.id
    );
    res.json({ notificacion });
  } catch (error) {
    next(error);
  }
}

export async function retry(req: Request, res: Response, next: NextFunction) {
  try {
    // `?canal=whatsapp` retries just that channel — including one previously
    // skipped for a missing phone number.
    const raw = req.query.canal ?? req.body?.canal;
    let canal: NotificacionCanal | undefined;
    if (raw) {
      const value = String(raw);
      if (!NOTIFICACION_CANALES.includes(value as NotificacionCanal)) {
        res.status(400).json({ error: `Canal inválido: ${value}` });
        return;
      }
      canal = value as NotificacionCanal;
    }

    const notificacion = await retryNotification(String(req.params.id), canal);
    res.json({ notificacion });
  } catch (error) {
    next(error);
  }
}
