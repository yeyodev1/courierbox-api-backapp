import type { Request, Response, NextFunction } from "express";
import {
  anularRetiro,
  buildComprobanteHtml,
  crearRetiro,
  listarRetiros,
  obtenerRetiro,
  paquetesDisponibles,
} from "../services/retiro_counter.service";
import { htmlToPdf } from "../services/pdf.service";

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as any).user;
    const retiro = await crearRetiro({
      ...req.body,
      atendidoPor: user?.userId ?? user?.id,
      atendidoPorNombre: user?.name ?? user?.email ?? "",
    });
    res.status(201).json({ retiro });
  } catch (error) {
    next(error);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const retiros = await listarRetiros({
      q: req.query.q ? String(req.query.q) : undefined,
      desde: req.query.desde ? String(req.query.desde) : undefined,
      hasta: req.query.hasta ? String(req.query.hasta) : undefined,
      estado: req.query.estado ? String(req.query.estado) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ retiros });
  } catch (error) {
    next(error);
  }
}

export async function disponibles(req: Request, res: Response, next: NextFunction) {
  try {
    const paquetes = await paquetesDisponibles(String(req.query.q ?? ""));
    res.json({ paquetes });
  } catch (error) {
    next(error);
  }
}

export async function detail(req: Request, res: Response, next: NextFunction) {
  try {
    const retiro = await obtenerRetiro(String(req.params.id));
    if (!retiro) {
      res.status(404).json({ error: "Retiro no encontrado" });
      return;
    }
    res.json({ retiro });
  } catch (error) {
    next(error);
  }
}

/** Re-renders the receipt on demand — covers retiros whose upload failed. */
export async function comprobante(req: Request, res: Response, next: NextFunction) {
  try {
    const retiro = await obtenerRetiro(String(req.params.id));
    if (!retiro) {
      res.status(404).json({ error: "Retiro no encontrado" });
      return;
    }

    const pdf = await htmlToPdf(buildComprobanteHtml(retiro as never));
    const folio = String(retiro._id).slice(-8).toUpperCase();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="retiro-${folio}.pdf"`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
}

export async function anular(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as any).user;
    const retiro = await anularRetiro(
      String(req.params.id),
      String(req.body?.motivo ?? ""),
      user?.userId ?? user?.id
    );
    res.json({ retiro });
  } catch (error) {
    next(error);
  }
}
