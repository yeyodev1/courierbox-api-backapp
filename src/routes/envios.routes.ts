import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  listEnvios,
  getEnvio,
  createEnvio,
  updateEnvio,
  deleteEnvio,
  buscarPaquetes,
  buscarClientes,
  marcarPagoEnvio,
} from "../controllers/envios.controller.js";

const router = Router();

router.use(requireAuth);

router.get("/", listEnvios);
router.get("/buscar-paquetes", buscarPaquetes);
router.get("/buscar-clientes", buscarClientes);
router.get("/:id", getEnvio);
router.post("/", createEnvio);
router.patch("/:id", updateEnvio);
router.patch("/:id/pago", marcarPagoEnvio);
router.delete("/:id", deleteEnvio);

export default router;
