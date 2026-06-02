import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { env } from "./src/config/env.js";
import { models } from "./src/models/index.js";

async function run() {
  await mongoose.connect(env.MONGO_URI);
  console.log("Connected to MongoDB.");

  const email = "ventas@courierboxlogistics.com".toLowerCase();
  const password = "123456789";

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  const existingUser = await models.users.findOne({ email });

  if (existingUser) {
    existingUser.passwordHash = passwordHash;
    existingUser.role = "admin";
    await existingUser.save();
    console.log("User updated!");
  } else {
    await models.users.create({
      email,
      passwordHash,
      name: "Admin",
      role: "admin",
    });
    console.log("User created!");
  }

  process.exit(0);
}

run().catch(console.error);
