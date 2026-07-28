import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import { list, retry } from "../controllers/notificacion.controller";

const router = Router();

router.use(requireAuth);
router.use(requireRole(["admin", "gerencia", "superadmin"]));
router.get("/", list);
router.post("/:id/reintentar", retry);

export default router;
