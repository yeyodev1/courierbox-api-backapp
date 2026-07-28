import { Router } from "express";
import multer from "multer";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import {
  generarFactura,
  getFacturasPendientes,
  registrarPago,
  confirmarPago,
  getHistorialFacturas,
} from "../controllers/facturacion.controller";

const upload = multer({ storage: multer.memoryStorage() });

export const facturacionRouter = Router();
const financeOnly = requireRole(["admin", "gerencia", "superadmin"]);

facturacionRouter.post("/generar", requireAuth, financeOnly, generarFactura);
facturacionRouter.get("/pendientes/:casillero", getFacturasPendientes);
facturacionRouter.post("/pagar", upload.single("comprobante"), registrarPago);
facturacionRouter.post("/confirmar/:facturaId", requireAuth, financeOnly, confirmarPago);
facturacionRouter.get("/historial", requireAuth, financeOnly, getHistorialFacturas);
