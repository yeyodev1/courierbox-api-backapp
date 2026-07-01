import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { getReporteEjecutivo } from "../controllers/reportes.controller.js";

const router = Router();

router.use(requireAuth);
router.use(requireRole(["admin", "gerencia", "superadmin"]));

router.get("/ejecutivo", getReporteEjecutivo);

export default router;
