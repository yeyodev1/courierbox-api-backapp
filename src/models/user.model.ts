import mongoose, { Document, Schema } from "mongoose";

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  name: string;
  role: "admin" | "asesor" | "user";
}

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true },
    role: { type: String, enum: ["admin", "asesor", "user"], default: "admin" },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export const User = mongoose.model<IUser>("User", userSchema);
