import { Router } from "express";
import multer from "multer";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import { listCaja, createCaja, resumenCaja, uploadCajaArchivo, deleteCaja } from "../controllers/caja.controller";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(requireAuth);
router.use(requireRole(["admin", "gerencia", "superadmin"]));

router.get("/", listCaja);
router.get("/resumen", resumenCaja);
router.post("/", createCaja);
router.post("/:id/upload", upload.single("file"), uploadCajaArchivo);
router.delete("/:id", deleteCaja);

export default router;
