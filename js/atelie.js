// Ateliê — área da equipe (estoque, peças e visitas). Tudo passa pelo servidor,
// que confere a permissão de cada pessoa. Pensado para o celular.
(function () {
  "use strict";

  var FIREBASE_CONFIG = { apiKey: "AIzaSyCzB4_YotWCPVh1yaqWkhbB4LypPQYvV4U", authDomain: "site-lamed.firebaseapp.com", projectId: "site-lamed", storageBucket: "site-lamed.firebasestorage.app", messagingSenderId: "862756160215", appId: "1:862756160215:web:d0fded233682bf93eaa692" };
  var API = "/api/admin/storefront/update";
  var TEAM_FLAG = "lamed_equipe"; // celulares da equipe não entram na contagem de visitas
  var UNDO_MS = 9000;

  var auth = null;
  var state = {
    me: null, pecas: [], movimentos: [], vendasSemana: 0, visitas: null,
    filtro: "mesa", aba: "inicio", pecaAberta: null, mov: null, editando: null, manifest: null
  };
  var avisoTimer = null;
  var ultimoFoco = null;

  // ------------------------------------------------------------ utilidades
  function $(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
    });
  }
  function brl(n) { return Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
  function plural(n, um, varios) { return n === 1 ? um : varios; }
  function normalizar(texto) { return String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  function novoId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 14);
  }
  function normalizarUsuario(value) {
    return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, ".").replace(/[^a-z0-9._-]/g, "").replace(/^[._-]+|[._-]+$/g, "");
  }
  function setView(view) { $("app").setAttribute("data-view", view); }
  function marcarEquipe() { try { localStorage.setItem(TEAM_FLAG, "1"); } catch (e) {} }

  function saudacao(nome) {
    var hora = Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }).format(new Date()));
    var parte = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
    var primeiro = String(nome || "").trim().split(/\s+/)[0];
    return primeiro ? parte + ", " + primeiro : parte;
  }

  // ------------------------------------------------------------ servidor
  function api(action, payload) {
    var user = auth.currentUser;
    if (!user) return Promise.reject(new Error("Sua sessão terminou. Entre novamente."));
    return user.getIdToken().then(function (token) {
      return fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ action: "atelie." + action, payload: payload || {} })
      });
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok || !data.ok) {
          var error = new Error(data.error || "Não foi possível concluir agora. Tente de novo.");
          error.code = data.code || "";
          error.status = response.status;
          throw error;
        }
        return data.result;
      });
    }, function (error) {
      if (error && error.status) throw error;
      var offline = new Error("Sem conexão com a internet. Confira o sinal e tente de novo.");
      offline.code = "REDE";
      throw offline;
    });
  }

  // ------------------------------------------------------------ fotos leves
  function carregarManifesto() {
    return fetch("img/manifest.json", { cache: "no-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) { state.manifest = m && m.items ? m : null; })
      .catch(function () {});
  }
  function fotoPequena(url) {
    var key = state.manifest && state.manifest.items[url];
    return key ? "img/p/" + key + "-480.webp" : "";
  }
  function fotoHtml(peca) {
    var src = fotoPequena(peca.imagem);
    if (src) return '<img class="peca__foto" src="' + esc(src) + '" alt="" loading="lazy" decoding="async" width="56" height="56">';
    return '<span class="peca__foto" aria-hidden="true">' + esc((peca.nome || "?").charAt(0)) + "</span>";
  }

  // ------------------------------------------------------------ aviso
  function aviso(texto, opcoes) {
    opcoes = opcoes || {};
    var box = $("aviso");
    $("aviso-texto").textContent = texto;
    box.classList.toggle("aviso--erro", Boolean(opcoes.erro));
    var desfazer = $("aviso-desfazer");
    desfazer.hidden = !opcoes.desfazer;
    desfazer.onclick = opcoes.desfazer ? function () { esconderAviso(); opcoes.desfazer(); } : null;
    box.hidden = false;
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(esconderAviso, opcoes.desfazer ? UNDO_MS : 4500);
  }
  function esconderAviso() { $("aviso").hidden = true; }

  // ------------------------------------------------------------ início
  function renderInicio() {
    $("titulo-inicio").textContent = saudacao(state.me && state.me.nome);
    var v = state.visitas;
    var podeVer = state.me && state.me.permissoes.visitas;
    $("bloco-visitas").hidden = !podeVer;
    if (podeVer) {
      $("v-hoje").textContent = v ? v.hoje.visitas : "–";
      $("w-hoje").textContent = v ? v.hoje.whatsapp : "–";
      var barras = $("semana-barras");
      if (v && v.serie) {
        var max = Math.max.apply(null, v.serie.map(function (d) { return d.visitas; }).concat([1]));
        var nomes = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
        barras.innerHTML = v.serie.map(function (d, i) {
          var dia = new Date(d.dia + "T12:00:00");
          var altura = Math.round((d.visitas / max) * 100);
          var hoje = i === v.serie.length - 1;
          return '<div class="semana__dia' + (hoje ? " semana__dia--hoje" : "") + '"><span class="semana__barra" style="height:' + Math.max(3, altura) + '%"></span><span class="semana__rotulo">' + (hoje ? "hoje" : nomes[dia.getDay()]) + "</span></div>";
        }).join("");
        barras.setAttribute("aria-label", "Visitas por dia: " + v.serie.map(function (d) { return d.visitas; }).join(", "));
        $("semana-legenda").textContent = v.periodo.visitas === 0
          ? "O contador de visitas começou agora. Os números aparecem aqui ao longo do dia."
          : v.periodo.visitas + " " + plural(v.periodo.visitas, "visita", "visitas") + " e " + v.periodo.whatsapp + " " + plural(v.periodo.whatsapp, "chamada", "chamadas") + " no WhatsApp nos últimos 7 dias.";
      } else {
        barras.innerHTML = "";
        $("semana-legenda").textContent = "Não foi possível carregar as visitas agora.";
      }
    }
    renderRanking("mais-vistas", v && v.maisVistas, "visualizações", "Ainda não há peças vistas nesta semana.");
    renderRanking("mais-whatsapp", v && v.maisWhatsapp, "chamadas", "Ninguém chamou no WhatsApp a partir de uma peça nesta semana.");

    var produzindo = 0, prontas = 0;
    state.pecas.forEach(function (p) { p.variantes.forEach(function (x) { produzindo += x.produzir; prontas += x.pronta; }); });
    $("total-produzindo").textContent = produzindo;
    $("total-prontas").textContent = prontas;
    $("vendas-semana").textContent = state.vendasSemana;

    var lista = $("ultimos-movimentos");
    if (!state.movimentos.length) {
      lista.innerHTML = '<li class="vazio">Nenhum movimento nos últimos 7 dias. Use a aba Estoque para registrar.</li>';
    } else {
      lista.innerHTML = state.movimentos.slice(0, 8).map(function (m) {
        var quando = m.createdAt ? new Date(m.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
        return '<li><span class="' + (m.desfeito ? "movimentos__desfeito" : "") + '">' + esc(m.productName) + ": " + esc(lowerFirst(m.descricao)) + "</span>" +
          '<span class="movimentos__quem">' + esc(m.userName) + (quando ? ", " + esc(quando) : "") + (m.desfeito ? " (desfeito)" : "") + "</span></li>";
      }).join("");
    }
  }
  function lowerFirst(t) { t = String(t || ""); return /^\d/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1); }

  function renderRanking(id, itens, unidade, vazio) {
    var el = $(id);
    if (!itens || !itens.length) { el.innerHTML = '<li class="vazio">' + esc(vazio) + "</li>"; return; }
    el.innerHTML = itens.map(function (i) {
      return '<li><span class="ranking__nome">' + esc(i.nome) + '</span><span class="ranking__total" aria-label="' + i.total + " " + unidade + '">' + i.total + "</span></li>";
    }).join("");
  }

  // ------------------------------------------------------------ estoque
  function totais(peca) {
    return peca.variantes.reduce(function (t, v) { t.produzir += v.produzir; t.pronta += v.pronta; return t; }, { produzir: 0, pronta: 0 });
  }
  function resumoEstoque(peca) {
    var t = totais(peca);
    if (!t.produzir && !t.pronta) return "Sem peças em produção ou prontas";
    var partes = [];
    if (t.produzir) partes.push(t.produzir + " em produção");
    if (t.pronta) partes.push(t.pronta + " " + plural(t.pronta, "pronta", "prontas"));
    return partes.join(", ");
  }
  function filtrar(lista, termo, segmento) {
    // Cada palavra digitada precisa aparecer, em qualquer ordem ("toalha shabat").
    var palavras = normalizar(termo).split(/\s+/).filter(Boolean);
    return lista.filter(function (p) {
      if (segmento && segmento !== "todas" && p.segmento !== segmento && !palavras.length) return false;
      var texto = normalizar(p.nome + " " + String(p.categoria || "").replace(/_/g, " "));
      return palavras.every(function (w) { return texto.indexOf(w) !== -1; });
    });
  }
  function renderEstoque() {
    var itens = filtrar(state.pecas, $("busca-estoque").value, state.filtro);
    var lista = $("lista-estoque");
    if (!itens.length) {
      lista.innerHTML = '<li class="vazio">Nenhuma peça encontrada. Confira o nome ou toque em "Todas".</li>';
      return;
    }
    lista.innerHTML = itens.map(function (p) {
      return '<li><button type="button" class="peca" data-abrir="' + esc(p.id) + '">' + fotoHtml(p) +
        '<span><span class="peca__nome">' + esc(p.nome) + '</span><span class="peca__info">' + esc(resumoEstoque(p)) +
        (p.status !== "active" ? ' <span class="peca__inativa">(fora do site)</span>' : "") + "</span></span>" +
        '<span class="peca__seta" aria-hidden="true">›</span></button></li>';
    }).join("");
  }

  function abrirPeca(id) {
    state.pecaAberta = id;
    renderFolhaPeca();
    abrirFolha("folha-peca");
  }
  function renderFolhaPeca() {
    var p = acharPeca(state.pecaAberta);
    if (!p) return;
    $("folha-peca-titulo").textContent = p.nome;
    $("folha-peca-cores").innerHTML = p.variantes.map(function (v, i) {
      var amostra = v.hex ? '<span class="amostra" style="background-color:' + esc(v.hex) + '" aria-hidden="true"></span>' : '<span class="amostra amostra--sem-cor" aria-hidden="true"></span>';
      return '<li class="cor"><div class="cor__cabeca">' + amostra + '<span class="cor__nome">' + esc(v.cor || "Peça (sem cor)") + "</span></div>" +
        '<div class="cor__numeros"><p class="numero"><span class="numero__valor">' + v.produzir + '</span><span class="numero__rotulo">em produção</span></p>' +
        '<p class="numero"><span class="numero__valor">' + v.pronta + '</span><span class="numero__rotulo">' + plural(v.pronta, "pronta", "prontas") + "</span></p></div>" +
        '<div class="cor__acoes">' +
        '<button type="button" class="acao" data-mov="produzir" data-var="' + i + '">Produzir</button>' +
        '<button type="button" class="acao" data-mov="pronta" data-var="' + i + '">Ficou pronta</button>' +
        '<button type="button" class="acao acao--venda" data-mov="venda" data-var="' + i + '">Vendeu</button>' +
        "</div>" +
        '<button type="button" class="cor__corrigir" data-mov="ajuste" data-var="' + i + '">Corrigir números</button></li>';
    }).join("");
  }

  var TEXTOS = {
    produzir: { titulo: "Começar a produzir", botao: "Lançar na produção", pergunta: "Quantas peças vão para a produção?" },
    pronta: { titulo: "Ficou pronta", botao: "Marcar como prontas", pergunta: "Quantas peças ficaram prontas?" },
    venda: { titulo: "Registrar venda", botao: "Registrar venda", pergunta: "Quantas peças foram vendidas?" },
    ajuste: { titulo: "Corrigir números", botao: "Salvar números", pergunta: "Conte as peças e coloque os números certos." }
  };

  function abrirMovimento(tipo, indice) {
    var p = acharPeca(state.pecaAberta);
    var v = p && p.variantes[indice];
    if (!v) return;
    var origem = "pronta";
    var nota = "";
    if (tipo === "venda" && v.pronta === 0) {
      if (v.produzir > 0) {
        origem = "producao";
        nota = "Não há peça pronta nesta cor. A venda vai sair das peças em produção (uma encomenda, por exemplo).";
      } else {
        nota = "Esta cor não tem peça pronta nem em produção. Use \"Corrigir números\" se a contagem estiver errada.";
      }
    }
    state.mov = { productId: p.id, cor: v.cor, tipo: tipo, origem: origem, movimentoId: novoId(), indice: indice };
    var t = TEXTOS[tipo];
    $("folha-mov-titulo").textContent = t.titulo;
    $("folha-mov-texto").textContent = (v.cor ? p.nome + ", cor " + v.cor : p.nome) + ". " + (nota || t.pergunta);
    $("mov-quantidade").hidden = tipo === "ajuste";
    $("mov-canal").hidden = tipo !== "venda";
    $("mov-ajuste").hidden = tipo !== "ajuste";
    $("mov-qtd").value = 1;
    $("ajuste-produzir").value = v.produzir;
    $("ajuste-pronta").value = v.pronta;
    $("mov-erro").textContent = "";
    var semNada = tipo === "venda" && v.pronta === 0 && v.produzir === 0;
    $("mov-confirmar").textContent = t.botao;
    $("mov-confirmar").disabled = semNada;
    var radio = document.querySelector('#mov-canal input[value="whatsapp"]');
    if (radio) radio.checked = true;
    abrirFolha("folha-mov");
  }

  function confirmarMovimento(event) {
    event.preventDefault();
    var m = state.mov;
    if (!m) return;
    var payload = { productId: m.productId, cor: m.cor, tipo: m.tipo, movimentoId: m.movimentoId };
    if (m.tipo === "ajuste") {
      payload.produzir = Number($("ajuste-produzir").value);
      payload.pronta = Number($("ajuste-pronta").value);
    } else {
      payload.quantidade = Number($("mov-qtd").value);
      if (!(payload.quantidade >= 1)) { $("mov-erro").textContent = "Informe uma quantidade de 1 para cima."; return; }
    }
    if (m.tipo === "venda") {
      payload.origem = m.origem;
      var canal = document.querySelector('#mov-canal input[name="canal"]:checked');
      payload.canal = canal ? canal.value : "outro";
    }
    var botao = $("mov-confirmar");
    botao.disabled = true;
    $("mov-erro").textContent = "";
    api("estoque.mover", payload).then(function (r) {
      // Mesmo id em caso de nova tentativa: o servidor não duplica.
      atualizarPeca(r.peca);
      if (r.movimento && !r.repetido) {
        state.movimentos.unshift(r.movimento);
        if (r.movimento.tipo === "venda") state.vendasSemana += r.movimento.quantidade;
      }
      state.mov = null;
      fecharFolha("folha-mov");
      renderTudo();
      var mov = r.movimento;
      aviso(mov ? mov.descricao + "." : "Registrado.", mov && !r.repetido ? { desfazer: function () { desfazer(mov); } } : {});
    }).catch(function (error) {
      if (error.code === "SEM_PRONTA" && m.origem !== "producao") {
        m.origem = "producao";
        m.movimentoId = novoId();
        $("folha-mov-texto").textContent = "Não há peça pronta nesta cor. Se foi uma peça que ainda está em produção, confirme de novo e a venda sai das peças em produção.";
      } else {
        $("mov-erro").textContent = error.message;
      }
    }).then(function () { botao.disabled = false; });
  }

  function desfazer(mov) {
    api("estoque.desfazer", { movimentoId: mov.id }).then(function (r) {
      atualizarPeca(r.peca);
      state.movimentos.forEach(function (x) { if (x.id === mov.id) x.desfeito = true; });
      if (mov.tipo === "venda") state.vendasSemana = Math.max(0, state.vendasSemana - mov.quantidade);
      renderTudo();
      aviso("Desfeito.");
    }).catch(function (error) { aviso(error.message, { erro: true }); });
  }

  // ------------------------------------------------------------ peças
  function renderPecas() {
    var itens = filtrar(state.pecas, $("busca-pecas").value, "todas");
    var lista = $("lista-pecas");
    if (!itens.length) { lista.innerHTML = '<li class="vazio">Nenhuma peça encontrada com esse nome.</li>'; return; }
    lista.innerHTML = itens.map(function (p) {
      var final = p.desconto > 0 ? Math.round(p.preco * (100 - p.desconto)) / 100 : p.preco;
      return '<li><button type="button" class="peca" data-editar="' + esc(p.id) + '">' + fotoHtml(p) +
        '<span><span class="peca__nome">' + esc(p.nome) + '</span><span class="peca__info">' +
        (p.desconto > 0 ? esc(p.desconto + "% de desconto, sai por " + brl(final)) : esc(p.categoria ? rotuloCategoria(p.categoria) : "")) +
        (p.status !== "active" ? ' <span class="peca__inativa">(fora do site)</span>' : "") +
        '</span></span><span class="peca__preco">' + esc(brl(p.preco)) + "</span></button></li>";
    }).join("");
  }
  function rotuloCategoria(slug) {
    var t = String(slug || "").replace(/_/g, " ");
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  function abrirEdicao(id) {
    var p = acharPeca(id);
    if (!p) return;
    state.editando = id;
    $("editar-nome").value = p.nome;
    $("editar-preco").value = p.preco.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    $("editar-erro").textContent = "";
    atualizarTextoDesconto();
    abrirFolha("folha-editar");
  }
  function lerPreco(texto) {
    var limpo = String(texto || "").replace(/[^\d,.-]/g, "");
    if (limpo.indexOf(",") !== -1) limpo = limpo.replace(/\./g, "").replace(",", ".");
    return Number(limpo);
  }
  function atualizarTextoDesconto() {
    var p = acharPeca(state.editando);
    var el = $("editar-desconto");
    if (!p || !(p.desconto > 0)) { el.textContent = ""; return; }
    var preco = lerPreco($("editar-preco").value);
    el.textContent = Number.isFinite(preco) && preco > 0
      ? "Esta peça está com " + p.desconto + "% de desconto: no site ela sai por " + brl(Math.round(preco * (100 - p.desconto)) / 100) + "."
      : "Esta peça está com " + p.desconto + "% de desconto.";
  }
  function salvarEdicao(event) {
    event.preventDefault();
    var p = acharPeca(state.editando);
    if (!p) return;
    var nome = $("editar-nome").value.trim().replace(/\s+/g, " ");
    var preco = lerPreco($("editar-preco").value);
    var payload = { productId: p.id };
    if (nome !== p.nome) payload.nome = nome;
    if (Number.isFinite(preco) && Math.round(preco * 100) !== Math.round(p.preco * 100)) payload.preco = preco;
    if (!("nome" in payload) && !("preco" in payload)) {
      if (!(preco > 0)) { $("editar-erro").textContent = "Informe um preço válido, como 189,90."; return; }
      fecharFolha("folha-editar");
      aviso("Nada mudou.");
      return;
    }
    if ("preco" in payload && !(preco > 0)) { $("editar-erro").textContent = "Informe um preço válido, como 189,90."; return; }
    var botao = $("editar-salvar");
    botao.disabled = true;
    api("peca.editar", payload).then(function (r) {
      atualizarPeca(r.peca);
      fecharFolha("folha-editar");
      renderTudo();
      aviso("Alteração salva. Já aparece no site.");
    }).catch(function (error) {
      $("editar-erro").textContent = error.message;
    }).then(function () { botao.disabled = false; });
  }

  // ------------------------------------------------------------ estado
  function acharPeca(id) {
    for (var i = 0; i < state.pecas.length; i += 1) if (state.pecas[i].id === id) return state.pecas[i];
    return null;
  }
  function atualizarPeca(peca) {
    if (!peca) return;
    for (var i = 0; i < state.pecas.length; i += 1) {
      if (state.pecas[i].id === peca.id) { state.pecas[i] = peca; return; }
    }
    state.pecas.push(peca);
  }
  function renderTudo() {
    renderInicio();
    renderEstoque();
    renderPecas();
    if (!$("folha-peca").hidden) renderFolhaPeca();
  }

  // ------------------------------------------------------------ abas e folhas
  function irPara(aba) {
    var caps = state.me ? state.me.permissoes : {};
    if (aba === "estoque" && !caps.estoque) aba = "inicio";
    if (aba === "pecas" && !caps.pecas) aba = "inicio";
    state.aba = aba;
    document.querySelectorAll("[data-painel]").forEach(function (el) { el.hidden = el.getAttribute("data-painel") !== aba; });
    document.querySelectorAll("[data-aba]").forEach(function (el) {
      if (el.getAttribute("data-aba") === aba) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
    });
    window.scrollTo(0, 0);
    try { history.replaceState(null, "", "#" + aba); } catch (e) {}
  }
  function abrirFolha(id) {
    var folha = $(id);
    if (folha.hidden) ultimoFoco = document.activeElement;
    folha.hidden = false;
    document.body.style.overflow = "hidden";
    document.body.classList.add("com-folha");
    var alvo = folha.querySelector(".folha__titulo");
    if (alvo) { alvo.setAttribute("tabindex", "-1"); alvo.focus({ preventScroll: true }); }
  }
  function fecharFolha(id) {
    var folha = $(id);
    folha.hidden = true;
    if (id === "folha-mov") state.mov = null;
    var aberta = document.querySelector(".folha:not([hidden])");
    if (!aberta) {
      document.body.style.overflow = "";
      document.body.classList.remove("com-folha");
      if (ultimoFoco && document.contains(ultimoFoco)) ultimoFoco.focus({ preventScroll: true });
    }
  }

  // ------------------------------------------------------------ entrar / sair
  function erroLogin(code) {
    return {
      "auth/invalid-credential": "Usuário ou senha incorretos.",
      "auth/wrong-password": "Usuário ou senha incorretos.",
      "auth/user-not-found": "Usuário ou senha incorretos.",
      "auth/invalid-email": "Usuário ou senha incorretos.",
      "auth/user-disabled": "Este acesso foi bloqueado. Fale com a administração.",
      "auth/too-many-requests": "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.",
      "auth/network-request-failed": "Sem conexão com a internet. Confira o sinal e tente de novo."
    }[code] || "Não foi possível entrar agora. Tente de novo.";
  }
  function entrar(event) {
    event.preventDefault();
    var usuario = $("entrar-usuario").value.trim();
    var senha = $("entrar-senha").value;
    var erro = $("entrar-erro");
    erro.textContent = "";
    if (!usuario || !senha) { erro.textContent = "Preencha o usuário e a senha."; return; }
    var email = usuario.indexOf("@") !== -1 ? usuario : normalizarUsuario(usuario) + "@producao.lamedvs.com.br";
    var botao = $("entrar-botao");
    botao.disabled = true;
    botao.textContent = "Entrando…";
    auth.signInWithEmailAndPassword(email, senha).catch(function (e) {
      erro.textContent = erroLogin(e && e.code);
      botao.disabled = false;
      botao.textContent = "Entrar";
    });
  }
  function carregar() {
    setView("carregando");
    return Promise.all([api("inicio"), state.manifest ? null : carregarManifesto()]).then(function (res) {
      var r = res[0];
      state.me = r.me;
      state.pecas = r.pecas || [];
      state.movimentos = r.movimentos || [];
      state.vendasSemana = r.vendasSemana || 0;
      state.visitas = r.visitas || null;
      marcarEquipe();
      var caps = state.me.permissoes;
      document.querySelector('[data-aba="estoque"]').hidden = !caps.estoque;
      document.querySelector('[data-aba="pecas"]').hidden = !caps.pecas;
      document.querySelector(".abas").style.gridTemplateColumns = "repeat(" + (1 + (caps.estoque ? 1 : 0) + (caps.pecas ? 1 : 0)) + ", 1fr)";
      renderTudo();
      setView("area");
      var hash = location.hash.replace("#", "");
      irPara(["inicio", "estoque", "pecas"].indexOf(hash) !== -1 ? hash : "inicio");
    }).catch(function (error) {
      if (error.status === 403 || error.status === 401) {
        auth.signOut();
        $("entrar-erro").textContent = error.status === 403 ? "Esta conta não tem acesso ao Ateliê. Fale com a administração." : error.message;
      } else {
        $("entrar-erro").textContent = error.message;
      }
      $("entrar-botao").disabled = false;
      $("entrar-botao").textContent = "Entrar";
      setView("entrar");
    });
  }

  // ------------------------------------------------------------ eventos
  function ligarEventos() {
    $("form-entrar").addEventListener("submit", entrar);
    $("entrar-mostrar").addEventListener("click", function (e) {
      var input = $("entrar-senha");
      var mostrar = input.type === "password";
      input.type = mostrar ? "text" : "password";
      e.currentTarget.textContent = mostrar ? "Ocultar" : "Mostrar";
      e.currentTarget.setAttribute("aria-pressed", String(mostrar));
    });
    $("botao-sair").addEventListener("click", function () { auth.signOut(); });

    document.querySelectorAll("[data-aba]").forEach(function (btn) {
      btn.addEventListener("click", function () { irPara(btn.getAttribute("data-aba")); });
    });
    document.querySelectorAll("[data-filtro]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.filtro = btn.getAttribute("data-filtro");
        document.querySelectorAll("[data-filtro]").forEach(function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
        renderEstoque();
      });
    });
    $("busca-estoque").addEventListener("input", renderEstoque);
    $("busca-pecas").addEventListener("input", renderPecas);

    $("lista-estoque").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-abrir]");
      if (btn) abrirPeca(btn.getAttribute("data-abrir"));
    });
    $("lista-pecas").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-editar]");
      if (btn) abrirEdicao(btn.getAttribute("data-editar"));
    });
    $("folha-peca-cores").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-mov]");
      if (btn) abrirMovimento(btn.getAttribute("data-mov"), Number(btn.getAttribute("data-var")));
    });

    document.querySelectorAll(".folha").forEach(function (folha) {
      folha.addEventListener("click", function (e) {
        if (e.target.closest("[data-fechar]")) fecharFolha(folha.id);
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      var abertas = document.querySelectorAll(".folha:not([hidden])");
      if (abertas.length) fecharFolha(abertas[abertas.length - 1].id);
    });

    $("form-mov").addEventListener("submit", confirmarMovimento);
    $("form-mov").addEventListener("click", function (e) {
      var passo = e.target.closest("[data-qtd]");
      var fixo = e.target.closest("[data-qtd-set]");
      var input = $("mov-qtd");
      if (passo) input.value = Math.min(500, Math.max(1, (Number(input.value) || 0) + Number(passo.getAttribute("data-qtd"))));
      if (fixo) input.value = fixo.getAttribute("data-qtd-set");
    });
    $("form-editar").addEventListener("submit", salvarEdicao);
    $("editar-preco").addEventListener("input", atualizarTextoDesconto);
  }

  function iniciar() {
    ligarEventos();
    if (!window.firebase) {
      $("entrar-erro").textContent = "Não foi possível carregar o acesso. Recarregue a página.";
      setView("entrar");
      return;
    }
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    auth = firebase.auth();
    if (window.LAMED_ATELIE_EMULADOR) auth.useEmulator(window.LAMED_ATELIE_EMULADOR, { disableWarnings: true }); // so nos testes locais
    auth.onAuthStateChanged(function (user) {
      if (user) { carregar(); return; }
      state.me = null;
      $("entrar-senha").value = "";
      $("entrar-botao").disabled = false;
      $("entrar-botao").textContent = "Entrar";
      setView("entrar");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
