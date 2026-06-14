import { Router } from "express";
import { getGeneralMetrics, getAgentMetrics, getRecentConversations, getDailyChart } from "../controllers/admin.controller.js";

export const adminRouter = Router();

adminRouter.get("/metrics/general", getGeneralMetrics);
adminRouter.get("/metrics/agents", getAgentMetrics);
adminRouter.get("/metrics/recent-conversations", getRecentConversations);
adminRouter.get("/metrics/chart-data", getDailyChart);
