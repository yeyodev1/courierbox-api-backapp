import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  listGastos,
  getGasto,
  createGasto,
  updateGasto,
  deleteGasto,
} from "../controllers/costos.controller.js";

const router = Router();

router.use(requireAuth);

router.get("/", listGastos);
router.get("/:id", getGasto);
router.post("/", createGasto);
router.patch("/:id", updateGasto);
router.delete("/:id", deleteGasto);

export default router;
