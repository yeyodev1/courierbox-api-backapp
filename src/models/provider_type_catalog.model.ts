import mongoose, { Schema, type Document } from "mongoose";

export interface IProviderTypeCatalog extends Document {
  key: string;
  customTypes: string[];
  createdAt: Date;
  updatedAt: Date;
}

const providerTypeCatalogSchema = new Schema<IProviderTypeCatalog>(
  {
    key: { type: String, required: true, unique: true, default: "default" },
    customTypes: { type: [String], default: [] },
  },
  { timestamps: true }
);

providerTypeCatalogSchema.index({ key: 1 }, { unique: true });

export const ProviderTypeCatalog = mongoose.model<IProviderTypeCatalog>("ProviderTypeCatalog", providerTypeCatalogSchema);
