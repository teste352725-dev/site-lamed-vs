(function enableEmbeddedAdminMode() {
    const params = new URLSearchParams(window.location.search);
    const embedded = window.self !== window.top || params.get("embedded") === "1";
    if (!embedded) return;

    function installExecutorDiscountConfirmation() {
        if (!/executor_scripts\.html$/i.test(window.location.pathname)) return;

        let pendingDiscount = null;
        let pendingTimer = null;
        let attempts = 0;
        const buttonSelector = 'button[onclick="runScript(\'aplicarDescontoGlobal\')"]';

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
            if (window.runScript.__lamedSafeDiscountConfirm) return true;

            const originalRunScript = window.runScript;
            const wrappedRunScript = async (scriptName, params = null) => {
                if (scriptName !== 'aplicarDescontoGlobal') {
                    return originalRunScript(scriptName, params);
                }

                const percent = Number(document.getElementById('bulk-discount-percent')?.value || 0);
                if (!Number.isFinite(percent) || percent < 0 || percent > 90) {
                    return originalRunScript(scriptName, params);
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

                    if (typeof window.log === 'function') {
                        window.log(`Confirme tocando novamente em “Confirmar ${percent}%”. A confirmação expira em 15 segundos.`, 'warning');
                    }

                    pendingTimer = window.setTimeout(() => {
                        if (!pendingDiscount || pendingDiscount.percent !== percent) return;
                        clearPending();
                        if (typeof window.log === 'function') {
                            window.log('Confirmação do desconto global expirada. Nenhuma peça foi alterada.', 'info');
                        }
                    }, 15000);
                    return;
                }

                clearPending();
                if (typeof window.log === 'function') {
                    window.log(`Confirmação recebida. Aplicando ${percent}% nas peças...`, 'info');
                }

                const nativeConfirm = window.confirm;
                const slowTimer = window.setTimeout(() => {
                    if (typeof window.log === 'function') {
                        window.log('A gravação ainda está em andamento. Aguardando confirmação do Firestore...', 'info');
                    }
                }, 8000);

                window.confirm = () => true;
                try {
                    return await originalRunScript(scriptName, params);
                } finally {
                    window.clearTimeout(slowTimer);
                    window.confirm = nativeConfirm;
                }
            };

            wrappedRunScript.__lamedSafeDiscountConfirm = true;
            window.runScript = wrappedRunScript;
            return true;
        };

        if (wrapRunScript()) return;

        const installTimer = window.setInterval(() => {
            attempts += 1;
            if (wrapRunScript() || attempts >= 120) {
                window.clearInterval(installTimer);
            }
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

    if (document.body) {
        activate();
    } else {
        document.addEventListener("DOMContentLoaded", activate, { once: true });
    }

})();
