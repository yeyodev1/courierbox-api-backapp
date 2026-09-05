import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import {
  createInventario,
  createVenta,
  eliminarAbono,
  getVenta,
  listInventario,
  listVentas,
  recordatoriosCobro,
  registrarAbono,
  buscarClientesVenta,
  crearClienteVenta,
  updateInventario,
  updateVenta,
} from "../controllers/ventas_producto.controller";

const router = Router();

router.use(requireAuth);
router.use(requireRole(["admin", "gerencia", "superadmin", "asesor"]));

/** Correcting a sale or its payments moves money, so it stays with admin. */
const adminOnly = requireRole(["admin", "gerencia", "superadmin"]);

// Inventory
router.get("/inventario", listInventario);
router.post("/inventario", createInventario);
router.patch("/inventario/:id", updateInventario);

// Sales — fixed segments first, so "/recordatorios" is not read as an id.
router.get("/", listVentas);
router.post("/", createVenta);
router.get("/recordatorios", recordatoriosCobro);
router.get("/clientes", buscarClientesVenta);
router.post("/clientes", crearClienteVenta);

router.get("/:id", getVenta);
router.patch("/:id", adminOnly, updateVenta);
router.post("/:id/abonos", adminOnly, registrarAbono);
router.delete("/:id/abonos/:abonoId", adminOnly, eliminarAbono);

export default router;
