import type { Request, Response, NextFunction } from "express";
import { models } from "../models/index";

export const DEFAULT_PROVIDER_TYPES = [
  "Importador",
  "Exportador",
  "Courier USA",
  "Courier Local",
  "Transporte",
  "Logística",
  "Aduana",
  "Almacén",
];

function normalizeType(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

async function getCatalog() {
  const catalog = await models.providerTypeCatalog.findOne({ key: "default" }).lean();
  return catalog || { key: "default", customTypes: [] };
}

async function saveCatalog(customTypes: string[]) {
  return models.providerTypeCatalog.findOneAndUpdate(
    { key: "default" },
    { $set: { key: "default", customTypes } },
    { new: true, upsert: true }
  ).lean();
}

export async function listProviderTypes(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const catalog = await getCatalog();
    const customTypes = Array.from(new Set((catalog.customTypes || []).map((type) => String(type).trim()).filter(Boolean)));
    const providerTypes = Array.from(new Set([...DEFAULT_PROVIDER_TYPES, ...customTypes]));
    res.status(200).json({ defaultTypes: DEFAULT_PROVIDER_TYPES, customTypes, providerTypes });
  } catch (error) {
    next(error);
  }
}

export async function addProviderType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const type = String(req.body?.type || "").trim();
    if (!type) {
      res.status(400).json({ error: "type is required" });
      return;
    }

    if (DEFAULT_PROVIDER_TYPES.some((item) => normalizeType(item) === normalizeType(type))) {
      res.status(200).json({ added: false, type, reason: "default_type" });
      return;
    }

    const catalog = await getCatalog();
    const customTypes = Array.from(new Set([...(catalog.customTypes || []), type]));
    const updated = await saveCatalog(customTypes);
    res.status(200).json({ providerTypes: Array.from(new Set([...DEFAULT_PROVIDER_TYPES, ...(updated?.customTypes || customTypes)])), customTypes: updated?.customTypes || customTypes, added: true, type });
  } catch (error) {
    next(error);
  }
}

export async function deleteProviderType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const type = String(req.params.type || "").trim();
    if (!type) {
      res.status(400).json({ error: "type is required" });
      return;
    }

    if (DEFAULT_PROVIDER_TYPES.some((item) => normalizeType(item) === normalizeType(type))) {
      res.status(400).json({ error: "default types cannot be deleted" });
      return;
    }

    const catalog = await getCatalog();
    const customTypes = (catalog.customTypes || []).filter((item) => normalizeType(item) !== normalizeType(type));
    const updated = await saveCatalog(customTypes);
    res.status(200).json({ providerTypes: Array.from(new Set([...DEFAULT_PROVIDER_TYPES, ...(updated?.customTypes || customTypes)])), customTypes: updated?.customTypes || customTypes, deleted: true, type });
  } catch (error) {
    next(error);
  }
}
