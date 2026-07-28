import mongoose, { Document, Schema } from "mongoose";

export const USER_ROLES = ["admin", "asesor", "gerencia", "superadmin", "motorizado", "bodega"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  activo: boolean;
  tokenVersion: number;
}

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true },
    role: { type: String, enum: USER_ROLES, default: "asesor" },
    activo: { type: Boolean, default: true, index: true },
    tokenVersion: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export const User = mongoose.model<IUser>("User", userSchema);
