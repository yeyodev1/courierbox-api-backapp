import { Router } from "express";
import { getUsers, createUser, updateUser, deleteUser } from "../controllers/user.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";

const router = Router();

router.use(requireAuth);
router.use(requireRole(["admin"]));

router.get("/", getUsers);
router.post("/", createUser);
router.put("/:id", updateUser);
router.delete("/:id", deleteUser);

export default router;
