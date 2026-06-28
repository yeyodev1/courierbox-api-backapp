import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import {
  listProveedores,
  getProveedor,
  createProveedor,
  updateProveedor,
  deleteProveedor,
} from "../controllers/proveedores.controller.js";

export const proveedoresRouter = Router();

proveedoresRouter.use(requireAuth);
proveedoresRouter.use(requireRole(["admin"]));

proveedoresRouter.get("/", listProveedores);
proveedoresRouter.get("/:id", getProveedor);
proveedoresRouter.post("/", createProveedor);
proveedoresRouter.patch("/:id", updateProveedor);
proveedoresRouter.delete("/:id", deleteProveedor);
