import { Router } from "express";
import multer from "multer";
import {
  uploadExcel,
  getPendientes,
  getPendientesHomologacion,
  postHomologar,
  buscarClientesMaster,
  postRecalcularNombres,
} from "../controllers/etl.controller";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

const upload = multer({ storage: multer.memoryStorage() });

export const etlRouter = Router();

etlRouter.use(requireAuth);
etlRouter.use(requireRole(["admin", "gerencia", "superadmin"]));
etlRouter.post("/upload", upload.single("file"), uploadExcel);
etlRouter.get("/pendientes", getPendientes);
etlRouter.get("/homologacion", getPendientesHomologacion);
etlRouter.get("/clientes-master", buscarClientesMaster);
etlRouter.post("/homologar", postHomologar);
etlRouter.post("/recalcular-nombres", postRecalcularNombres);
