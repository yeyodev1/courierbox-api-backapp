import { Router } from "express";
import { getTrackingHandler, getTrackingTextHandler } from "../controllers/tracking.controller.js";
import { rateLimit } from "../middleware/rate-limit.js";

export const trackingRouter = Router();

trackingRouter.get("/:codigo", rateLimit, getTrackingHandler);
trackingRouter.get("/:codigo/text", rateLimit, getTrackingTextHandler);
