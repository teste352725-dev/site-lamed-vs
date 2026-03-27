import { FieldValue, getAdminDb } from "../../../server/_firebase-admin.mjs";
import { sendOrderStatusNotification } from "../../../server/_notifications.mjs";
import { requireAdminUser, isSessionRequestError } from "../../../server/_session.mjs";
import { getRequestBody, setNoStore } from "../../../server/_shipping.mjs";

const STATUS_ORDER = new Set(["pendente", "processando", "enviado", "entregue", "cancelado"]);

function sanitizePlainText(value, maxLength = 120) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export default async function handler(req, res) {
  setNoStore(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Metodo nao permitido." });
  }

  try {
    const authorizationHeader = req.headers?.authorization || req.headers?.Authorization || "";
    const adminUser = await requireAdminUser(authorizationHeader);
    const body = getRequestBody(req);

    const orderId = sanitizePlainText(body?.orderId, 80);
    const nextStatus = sanitizePlainText(body?.status, 40).toLowerCase();

    if (!orderId || !STATUS_ORDER.has(nextStatus)) {
      return res.status(400).json({
        ok: false,
        error: "Pedido ou status invalido."
      });
    }

    const db = getAdminDb();
    const orderRef = db.collection("pedidos").doc(orderId);
    const snapshot = await orderRef.get();

    if (!snapshot.exists) {
      return res.status(404).json({
        ok: false,
        error: "Pedido nao encontrado."
      });
    }

    await orderRef.update({
      status: nextStatus,
      updatedAtAdmin: FieldValue.serverTimestamp(),
      updatedByAdmin: sanitizePlainText(adminUser?.uid, 128)
    });

    const order = { id: snapshot.id, ...snapshot.data(), status: nextStatus };
    const pushResult = await sendOrderStatusNotification({ order, nextStatus });

    return res.status(200).json({
      ok: true,
      status: nextStatus,
      push: pushResult
    });
  } catch (error) {
    if (isSessionRequestError(error)) {
      return res.status(Number(error.status) || 400).json({
        ok: false,
        error: String(error.message || "Nao foi possivel validar sua sessao.")
      });
    }

    console.error("[vercel.admin.orders.status]", error);
    return res.status(500).json({
      ok: false,
      error: "Nao foi possivel atualizar o status do pedido."
    });
  }
}
