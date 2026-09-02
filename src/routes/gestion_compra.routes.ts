import { Router } from "express";
import multer from "multer";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import {
  listGestiones,
  createGestion,
  getStatsMensuales,
  getByToken,
  getEvidenceByToken,
  getGestion,
  updateGestion,
  confirmarReserva,
  reNotificar,
  comisionPreview,
  uploadImagen,
  recepcionBodega,
  exportExcel,
  exportPdf,
  confirmarPago,
  registrarAbono,
  asignarComprador,
  marcarComprada,
  getBitacora,
} from "../controllers/gestion_compra.controller.js";

export const gestionCompraRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const canAccess = requireRole(["admin", "asesor", "gerencia", "superadmin", "bodega"]);
const adminOnly = requireRole(["admin", "gerencia", "superadmin"]);
const bodegaAccess = requireRole(["admin", "gerencia", "superadmin", "bodega"]);

// --- Public (no auth) ---
gestionCompraRouter.get("/view/:token/evidence/:type", getEvidenceByToken);
gestionCompraRouter.get("/view/:token", getByToken);

// --- Auth required for all below ---
gestionCompraRouter.use(requireAuth);

// Stats + preview (before /:id to avoid conflicts)
gestionCompraRouter.get("/stats/mensual", requireRole(["admin", "asesor", "gerencia", "superadmin"]), getStatsMensuales);
gestionCompraRouter.get("/comision-preview", canAccess, comisionPreview);
gestionCompraRouter.get("/export/excel", requireRole(["admin", "asesor", "gerencia", "superadmin"]), exportExcel);
gestionCompraRouter.get("/export/pdf", requireRole(["admin", "asesor", "gerencia", "superadmin"]), exportPdf);

// Upload imagen (multipart)
gestionCompraRouter.post("/upload-imagen", canAccess, upload.single("imagen"), uploadImagen);

// CRUD
gestionCompraRouter.get("/", canAccess, listGestiones);
gestionCompraRouter.post("/", requireRole(["admin", "asesor", "gerencia", "superadmin"]), createGestion);
gestionCompraRouter.get("/:id", canAccess, getGestion);
gestionCompraRouter.get("/:id/bitacora", canAccess, getBitacora);
gestionCompraRouter.patch("/:id", canAccess, updateGestion);

// Admin actions
gestionCompraRouter.post("/:id/confirmar-reserva", adminOnly, confirmarReserva);
gestionCompraRouter.post("/:id/confirmar-pago", adminOnly, confirmarPago);
gestionCompraRouter.post("/:id/abonos", adminOnly, registrarAbono);
gestionCompraRouter.post("/:id/asignar-comprador", adminOnly, asignarComprador);
gestionCompraRouter.post("/:id/marcar-comprada", canAccess, marcarComprada);
gestionCompraRouter.post("/:id/notificar", adminOnly, reNotificar);

// Bodega: registrar recepción (fotos) y notificar al cliente
gestionCompraRouter.post("/:id/recepcion-bodega", bodegaAccess, recepcionBodega);
