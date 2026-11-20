// Operações > "Padronizar cores": corrige os nomes das cores de todas as peças
// para a paleta padrão (js/paleta-cores.js). Mostra antes o que vai mudar,
// baixa uma cópia de segurança e mantém o estoque de cada cor.
(() => {
    const $ = (selector, root = document) => root.querySelector(selector);
    const esc = (value) => String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    let db = null;
    let auth = null;
    let plano = null;      // resultado da prévia
    let copia = null;      // cópia de segurança da última aplicação (para desfazer)

    function log(message, type = 'info') {
        if (typeof window.log === 'function') window.log(message, type);
        else console.log(message);
    }

    const numero = (value) => {
        const n = parseInt(value, 10);
        return Number.isFinite(n) && n > 0 ? n : 0;
    };

    // Junta duas cores que viraram a mesma (soma o estoque).
    function juntar(a, b) {
        const out = { ...b, ...a }; // campos que só a segunda tinha (ex.: foto) não se perdem
        if (a.quantidade != null || b.quantidade != null) out.quantidade = numero(a.quantidade) + numero(b.quantidade);
        if (a.estoque != null || b.estoque != null) out.estoque = numero(a.estoque) + numero(b.estoque);
        if (a.produzir != null || b.produzir != null) out.produzir = numero(a.produzir) + numero(b.produzir);
        return out;
    }

    // Novas cores de uma peça + lista do que mudou.
    function planejarPeca(cores) {
        const paleta = window.LamedPaleta;
        const novas = [];
        const mudancas = [];
        const desconhecidas = [];
        (Array.isArray(cores) ? cores : []).forEach((cor) => {
            if (!cor || typeof cor !== 'object') { novas.push(cor); return; }
            const padrao = paleta.padronizar(cor.nome);
            if (!padrao) {
                desconhecidas.push(String(cor.nome || ''));
                novas.push(cor);
                return;
            }
            const nova = { ...cor, nome: padrao.nome, hex: padrao.hex };
            if (nova.nome !== cor.nome || nova.hex !== cor.hex) {
                mudancas.push({ de: String(cor.nome || ''), para: padrao.nome, inferido: padrao.inferido });
            }
            const igual = novas.findIndex((item) => item && item.nome === nova.nome);
            if (igual >= 0) {
                novas[igual] = juntar(novas[igual], nova);
                mudancas.push({ de: String(cor.nome || ''), para: padrao.nome, juntou: true });
            } else {
                novas.push(nova);
            }
        });
        return { novas, mudancas, desconhecidas };
    }

    async function verPrevia() {
        if (!window.LamedPaleta) return log('Paleta de cores não carregou. Recarregue a página.', 'error');
        const snap = await db.collection('pecas').get();
        const pecas = [];
        const resumo = new Map();
        const desconhecidas = new Set();
        let juntadas = 0;
        snap.docs.forEach((doc) => {
            const data = doc.data() || {};
            const r = planejarPeca(data.cores);
            r.desconhecidas.forEach((nome) => desconhecidas.add(nome));
            if (!r.mudancas.length) return;
            pecas.push({ id: doc.id, nome: data.nome || doc.id });
            r.mudancas.forEach((m) => {
                if (m.juntou) juntadas += 1;
                const chave = `${m.de}→${m.para}`;
                const atual = resumo.get(chave) || { ...m, vezes: 0 };
                atual.vezes += 1;
                resumo.set(chave, atual);
            });
        });
        plano = { pecas, total: snap.size };
        const linhas = [...resumo.values()].sort((a, b) => a.para.localeCompare(b.para, 'pt-BR') || a.de.localeCompare(b.de, 'pt-BR'));
        const alvo = $('#padronizar-cores-previa');
        alvo.innerHTML = `
            <p class="padronizar-cores__resumo"><strong>${pecas.length}</strong> de ${snap.size} peças vão mudar.
            ${juntadas ? `<br>${juntadas} cor(es) repetida(s) na mesma peça vão virar uma só, somando o estoque.` : ''}</p>
            ${linhas.length ? `<ul class="padronizar-cores__lista">${linhas.map((l) => `
                <li><span class="padronizar-cores__de">${esc(l.de || '(sem nome)')}</span>
                <span aria-hidden="true">→</span>
                <span class="padronizar-cores__para"><i class="padronizar-cores__amostra" style="background:${esc(window.LamedPaleta.padronizar(l.para)?.hex || '#ccc')}"></i>${esc(l.para)}</span>
                <small>${l.vezes} peça(s)${l.de === l.para ? ' · só o tom' : ''}${l.inferido ? ' · completei com "bordado"' : ''}</small></li>`).join('')}</ul>` : '<p>Todas as cores já estão no padrão.</p>'}
            ${desconhecidas.size ? `<p class="padronizar-cores__aviso">Não reconheci e vou deixar como está: ${[...desconhecidas].map(esc).join(', ')}</p>` : ''}`;
        $('#padronizar-cores-aplicar').disabled = pecas.length === 0;
        log(`Prévia: ${pecas.length} peça(s) com cores para padronizar.`, 'info');
    }

    function baixar(nome, dados) {
        const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = nome;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    async function aplicar() {
        if (!plano || !plano.pecas.length) return;
        if (!auth.currentUser) return log('Entre com a conta de administração.', 'error');
        if (!window.confirm(`Padronizar as cores de ${plano.pecas.length} peça(s)? Uma cópia de segurança será baixada antes.`)) return;
        const botao = $('#padronizar-cores-aplicar');
        botao.disabled = true;
        botao.textContent = 'Aplicando…';
        // Cópia de segurança das cores atuais (arquivo + memória para desfazer).
        const snap = await db.collection('pecas').get();
        copia = snap.docs.map((doc) => ({ id: doc.id, nome: doc.data()?.nome || '', cores: doc.data()?.cores || [] }));
        baixar(`backup_cores_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`, { geradoEm: new Date().toISOString(), pecas: copia });

        let feitas = 0;
        let falhas = 0;
        for (const peca of plano.pecas) {
            const ref = db.collection('pecas').doc(peca.id);
            try {
                // Transação: lê a versão mais nova (pode ter tido venda no Ateliê agora) e grava.
                await db.runTransaction(async (tx) => {
                    const atual = await tx.get(ref);
                    if (!atual.exists) return;
                    const r = planejarPeca(atual.data()?.cores);
                    if (!r.mudancas.length) return;
                    tx.update(ref, { cores: r.novas, updatedAt: new Date() });
                });
                feitas += 1;
            } catch (error) {
                falhas += 1;
                log(`Não consegui atualizar "${peca.nome}": ${error?.message || error}`, 'error');
            }
        }
        try {
            await db.collection('operacoes_logs').add({ action: 'padronizar_cores', admin: auth.currentUser.email || auth.currentUser.uid, total: feitas, createdAt: new Date() });
        } catch (error) { /* registro é opcional */ }
        log(`Cores padronizadas em ${feitas} peça(s)${falhas ? `; ${falhas} com erro` : ''}. A cópia de segurança foi baixada.`, falhas ? 'warning' : 'success');
        botao.textContent = 'Aplicar padronização';
        $('#padronizar-cores-desfazer').hidden = false;
        await verPrevia();
    }

    async function desfazer() {
        if (!copia) return;
        if (!window.confirm('Voltar as cores como estavam antes? O estoque das cores volta ao valor da cópia.')) return;
        let feitas = 0;
        for (const item of copia) {
            await db.collection('pecas').doc(item.id).update({ cores: item.cores, updatedAt: new Date() }).then(() => { feitas += 1; })
                .catch((error) => log(`Erro ao restaurar ${item.nome}: ${error.message}`, 'error'));
        }
        log(`Cores restauradas em ${feitas} peça(s).`, 'success');
        copia = null;
        $('#padronizar-cores-desfazer').hidden = true;
        await verPrevia();
    }

    function montarCartao() {
        const referencia = $('.color-card');
        if (!referencia || $('#padronizar-cores')) return false;
        const cartao = document.createElement('article');
        cartao.id = 'padronizar-cores';
        cartao.className = 'operation-card';
        cartao.innerHTML = `
            <div class="operation-card-head"><span class="operation-icon"><i class="fa-solid fa-swatchbook"></i></span><div><span class="panel-kicker">Paleta</span><h3>Padronizar cores</h3></div></div>
            <p>Corrige o português dos nomes das cores e usa o mesmo tom para a mesma cor em todas as peças (ex.: um só "Azul"). O estoque de cada cor é mantido.</p>
            <div class="operation-actions split-actions">
                <button id="padronizar-cores-ver" type="button" class="btn btn-secondary"><i class="fa-solid fa-eye"></i> Ver o que vai mudar</button>
                <button id="padronizar-cores-aplicar" type="button" class="btn btn-primary" disabled>Aplicar padronização</button>
            </div>
            <button id="padronizar-cores-desfazer" type="button" class="btn btn-ghost full-width" hidden>Desfazer (voltar como estava)</button>
            <div id="padronizar-cores-previa" class="padronizar-cores__previa"></div>`;
        referencia.insertAdjacentElement('afterend', cartao);
        const estilo = document.createElement('style');
        estilo.textContent = `.padronizar-cores__previa{margin-top:12px;font-size:13px}.padronizar-cores__resumo{margin:0 0 10px}.padronizar-cores__lista{list-style:none;margin:0;padding:0;display:grid;gap:6px;max-height:420px;overflow:auto}.padronizar-cores__lista li{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:8px;align-items:center;padding:8px 10px;border:1px solid rgba(95,61,47,.1);border-radius:12px;background:rgba(255,255,255,.75)}.padronizar-cores__lista small{grid-column:1/-1;color:#7a7068;font-size:11px}.padronizar-cores__de{color:#8b6b5c;text-decoration:line-through;text-decoration-color:rgba(139,107,92,.5)}.padronizar-cores__para{display:flex;align-items:center;gap:6px;font-weight:700}.padronizar-cores__amostra{display:inline-block;flex:none;width:14px;height:14px;border-radius:50%;border:1px solid rgba(0,0,0,.15)}.padronizar-cores__aviso{margin-top:10px;color:#9a5b13}`;
        document.head.appendChild(estilo);
        $('#padronizar-cores-ver').addEventListener('click', () => verPrevia().catch((error) => log(`Erro na prévia: ${error.message}`, 'error')));
        $('#padronizar-cores-aplicar').addEventListener('click', () => aplicar().catch((error) => log(`Erro ao aplicar: ${error.message}`, 'error')));
        $('#padronizar-cores-desfazer').addEventListener('click', () => desfazer().catch((error) => log(`Erro ao desfazer: ${error.message}`, 'error')));
        return true;
    }

    function iniciar() {
        const app = window.firebase?.apps?.length ? window.firebase.app() : null;
        if (!app) return false;
        db = window.firebase.firestore(app);
        auth = window.firebase.auth(app);
        return montarCartao();
    }

    let tentativas = 0;
    const timer = window.setInterval(() => {
        tentativas += 1;
        if ((document.querySelector('.color-card') && window.firebase?.apps?.length && iniciar()) || tentativas > 80) {
            window.clearInterval(timer);
        }
    }, 250);
})();
