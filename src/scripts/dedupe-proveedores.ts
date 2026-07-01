import "dotenv/config";
import { dbConnect } from "../db/mongo.js";
import { models } from "../models/index.js";
import { canonicalProveedorNombre, normalizeProveedorNombre } from "../services/proveedor-normalize.js";

type ProveedorLean = {
  _id: any;
  nombre: string;
  nombreNormalizado: string;
  tipo?: string;
  pais?: string;
  ciudad?: string;
  contacto?: string;
  telefono?: string;
  email?: string;
  notas?: string;
  activo?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

function isFilled(value?: string) {
  return Boolean(String(value || "").trim());
}

function completenessScore(proveedor: ProveedorLean) {
  return [proveedor.nombre, proveedor.tipo, proveedor.pais, proveedor.ciudad, proveedor.contacto, proveedor.telefono, proveedor.email, proveedor.notas].reduce(
    (score, value) => score + (isFilled(value) ? 1 : 0),
    0
  );
}

function pickCanonical(items: ProveedorLean[]) {
  return [...items].sort((a, b) => {
    const scoreDiff = completenessScore(b) - completenessScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
  })[0];
}

function mergeProveedorData(canonical: ProveedorLean, duplicates: ProveedorLean[]) {
  const merged = { ...canonical };
  for (const duplicate of duplicates) {
    merged.nombre = merged.nombre || canonicalProveedorNombre(duplicate.nombre) || duplicate.nombre;
    merged.tipo = merged.tipo || duplicate.tipo || "";
    merged.pais = merged.pais || duplicate.pais || "";
    merged.ciudad = merged.ciudad || duplicate.ciudad || "";
    merged.contacto = merged.contacto || duplicate.contacto || "";
    merged.telefono = merged.telefono || duplicate.telefono || "";
    merged.email = merged.email || duplicate.email || "";
    merged.notas = merged.notas || duplicate.notas || "";
    merged.activo = merged.activo ?? duplicate.activo;
    merged.nombreNormalizado = normalizeProveedorNombre(merged.nombre || duplicate.nombre);
  }
  return merged;
}

async function reassignReferences(fromId: any, toId: any, canonicalName: string) {
  const [gastos, trayectoUsa, trayectoLocal] = await Promise.all([
    models.gastos.updateMany({ proveedorId: fromId }, { $set: { proveedorId: toId, proveedor: canonicalName } }),
    models.enviosDomicilio.updateMany(
      { "trayectoUsa.proveedorId": fromId },
      { $set: { "trayectoUsa.proveedorId": toId, "trayectoUsa.proveedorNombre": canonicalName } }
    ),
    models.enviosDomicilio.updateMany(
      { "trayectoLocal.proveedorId": fromId },
      { $set: { "trayectoLocal.proveedorId": toId, "trayectoLocal.proveedorNombre": canonicalName } }
    ),
  ]);

  return gastos.modifiedCount + trayectoUsa.modifiedCount + trayectoLocal.modifiedCount;
}

async function main() {
  await dbConnect();

  const proveedores = (await models.proveedores.find({}).sort({ createdAt: 1 }).lean()) as ProveedorLean[];
  const groups = new Map<string, ProveedorLean[]>();

  for (const proveedor of proveedores) {
    const key = proveedor.nombreNormalizado || normalizeProveedorNombre(proveedor.nombre);
    const current = groups.get(key) || [];
    current.push(proveedor);
    groups.set(key, current);
  }

  let mergedGroups = 0;
  let deleted = 0;
  let reassigned = 0;

  for (const [, items] of groups) {
    if (items.length < 2) continue;
    mergedGroups += 1;

    const canonical = pickCanonical(items);
    const duplicates = items.filter((item) => String(item._id) !== String(canonical._id));
    const merged = mergeProveedorData(canonical, duplicates);

    await models.proveedores.findByIdAndUpdate(canonical._id, { $set: merged });

    for (const duplicate of duplicates) {
      reassigned += await reassignReferences(duplicate._id, canonical._id, merged.nombre);
      await models.proveedores.findByIdAndDelete(duplicate._id);
      deleted += 1;
    }
  }

  console.log(
    `Provider dedupe complete: ${mergedGroups} merged groups, ${deleted} duplicates deleted, ${reassigned} references reassigned.`
  );
}

main().catch((error) => {
  console.error("Provider dedupe failed:", error);
  process.exit(1);
});
