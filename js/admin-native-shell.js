(function initAdminNativeShell() {
    const params = new URLSearchParams(window.location.search);
    if (window.self !== window.top || params.get("embedded") === "1") return;

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
