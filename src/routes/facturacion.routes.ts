import { Router } from "express";
import multer from "multer";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import {
  generarFactura,
  getFacturables,
  previewFactura,
  getFacturasPendientes,
  registrarPago,
  confirmarPago,
  getHistorialFacturas,
} from "../controllers/facturacion.controller";

const upload = multer({ storage: multer.memoryStorage() });

export const facturacionRouter = Router();
const financeOnly = requireRole(["admin", "gerencia", "superadmin"]);
// Invoicing happens at the counter, which is staffed by the bodega role — the
// same role already trusted to release packages against a signature.
const counterAccess = requireRole(["admin", "gerencia", "superadmin", "bodega"]);

facturacionRouter.get("/facturables", requireAuth, counterAccess, getFacturables);
facturacionRouter.post("/preview", requireAuth, counterAccess, previewFactura);
facturacionRouter.post("/generar", requireAuth, counterAccess, generarFactura);
facturacionRouter.get("/pendientes/:casillero", getFacturasPendientes);
facturacionRouter.post("/pagar", upload.single("comprobante"), registrarPago);
facturacionRouter.post("/confirmar/:facturaId", requireAuth, financeOnly, confirmarPago);
facturacionRouter.get("/historial", requireAuth, financeOnly, getHistorialFacturas);
