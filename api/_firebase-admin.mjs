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

function getServiceAccountConfig() {
  const projectId = readFirstEnv("FIREBASE_ADMIN_PROJECT_ID", "FIREBASE_PROJECT_ID");
  const clientEmail = readFirstEnv("FIREBASE_ADMIN_CLIENT_EMAIL", "FIREBASE_CLIENT_EMAIL");
  const privateKeyRaw = readFirstEnv("FIREBASE_ADMIN_PRIVATE_KEY", "FIREBASE_PRIVATE_KEY");

  if (!projectId || !clientEmail || !privateKeyRaw) {
    return null;
  }

  return {
    projectId,
    clientEmail,
    privateKey: privateKeyRaw.replace(/\\n/g, "\n")
  };
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
