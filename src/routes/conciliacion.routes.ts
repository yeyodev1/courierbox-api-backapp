import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../middleware/auth.middleware";
import { cargarCsv, getPagosVerificando, getResumenConciliacion } from "../controllers/conciliacion.controller";

const upload = multer({ storage: multer.memoryStorage() });

export const conciliacionRouter = Router();

conciliacionRouter.use(requireAuth);

conciliacionRouter.post("/cargar-csv", upload.single("csv"), cargarCsv);
conciliacionRouter.get("/verificando", getPagosVerificando);
conciliacionRouter.get("/resumen", getResumenConciliacion);
