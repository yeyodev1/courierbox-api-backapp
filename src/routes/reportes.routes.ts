import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import { getComisiones, getEmbudoOperativo, getRentabilidadEnvios, getReporteEjecutivo, getVentasDiarias } from "../controllers/reportes.controller";

const router = Router();

router.use(requireAuth);
router.use(requireRole(["admin", "gerencia", "superadmin"]));

router.get("/ejecutivo", getReporteEjecutivo);
router.get("/embudo-operativo", getEmbudoOperativo);
router.get("/ventas-diarias", getVentasDiarias);
router.get("/comisiones", getComisiones);
router.get("/envios-rentabilidad", getRentabilidadEnvios);

export default router;
