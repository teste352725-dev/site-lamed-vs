(function enableEmbeddedAdminMode() {
    const params = new URLSearchParams(window.location.search);
    const embedded = window.self !== window.top || params.get("embedded") === "1";
    if (!embedded) return;

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
                if (scriptName !== 'aplicarDescontoGlobal') {
                    return originalRunScript(scriptName, params);
                }

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

    const style = document.createElement("style");
    style.textContent = `
        html, body {
            height: auto !important;
            min-height: 100% !important;
            overflow-x: hidden !important;
            overflow-y: auto !important;
            overscroll-behavior: contain;
        }

        body.admin-embedded {
            padding-bottom: 0 !important;
            min-height: 100% !important;
            background-color: #f8fafc !important;
        }

        body.admin-embedded > header:first-of-type {
            display: none !important;
        }

        body.admin-embedded main,
        body.admin-embedded .max-w-4xl,
        body.admin-embedded .max-w-7xl {
            max-width: none !important;
            width: 100% !important;
        }

        body.admin-embedded main {
            padding-top: 1rem !important;
            padding-bottom: 1.25rem !important;
        }

        body.admin-embedded .page-shell {
            max-width: none !important;
            padding: 0 0 1.25rem !important;
        }

        body.admin-embedded .hero-panel {
            position: static !important;
            top: auto !important;
            margin-bottom: 1rem !important;
        }

        body.admin-embedded .hero-panel .hero-subtitle,
        body.admin-embedded .hero-panel .summary-strip,
        body.admin-embedded .control-panel > .section-kicker,
        body.admin-embedded .control-panel > .section-title,
        body.admin-embedded .control-panel > .section-subtitle,
        body.admin-embedded .control-panel > .modal-panel {
            display: none !important;
        }

        body.admin-embedded .hero-panel,
        body.admin-embedded .control-panel {
            padding: 1rem !important;
        }

        body.admin-embedded .filters-grid {
            margin-top: 0 !important;
        }

        body.admin-embedded .ghost-button {
            display: none !important;
        }

        body.admin-embedded .modal {
            padding: 0 !important;
        }

        body.admin-embedded .modal-shell,
        body.admin-embedded .gallery-shell {
            width: 100% !important;
            max-height: 100dvh !important;
            min-height: 100dvh !important;
            border-radius: 0 !important;
        }
    `;
    document.head.appendChild(style);

    const activate = () => {
        if (!document.body) return;
        document.body.classList.add("admin-embedded");
    };

    if (document.body) activate();
    else document.addEventListener("DOMContentLoaded", activate, { once: true });
})();

(function loadProductCollectionsExtensionEmbedded() {
    if (!/produtos\.html$/i.test(window.location.pathname)) return;
    if (document.querySelector('script[data-products-collections-extension]')) return;
    const script = document.createElement('script');
    script.src = 'js/products-collections-extension.js?v=20260908-1';
    script.dataset.productsCollectionsExtension = '1';
    document.head.appendChild(script);
})();
