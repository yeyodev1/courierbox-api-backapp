import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { listContactos, getContacto } from "../controllers/contactos.controller.js";

export const contactosRouter = Router();

contactosRouter.use(requireAuth);
contactosRouter.use(requireRole(["admin"]));

contactosRouter.get("/", listContactos);
contactosRouter.get("/detail", getContacto);
