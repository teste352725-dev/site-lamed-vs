import { applyStorefrontAdminAction, isStorefrontAdminError } from "../../../server/_storefront-admin.mjs";
import { requireAdminUser, isSessionRequestError } from "../../../server/_session.mjs";
import { getRequestBody, setNoStore } from "../../../server/_shipping.mjs";
import { applyTeamAdminAction } from "../../../server/_team-admin.mjs";
import { applyProductionStockUpdate } from "../../../server/_production-stock-admin.mjs";
import { resolveAuthenticatedUser } from "../../../server/_session.mjs";

export default async function handler(req, res) {
  setNoStore(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Metodo nao permitido." });
  }

  try {
    const authorizationHeader = req.headers?.authorization || req.headers?.Authorization || "";
    const body = getRequestBody(req);
    if (body?.action === "production.stock.update") {
      const user = await resolveAuthenticatedUser(authorizationHeader);
      const result = await applyProductionStockUpdate({ payload: body?.payload, user });
      return res.status(200).json({ ok: true, result });
    }

    const adminUser = await requireAdminUser(authorizationHeader);
    if (String(body?.action || "").startsWith("team.")) {
      const result = await applyTeamAdminAction({ action: String(body.action).slice(5), payload: body?.payload, adminUid: adminUser.uid });
      return res.status(200).json({ ok: true, result });
    }

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
    if (isSessionRequestError(error) || isStorefrontAdminError(error) || Number(error?.status)) {
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
