import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import {
  searchContactos,
  listContactos,
  getContacto,
  createContacto,
  updateContacto,
} from "../controllers/contactos_cb.controller.js";

export const contactosCbRouter = Router();

const canAccess = requireRole(["admin", "asesor", "gerencia", "superadmin"]);

contactosCbRouter.use(requireAuth);
contactosCbRouter.use(canAccess);

contactosCbRouter.get("/search", searchContactos);
contactosCbRouter.get("/list", listContactos);
contactosCbRouter.get("/:id", getContacto);
contactosCbRouter.post("/", createContacto);
contactosCbRouter.patch("/:id", updateContacto);
