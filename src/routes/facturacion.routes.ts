import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  generarFactura,
  getFacturasPendientes,
  registrarPago,
  confirmarPago,
  getHistorialFacturas,
} from "../controllers/facturacion.controller.js";

const upload = multer({ storage: multer.memoryStorage() });

export const facturacionRouter = Router();

facturacionRouter.post("/generar", requireAuth, generarFactura);
facturacionRouter.get("/pendientes/:casillero", getFacturasPendientes);
facturacionRouter.post("/pagar", upload.single("comprobante"), registrarPago);
facturacionRouter.post("/confirmar/:facturaId", requireAuth, confirmarPago);
facturacionRouter.get("/historial", requireAuth, getHistorialFacturas);
