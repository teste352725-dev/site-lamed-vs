import fs from "node:fs";
import path from "node:path";

const inputPath = process.argv[2];

if (!inputPath) {
  console.error("Uso: node scripts/firebase-admin-env.mjs caminho/para/service-account.json");
  process.exit(1);
}

const resolvedPath = path.resolve(process.cwd(), inputPath);

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
} catch (error) {
  console.error(`Nao foi possivel ler o JSON de service account em: ${resolvedPath}`);
  console.error(error.message);
  process.exit(1);
}

const serialized = JSON.stringify(parsed);
const base64Value = Buffer.from(serialized, "utf8").toString("base64");
const privateKey = String(parsed.private_key || "").replace(/\n/g, "\\n");

console.log("FIREBASE_ADMIN_SERVICE_ACCOUNT_BASE64=" + base64Value);
console.log("FIREBASE_ADMIN_PROJECT_ID=" + String(parsed.project_id || ""));
console.log("FIREBASE_ADMIN_CLIENT_EMAIL=" + String(parsed.client_email || ""));
console.log("FIREBASE_ADMIN_PRIVATE_KEY=" + privateKey);
