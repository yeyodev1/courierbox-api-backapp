import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import { deleteJornada, getJornada, getJornadas, getPlantilla, postJornada, putJornada, putPlantilla } from "../controllers/gerencia.controller";

export const gerenciaRouter = Router();
// Control gerencial: solo la vista de Oscar (superadmin), ni siquiera administración.
const soloGerente = [requireAuth, requireRole(["superadmin"])];

gerenciaRouter.get("/plantilla", ...soloGerente, getPlantilla);
gerenciaRouter.put("/plantilla", ...soloGerente, putPlantilla);
gerenciaRouter.get("/jornadas", ...soloGerente, getJornadas);
gerenciaRouter.get("/jornadas/:id", ...soloGerente, getJornada);
gerenciaRouter.post("/jornadas", ...soloGerente, postJornada);
gerenciaRouter.put("/jornadas/:id", ...soloGerente, putJornada);
gerenciaRouter.delete("/jornadas/:id", ...soloGerente, deleteJornada);
