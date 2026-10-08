import { Router } from "express";
import multer from "multer";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import { getAliados, postAliado, putAliado, postLogoAliado } from "../controllers/aliados.controller";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

export const aliadosRouter = Router();
const gestion = requireRole(["admin", "gerencia", "superadmin"]);

// La bodega los lee para imprimir etiquetas; cambiarlos (y su tarifa) es de administración.
aliadosRouter.get("/", requireAuth, requireRole(["admin", "gerencia", "superadmin", "bodega"]), getAliados);
aliadosRouter.post("/", requireAuth, gestion, postAliado);
aliadosRouter.put("/:id", requireAuth, gestion, putAliado);
aliadosRouter.post("/:id/logo", requireAuth, gestion, upload.single("logo"), postLogoAliado);
