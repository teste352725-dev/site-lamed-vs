(function initAdminNativeShell() {
    const params = new URLSearchParams(window.location.search);
    if (window.self !== window.top || params.get("embedded") === "1") return;

    function installExecutorDiscountConfirmation() {
        if (!/executor_scripts\.html$/i.test(window.location.pathname)) return;

        const adminUid = "NoGsCqiKc0VJwWb6rppk7QVLV1B2";
        let pendingDiscount = null;
        let pendingTimer = null;
        let attempts = 0;
        let operationInFlight = false;
        const buttonSelector = 'button[onclick="runScript(\'aplicarDescontoGlobal\')"]';

        const writeLog = (message, type = 'info') => {
            if (typeof window.log === 'function') window.log(message, type);
        };

        const withTimeout = (promise, timeoutMs, message) => new Promise((resolve, reject) => {
            const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
            Promise.resolve(promise).then(
                (value) => {
                    window.clearTimeout(timer);
                    resolve(value);
                },
                (error) => {
                    window.clearTimeout(timer);
                    reject(error);
                }
            );
        });

        const readFirebaseConfigFromPage = () => {
            const scriptText = Array.from(document.scripts)
                .filter((script) => script.type === 'module')
                .map((script) => script.textContent || '')
                .find((text) => text.includes('firebaseConfig') && text.includes('projectId')) || '';
            const keys = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId'];
            const config = {};
            keys.forEach((key) => {
                const match = scriptText.match(new RegExp(`${key}\\s*:\\s*["']([^"']+)["']`));
                if (match?.[1]) config[key] = match[1];
            });
            if (!config.apiKey || !config.projectId) {
                throw new Error('Não foi possível localizar a configuração do Firebase nesta página.');
            }
            return config;
        };

        const waitForAuthUser = (auth) => {
            if (auth?.currentUser) return Promise.resolve(auth.currentUser);
            return new Promise((resolve, reject) => {
                let settled = false;
                let unsubscribe = null;
                const timer = window.setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    if (unsubscribe) unsubscribe();
                    reject(new Error('A sessão administrativa não ficou disponível a tempo. Recarregue o painel e tente novamente.'));
                }, 8000);
                unsubscribe = auth.onAuthStateChanged((user) => {
                    if (settled || !user) return;
                    settled = true;
                    window.clearTimeout(timer);
                    unsubscribe();
                    resolve(user);
                }, (error) => {
                    if (settled) return;
                    settled = true;
                    window.clearTimeout(timer);
                    reject(error);
                });
            });
        };

        const getCompatServices = async () => {
            if (!window.firebase?.initializeApp || !window.firebase?.firestore || !window.firebase?.auth) {
                throw new Error('Firebase compatível não está disponível nesta página.');
            }

            let app;
            try {
                app = window.firebase.app();
            } catch (error) {
                app = window.firebase.initializeApp(readFirebaseConfigFromPage());
            }

            const auth = window.firebase.auth(app);
            const db = window.firebase.firestore(app);
            const user = await waitForAuthUser(auth);
            const tokenResult = await withTimeout(user.getIdTokenResult(), 8000, 'Não foi possível validar a sessão administrativa.');
            if (user.uid !== adminUid && tokenResult?.claims?.admin !== true) {
                throw new Error('A sessão atual não possui permissão administrativa para alterar as peças.');
            }

            return { db, user };
        };

        const executeGlobalDiscount = async (percent) => {
            if (operationInFlight) {
                writeLog('Já existe uma aplicação de desconto em andamento. Aguarde a conclusão.', 'warning');
                return;
            }

            operationInFlight = true;
            const button = document.querySelector(buttonSelector);
            if (button) button.disabled = true;

            try {
                writeLog('Etapa 1/4: validando a sessão administrativa...', 'info');
                const { db, user } = await getCompatServices();

                writeLog('Etapa 2/4: lendo as peças diretamente do Firestore...', 'info');
                const snapshot = await withTimeout(
                    db.collection('pecas').get({ source: 'server' }),
                    12000,
                    'O Firestore não respondeu à leitura das peças em 12 segundos.'
                );

                if (!snapshot.size) {
                    writeLog('Nenhuma peça foi encontrada para atualizar.', 'warning');
                    return;
                }

                writeLog(`${snapshot.size} peça(s) encontradas. Preparando um único lote de atualização...`, 'info');
                const batch = db.batch();
                const serverTimestamp = window.firebase.firestore.FieldValue.serverTimestamp();
                snapshot.docs.forEach((productDoc) => {
                    batch.update(productDoc.ref, { desconto: percent, updatedAt: serverTimestamp });
                });

                writeLog(`Etapa 3/4: enviando ${snapshot.size} alteração(ões) ao Firestore...`, 'info');
                await withTimeout(
                    batch.commit(),
                    20000,
                    'O Firestore não confirmou a gravação em 20 segundos. Não execute novamente antes de conferir uma peça.'
                );
                writeLog('Gravação confirmada pelo Firestore.', 'success');

                writeLog('Etapa 4/4: verificando o desconto gravado...', 'info');
                const verification = await withTimeout(
                    db.collection('pecas').get({ source: 'server' }),
                    12000,
                    'A gravação foi confirmada, mas a verificação final demorou mais de 12 segundos.'
                );
                const confirmed = verification.docs.filter((productDoc) => Number(productDoc.data()?.desconto || 0) === percent).length;

                if (confirmed !== verification.size) {
                    writeLog(`Atenção: ${confirmed}/${verification.size} peça(s) aparecem com ${percent}% na verificação final.`, 'warning');
                } else {
                    writeLog(`Desconto de ${percent}% confirmado em ${confirmed} peça(s).`, 'success');
                }

                db.collection('operacoes_logs').add({
                    action: 'aplicar_desconto_global',
                    details: { percent, total: confirmed, executor: 'bulk-safe-v2' },
                    admin: user.email || user.uid,
                    createdAt: window.firebase.firestore.FieldValue.serverTimestamp()
                }).catch((error) => console.warn('[executor.audit.skipped]', error));
            } catch (error) {
                console.error('[executor.discountGlobal]', error);
                writeLog(`Erro no desconto global: ${error?.message || error}`, 'error');
            } finally {
                operationInFlight = false;
                if (button) button.disabled = false;
            }
        };

        const resetButton = () => {
            const button = document.querySelector(buttonSelector);
            if (!button) return;
            button.textContent = button.dataset.discountOriginalText || 'Aplicar';
            delete button.dataset.discountOriginalText;
        };

        const clearPending = () => {
            pendingDiscount = null;
            if (pendingTimer) window.clearTimeout(pendingTimer);
            pendingTimer = null;
            resetButton();
        };

        const wrapRunScript = () => {
            if (typeof window.runScript !== 'function') return false;
            if (window.runScript.__lamedSafeDiscountConfirmV2) return true;

            const originalRunScript = window.runScript;
            const wrappedRunScript = async (scriptName, params = null) => {
                if (scriptName !== 'aplicarDescontoGlobal') return originalRunScript(scriptName, params);

                const percent = Number(document.getElementById('bulk-discount-percent')?.value || 0);
                if (!Number.isFinite(percent) || percent < 0 || percent > 90) {
                    writeLog('Informe um desconto entre 0 e 90%.', 'error');
                    return;
                }

                const now = Date.now();
                if (!pendingDiscount || pendingDiscount.percent !== percent || now > pendingDiscount.expiresAt) {
                    clearPending();
                    pendingDiscount = { percent, expiresAt: now + 15000 };
                    const button = document.querySelector(buttonSelector);
                    if (button) {
                        button.dataset.discountOriginalText = button.textContent || 'Aplicar';
                        button.textContent = `Confirmar ${percent}%`;
                    }
                    writeLog(`Confirme tocando novamente em “Confirmar ${percent}%”. A confirmação expira em 15 segundos.`, 'warning');
                    pendingTimer = window.setTimeout(() => {
                        if (!pendingDiscount || pendingDiscount.percent !== percent) return;
                        clearPending();
                        writeLog('Confirmação do desconto global expirada. Nenhuma peça foi alterada.', 'info');
                    }, 15000);
                    return;
                }

                clearPending();
                writeLog(`Confirmação recebida. Aplicando ${percent}% nas peças...`, 'info');
                return executeGlobalDiscount(percent);
            };

            wrappedRunScript.__lamedSafeDiscountConfirmV2 = true;
            window.runScript = wrappedRunScript;
            return true;
        };

        if (wrapRunScript()) return;
        const installTimer = window.setInterval(() => {
            attempts += 1;
            if (wrapRunScript() || attempts >= 120) window.clearInterval(installTimer);
        }, 50);
    }

    installExecutorDiscountConfirmation();

    const pageName = window.location.pathname.split("/").pop() || "dashboard.html";
    const pages = [
        { id: "overview", href: "dashboard.html", label: "Visão geral", icon: "fa-chart-pie" },
        { id: "products", href: "produtos.html", label: "Produtos", icon: "fa-box-open" },
        { id: "stock", href: "estoque-mesaposta.html", label: "Estoque e produção", icon: "fa-boxes-stacked" },
        { id: "team", href: "equipe.html", label: "Equipe e acessos", icon: "fa-users-gear" },
        { id: "orders", href: "pedidos.html", label: "Pedidos", icon: "fa-cart-shopping" },
        { id: "collections", href: "colecoes.html", label: "Coleções", icon: "fa-layer-group" },
        { id: "gallery", href: "galeria.html", label: "Galeria", icon: "fa-images" },
        { id: "pricing", href: "calculadora.html", label: "Precificação", icon: "fa-ruler-combined" },
        { id: "chat", href: "chat-admin.html", label: "Atendimento", icon: "fa-comments" },
        { id: "scripts", href: "executor_scripts.html", label: "Scripts", icon: "fa-terminal" }
    ];
    const currentPage = pages.find((page) => page.href === pageName);
    if (!currentPage || currentPage.id === "overview") return;

    const start = () => {
        if (!document.body || document.body.classList.contains("admin-native-page")) return;

        const content = document.createElement("div");
        content.className = "admin-native-content";
        Array.from(document.body.childNodes).forEach((node) => content.appendChild(node));

        const navHtml = pages.map((page) => `
            <a href="${page.href}" data-admin-page-id="${page.id}" class="admin-native-link${page.id === currentPage.id ? " is-active" : ""}"${page.id === currentPage.id ? ' aria-current="page"' : ""}>
                <i class="fa-solid ${page.icon}" aria-hidden="true"></i>
                <span>${page.label}</span>
            </a>
        `).join("");

        const topbar = document.createElement("header");
        topbar.className = "admin-native-topbar";
        topbar.innerHTML = `
            <button type="button" data-admin-native-menu aria-label="Abrir menu administrativo"><i class="fa-solid fa-bars"></i></button>
            <div class="admin-native-topbar-title"><strong>Laméd</strong><span>${currentPage.label}</span></div>
            <a href="dashboard.html" class="admin-native-home" aria-label="Voltar à visão geral"><i class="fa-solid fa-house"></i></a>
        `;

        const sidebar = document.createElement("aside");
        sidebar.className = "admin-native-sidebar";
        sidebar.setAttribute("aria-label", "Navegação administrativa");
        sidebar.innerHTML = `
            <div class="admin-native-brand"><strong>Laméd</strong><span>Central Admin</span></div>
            <nav class="admin-native-nav">${navHtml}</nav>
            <div class="admin-native-sidebar-footer">
                <a href="index.html" target="_blank" rel="noopener" class="admin-native-link"><i class="fa-solid fa-arrow-up-right-from-square"></i><span>Abrir site público</span></a>
                <button type="button" class="admin-native-link admin-native-logout" data-admin-native-logout><i class="fa-solid fa-right-from-bracket"></i><span>Sair</span></button>
            </div>
        `;

        const overlay = document.createElement("button");
        overlay.type = "button";
        overlay.className = "admin-native-overlay";
        overlay.setAttribute("aria-label", "Fechar menu administrativo");

        document.body.dataset.adminPage = currentPage.id;
        document.body.classList.add("admin-native-page");
        document.body.append(topbar, sidebar, overlay, content);

        const closeMenu = () => document.body.classList.remove("admin-native-menu-open");
        topbar.querySelector("[data-admin-native-menu]")?.addEventListener("click", () => {
            document.body.classList.toggle("admin-native-menu-open");
        });
        overlay.addEventListener("click", closeMenu);
        sidebar.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
        sidebar.querySelector("[data-admin-native-logout]")?.addEventListener("click", async () => {
            const loginPage = document.body.classList.contains("production-role") ? "login-producao.html" : "login-admin.html";
            try {
                if (typeof window.adminNativeSignOut === "function") await window.adminNativeSignOut();
                else if (window.firebase?.auth) await window.firebase.auth().signOut();
            } catch (error) {}
            window.location.href = loginPage;
        });
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }
})();
