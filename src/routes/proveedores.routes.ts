import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import {
  listProveedores,
  getProveedor,
  createProveedor,
  updateProveedor,
  deleteProveedor,
} from "../controllers/proveedores.controller";
import { addProviderType, deleteProviderType, listProviderTypes } from "../controllers/provider-types.controller";

export const proveedoresRouter = Router();
const providerTypesRouter = Router();

proveedoresRouter.use(requireAuth);
proveedoresRouter.use(requireRole(["admin", "gerencia", "superadmin"]));

providerTypesRouter.get("/", listProviderTypes);
providerTypesRouter.post("/", addProviderType);
providerTypesRouter.delete("/:type", deleteProviderType);

proveedoresRouter.get("/", listProveedores);
proveedoresRouter.use("/tipos", providerTypesRouter);
proveedoresRouter.get("/:id", getProveedor);
proveedoresRouter.post("/", createProveedor);
proveedoresRouter.patch("/:id", updateProveedor);
proveedoresRouter.delete("/:id", deleteProveedor);
