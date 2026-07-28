import { Router } from "express";
import multer from "multer";
import { uploadExcel, getPendientes } from "../controllers/etl.controller";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

const upload = multer({ storage: multer.memoryStorage() });

export const etlRouter = Router();

etlRouter.use(requireAuth);
etlRouter.use(requireRole(["admin", "gerencia", "superadmin"]));
etlRouter.post("/upload", upload.single("file"), uploadExcel);
etlRouter.get("/pendientes", getPendientes);
