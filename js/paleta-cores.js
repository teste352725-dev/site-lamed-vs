// Paleta padrão de cores da Laméd VS.
// Uma cor de tecido = um nome e um tom. Detalhes (bordado, arabesco, borda)
// entram no nome: "Pérola com bordado dourado". O tom mostrado é o do tecido.
(function () {
  "use strict";

  // Tons de referência de tecido (linho/algodão), do claro ao escuro.
  var PALETA = [
    { nome: "Branco", hex: "#FFFFFF" },
    { nome: "Off-white", hex: "#F7F3EA" },
    { nome: "Pérola", hex: "#F2EBDC" },
    { nome: "Areia", hex: "#E6D7B9" },
    { nome: "Bege", hex: "#CDBA9A" },
    { nome: "Amarelo", hex: "#F2D35B" },
    { nome: "Dourado", hex: "#C9A45C" },
    { nome: "Rosa", hex: "#F2B8C6" },
    { nome: "Marsala", hex: "#964F4C" },
    { nome: "Azul", hex: "#3F63C4" },
    { nome: "Azul-marinho", hex: "#1F2D4D" },
    { nome: "Verde", hex: "#396441" },
    { nome: "Cinza", hex: "#A3A3A3" },
    { nome: "Preto", hex: "#1A1A1A" }
  ];

  var ACABAMENTOS = [
    { id: "", rotulo: "Lisa (sem detalhe)" },
    { id: "bordado", rotulo: "Com bordado" },
    { id: "arabesco", rotulo: "Com arabesco" },
    { id: "borda", rotulo: "Com borda" }
  ];

  // Cor do detalhe, sempre guardada no masculino ("dourado").
  var DETALHES = ["dourado", "prata", "preto", "branco", "marsala", "verde", "azul", "rosa"];
  var FEMININO = { dourado: "dourada", preto: "preta", branco: "branca" };

  function semAcento(texto) {
    return String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  }
  function chave(texto) {
    return semAcento(texto).replace(/[‎‏​]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  var BASES = {
    "branco": "Branco", "branca": "Branco",
    "off-white": "Off-white", "off white": "Off-white", "offwhite": "Off-white",
    "perola": "Pérola", "areia": "Areia", "bege": "Bege", "amarelo": "Amarelo",
    "dourado": "Dourado", "dourados": "Dourado", "rosa": "Rosa", "marsala": "Marsala",
    "azul-marinho": "Azul-marinho", "azul marinho": "Azul-marinho", "azul": "Azul",
    "verde": "Verde", "cinza": "Cinza", "preto": "Preto", "preta": "Preto"
  };
  var BASES_ORDEM = Object.keys(BASES).sort(function (a, b) { return b.length - a.length; });

  var DETALHE_NORMAL = {
    dourado: "dourado", dourada: "dourado", dourados: "dourado", douradas: "dourado",
    prata: "prata", prateado: "prata", prateada: "prata",
    preto: "preto", preta: "preto", pretos: "preto",
    branco: "branco", branca: "branco",
    marsala: "marsala", verde: "verde", azul: "azul", rosa: "rosa"
  };

  function hexDaBase(base) {
    for (var i = 0; i < PALETA.length; i += 1) if (PALETA[i].nome === base) return PALETA[i].hex;
    return "";
  }

  function montarNome(base, acabamento, detalhe) {
    if (!acabamento) return base;
    var d = acabamento === "borda" ? (FEMININO[detalhe] || detalhe) : detalhe;
    return base + " com " + acabamento + " " + d;
  }

  // Lê um nome livre ("Perola com Bordados dourados") e devolve o padrão.
  // Retorna null quando não reconhece (a cor fica como está).
  function padronizar(nome) {
    var texto = chave(nome).replace(/^guardanapo estrela de davi /, "");
    var base = "";
    var resto = "";
    for (var i = 0; i < BASES_ORDEM.length; i += 1) {
      var k = BASES_ORDEM[i];
      if (texto === k || texto.indexOf(k + " ") === 0) { base = BASES[k]; resto = texto.slice(k.length).trim(); break; }
    }
    if (!base) return null;
    if (!resto) return { nome: base, hex: hexDaBase(base), base: base, acabamento: "", detalhe: "", inferido: false };
    var m = resto.match(/^com (bordados?|arabescos?|bordas?)? ?([a-z]+)$/);
    if (!m) return null;
    var detalhe = DETALHE_NORMAL[m[2]];
    if (!detalhe) return null;
    var acabamento = m[1] ? m[1].replace(/s$/, "") : "bordado";
    return {
      nome: montarNome(base, acabamento, detalhe),
      hex: hexDaBase(base),
      base: base,
      acabamento: acabamento,
      detalhe: detalhe,
      inferido: !m[1] // "Cinza com verde" -> "Cinza com bordado verde"
    };
  }

  window.LamedPaleta = {
    PALETA: PALETA,
    ACABAMENTOS: ACABAMENTOS,
    DETALHES: DETALHES,
    montarNome: montarNome,
    hexDaBase: hexDaBase,
    padronizar: padronizar
  };
})();
