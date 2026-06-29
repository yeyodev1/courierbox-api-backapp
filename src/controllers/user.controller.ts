import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { models } from "../models/index.js";
import { sendCredenciales } from "../services/email.service.js";

export async function getUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { q } = req.query;
    let query = {};
    if (q && typeof q === "string" && q.trim()) {
      const regex = new RegExp(q.trim(), "i");
      query = { $or: [{ name: regex }, { email: regex }] };
    }
    const users = await models.users.find(query).select("-passwordHash").sort({ createdAt: -1 });
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
      role: role || "user",
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
    const { email, password, name, role } = req.body;

    const user = await models.users.findById(id);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
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
    if (role) user.role = role;

    if (password) {
      const salt = await bcrypt.genSalt(10);
      user.passwordHash = await bcrypt.hash(password, salt);
    }

    await user.save();

    res.status(200).json({
      message: "User updated successfully",
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
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

    const user = await models.users.findByIdAndDelete(id);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("[user.controller] deleteUser error:", error);
    next(error);
  }
}
