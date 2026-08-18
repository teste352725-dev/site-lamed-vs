(function initAdminNativeShell() {
    const params = new URLSearchParams(window.location.search);
    if (window.self !== window.top || params.get("embedded") === "1") return;

    const pageName = window.location.pathname.split("/").pop() || "dashboard.html";
    const pages = [
        { id: "overview", href: "dashboard.html", label: "Visão geral", icon: "fa-chart-pie" },
        { id: "products", href: "produtos.html", label: "Produtos", icon: "fa-box-open" },
        { id: "stock", href: "estoque-mesaposta.html", label: "Estoque e produção", icon: "fa-boxes-stacked" },
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
            <a href="${page.href}" class="admin-native-link${page.id === currentPage.id ? " is-active" : ""}"${page.id === currentPage.id ? ' aria-current="page"' : ""}>
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
            try {
                if (window.firebase?.auth) await window.firebase.auth().signOut();
            } catch (error) {}
            window.location.href = "login-admin.html";
        });
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }
})();
