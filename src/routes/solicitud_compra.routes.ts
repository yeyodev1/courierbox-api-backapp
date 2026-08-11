import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import { rateLimit } from "../middleware/rate-limit";
import {
  cambiarEstado,
  cotizarPublico,
  crear,
  listar,
  tiendas,
} from "../controllers/solicitud_compra.controller";

export const solicitudCompraRouter = Router();

// ── Public (no auth): the self-service form on the marketing site.
// Rate limited because anyone on the internet can reach these.
solicitudCompraRouter.get("/tiendas", tiendas);
solicitudCompraRouter.post("/cotizar", rateLimit, cotizarPublico);
solicitudCompraRouter.post("/", rateLimit, crear);

// ── Internal: the queue advisors work from.
const staff = requireRole(["admin", "gerencia", "superadmin", "asesor"]);
solicitudCompraRouter.get("/", requireAuth, staff, listar);
solicitudCompraRouter.patch("/:id/estado", requireAuth, staff, cambiarEstado);

export default solicitudCompraRouter;
