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
  validarFactura,
  completarCliente,
  sincronizarSri,
  diagnosticoContifico,
  getConfiguracionFacturacion,
  putConfiguracionFacturacion,
  getPerfilesCliente,
  postPerfilCliente,
  putPerfilCliente,
  deletePerfilCliente,
} from "../controllers/facturacion.controller";

const upload = multer({ storage: multer.memoryStorage() });

export const facturacionRouter = Router();
const financeOnly = requireRole(["admin", "gerencia", "superadmin"]);
// Invoicing happens at the counter, which is staffed by the bodega role — the
// same role already trusted to release packages against a signature.
const counterAccess = requireRole(["admin", "gerencia", "superadmin", "bodega"]);

facturacionRouter.get("/facturables", requireAuth, counterAccess, getFacturables);
facturacionRouter.post("/preview", requireAuth, counterAccess, previewFactura);
facturacionRouter.post("/validar", requireAuth, counterAccess, validarFactura);
facturacionRouter.get("/configuracion", requireAuth, counterAccess, getConfiguracionFacturacion);
facturacionRouter.put("/configuracion", requireAuth, financeOnly, putConfiguracionFacturacion);
facturacionRouter.get("/contifico/diagnostico", requireAuth, financeOnly, diagnosticoContifico);
facturacionRouter.patch("/cliente/:id", requireAuth, counterAccess, completarCliente);
facturacionRouter.get("/cliente/:id/perfiles", requireAuth, counterAccess, getPerfilesCliente);
facturacionRouter.post("/cliente/:id/perfiles", requireAuth, counterAccess, postPerfilCliente);
facturacionRouter.put("/cliente/:id/perfiles/:perfilId", requireAuth, counterAccess, putPerfilCliente);
facturacionRouter.delete("/cliente/:id/perfiles/:perfilId", requireAuth, counterAccess, deletePerfilCliente);
facturacionRouter.post("/:facturaId/sri", requireAuth, counterAccess, sincronizarSri);
facturacionRouter.post("/generar", requireAuth, counterAccess, generarFactura);
facturacionRouter.get("/pendientes/:casillero", getFacturasPendientes);
facturacionRouter.post("/pagar", upload.single("comprobante"), registrarPago);
facturacionRouter.post("/confirmar/:facturaId", requireAuth, financeOnly, confirmarPago);
// El counter también necesita ver qué se facturó (número, estado SRI, PDF).
facturacionRouter.get("/historial", requireAuth, counterAccess, getHistorialFacturas);
