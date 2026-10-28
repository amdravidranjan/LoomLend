import type { Config } from "drizzle-kit";

const url = process.env.TURSO_DATABASE_URL ?? "file:local.db";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: url.startsWith("file:") ? "sqlite" : "turso",
  dbCredentials: { url, authToken: process.env.TURSO_AUTH_TOKEN },
} as Config;
