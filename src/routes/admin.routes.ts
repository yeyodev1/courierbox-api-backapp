import { Router } from "express";
import { getGeneralMetrics, getAgentMetrics, getRecentConversations, getDailyChart } from "../controllers/admin.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";

export const adminRouter = Router();

adminRouter.use(requireAuth);
adminRouter.use(requireRole(["admin", "gerencia", "superadmin"]));

adminRouter.get("/metrics/general", getGeneralMetrics);
adminRouter.get("/metrics/agents", getAgentMetrics);
adminRouter.get("/metrics/recent-conversations", getRecentConversations);
adminRouter.get("/metrics/chart-data", getDailyChart);
