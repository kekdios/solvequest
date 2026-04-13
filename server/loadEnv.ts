/**
 * Load `.env` before any other local imports in `index.ts`.
 * Modules such as `src/engine/qusdVault.ts` read `process.env` at init; without this,
 * `dotenv.config()` in the entry body runs too late.
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(root, ".env") });
dotenv.config({ path: path.join(root, "backend", ".env") });
