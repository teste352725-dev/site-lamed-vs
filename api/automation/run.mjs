import { runStoreAutomation } from "../../server/_store-automation.mjs";
import { setNoStore } from "../../server/_shipping.mjs";
import { isSessionRequestError, requireAdminUser } from "../../server/_session.mjs";

function isAuthorizedCronRequest(authorizationHeader) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  const header = String(authorizationHeader || "").trim();
  return Boolean(secret && header === `Bearer ${secret}`);
}

export default async function handler(req, res) {
  setNoStore(res);

  if (!["GET", "POST"].includes(req.method || "")) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Metodo nao permitido." });
  }

  try {
    const authorizationHeader = req.headers?.authorization || req.headers?.Authorization || "";

    let trigger = "cron";
    if (!isAuthorizedCronRequest(authorizationHeader)) {
      const adminUser = await requireAdminUser(authorizationHeader);
      trigger = `admin:${adminUser.uid}`;
    }

    const result = await runStoreAutomation({ trigger });
    return res.status(200).json(result);
  } catch (error) {
    if (isSessionRequestError(error)) {
      return res.status(Number(error.status) || 403).json({
        ok: false,
        error: String(error.message || "Nao autorizado.")
      });
    }

    if (String(error?.message || "") === "automation_locked") {
      return res.status(409).json({
        ok: false,
        error: "A automacao da loja ja esta rodando neste momento."
      });
    }

    console.error("[vercel.automation.run]", error);
    return res.status(500).json({
      ok: false,
      error: "Nao foi possivel executar a automacao agora."
    });
  }
}
