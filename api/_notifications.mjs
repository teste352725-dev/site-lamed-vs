import { createHash } from "node:crypto";
import { FieldValue, getAdminDb, getAdminMessaging, getFirebaseAdminStatus } from "./_firebase-admin.mjs";

const PUSH_COLLECTION = "push_subscriptions";
const DEFAULT_NOTIFICATION_ICON = "https://i.ibb.co/mr93jDHT/JM.png";
const DEFAULT_CLICK_BASE_URL = "https://www.lamedvs.com.br";

class NotificationRequestError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.name = "NotificationRequestError";
    this.status = status;
    Object.assign(this, details);
  }
}

function sanitizePlainText(value, maxLength = 180) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizePushToken(value) {
  return String(value ?? "").trim().slice(0, 4096);
}

function getPublicVapidKey() {
  return sanitizePlainText(process.env.FCM_WEB_PUSH_PUBLIC_KEY, 512);
}

function getNotificationIconUrl() {
  return sanitizePlainText(process.env.WEB_PUSH_NOTIFICATION_ICON_URL, 500) || DEFAULT_NOTIFICATION_ICON;
}

function getClickBaseUrl() {
  return sanitizePlainText(process.env.WEB_PUSH_CLICK_BASE_URL, 500) || DEFAULT_CLICK_BASE_URL;
}

function buildSubscriptionDocId(token) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeDataPayload(data) {
  const normalized = {};
  const input = data && typeof data === "object" ? data : {};
  for (const [key, value] of Object.entries(input)) {
    if (!key) continue;
    normalized[String(key)] = sanitizePlainText(value, 240);
  }
  return normalized;
}

function buildStatusNotification(order, nextStatus) {
  const displayId = sanitizePlainText(order?.id, 24).slice(-8).toUpperCase() || "PEDIDO";
  const labels = {
    pendente: "pedido recebido",
    processando: "pedido em producao",
    enviado: "pedido enviado",
    entregue: "pedido entregue",
    cancelado: "pedido cancelado"
  };
  const label = labels[nextStatus] || "pedido atualizado";

  return {
    title: `Atualizacao do pedido #${displayId}`,
    body: `Seu ${label}. Toque para acompanhar os detalhes na sua conta.`,
    link: `${getClickBaseUrl().replace(/\/+$/, "")}/minha-conta.html#pedidos`,
    data: {
      screen: "pedidos",
      orderId: sanitizePlainText(order?.id, 80),
      status: sanitizePlainText(nextStatus, 40)
    }
  };
}

async function disableInvalidTokens(tokenDocIds) {
  if (!Array.isArray(tokenDocIds) || tokenDocIds.length === 0) return;
  const db = getAdminDb();
  const batch = db.batch();
  tokenDocIds.forEach((docId) => {
    const ref = db.collection(PUSH_COLLECTION).doc(docId);
    batch.set(ref, {
      enabled: false,
      invalidatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });
  await batch.commit();
}

export function isNotificationRequestError(error) {
  return error instanceof NotificationRequestError;
}

export function getPushPublicConfig() {
  const firebaseAdmin = getFirebaseAdminStatus();
  const vapidPublicKey = getPublicVapidKey();

  return {
    ok: Boolean(firebaseAdmin.configured && vapidPublicKey),
    enabled: Boolean(firebaseAdmin.configured && vapidPublicKey),
    vapidPublicKey,
    iconUrl: getNotificationIconUrl()
  };
}

export async function registerPushSubscription({ userId, token, userAgent = "", permission = "granted" }) {
  const firebaseAdmin = getFirebaseAdminStatus();
  if (!firebaseAdmin.configured) {
    throw new NotificationRequestError(503, "Notificacoes indisponiveis no momento.");
  }

  const vapidPublicKey = getPublicVapidKey();
  if (!vapidPublicKey) {
    throw new NotificationRequestError(503, "As notificacoes ainda nao foram configuradas no servidor.");
  }

  const safeUserId = sanitizePlainText(userId, 128);
  const safeToken = normalizePushToken(token);
  if (!safeUserId || !safeToken) {
    throw new NotificationRequestError(400, "Token de notificacao invalido.");
  }

  const db = getAdminDb();
  const docId = buildSubscriptionDocId(safeToken);
  await db.collection(PUSH_COLLECTION).doc(docId).set({
    userId: safeUserId,
    token: safeToken,
    enabled: true,
    permission: sanitizePlainText(permission, 40) || "granted",
    platform: "web",
    userAgent: sanitizePlainText(userAgent, 240),
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return {
    ok: true,
    subscribed: true
  };
}

export async function unregisterPushSubscription({ userId, token }) {
  const firebaseAdmin = getFirebaseAdminStatus();
  if (!firebaseAdmin.configured) {
    throw new NotificationRequestError(503, "Notificacoes indisponiveis no momento.");
  }

  const safeUserId = sanitizePlainText(userId, 128);
  const safeToken = normalizePushToken(token);
  if (!safeUserId || !safeToken) {
    throw new NotificationRequestError(400, "Token de notificacao invalido.");
  }

  const db = getAdminDb();
  const docId = buildSubscriptionDocId(safeToken);
  const ref = db.collection(PUSH_COLLECTION).doc(docId);
  const snapshot = await ref.get();
  if (snapshot.exists && snapshot.data()?.userId !== safeUserId) {
    throw new NotificationRequestError(403, "Nao foi possivel remover esta inscricao.");
  }

  await ref.set({
    userId: safeUserId,
    token: safeToken,
    enabled: false,
    updatedAt: FieldValue.serverTimestamp(),
    disabledAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return {
    ok: true,
    subscribed: false
  };
}

export async function sendOrderStatusNotification({ order, nextStatus }) {
  const firebaseAdmin = getFirebaseAdminStatus();
  if (!firebaseAdmin.configured) {
    return { sent: 0, skipped: true, reason: "firebase_admin_not_configured" };
  }

  const safeUserId = sanitizePlainText(order?.userId, 128);
  if (!safeUserId) {
    return { sent: 0, skipped: true, reason: "order_without_user" };
  }

  const db = getAdminDb();
  const snapshot = await db.collection(PUSH_COLLECTION)
    .where("userId", "==", safeUserId)
    .where("enabled", "==", true)
    .get();

  if (snapshot.empty) {
    return { sent: 0, skipped: true, reason: "no_active_tokens" };
  }

  const tokens = [];
  const tokenDocIds = [];
  snapshot.forEach((doc) => {
    const data = doc.data() || {};
    const token = normalizePushToken(data.token);
    if (!token) return;
    tokens.push(token);
    tokenDocIds.push(doc.id);
  });

  if (!tokens.length) {
    return { sent: 0, skipped: true, reason: "no_valid_tokens" };
  }

  const notification = buildStatusNotification(order, nextStatus);
  const response = await getAdminMessaging().sendEachForMulticast({
    tokens,
    data: normalizeDataPayload(notification.data),
    webpush: {
      notification: {
        title: notification.title,
        body: notification.body,
        icon: getNotificationIconUrl()
      },
      fcmOptions: {
        link: notification.link
      }
    }
  });

  const invalidDocIds = [];
  response.responses.forEach((item, index) => {
    if (item.success) return;
    const errorCode = String(item.error?.code || "");
    if (errorCode === "messaging/registration-token-not-registered" || errorCode === "messaging/invalid-argument") {
      invalidDocIds.push(tokenDocIds[index]);
    }
  });

  if (invalidDocIds.length) {
    await disableInvalidTokens(invalidDocIds);
  }

  return {
    sent: response.successCount,
    failed: response.failureCount
  };
}
