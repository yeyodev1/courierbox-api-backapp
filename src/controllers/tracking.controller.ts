import type { RequestHandler } from "express";
import { trackingParams } from "../schemas/tracking.schema";
import { getTracking } from "../services/tracking.service";

export const getTrackingHandler: RequestHandler = async (req, res, next) => {
  try {
    const { codigo } = trackingParams.parse(req.params);
    const data = await getTracking(codigo);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

export const getTrackingTextHandler: RequestHandler = async (req, res, next) => {
  try {
    const { codigo } = trackingParams.parse(req.params);
    const data = await getTracking(codigo);
    const lines = [
      `📦 Tracking ${data.codigo}`,
      data.wr ? `WR: ${data.wr}` : null,
      `Estado: ${data.estadoLabel}`,
      data.notes ? `Para: ${data.notes}` : null,
      data.descripcion ? `Descripción: ${data.descripcion}` : null,
      data.pesoLb != null ? `Peso: ${data.pesoLb} lb` : null,
      data.costo
        ? `Flete: $${data.costo.flete.toFixed(2)} · Arancel: $${data.costo.arancel.toFixed(2)} · Total estimado: $${data.costo.total.toFixed(2)}`
        : null,
      data.fechaRecepcion ? `Recibido: ${data.fechaRecepcion}` : null,
      "",
      "Historial:",
      ...data.eventos.map((e) => `• ${e.fechaTexto || (e.fecha ? new Date(e.fecha).toLocaleString("es-EC") : "—")} — ${e.descripcion}`),
    ].filter(Boolean);
    res.type("text/plain; charset=utf-8").send(lines.join("\n"));
  } catch (err) {
    next(err);
  }
};
