import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  listEnvios,
  getEnvio,
  createEnvio,
  updateEnvio,
  deleteEnvio,
  buscarPaquetes,
} from "../controllers/envios.controller.js";

const router = Router();

router.use(requireAuth);

router.get("/", listEnvios);
router.get("/buscar-paquetes", buscarPaquetes);
router.get("/:id", getEnvio);
router.post("/", createEnvio);
router.patch("/:id", updateEnvio);
router.delete("/:id", deleteEnvio);

export default router;
