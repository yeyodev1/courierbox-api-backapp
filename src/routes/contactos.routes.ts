import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import { listContactos, getContacto } from "../controllers/contactos.controller";

export const contactosRouter = Router();

contactosRouter.use(requireAuth);
contactosRouter.use(requireRole(["admin"]));

contactosRouter.get("/", listContactos);
contactosRouter.get("/detail", getContacto);
