// Contador anônimo de visitas (aparece no Ateliê da equipe).
// Sem cookie e sem identificar ninguém: só avisa o servidor "teve uma visita",
// "esta peça foi vista" e "alguém tocou para chamar no WhatsApp".
(function () {
  "use strict";
  var ENDPOINT = "/api/eventos";
  var PRODUCT_ID = /^[A-Za-z0-9]{6,40}$/;

  function equipe() {
    try { return localStorage.getItem("lamed_equipe") === "1"; } catch (e) { return false; }
  }
  function jaContou(chave) {
    try {
      if (sessionStorage.getItem(chave)) return true;
      sessionStorage.setItem(chave, "1");
    } catch (e) {}
    return false;
  }
  function enviar(evento) {
    if (equipe()) return;
    var corpo = JSON.stringify(evento);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, corpo)) return;
    } catch (e) {}
    try {
      fetch(ENDPOINT, { method: "POST", body: corpo, keepalive: true, headers: { "Content-Type": "text/plain" } }).catch(function () {});
    } catch (e) {}
  }

  function produtoDaRota() {
    var m = String(location.hash || "").match(/^#\/produto\/([A-Za-z0-9]+)/);
    if (m && PRODUCT_ID.test(m[1])) return m[1];
    var main = document.querySelector("[data-product-id]");
    var id = main && main.getAttribute("data-product-id");
    return id && PRODUCT_ID.test(id) ? id : "";
  }

  function contarProduto() {
    var id = produtoDaRota();
    if (id && !jaContou("lv_p_" + id)) enviar({ t: "produto", id: id });
  }

  function origemDoClique(link) {
    if (link.closest(".floating-whatsapp")) return "flutuante";
    if (link.closest(".produto-whats")) return "pagina-produto";
    if (link.closest("footer")) return "rodape";
    return produtoDaRota() ? "produto" : "outro";
  }

  document.addEventListener("click", function (event) {
    var link = event.target && event.target.closest && event.target.closest('a[href*="wa.me"], a[href*="api.whatsapp.com"]');
    if (!link) return;
    var origem = origemDoClique(link);
    var id = produtoDaRota();
    enviar({ t: "whatsapp", o: origem, id: id });
  }, true);

  window.addEventListener("hashchange", contarProduto);

  function iniciar() {
    if (!jaContou("lv_visita")) enviar({ t: "visita" });
    contarProduto();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();

  // O checkout chama isto antes de abrir o WhatsApp com o pedido.
  window.LamedMetricas = {
    whatsapp: function (origem, id) {
      enviar({ t: "whatsapp", o: origem || "outro", id: PRODUCT_ID.test(String(id || "")) ? id : "" });
    }
  };
})();
