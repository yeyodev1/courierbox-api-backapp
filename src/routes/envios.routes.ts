import { Router } from "express";
import multer from "multer";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import type { UserRole } from "../models/user.model";
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
  iniciarRuta,
  marcarFallido,
  reprogramarEnvio,
  asignarMotorizado,
  listMotorizados,
  createMotorizado,
  deleteMotorizado,
  resumenEnvios,
} from "../controllers/envios.controller";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Tipo de archivo no permitido"));
  },
});

const OPERATIONS: UserRole[] = ["admin", "gerencia", "superadmin", "bodega"];
const OPERATIONS_AND_MOTORIZADO: UserRole[] = [...OPERATIONS, "motorizado"];
const FINANCE: UserRole[] = ["admin", "gerencia", "superadmin"];
const USER_MANAGERS: UserRole[] = ["admin", "gerencia", "superadmin"];

router.use(requireAuth);

// Read + delivery execution: staff and motorizados (controller scopes motorizados to their own).
router.get("/", requireRole(OPERATIONS_AND_MOTORIZADO), listEnvios);
router.get("/resumen", requireRole(OPERATIONS), resumenEnvios);
router.get("/motorizados", requireRole(OPERATIONS), listMotorizados);
router.post("/motorizados", requireRole(USER_MANAGERS), createMotorizado);
router.delete("/motorizados/:id", requireRole(USER_MANAGERS), deleteMotorizado);
router.get("/buscar-paquetes", requireRole(OPERATIONS), buscarPaquetes);
router.get("/buscar-clientes", requireRole(OPERATIONS), buscarClientes);
router.get("/:id", requireRole(OPERATIONS_AND_MOTORIZADO), getEnvio);
router.patch("/:id/iniciar-ruta", requireRole(["motorizado"]), iniciarRuta);
router.patch("/:id/entregado", requireRole(["motorizado"]), marcarEntregado);
router.patch("/:id/fallido", requireRole(["motorizado"]), marcarFallido);
router.patch("/:id/reprogramar", requireRole(OPERATIONS), reprogramarEnvio);
router.post("/:id/upload", requireRole(OPERATIONS_AND_MOTORIZADO), upload.single("file"), uploadEnvioArchivo);

// Management: staff only.
router.post("/", requireRole(OPERATIONS), createEnvio);
router.patch("/:id/asignar", requireRole(OPERATIONS), asignarMotorizado);
router.patch("/:id/pago", requireRole(FINANCE), marcarPagoEnvio);
router.patch("/:id", requireRole(OPERATIONS), updateEnvio);
router.delete("/:id", requireRole(FINANCE), deleteEnvio);

export default router;
