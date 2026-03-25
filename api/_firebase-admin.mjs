import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

function readFirstEnv(...keys) {
  for (const key of keys) {
    const value = String(process.env[key] || "").trim();
    if (value) return value;
  }

  return "";
}

function normalizeServiceAccountConfig(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const projectId = String(candidate.projectId || candidate.project_id || "").trim();
  const clientEmail = String(candidate.clientEmail || candidate.client_email || "").trim();
  const privateKey = String(candidate.privateKey || candidate.private_key || "")
    .replace(/\\n/g, "\n")
    .trim();

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return {
    projectId,
    clientEmail,
    privateKey
  };
}

function parseInlineServiceAccount(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return null;

  try {
    return normalizeServiceAccountConfig(JSON.parse(raw));
  } catch (error) {
    return null;
  }
}

function getServiceAccountConfig() {
  const inlineJson = parseInlineServiceAccount(
    readFirstEnv("FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON", "GOOGLE_CREDENTIALS_JSON")
  );
  if (inlineJson) {
    return inlineJson;
  }

  const inlineBase64 = readFirstEnv(
    "FIREBASE_ADMIN_SERVICE_ACCOUNT_BASE64",
    "GOOGLE_CREDENTIALS_BASE64"
  );
  if (inlineBase64) {
    try {
      const decoded = Buffer.from(inlineBase64, "base64").toString("utf8");
      const parsed = parseInlineServiceAccount(decoded);
      if (parsed) {
        return parsed;
      }
    } catch (error) {
      // Ignore invalid base64 input and continue to split envs.
    }
  }

  const projectId = readFirstEnv("FIREBASE_ADMIN_PROJECT_ID", "FIREBASE_PROJECT_ID");
  const clientEmail = readFirstEnv("FIREBASE_ADMIN_CLIENT_EMAIL", "FIREBASE_CLIENT_EMAIL");
  const privateKeyRaw = readFirstEnv("FIREBASE_ADMIN_PRIVATE_KEY", "FIREBASE_PRIVATE_KEY");

  return normalizeServiceAccountConfig({
    projectId,
    clientEmail,
    privateKey: privateKeyRaw
  });
}

function initializeFirebaseAdmin() {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const serviceAccount = getServiceAccountConfig();
  if (serviceAccount) {
    return initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.projectId
    });
  }

  const projectId = readFirstEnv("FIREBASE_ADMIN_PROJECT_ID", "FIREBASE_PROJECT_ID");

  return initializeApp({
    credential: applicationDefault(),
    ...(projectId ? { projectId } : {})
  });
}

export function getAdminDb() {
  return getFirestore(initializeFirebaseAdmin());
}

export function getAdminAuth() {
  return getAuth(initializeFirebaseAdmin());
}

export function getFirebaseAdminStatus() {
  const serviceAccount = getServiceAccountConfig();

  return {
    configured: Boolean(serviceAccount),
    projectIdConfigured: Boolean(serviceAccount?.projectId),
    clientEmailConfigured: Boolean(serviceAccount?.clientEmail),
    privateKeyConfigured: Boolean(serviceAccount?.privateKey)
  };
}

export { FieldValue };
