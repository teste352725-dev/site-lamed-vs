import { applyStorefrontAdminAction, isStorefrontAdminError } from "../../../server/_storefront-admin.mjs";
import { requireAdminUser, isSessionRequestError } from "../../../server/_session.mjs";
import { getRequestBody, setNoStore } from "../../../server/_shipping.mjs";

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

    const result = await applyStorefrontAdminAction({
      action: body?.action,
      payload: body?.payload,
      adminUid: adminUser?.uid
    });

    return res.status(200).json({
      ok: true,
      result
    });
  } catch (error) {
    if (isSessionRequestError(error) || isStorefrontAdminError(error)) {
      return res.status(Number(error.status) || 400).json({
        ok: false,
        error: String(error.message || "Nao foi possivel validar sua operacao.")
      });
    }

    console.error("[vercel.admin.storefront.update]", error);
    return res.status(500).json({
      ok: false,
      error: "Nao foi possivel salvar esta alteracao agora."
    });
  }
}
