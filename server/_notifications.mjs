import { createHash } from "node:crypto";
import { FieldValue, getAdminDb, getAdminMessaging, getFirebaseAdminStatus } from "./_firebase-admin.mjs";

const PUSH_COLLECTION = "push_subscriptions";
const DEFAULT_NOTIFICATION_ICON = "https://i.ibb.co/mr93jDHT/JM.png";
const DEFAULT_CLICK_BASE_URL = "https://www.lamedvs.com.br";
const DEFAULT_ADMIN_NOTIFICATION_UIDS = ["NoGsCqiKc0VJwWb6rppk7QVLV1B2"];

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

function getAdminNotificationUserIds() {
  const configured = String(process.env.ADMIN_NOTIFICATION_UIDS || "")
    .split(",")
    .map((item) => sanitizePlainText(item, 128))
    .filter(Boolean);

  const merged = new Set([...DEFAULT_ADMIN_NOTIFICATION_UIDS, ...configured]);
  return [...merged];
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function sendMulticastWithChunks({ tokens, tokenDocIds, title, body, link, data }) {
  const tokenChunks = chunkArray(tokens, 500);
  const docIdChunks = chunkArray(tokenDocIds, 500);
  let sent = 0;
  let failed = 0;
  const invalidDocIds = [];

  for (let index = 0; index < tokenChunks.length; index += 1) {
    const response = await getAdminMessaging().sendEachForMulticast({
      tokens: tokenChunks[index],
      data: normalizeDataPayload(data),
      webpush: {
        notification: {
          title: sanitizePlainText(title, 120),
          body: sanitizePlainText(body, 240),
          icon: getNotificationIconUrl()
        },
        fcmOptions: {
          link: sanitizePlainText(link, 500)
        }
      }
    });

    sent += response.successCount;
    failed += response.failureCount;

    response.responses.forEach((item, responseIndex) => {
      if (item.success) return;
      const errorCode = String(item.error?.code || "");
      if (errorCode === "messaging/registration-token-not-registered" || errorCode === "messaging/invalid-argument") {
        invalidDocIds.push(docIdChunks[index][responseIndex]);
      }
    });
  }

  if (invalidDocIds.length) {
    await disableInvalidTokens(invalidDocIds);
  }

  return { sent, failed };
}

async function getActivePushTargetsByUserIds(userIds) {
  const db = getAdminDb();
  const safeUserIds = [...new Set((Array.isArray(userIds) ? userIds : []).map((item) => sanitizePlainText(item, 128)).filter(Boolean))];
  if (!safeUserIds.length) {
    return { tokens: [], tokenDocIds: [] };
  }

  const tokens = [];
  const tokenDocIds = [];

  for (const chunk of chunkArray(safeUserIds, 10)) {
    const snapshot = await db.collection(PUSH_COLLECTION)
      .where("userId", "in", chunk)
      .where("enabled", "==", true)
      .get();

    snapshot.forEach((doc) => {
      const data = doc.data() || {};
      const token = normalizePushToken(data.token);
      if (!token) return;
      tokens.push(token);
      tokenDocIds.push(doc.id);
    });
  }

  return { tokens, tokenDocIds };
}

async function getAllActivePushTargets() {
  const db = getAdminDb();
  const snapshot = await db.collection(PUSH_COLLECTION)
    .where("enabled", "==", true)
    .get();

  const tokens = [];
  const tokenDocIds = [];
  snapshot.forEach((doc) => {
    const data = doc.data() || {};
    const token = normalizePushToken(data.token);
    if (!token) return;
    tokens.push(token);
    tokenDocIds.push(doc.id);
  });

  return { tokens, tokenDocIds };
}

async function sendNotificationToUsers({ userIds, title, body, link, data }) {
  const firebaseAdmin = getFirebaseAdminStatus();
  if (!firebaseAdmin.configured) {
    return { sent: 0, skipped: true, reason: "firebase_admin_not_configured" };
  }

  const { tokens, tokenDocIds } = await getActivePushTargetsByUserIds(userIds);
  if (!tokens.length) {
    return { sent: 0, skipped: true, reason: "no_active_tokens" };
  }

  return sendMulticastWithChunks({ tokens, tokenDocIds, title, body, link, data });
}

async function sendNotificationToAll({ title, body, link, data }) {
  const firebaseAdmin = getFirebaseAdminStatus();
  if (!firebaseAdmin.configured) {
    return { sent: 0, skipped: true, reason: "firebase_admin_not_configured" };
  }

  const { tokens, tokenDocIds } = await getAllActivePushTargets();
  if (!tokens.length) {
    return { sent: 0, skipped: true, reason: "no_active_tokens" };
  }

  return sendMulticastWithChunks({ tokens, tokenDocIds, title, body, link, data });
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

  const notification = buildStatusNotification(order, nextStatus);
  return sendNotificationToUsers({
    userIds: [safeUserId],
    title: notification.title,
    body: notification.body,
    link: notification.link,
    data: notification.data
  });
}

export async function sendCustomNotificationToUsers({ userIds, title, body, link, data }) {
  return sendNotificationToUsers({ userIds, title, body, link, data });
}

export async function sendBroadcastNotification({ title, body, link, data }) {
  return sendNotificationToAll({ title, body, link, data });
}

export async function sendChatMessageNotification({ sender, chatId, senderName, text, orderId, threadId, threadLabel }) {
  const safeChatId = sanitizePlainText(chatId, 128);
  if (!safeChatId) {
    return { sent: 0, skipped: true, reason: "chat_without_user" };
  }

  const safeThreadLabel = sanitizePlainText(threadLabel, 120) || (orderId ? `Pedido #${sanitizePlainText(orderId, 24).slice(0, 6).toUpperCase()}` : "Conversa geral");
  const safeBody = sanitizePlainText(text, 180);
  const baseUrl = getClickBaseUrl().replace(/\/+$/, "");

  if (sender === "user") {
    return sendNotificationToUsers({
      userIds: getAdminNotificationUserIds(),
      title: "Nova mensagem no atendimento",
      body: `${sanitizePlainText(senderName || "Cliente", 60)}: ${safeBody}`,
      link: `${baseUrl}/chat-admin.html?chat=${encodeURIComponent(safeChatId)}&thread=${encodeURIComponent(sanitizePlainText(threadId, 120) || "geral")}&pedido=${encodeURIComponent(sanitizePlainText(orderId, 120))}`,
      data: {
        screen: "admin-chat",
        chatId: safeChatId,
        orderId: sanitizePlainText(orderId, 120),
        threadId: sanitizePlainText(threadId, 120) || "geral",
        threadLabel: safeThreadLabel
      }
    });
  }

  return sendNotificationToUsers({
    userIds: [safeChatId],
    title: orderId ? `Nova resposta sobre ${safeThreadLabel}` : "Nova resposta do suporte",
    body: safeBody || "A equipe respondeu sua mensagem.",
    link: `${baseUrl}/minha-conta.html${orderId ? `?pedido=${encodeURIComponent(sanitizePlainText(orderId, 120))}` : ""}#chat`,
    data: {
      screen: "chat",
      chatId: safeChatId,
      orderId: sanitizePlainText(orderId, 120),
      threadId: sanitizePlainText(threadId, 120) || "geral",
      threadLabel: safeThreadLabel
    }
  });
}
