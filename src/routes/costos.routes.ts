import { Router } from "express";
import multer from "multer";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import {
  listGastos,
  getGasto,
  createGasto,
  updateGasto,
  deleteGasto,
  uploadGastoArchivo,
  resumenGastos,
} from "../controllers/costos.controller.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(requireAuth);
router.use(requireRole(["admin", "gerencia", "superadmin"]));

router.get("/", listGastos);
router.get("/resumen", resumenGastos);
router.get("/:id", getGasto);
router.post("/", createGasto);
router.patch("/:id", updateGasto);
router.post("/:id/upload", upload.single("file"), uploadGastoArchivo);
router.delete("/:id", deleteGasto);

export default router;
