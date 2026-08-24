import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import {
  createInventario,
  createVenta,
  listInventario,
  listVentas,
  recordatoriosCobro,
  buscarClientesVenta,
  crearClienteVenta,
  updateInventario,
} from "../controllers/ventas_producto.controller";

const router = Router();

router.use(requireAuth);
router.use(requireRole(["admin", "gerencia", "superadmin", "asesor"]));

// Inventory
router.get("/inventario", listInventario);
router.post("/inventario", createInventario);
router.patch("/inventario/:id", updateInventario);

// Sales
router.get("/", listVentas);
router.post("/", createVenta);
router.get("/recordatorios", recordatoriosCobro);
router.get("/clientes", buscarClientesVenta);
router.post("/clientes", crearClienteVenta);

export default router;
