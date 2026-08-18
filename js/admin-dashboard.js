const adminFirebaseConfig = {
    apiKey: "AIzaSyCzB4_YotWCPVh1yaqWkhbB4LypPQYvV4U",
    authDomain: "site-lamed.firebaseapp.com",
    projectId: "site-lamed",
    storageBucket: "site-lamed.firebasestorage.app",
    messagingSenderId: "862756160215",
    appId: "1:862756160215:web:d0fded233682bf93eaa692"
};

let adminApp;
try {
    adminApp = firebase.app();
} catch (error) {
    adminApp = firebase.initializeApp(adminFirebaseConfig);
}

const adminDb = firebase.firestore();
const adminAuth = firebase.auth();
const ADMIN_UIDS = ["NoGsCqiKc0VJwWb6rppk7QVLV1B2"];
const WORKSPACE_VIEWS = {
    products: "produtos.html?embedded=1",
    orders: "pedidos.html?embedded=1",
    collections: "colecoes.html?embedded=1",
    gallery: "galeria.html?embedded=1",
    pricing: "calculadora.html?embedded=1",
    chat: "chat-admin.html?embedded=1",
    scripts: "executor_scripts.html?embedded=1"
};

let currentAdminView = "overview";
const workspaceFrameObservers = new WeakMap();
const workspaceScrollBridgeDocuments = new WeakSet();

function getNestedScrollTarget(target, deltaY, frameDocument) {
    let element = target?.nodeType === 1 ? target : target?.parentElement;

    while (element && element !== frameDocument.body && element !== frameDocument.documentElement) {
        const style = frameDocument.defaultView.getComputedStyle(element);
        const isScrollable = /(auto|scroll)/.test(style.overflowY)
            && element.scrollHeight > element.clientHeight + 2;

        if (isScrollable) {
            const canScrollDown = deltaY > 0 && element.scrollTop + element.clientHeight < element.scrollHeight - 1;
            const canScrollUp = deltaY < 0 && element.scrollTop > 1;
            if (canScrollDown || canScrollUp) return element;
        }

        element = element.parentElement;
    }

    return null;
}

function bridgeWorkspaceScroll(frame, frameDocument) {
    if (workspaceScrollBridgeDocuments.has(frameDocument)) return;
    workspaceScrollBridgeDocuments.add(frameDocument);

    let lastTouchY = null;

    frameDocument.addEventListener("touchstart", (event) => {
        lastTouchY = event.touches.length === 1 ? event.touches[0].clientY : null;
    }, { passive: true });

    frameDocument.addEventListener("touchend", () => {
        lastTouchY = null;
    }, { passive: true });

    frameDocument.addEventListener("touchcancel", () => {
        lastTouchY = null;
    }, { passive: true });

    frameDocument.addEventListener("touchmove", (event) => {
        if (window.innerWidth >= 768 || lastTouchY === null || event.touches.length !== 1) return;

        const currentY = event.touches[0].clientY;
        const deltaY = lastTouchY - currentY;
        lastTouchY = currentY;

        if (Math.abs(deltaY) < 1) return;

        event.preventDefault();
        const nestedScrollTarget = getNestedScrollTarget(event.target, deltaY, frameDocument);
        if (nestedScrollTarget) {
            nestedScrollTarget.scrollTop += deltaY;
            return;
        }
        window.scrollBy(0, deltaY);
    }, { passive: false });

    frameDocument.addEventListener("wheel", (event) => {
        if (window.innerWidth >= 768) return;
        event.preventDefault();
        const nestedScrollTarget = getNestedScrollTarget(event.target, event.deltaY, frameDocument);
        if (nestedScrollTarget) {
            nestedScrollTarget.scrollTop += event.deltaY;
            return;
        }
        window.scrollBy(0, event.deltaY);
    }, { passive: false });
}

function fitWorkspaceFrame(frame) {
    if (!frame) return;

    const previousObserver = workspaceFrameObservers.get(frame);
    if (previousObserver) previousObserver.disconnect();
    workspaceFrameObservers.delete(frame);

    if (window.innerWidth >= 768) {
        frame.style.removeProperty("height");
        return;
    }

    try {
        const frameDocument = frame.contentDocument;
        if (!frameDocument?.documentElement || !frameDocument.body) return;

        frameDocument.documentElement.style.setProperty("min-height", "0", "important");
        frameDocument.body.style.setProperty("min-height", "0", "important");
        frameDocument.documentElement.style.setProperty("overflow-y", "visible", "important");
        frameDocument.body.style.setProperty("overflow-y", "visible", "important");
        frameDocument.documentElement.style.setProperty("touch-action", "pan-x", "important");
        frameDocument.body.style.setProperty("touch-action", "pan-x", "important");
        bridgeWorkspaceScroll(frame, frameDocument);

        let resizeFrameId = 0;
        const updateHeight = () => {
            cancelAnimationFrame(resizeFrameId);
            resizeFrameId = requestAnimationFrame(() => {
                const contentHeight = Math.max(
                    frameDocument.body.scrollHeight,
                    frameDocument.documentElement.scrollHeight
                );
                frame.style.height = `${Math.max(560, contentHeight + 2)}px`;
            });
        };

        updateHeight();
        const observer = new ResizeObserver(updateHeight);
        observer.observe(frameDocument.documentElement);
        observer.observe(frameDocument.body);
        workspaceFrameObservers.set(frame, observer);
        frameDocument.fonts?.ready?.then(updateHeight).catch(() => {});
        Array.from(frameDocument.images || []).forEach((image) => {
            if (!image.complete) image.addEventListener("load", updateHeight, { once: true });
        });
    } catch (error) {
        frame.style.height = "calc(100dvh - 180px)";
    }
}

function bindWorkspaceFrame(frame) {
    if (!frame || frame.dataset.autoHeightBound === "true") return;
    frame.dataset.autoHeightBound = "true";
    frame.setAttribute("scrolling", "no");
    frame.addEventListener("load", () => fitWorkspaceFrame(frame));
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatCurrency(value) {
    return Number(value || 0).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
        minimumFractionDigits: 2
    });
}

function normalizeOrderStatus(status) {
    const aliases = {
        pago: "processando",
        concluido: "entregue"
    };

    const normalized = String(status ?? "").trim().toLowerCase();
    const canonical = aliases[normalized] || normalized;
    return ["pendente", "processando", "enviado", "entregue", "cancelado"].includes(canonical)
        ? canonical
        : "pendente";
}

function getViewFromHash() {
    const requested = (window.location.hash || "").replace("#", "").trim();
    if (!requested) return "overview";
    return requested in WORKSPACE_VIEWS || requested === "overview" ? requested : "overview";
}

async function isAuthorizedAdmin(user) {
    if (!user) return false;
    if (ADMIN_UIDS.includes(user.uid)) return true;

    try {
        const tokenResult = await user.getIdTokenResult();
        return tokenResult?.claims?.admin === true;
    } catch (error) {
        return false;
    }
}

function setSidebarState(show) {
    const sidebar = document.getElementById("admin-sidebar");
    const overlay = document.getElementById("mobile-overlay");
    if (!sidebar || !overlay) return;

    if (show) {
        sidebar.classList.remove("-translate-x-full");
        overlay.classList.remove("hidden");
        document.body.classList.add("overflow-hidden");
        return;
    }

    sidebar.classList.add("-translate-x-full");
    overlay.classList.add("hidden");
    document.body.classList.remove("overflow-hidden");
}

window.toggleAdminSidebar = function toggleAdminSidebar(show) {
    setSidebarState(show);
};

function ensureWorkspaceLoaded(view) {
    if (!(view in WORKSPACE_VIEWS)) return;

    const frame = document.getElementById(`frame-${view}`);
    if (!frame || frame.dataset.loaded === "true") return;

    bindWorkspaceFrame(frame);
    frame.style.removeProperty("height");
    frame.src = frame.dataset.src;
    frame.dataset.loaded = "true";
}

window.reloadWorkspace = function reloadWorkspace(view) {
    if (!(view in WORKSPACE_VIEWS)) return;
    const frame = document.getElementById(`frame-${view}`);
    if (!frame) return;

    const baseSrc = frame.dataset.src || WORKSPACE_VIEWS[view];
    frame.style.removeProperty("height");
    frame.src = `${baseSrc}${baseSrc.includes("?") ? "&" : "?"}ts=${Date.now()}`;
    frame.dataset.loaded = "true";
};

window.openWorkspaceInNewTab = function openWorkspaceInNewTab(view) {
    if (!(view in WORKSPACE_VIEWS)) return;
    const cleanUrl = WORKSPACE_VIEWS[view].replace("?embedded=1", "");
    window.open(cleanUrl, "_blank");
};

function renderRecentOrders(orders) {
    const container = document.getElementById("recent-orders-list");
    if (!container) return;

    if (!orders.length) {
        container.innerHTML = `
            <div class="rounded-2xl border border-dashed border-[#e6dccd] px-4 py-8 text-center text-sm text-slate-500">
                Nenhum pedido encontrado ainda.
            </div>
        `;
        return;
    }

    container.innerHTML = orders.map((order) => {
        const status = normalizeOrderStatus(order.status);
        const createdAt = order.data?.seconds
            ? new Date(order.data.seconds * 1000).toLocaleString("pt-BR")
            : "-";

        return `
            <button onclick="changeView('orders')" class="flex w-full items-start justify-between gap-4 rounded-[22px] border border-[#ece2d4] bg-white px-4 py-4 text-left transition hover:border-[--admin-gold] hover:shadow-lg">
                <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                        <strong class="text-sm text-slate-900">#${escapeHtml((order.id || "").slice(0, 6).toUpperCase())}</strong>
                        <span class="status-pill status-${status}">${escapeHtml(status)}</span>
                    </div>
                    <p class="mt-2 text-sm font-medium text-slate-700">${escapeHtml(order.cliente?.nome || "Cliente sem nome")}</p>
                    <p class="mt-1 text-xs text-slate-500">${createdAt}</p>
                </div>
                <div class="shrink-0 text-right">
                    <p class="text-sm font-semibold text-slate-900">${formatCurrency(order.total || 0)}</p>
                    <p class="mt-1 text-xs text-slate-500">${(order.produtos || []).length} item(ns)</p>
                </div>
            </button>
        `;
    }).join("");
}

async function refreshOverview() {
    const productsEl = document.getElementById("stat-products");
    const customProductsEl = document.getElementById("stat-custom-products");
    const pendingEl = document.getElementById("stat-pending");
    const ordersEl = document.getElementById("stat-orders");
    const salesEl = document.getElementById("stat-sales");
    const collectionsEl = document.getElementById("stat-collections");
    const galleryEl = document.getElementById("stat-gallery");
    const chatsEl = document.getElementById("stat-chats");
    const unreadChatsEl = document.getElementById("stat-unread-chats");
    const recentOrdersEl = document.getElementById("recent-orders-list");

    if (recentOrdersEl) {
        recentOrdersEl.innerHTML = `
            <div class="rounded-2xl border border-dashed border-[#e6dccd] px-4 py-8 text-center text-sm text-slate-500">
                Atualizando painel...
            </div>
        `;
    }

    try {
        const [productsSnap, ordersSnap, collectionsSnap, gallerySnap, chatsSnap] = await Promise.all([
            adminDb.collection("pecas").get(),
            adminDb.collection("pedidos").orderBy("data", "desc").get(),
            adminDb.collection("colecoes").get(),
            adminDb.collection("galeria").get(),
            adminDb.collection("chats_ativos").get()
        ]);

        const products = productsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        const orders = ordersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        const collections = collectionsSnap.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }))
            .filter((collection) => collection.id !== "__catalog_settings" && collection.kind !== "catalog_settings");
        const chats = chatsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

        const pendingOrders = orders.filter((order) => normalizeOrderStatus(order.status) === "pendente");
        const totalSales = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
        const activeCollections = collections.filter((collection) => collection.ativa === true);
        const customProducts = products.filter((product) => product.personalizavel === true);
        const unreadChats = chats.filter((chat) => chat.unread === true);

        if (productsEl) productsEl.textContent = String(products.length);
        if (customProductsEl) customProductsEl.textContent = `${customProducts.length} personalizaveis`;
        if (pendingEl) pendingEl.textContent = String(pendingOrders.length);
        if (ordersEl) ordersEl.textContent = `${orders.length} pedidos totais`;
        if (salesEl) salesEl.textContent = formatCurrency(totalSales);
        if (collectionsEl) collectionsEl.textContent = String(activeCollections.length);
        if (galleryEl) galleryEl.textContent = String(gallerySnap.size);
        if (chatsEl) chatsEl.textContent = String(chats.length);
        if (unreadChatsEl) unreadChatsEl.textContent = `${unreadChats.length} com alerta`;

        renderRecentOrders(orders.slice(0, 5));
    } catch (error) {
        console.error("Erro ao atualizar overview:", error);
        if (recentOrdersEl) {
            recentOrdersEl.innerHTML = `
                <div class="rounded-2xl border border-red-100 bg-red-50 px-4 py-8 text-center text-sm text-red-600">
                    Nao foi possivel carregar o painel agora. ${escapeHtml(error.message || "Erro inesperado")}
                </div>
            `;
        }
    }
}

window.refreshOverview = refreshOverview;

window.changeView = function changeView(view) {
    const nextView = view in WORKSPACE_VIEWS || view === "overview" ? view : "overview";
    currentAdminView = nextView;

    if (nextView !== "overview") {
        window.location.href = WORKSPACE_VIEWS[nextView].replace("?embedded=1", "");
        return;
    }

    document.querySelectorAll(".admin-view").forEach((section) => {
        section.classList.toggle("hidden", section.id !== `view-${nextView}`);
    });

    document.querySelectorAll(".sidebar-link").forEach((button) => button.classList.remove("active"));
    document.getElementById(`nav-${nextView}`)?.classList.add("active");

    if (nextView === "overview") {
        refreshOverview();
    } else {
        ensureWorkspaceLoaded(nextView);
    }

    window.location.hash = nextView;
    if (window.innerWidth < 768) setSidebarState(false);
};

window.logout = function logout() {
    adminAuth.signOut().then(() => {
        window.location.href = "login-admin.html";
    }).catch(() => {
        window.location.href = "login-admin.html";
    });
};

adminAuth.onAuthStateChanged(async (user) => {
    if (!(await isAuthorizedAdmin(user))) {
        adminAuth.signOut().catch(() => {});
        window.location.href = "login-admin.html";
        return;
    }

    const initialView = getViewFromHash();
    if (initialView === "overview") {
        await refreshOverview();
    }
    changeView(initialView);
});

window.addEventListener("hashchange", () => {
    const nextView = getViewFromHash();
    if (nextView !== currentAdminView) {
        changeView(nextView);
    }
});

window.addEventListener("resize", () => {
    document.querySelectorAll(".workspace-frame[data-loaded='true']").forEach(fitWorkspaceFrame);
});
