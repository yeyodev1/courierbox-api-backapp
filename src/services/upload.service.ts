import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME || undefined,
  api_key: env.CLOUDINARY_API_KEY || undefined,
  api_secret: env.CLOUDINARY_API_SECRET || undefined,
});

export interface UploadResult {
  url: string;
  publicId: string;
}

async function uploadBuffer(buffer: Buffer, folder: string): Promise<UploadResult> {
  if (!env.CLOUDINARY_CLOUD_NAME) {
    logger.warn("[upload] Cloudinary no configurado — simulando subida");
    return { url: "", publicId: `sim-${Date.now()}` };
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "auto" },
      (err, result) => {
        if (err || !result) {
          reject(err || new Error("Upload failed"));
          return;
        }
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(buffer);
  });
}

export async function uploadComprobante(buffer: Buffer): Promise<UploadResult> {
  return uploadBuffer(buffer, "courierbox/comprobantes");
}

export async function uploadTransferProof(buffer: Buffer): Promise<UploadResult> {
  return uploadBuffer(buffer, "courierbox/transferencias");
}

export async function uploadExcel(buffer: Buffer): Promise<UploadResult> {
  return uploadBuffer(buffer, "courierbox/etl");
}

export async function uploadEnvioEvidencia(buffer: Buffer): Promise<UploadResult> {
  return uploadBuffer(buffer, "courierbox/envios/evidencias");
}

export async function uploadEnvioGuia(buffer: Buffer): Promise<UploadResult> {
  return uploadBuffer(buffer, "courierbox/envios/guias");
}

export async function uploadGastoFactura(buffer: Buffer): Promise<UploadResult> {
  return uploadBuffer(buffer, "courierbox/gastos/facturas");
}
