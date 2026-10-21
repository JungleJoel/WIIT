import fs from "fs";
import path from "path";
import dotenv from "dotenv";

/**
 * dotenv's default only looks for ".env" in process.cwd(). If the server is
 * started from another folder (or from dist/), no variables are loaded and
 * DB_HOST etc. stay undefined. Search upwards from the cwd and from this file.
 */
function findEnvFile(): string | undefined {
  for (const start of [process.cwd(), __dirname]) {
    let dir = start;
    for (;;) {
      const candidate = path.join(dir, ".env");
      if (fs.existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return undefined;
}

export const envFile = findEnvFile();

if (envFile) {
  dotenv.config({ path: envFile, quiet: true });
}

const required = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"];
const missing = required.filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.warn(
    `[DB CONFIG] Missing environment variables: ${missing.join(", ")}. ` +
      (envFile ? `Loaded .env from ${envFile}` : "No .env file was found.") +
      ` (cwd: ${process.cwd()})`
  );
}