// Botao "Compartilhar" da pagina da peca.
// Usa o compartilhar do proprio celular (WhatsApp, Instagram, etc.), o que
// tambem funciona no site instalado como aplicativo. Sem isso, copia o link.
// Sempre que existe, compartilha a pagina propria da peca (/produto/...),
// que mostra a foto da peca na previa do link.
(function () {
  "use strict";
  var SITE = "https://www.lamedvs.com.br";
  var PRODUCT_ID = /^[A-Za-z0-9]{6,40}$/;
  var linksPromise = null;
  var colecoesPromise = null;

  function carregarLinksColecoes() {
    if (!colecoesPromise) {
      colecoesPromise = fetch("/colecao/links.json", { cache: "no-cache" })
        .then(function (r) { return r.ok ? r.json() : {}; })
        .catch(function () { return {}; });
    }
    return colecoesPromise;
  }

  function carregarLinks() {
    if (!linksPromise) {
      linksPromise = fetch("/produto/links.json", { cache: "no-cache" })
        .then(function (r) { return r.ok ? r.json() : {}; })
        .catch(function () { return {}; });
    }
    return linksPromise;
  }

  function linkDaPeca(id) {
    return carregarLinks().then(function (links) {
      var caminho = links && typeof links[id] === "string" && /^\/produto\/[a-z0-9-]+\/$/.test(links[id]) ? links[id] : "";
      return caminho ? SITE + caminho : SITE + "/#/produto/" + id;
    });
  }

  function avisar(botao, texto) {
    var rotulo = botao.querySelector("[data-share-label]") || botao;
    var original = rotulo.getAttribute("data-original") || rotulo.textContent;
    rotulo.setAttribute("data-original", original);
    rotulo.textContent = texto;
    clearTimeout(botao._lvTimer);
    botao._lvTimer = setTimeout(function () { rotulo.textContent = original; }, 2500);
  }

  function copiar(texto) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(texto);
    return new Promise(function (resolve, reject) {
      var campo = document.createElement("textarea");
      campo.value = texto;
      campo.setAttribute("readonly", "");
      campo.style.position = "fixed";
      campo.style.opacity = "0";
      document.body.appendChild(campo);
      campo.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(campo);
      ok ? resolve() : reject(new Error("copy"));
    });
  }

  function compartilhar(botao, nome, url) {
    var dados = { title: nome ? nome + " | Laméd vs" : "Laméd vs", text: nome ? "Olha esta peça da Laméd vs: " + nome : "Olha esta peça da Laméd vs", url: url };
    if (navigator.share) {
      return navigator.share(dados).catch(function (erro) {
        if (erro && erro.name === "AbortError") return; // a pessoa fechou a janela
        return copiar(url)
          .then(function () { avisar(botao, "Link copiado"); })
          .catch(function () { window.prompt("Copie o link da peça:", url); });
      });
    }
    return copiar(url)
      .then(function () { avisar(botao, "Link copiado"); })
      .catch(function () { window.prompt("Copie o link da peça:", url); });
  }

  function compartilharColecao(botao, nome, url) {
    var dados = { title: "Coleção " + nome + " | Laméd vs", text: "Conheça a coleção " + nome + " da Laméd vs", url: url };
    if (navigator.share) {
      return navigator.share(dados).catch(function (erro) {
        if (erro && erro.name === "AbortError") return;
        return copiar(url).then(function () { avisar(botao, "Link copiado"); }).catch(function () { window.prompt("Copie o link da coleção:", url); });
      });
    }
    return copiar(url).then(function () { avisar(botao, "Link copiado"); }).catch(function () { window.prompt("Copie o link da coleção:", url); });
  }

  document.addEventListener("click", function (event) {
    var botaoColecao = event.target && event.target.closest && event.target.closest("[data-share-collection]");
    if (botaoColecao) {
      event.preventDefault();
      var colecaoId = botaoColecao.getAttribute("data-share-collection") || "";
      if (!PRODUCT_ID.test(colecaoId)) return;
      var tituloColecao = document.querySelector("#page-collection h3");
      var nomeColecao = tituloColecao ? tituloColecao.textContent.trim() : "";
      carregarLinksColecoes().then(function (links) {
        var caminho = links && typeof links[colecaoId] === "string" && /^\/colecao\/[a-z0-9-]+\/$/.test(links[colecaoId]) ? links[colecaoId] : "";
        compartilharColecao(botaoColecao, nomeColecao, caminho ? SITE + caminho : SITE + "/#/colecao/" + colecaoId);
      });
      return;
    }
    var botao = event.target && event.target.closest && event.target.closest("[data-share-product]");
    if (!botao) return;
    event.preventDefault();

    // Pagina propria da peca: o link certo ja esta na pagina.
    var canonical = botao.getAttribute("data-share-url");
    if (canonical) {
      compartilhar(botao, botao.getAttribute("data-share-name") || "", canonical);
      return;
    }

    // Loja (index.html): a peca aberta vem do endereco #/produto/<id>.
    var m = String(location.hash || "").match(/^#\/produto\/([A-Za-z0-9]+)/);
    var id = m && PRODUCT_ID.test(m[1]) ? m[1] : "";
    var titulo = document.getElementById("detail-title");
    var nome = titulo ? titulo.textContent.trim() : "";
    if (!id) { compartilhar(botao, nome, SITE + "/"); return; }

    // navigator.share precisa acontecer logo apos o toque; a lista de links
    // normalmente ja foi carregada quando a peca abriu (ver abaixo).
    linkDaPeca(id).then(function (url) { compartilhar(botao, nome, url); });
  });

  // Carrega a lista de links quando uma peca e aberta, para o toque ser imediato.
  function preparar() {
    if (/^#\/produto\//.test(location.hash || "")) carregarLinks();
    if (/^#\/colecao\//.test(location.hash || "")) carregarLinksColecoes();
  }
  window.addEventListener("hashchange", preparar);
  preparar();
})();
