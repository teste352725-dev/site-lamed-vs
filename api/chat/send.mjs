import { createChatMessageFromBody, isChatRequestError } from "../../server/_chat.mjs";
import { getRequestBody, setNoStore } from "../../server/_shipping.mjs";
import { isSessionRequestError, resolveAuthenticatedUser } from "../../server/_session.mjs";

export default async function handler(req, res) {
  setNoStore(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Metodo nao permitido." });
  }

  try {
    const authorizationHeader = req.headers?.authorization || req.headers?.Authorization || "";
    const decodedUser = await resolveAuthenticatedUser(authorizationHeader);
    const body = getRequestBody(req);
    const result = await createChatMessageFromBody(body, decodedUser);
    return res.status(201).json(result);
  } catch (error) {
    if (isSessionRequestError(error) || isChatRequestError(error)) {
      return res.status(Number(error.status) || 400).json({
        ok: false,
        error: String(error.message || "Nao foi possivel enviar a mensagem.")
      });
    }

    console.error("[vercel.chat.send]", error);
    return res.status(500).json({
      ok: false,
      error: "Nao foi possivel enviar a mensagem agora."
    });
  }
}
