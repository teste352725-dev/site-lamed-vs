import { FieldValue, getAdminDb } from "./_firebase-admin.mjs";
import { sendChatMessageNotification } from "./_notifications.mjs";
import { isAdminDecodedToken } from "./_session.mjs";

class ChatRequestError extends Error {
  constructor(status, message, code = "") {
    super(message);
    this.name = "ChatRequestError";
    this.status = status;
    this.code = code;
  }
}

function sanitizePlainText(value, maxLength = 180) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeThreadId(requestedThreadId, orderId) {
  if (orderId) {
    return `pedido:${orderId}`;
  }

  const safeThreadId = sanitizePlainText(requestedThreadId, 120);
  return safeThreadId || "geral";
}

function buildOrderCode(orderId) {
  return `#${sanitizePlainText(orderId, 24).slice(0, 6).toUpperCase()}`;
}

function buildThreadLabel({ threadId, orderId, explicitLabel }) {
  const safeExplicitLabel = sanitizePlainText(explicitLabel, 120);
  if (safeExplicitLabel) return safeExplicitLabel;
  if (orderId) return `Pedido ${buildOrderCode(orderId)}`;
  return threadId === "geral" ? "Conversa geral" : sanitizePlainText(threadId, 120);
}

function buildLastMessagePreview({ text, threadId, threadLabel, orderId, sender }) {
  const safeText = sanitizePlainText(text, 140);
  const prefix = sender === "admin" ? "Voce: " : "";
  if (threadId === "geral") {
    return `${prefix}${safeText}`.slice(0, 140);
  }

  const context = sanitizePlainText(threadLabel || (orderId ? `Pedido ${buildOrderCode(orderId)}` : "Pedido"), 48);
  return `${prefix}[${context}] ${safeText}`.slice(0, 140);
}

async function resolveOrderIdForChat(db, requestedOrderId, chatId) {
  const safeOrderId = sanitizePlainText(requestedOrderId, 120);
  if (!safeOrderId) return "";

  const snapshot = await db.collection("pedidos").doc(safeOrderId).get();
  if (!snapshot.exists) return "";

  const order = snapshot.data() || {};
  return sanitizePlainText(order.userId, 128) === chatId ? safeOrderId : "";
}

async function resolveChatDisplayName(db, chatId, fallbackName = "") {
  const safeFallback = sanitizePlainText(fallbackName, 80);

  try {
    const [userDoc, chatDoc] = await Promise.all([
      db.collection("usuarios").doc(chatId).get(),
      db.collection("chats_ativos").doc(chatId).get()
    ]);

    const userData = userDoc.exists ? (userDoc.data() || {}) : {};
    const chatData = chatDoc.exists ? (chatDoc.data() || {}) : {};
    const resolvedName = sanitizePlainText(userData.nome || chatData.userName || safeFallback, 80);
    return resolvedName || safeFallback || "Cliente";
  } catch (error) {
    return safeFallback || "Cliente";
  }
}

export function isChatRequestError(error) {
  return error instanceof ChatRequestError;
}

export async function createChatMessageFromBody(body, decodedUser) {
  const db = getAdminDb();
  const isAdmin = isAdminDecodedToken(decodedUser);
  const decodedUid = sanitizePlainText(decodedUser?.uid, 128);
  const requestedChatId = sanitizePlainText(body?.chatId, 128);
  const chatId = isAdmin ? requestedChatId : decodedUid;

  if (!chatId) {
    throw new ChatRequestError(400, "Conversa invalida.", "invalid_chat");
  }

  const cleanText = sanitizePlainText(body?.text, 1000);
  if (!cleanText) {
    throw new ChatRequestError(400, "Digite uma mensagem antes de enviar.", "empty_message");
  }

  const orderId = await resolveOrderIdForChat(db, body?.orderId, chatId);
  const threadId = normalizeThreadId(body?.threadId, orderId);
  const threadLabel = buildThreadLabel({
    threadId,
    orderId,
    explicitLabel: body?.threadLabel
  });

  const sender = isAdmin ? "admin" : "user";
  const senderName = isAdmin
    ? sanitizePlainText(decodedUser?.name || "Equipe Lamed", 80) || "Equipe Lamed"
    : await resolveChatDisplayName(
        db,
        chatId,
        decodedUser?.name || decodedUser?.email?.split("@")[0] || "Cliente"
      );

  const timestamp = FieldValue.serverTimestamp();
  const messageRef = db.collection("chats").doc(chatId).collection("messages").doc();
  const metaRef = db.collection("chats_ativos").doc(chatId);

  const messageData = {
    text: cleanText,
    sender,
    timestamp,
    threadId,
    threadLabel,
    orderId
  };

  if (senderName) {
    messageData.userName = senderName;
  }

  const metaData = {
    lastMessage: buildLastMessagePreview({
      text: cleanText,
      threadId,
      threadLabel,
      orderId,
      sender
    }),
    lastUpdate: timestamp,
    userName: await resolveChatDisplayName(db, chatId, senderName),
    userId: chatId,
    unread: sender !== "admin",
    activeThreadId: threadId,
    activeThreadLabel: threadLabel,
    orderId
  };

  const batch = db.batch();
  batch.set(messageRef, messageData);
  batch.set(metaRef, metaData, { merge: true });
  await batch.commit();

  const push = await sendChatMessageNotification({
    sender,
    chatId,
    senderName,
    text: cleanText,
    orderId,
    threadId,
    threadLabel
  });

  return {
    ok: true,
    chatId,
    threadId,
    orderId,
    threadLabel,
    sender,
    push
  };
}
