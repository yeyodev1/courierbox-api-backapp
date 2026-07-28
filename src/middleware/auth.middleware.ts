import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AsyncLocalStorage } from "node:async_hooks";
import { env } from "../config/env";
import { models } from "../models/index";
import type { UserRole } from "../models/user.model";

export interface AuthUser {
  userId: string;
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tokenVersion: number;
}

const requestAuthStorage = new AsyncLocalStorage<{ user?: AuthUser }>();

// Extend Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized: Missing or invalid token" });
    return;
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    res.status(401).json({ error: "Unauthorized: Token missing" });
    return;
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET as string) as jwt.JwtPayload;
    const userId = String(decoded.userId ?? decoded.id ?? "");
    if (!userId) {
      res.status(401).json({ error: "Unauthorized: Invalid token subject" });
      return;
    }

    const user = await models.users.findById(userId).select("email name role activo tokenVersion").lean();
    if (!user || user.activo === false) {
      res.status(401).json({ error: "Unauthorized: User is inactive or missing" });
      return;
    }

    const currentTokenVersion = Number(user.tokenVersion ?? 0);
    const signedTokenVersion = Number(decoded.tokenVersion ?? 0);
    if (signedTokenVersion !== currentTokenVersion) {
      res.status(401).json({ error: "Unauthorized: Session was revoked" });
      return;
    }

    const authUser: AuthUser = {
      userId: String(user._id),
      id: String(user._id),
      email: user.email,
      name: user.name,
      role: user.role,
      tokenVersion: currentTokenVersion,
    };

    requestAuthStorage.run({ user: authUser }, () => {
      req.user = authUser;
      next();
    });
  } catch (error) {
    res.status(401).json({ error: "Unauthorized: Invalid or expired token" });
  }
}

export function getCurrentAuthUser() {
  return requestAuthStorage.getStore()?.user;
}

export function requireRole(allowedRoles: readonly UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden: insufficient role" });
      return;
    }
    next();
  };
}
