import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { models } from "../models/index";
import { sendCredenciales } from "../services/email.service";
import { USER_ROLES, type UserRole } from "../models/user.model";

function actorRole(req: Request): UserRole | undefined {
  return req.user?.role;
}

function canManageRole(req: Request, role: UserRole): boolean {
  return actorRole(req) === "superadmin" || role !== "superadmin";
}

function parseRole(value: unknown): UserRole | null {
  return USER_ROLES.includes(value as UserRole) ? (value as UserRole) : null;
}

export async function getUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { q } = req.query;
    let query = {};
    if (q && typeof q === "string" && q.trim()) {
      const regex = new RegExp(q.trim(), "i");
      query = { $or: [{ name: regex }, { email: regex }] };
    }
    const users = await models.users.find(query).select("-passwordHash -tokenVersion").sort({ activo: -1, createdAt: -1 });
    res.status(200).json({ users });
  } catch (error) {
    console.error("[user.controller] getUsers error:", error);
    next(error);
  }
}

export async function createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password, name, role, sendEmail } = req.body;

    if (!email || !password || !name) {
      res.status(400).json({ error: "Email, password, and name are required" });
      return;
    }

    const requestedRole = parseRole(role ?? "asesor");
    if (!requestedRole || !canManageRole(req, requestedRole)) {
      res.status(403).json({ error: "No puedes asignar ese rol" });
      return;
    }

    const existingUser = await models.users.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      res.status(400).json({ error: "Email is already registered" });
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = await models.users.create({
      email: email.toLowerCase(),
      passwordHash,
      name,
      role: requestedRole,
      activo: true,
    });

    if (sendEmail) {
      await sendCredenciales({
        to: newUser.email,
        name: newUser.name,
        email: newUser.email,
        password,
        role: newUser.role,
        loginUrl: req.body.loginUrl || "https://courierboxlogistics.com/login",
      });
    }

    res.status(201).json({
      message: "User created successfully",
      user: {
        id: newUser._id,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role,
        activo: newUser.activo,
      },
    });
  } catch (error) {
    console.error("[user.controller] createUser error:", error);
    next(error);
  }
}

export async function updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { email, password, name, role, activo } = req.body;

    const user = await models.users.findById(id);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (!canManageRole(req, user.role)) {
      res.status(403).json({ error: "Solo superadmin puede modificar una cuenta superadmin" });
      return;
    }

    const requestedRole = role === undefined ? null : parseRole(role);
    if (role !== undefined && (!requestedRole || !canManageRole(req, requestedRole))) {
      res.status(403).json({ error: "No puedes asignar ese rol" });
      return;
    }

    const removesActiveSuperadmin = user.role === "superadmin"
      && user.activo !== false
      && ((requestedRole && requestedRole !== "superadmin") || activo === false);
    if (removesActiveSuperadmin) {
      const activeSuperadmins = await models.users.countDocuments({ role: "superadmin", activo: { $ne: false } });
      if (activeSuperadmins <= 1) {
        res.status(400).json({ error: "No puedes desactivar ni cambiar el rol de la ultima cuenta superadmin" });
        return;
      }
    }

    if (email && email.toLowerCase() !== user.email) {
      const existingEmail = await models.users.findOne({ email: email.toLowerCase() });
      if (existingEmail) {
        res.status(400).json({ error: "Email is already in use" });
        return;
      }
      user.email = email.toLowerCase();
    }

    if (name) user.name = name;
    if (requestedRole && requestedRole !== user.role) {
      user.role = requestedRole;
      user.tokenVersion = Number(user.tokenVersion ?? 0) + 1;
    }

    if (typeof activo === "boolean" && activo !== user.activo) {
      if (String(user._id) === req.user?.userId && !activo) {
        res.status(400).json({ error: "No puedes desactivar tu propio usuario" });
        return;
      }
      user.activo = activo;
      user.tokenVersion = Number(user.tokenVersion ?? 0) + 1;
    }

    if (password) {
      const salt = await bcrypt.genSalt(10);
      user.passwordHash = await bcrypt.hash(password, salt);
      user.tokenVersion = Number(user.tokenVersion ?? 0) + 1;
    }

    await user.save();

    res.status(200).json({
      message: "User updated successfully",
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        activo: user.activo,
      },
    });
  } catch (error) {
    console.error("[user.controller] updateUser error:", error);
    next(error);
  }
}

export async function deleteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    
    // Prevent user from deleting themselves
    if (req.user && req.user.userId === id) {
      res.status(400).json({ error: "No puedes eliminar tu propio usuario" });
      return;
    }

    const user = await models.users.findById(id);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }


    if (!canManageRole(req, user.role)) {
      res.status(403).json({ error: "Solo superadmin puede desactivar una cuenta superadmin" });
      return;
    }

    if (user.role === "superadmin") {
      const activeSuperadmins = await models.users.countDocuments({ role: "superadmin", activo: { $ne: false } });
      if (activeSuperadmins <= 1) {
        res.status(400).json({ error: "No puedes desactivar la ultima cuenta superadmin" });
        return;
      }
    }

    user.activo = false;
    user.tokenVersion = Number(user.tokenVersion ?? 0) + 1;
    await user.save();

    res.status(200).json({ message: "User deactivated successfully" });
  } catch (error) {
    console.error("[user.controller] deleteUser error:", error);
    next(error);
  }
}
