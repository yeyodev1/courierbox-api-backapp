import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import {
  listCuentas,
  createCuenta,
  updateCuenta,
  deleteCuenta,
} from "../controllers/cuenta_bancaria.controller.js";

export const cuentasBancariasRouter = Router();

const canRead = requireRole(["admin", "asesor", "gerencia", "superadmin"]);
const adminOnly = requireRole(["admin", "gerencia", "superadmin"]);

cuentasBancariasRouter.use(requireAuth);

cuentasBancariasRouter.get("/", canRead, listCuentas);
cuentasBancariasRouter.post("/", adminOnly, createCuenta);
cuentasBancariasRouter.patch("/:id", adminOnly, updateCuenta);
cuentasBancariasRouter.delete("/:id", adminOnly, deleteCuenta);
