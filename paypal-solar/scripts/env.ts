// Loads paypal-solar/.env.local for command-line scripts, wherever they are started from
// (Next.js reads .env.local itself; dotenv/config would only read .env in the current directory).
import path from "node:path";
import { config } from "dotenv";

config({ path: path.join(__dirname, "..", ".env.local"), quiet: true });
