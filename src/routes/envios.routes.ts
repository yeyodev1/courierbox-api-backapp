import { Router } from "express";
import multer from "multer";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
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
  asignarMotorizado,
  listMotorizados,
  createMotorizado,
  deleteMotorizado,
  resumenEnvios,
} from "../controllers/envios.controller";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

const STAFF = ["admin", "asesor", "gerencia", "superadmin", "bodega"];
const STAFF_AND_MOTORIZADO = [...STAFF, "motorizado"];

router.use(requireAuth);

// Read + delivery execution: staff and motorizados (controller scopes motorizados to their own).
router.get("/", requireRole(STAFF_AND_MOTORIZADO), listEnvios);
router.get("/resumen", requireRole(STAFF), resumenEnvios);
router.get("/motorizados", requireRole(STAFF), listMotorizados);
router.post("/motorizados", requireRole(STAFF), createMotorizado);
router.delete("/motorizados/:id", requireRole(STAFF), deleteMotorizado);
router.get("/buscar-paquetes", requireRole(STAFF), buscarPaquetes);
router.get("/buscar-clientes", requireRole(STAFF), buscarClientes);
router.get("/:id", requireRole(STAFF_AND_MOTORIZADO), getEnvio);
router.patch("/:id/entregado", requireRole(STAFF_AND_MOTORIZADO), marcarEntregado);
router.post("/:id/upload", requireRole(STAFF_AND_MOTORIZADO), upload.single("file"), uploadEnvioArchivo);

// Management: staff only.
router.post("/", requireRole(STAFF), createEnvio);
router.patch("/:id/asignar", requireRole(STAFF), asignarMotorizado);
router.patch("/:id/pago", requireRole(STAFF), marcarPagoEnvio);
router.patch("/:id", requireRole(STAFF), updateEnvio);
router.delete("/:id", requireRole(STAFF), deleteEnvio);

export default router;
