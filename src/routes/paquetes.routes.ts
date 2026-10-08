import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import { getPaquetes, getPaquete, getEtiquetas } from "../controllers/paquetes.controller";

export const paquetesRouter = Router();

// La bodega ingresa la carga e imprime las etiquetas; el counter busca cajas.
paquetesRouter.use(requireAuth, requireRole(["admin", "gerencia", "superadmin", "bodega"]));
paquetesRouter.get("/", getPaquetes);
paquetesRouter.post("/etiquetas", getEtiquetas);
paquetesRouter.get("/:id", getPaquete);
