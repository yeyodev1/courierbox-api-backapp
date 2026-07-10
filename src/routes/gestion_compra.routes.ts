import { Router } from "express";
import multer from "multer";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import {
  listGestiones,
  createGestion,
  getStatsMensuales,
  getByToken,
  getGestion,
  updateGestion,
  confirmarReserva,
  reNotificar,
  comisionPreview,
  uploadImagen,
} from "../controllers/gestion_compra.controller.js";

export const gestionCompraRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const canAccess = requireRole(["admin", "asesor", "gerencia", "superadmin"]);
const adminOnly = requireRole(["admin", "gerencia", "superadmin"]);

// --- Public (no auth) ---
gestionCompraRouter.get("/view/:token", getByToken);

// --- Auth required for all below ---
gestionCompraRouter.use(requireAuth);

// Stats + preview (before /:id to avoid conflicts)
gestionCompraRouter.get("/stats/mensual", canAccess, getStatsMensuales);
gestionCompraRouter.get("/comision-preview", canAccess, comisionPreview);

// Upload imagen (multipart)
gestionCompraRouter.post("/upload-imagen", canAccess, upload.single("imagen"), uploadImagen);

// CRUD
gestionCompraRouter.get("/", canAccess, listGestiones);
gestionCompraRouter.post("/", canAccess, createGestion);
gestionCompraRouter.get("/:id", canAccess, getGestion);
gestionCompraRouter.patch("/:id", canAccess, updateGestion);

// Admin actions
gestionCompraRouter.post("/:id/confirmar-reserva", adminOnly, confirmarReserva);
gestionCompraRouter.post("/:id/notificar", adminOnly, reNotificar);
