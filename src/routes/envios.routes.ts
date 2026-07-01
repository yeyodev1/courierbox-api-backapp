import { Router } from "express";
import multer from "multer";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import {
  listEnvios,
  getEnvio,
  createEnvio,
  updateEnvio,
  deleteEnvio,
  buscarPaquetes,
  buscarClientes,
  marcarPagoEnvio,
  uploadEnvioArchivo,
  marcarEntregado,
  resumenEnvios,
} from "../controllers/envios.controller.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(requireAuth);
router.use(requireRole(["admin", "asesor", "gerencia", "superadmin"]));

router.get("/", listEnvios);
router.get("/resumen", resumenEnvios);
router.get("/buscar-paquetes", buscarPaquetes);
router.get("/buscar-clientes", buscarClientes);
router.get("/:id", getEnvio);
router.post("/", createEnvio);
router.patch("/:id", updateEnvio);
router.patch("/:id/pago", marcarPagoEnvio);
router.patch("/:id/entregado", marcarEntregado);
router.post("/:id/upload", upload.single("file"), uploadEnvioArchivo);
router.delete("/:id", deleteEnvio);

export default router;
