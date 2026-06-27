import { Router } from "express";
import multer from "multer";
import { uploadExcel, getPendientes } from "../controllers/etl.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const upload = multer({ storage: multer.memoryStorage() });

export const etlRouter = Router();

etlRouter.post("/upload", requireAuth, upload.single("file"), uploadExcel);
etlRouter.get("/pendientes", requireAuth, getPendientes);
