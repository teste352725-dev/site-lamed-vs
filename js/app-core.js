// Configura??es e Init do Firebase
const appFirebaseConfig = {
    apiKey: "AIzaSyCzB4_YotWCPVh1yaqWkhbB4LypPQYvV4U",
    authDomain: "site-lamed.firebaseapp.com",
    databaseURL: "https://site-lamed-default-rtdb.firebaseio.com",
    projectId: "site-lamed",
    storageBucket: "site-lamed.firebasestorage.app",
    messagingSenderId: "862756160215",
    appId: "1:862756160215:web:d0fded233682bf93eaa692",
    measurementId: "G-BL1G961PGT"
};

let app;
try { 
    app = firebase.app(); 
} catch (e) { 
    app = firebase.initializeApp(appFirebaseConfig); 
}

const db = firebase.firestore();
const auth = firebase.auth();
const ADMIN_UIDS = new Set(["NoGsCqiKc0VJwWb6rppk7QVLV1B2"]);
const CATALOG_SETTINGS_DOC_ID = "__catalog_settings";

// Vari?veis Globais
let products = [];
let activeCollections = []; 
let cart = [];
let currentProduct = null;
let selectedSize = null;
let selectedColor = null;
let comboSelections = {};
let currentUser = null;
let currentUserIsAdmin = false;
let storefrontForegroundPushBound = false;
const TAXA_JUROS = 0.0549;
let currentHomeFilter = 'all';
let currentHomePage = 1;
const HOME_PAGE_SIZE = 10;
const API_BASE_URL = resolveApiBaseUrl();
const adminRealtimeUnsubscribers = [];
const adminPanelState = {
    products: [],
    collections: [],
    categories: [],
    chats: []
};

// Controle Carrossel
let mainSplideInstance = null;
let thumbSplideInstance = null;

// Elementos DOM
const elements = {
    // Sidebar
    sidebarToggle: document.getElementById('sidebar-toggle'),
    sidebarMenu: document.getElementById('sidebar-menu'),
    sidebarOverlay: document.getElementById('sidebar-overlay'),
    closeSidebarBtn: document.getElementById('close-sidebar'),
    sidebarUserArea: document.getElementById('sidebar-user-area'),
    sidebarCollectionsToggle: document.getElementById('sidebar-collections-toggle'),
    sidebarSubmenu: document.getElementById('sidebar-submenu'),
    sidebarArrow: document.getElementById('sidebar-arrow'),

    // Carrinho
    cartOverlay: document.getElementById('cart-overlay'),
    cartDrawer: document.getElementById('cart-drawer'),
    cartButton: document.getElementById('cart-btn'),
    closeCartButton: document.getElementById('close-cart-btn'),
    cartItemsContainer: document.getElementById('cart-items-container'),
    cartEmptyMsg: document.getElementById('cart-empty-msg'),
    cartSubtotalEl: document.getElementById('cart-subtotal'),
    cartCountBadge: document.getElementById('cart-count'),
    mobileCartButton: document.getElementById('mobile-cart-btn'),
    addToCartBtn: document.getElementById('add-to-cart-button'),
    selectedSizeDisplay: document.getElementById('selected-size-display'),
    menuButton: document.getElementById('menu-button'),
    mobileMenu: document.getElementById('mobile-menu'),
    
    // Checkout
    finalizarPedidoBtn: document.getElementById('finalizar-pedido-btn'),
    checkoutModal: document.getElementById('checkout-modal'),
    checkoutForm: document.getElementById('checkout-form'),
    checkoutSummary: document.getElementById('checkout-summary'),
    checkoutTotal: document.getElementById('checkout-total'),
    checkoutCepInput: document.getElementById('checkout-cep'),
    checkoutSubmitButton: document.getElementById('checkout-submit-btn'),
    checkoutAccountAssist: document.getElementById('checkout-account-assist'),
    checkoutGuestCard: document.getElementById('checkout-guest-card'),
    checkoutLoggedInCard: document.getElementById('checkout-logged-in-card'),
    checkoutGoogleLoginBtn: document.getElementById('checkout-google-login-btn'),
    checkoutAccountPasswordWrap: document.getElementById('checkout-account-password-wrap'),
    checkoutAccountPasswordInput: document.getElementById('checkout-account-password'),
    checkoutAccountCopy: document.getElementById('checkout-account-copy'),
    shippingMessageBox: document.getElementById('shipping-message-box'),
    shippingCostMsg: document.getElementById('shipping-cost-msg'),
    shippingQuoteStatus: document.getElementById('shipping-quote-status'),
    shippingOptions: document.getElementById('shipping-options'),
    shippingCalculateBtn: document.getElementById('quote-shipping-btn'),

    // P?ginas
    collectionsContainer: document.getElementById('collections-container'),
    favoriteBtn: document.getElementById('btn-favorite'),
    userIconLink: document.getElementById('header-user-icon-link'),
    adminModePanel: document.getElementById('admin-mode-panel'),
    adminProductsList: document.getElementById('admin-products-list'),
    adminCollectionsList: document.getElementById('admin-collections-list'),
    adminCategoriesList: document.getElementById('admin-categories-list'),
    adminChatsList: document.getElementById('admin-chats-list'),
    adminStatProducts: document.getElementById('admin-stat-products'),
    adminStatCollections: document.getElementById('admin-stat-collections'),
    adminStatCategories: document.getElementById('admin-stat-categories'),
    adminStatChats: document.getElementById('admin-stat-chats'),
    
    // Auth Modal
    authPromptModal: document.getElementById('auth-prompt-modal'),
    closeAuthPromptBtn: document.getElementById('close-auth-prompt'),
    dismissAuthPromptBtn: document.getElementById('auth-prompt-dismiss'),
    checkoutPushModal: document.getElementById('checkout-push-modal'),
    closeCheckoutPushModalBtn: document.getElementById('close-checkout-push-modal'),
    checkoutPushEnableBtn: document.getElementById('checkout-push-enable-btn'),
    checkoutPushLaterBtn: document.getElementById('checkout-push-later-btn'),

    // Popup de prazo
    deliveryPopupOverlay: document.getElementById('delivery-popup-overlay'),
    dismissDeliveryPopupBtn: document.getElementById('dismiss-delivery-popup'),
    closeDeliveryPopupBtn: document.getElementById('close-delivery-popup')
};

const bodyScrollLocks = new Set();
let deliveryPopupTimer = null;
const mobileBottomNavLinks = Array.from(document.querySelectorAll('.mobile-bottom-link[href]'));

function syncBodyScrollState() {
    document.body.classList.toggle('no-scroll', bodyScrollLocks.size > 0);
}

function lockBodyScroll(key) {
    bodyScrollLocks.add(key);
    syncBodyScrollState();
}

function unlockBodyScroll(key) {
    bodyScrollLocks.delete(key);
    syncBodyScrollState();
}

function updateMobileBottomNavState() {
    if (mobileBottomNavLinks.length === 0) return;

    const hash = window.location.hash;
    let activeHref = '#home';

    if (hash === '#loja' || hash.startsWith('#/categoria/')) {
        activeHref = '#loja';
    } else if (hash === '#colecoes' || hash.startsWith('#/colecao/')) {
        activeHref = '#colecoes';
    } else if (hash === '#conheca-loja') {
        activeHref = '#conheca-loja';
    } else if (hash === '#sacola') {
        activeHref = '';
    }

    mobileBottomNavLinks.forEach((link) => {
        const isActive = link.getAttribute('href') === activeHref;
        link.classList.toggle('is-active', isActive);

        if (isActive) {
            link.setAttribute('aria-current', 'page');
        } else {
            link.removeAttribute('aria-current');
        }
    });
}

async function isAuthorizedAdminUser(user) {
    if (!user) return false;
    if (ADMIN_UIDS.has(user.uid)) return true;

    try {
        const tokenResult = await user.getIdTokenResult();
        return tokenResult?.claims?.admin === true;
    } catch (error) {
        return false;
    }
}

function clearAdminRealtimeListeners() {
    while (adminRealtimeUnsubscribers.length) {
        const unsubscribe = adminRealtimeUnsubscribers.pop();
        if (typeof unsubscribe === 'function') {
            unsubscribe();
        }
    }
}

function formatAdminTimestamp(value) {
    if (typeof value?.toDate === 'function') {
        return value.toDate().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    }
    if (typeof value?.seconds === 'number') {
        return new Date(value.seconds * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    }
    return 'Agora';
}

function createAdminInlineAction(label, variant = 'muted') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = variant === 'danger'
        ? 'rounded-full border border-[#D8BCA4] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#8E5D3A] hover:bg-[#FFF4E6]'
        : 'rounded-full border border-[#E4D2BC] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#6B5139] hover:bg-[#FFFCF6]';
    button.textContent = label;
    return button;
}

function createAdminMetaLine(primary, secondary = '') {
    const wrapper = document.createElement('div');
    wrapper.className = 'rounded-[20px] border border-[#EFE2D0] bg-[#FFFCF7] px-4 py-3';

    const title = document.createElement('div');
    title.className = 'text-sm font-semibold text-[#2F2015]';
    title.textContent = primary;

    const subtitle = document.createElement('div');
    subtitle.className = 'mt-1 text-xs text-[#7A6E62]';
    subtitle.textContent = secondary;

    wrapper.appendChild(title);
    wrapper.appendChild(subtitle);
    return wrapper;
}

function renderAdminModePanel() {
    if (!elements.adminModePanel) return;

    elements.adminStatProducts.textContent = String(adminPanelState.products.length);
    elements.adminStatCollections.textContent = String(adminPanelState.collections.length);
    elements.adminStatCategories.textContent = String(adminPanelState.categories.filter((item) => item.ativa !== false).length);
    elements.adminStatChats.textContent = String(adminPanelState.chats.filter((chat) => chat.unread === true).length || adminPanelState.chats.length);

    const renderList = (container, emptyMessage, builder) => {
        if (!container) return;
        container.replaceChildren();

        const nodes = builder();
        if (!nodes.length) {
            const empty = document.createElement('p');
            empty.className = 'text-sm text-[#8D8175]';
            empty.textContent = emptyMessage;
            container.appendChild(empty);
            return;
        }

        nodes.forEach((node) => container.appendChild(node));
    };

    renderList(elements.adminProductsList, 'Nenhuma peca carregada.', () => adminPanelState.products.slice(0, 4).map((product) => {
        const row = createAdminMetaLine(
            sanitizePlainText(product.nome || 'Produto', 90),
            `${sanitizePlainText(product.status === 'active' ? 'Ativo' : 'Inativo', 20)} • ${sanitizePlainText(product.categoria || 'Sem categoria', 40)}`
        );
        const action = createAdminInlineAction(product.status === 'active' ? 'Desativar' : 'Ativar', 'danger');
        action.addEventListener('click', async () => {
            action.disabled = true;
            try {
                await toggleAdminProductStatus(product.id, product.status === 'active' ? 'inactive' : 'active');
            } finally {
                action.disabled = false;
            }
        });
        row.appendChild(action);
        return row;
    }));

    renderList(elements.adminCollectionsList, 'Nenhuma colecao carregada.', () => adminPanelState.collections.slice(0, 4).map((collection) => {
        const row = createAdminMetaLine(
            sanitizePlainText(collection.nome || 'Colecao', 90),
            collection.ativa ? 'Em destaque no site' : 'Oculta na vitrine'
        );
        const action = createAdminInlineAction(collection.ativa ? 'Pausar' : 'Ativar');
        action.addEventListener('click', async () => {
            action.disabled = true;
            try {
                await toggleAdminCollectionStatus(collection.id, !collection.ativa);
            } finally {
                action.disabled = false;
            }
        });
        row.appendChild(action);
        return row;
    }));

    renderList(elements.adminCategoriesList, 'Nenhuma categoria configurada.', () => adminPanelState.categories.slice(0, 5).map((category) => {
        const row = createAdminMetaLine(
            sanitizePlainText(category.nome || 'Categoria', 90),
            category.ativa !== false ? 'Visivel nos filtros da loja' : 'Oculta para a cliente'
        );
        const action = createAdminInlineAction(category.ativa !== false ? 'Ocultar' : 'Exibir');
        action.addEventListener('click', async () => {
            action.disabled = true;
            try {
                await toggleAdminCategoryStatus(category.slug);
            } finally {
                action.disabled = false;
            }
        });
        row.appendChild(action);
        return row;
    }));

    renderList(elements.adminChatsList, 'Nenhum chat ativo agora.', () => adminPanelState.chats.slice(0, 4).map((chat) => {
        const row = createAdminMetaLine(
            sanitizePlainText(chat.userName || 'Cliente', 90),
            `${sanitizePlainText(chat.lastMessage || 'Sem mensagens ainda.', 100)} • ${formatAdminTimestamp(chat.lastUpdate)}`
        );
        const link = document.createElement('a');
        link.href = `chat-admin.html?chat=${encodeURIComponent(chat.id)}&thread=${encodeURIComponent(sanitizePlainText(chat.activeThreadId, 120) || 'geral')}&pedido=${encodeURIComponent(sanitizePlainText(chat.orderId, 120))}`;
        link.className = 'inline-flex items-center justify-center rounded-full border border-[#E4D2BC] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#6B5139] hover:bg-[#FFFCF6]';
        link.textContent = chat.unread ? 'Abrir agora' : 'Abrir chat';
        row.appendChild(link);
        return row;
    }));
}

async function toggleAdminProductStatus(productId, nextStatus) {
    if (!currentUserIsAdmin || !productId) return;
    await db.collection('pecas').doc(productId).update({
        status: nextStatus,
        updatedAt: new Date()
    });
}

async function toggleAdminCollectionStatus(collectionId, nextActive) {
    if (!currentUserIsAdmin || !collectionId) return;
    await db.collection('colecoes').doc(collectionId).update({
        ativa: nextActive,
        updatedAt: new Date()
    });
}

async function toggleAdminCategoryStatus(categorySlug) {
    if (!currentUserIsAdmin || !categorySlug) return;

    const nextCategories = adminPanelState.categories.map((category) => (
        category.slug === categorySlug
            ? { ...category, ativa: category.ativa === false }
            : category
    ));

    await db.collection('colecoes').doc(CATALOG_SETTINGS_DOC_ID).set({
        kind: 'catalog_settings',
        categorias: nextCategories.map((category, index) => ({
            slug: sanitizePlainText(category.slug, 60),
            nome: sanitizePlainText(category.nome, 80),
            ordem: Number.isFinite(Number(category.ordem)) ? Number(category.ordem) : index * 10 + 10,
            ativa: category.ativa !== false
        })),
        updatedAt: new Date()
    }, { merge: true });
}

function startAdminRealtimePanel() {
    clearAdminRealtimeListeners();
    if (!currentUserIsAdmin || !elements.adminModePanel) return;

    elements.adminModePanel.classList.remove('hidden');

    adminRealtimeUnsubscribers.push(
        db.collection('pecas').onSnapshot((snapshot) => {
            adminPanelState.products = snapshot.docs
                .map((doc) => ({ id: doc.id, ...doc.data() }))
                .sort((left, right) => String(left.nome || '').localeCompare(String(right.nome || ''), 'pt-BR'));
            renderAdminModePanel();
        })
    );

    adminRealtimeUnsubscribers.push(
        db.collection('colecoes').onSnapshot((snapshot) => {
            const collections = [];
            let categories = adminPanelState.categories;

            snapshot.forEach((doc) => {
                const data = doc.data() || {};
                if (doc.id === CATALOG_SETTINGS_DOC_ID || data.kind === 'catalog_settings') {
                    categories = Array.isArray(data.categorias) ? data.categorias : [];
                    return;
                }

                collections.push({ id: doc.id, ...data });
            });

            adminPanelState.collections = collections.sort((left, right) => Number(left.ordem || 0) - Number(right.ordem || 0));
            adminPanelState.categories = categories
                .map((category, index) => ({
                    slug: sanitizePlainText(category?.slug, 60),
                    nome: sanitizePlainText(category?.nome || category?.slug, 80),
                    ordem: Number.isFinite(Number(category?.ordem)) ? Number(category.ordem) : index * 10 + 10,
                    ativa: category?.ativa !== false
                }))
                .filter((category) => category.slug);
            renderAdminModePanel();
        })
    );

    adminRealtimeUnsubscribers.push(
        db.collection('chats_ativos').onSnapshot((snapshot) => {
            adminPanelState.chats = snapshot.docs
                .map((doc) => ({ id: doc.id, ...doc.data() }))
                .sort((left, right) => {
                    const leftTime = typeof left.lastUpdate?.seconds === 'number' ? left.lastUpdate.seconds : 0;
                    const rightTime = typeof right.lastUpdate?.seconds === 'number' ? right.lastUpdate.seconds : 0;
                    return rightTime - leftTime;
                });
            renderAdminModePanel();
        })
    );
}

function updateAdminModeExperience(isAdmin) {
    if (elements.adminModePanel) {
        elements.adminModePanel.classList.toggle('hidden', !isAdmin);
    }

    if (!isAdmin) {
        clearAdminRealtimeListeners();
    } else {
        startAdminRealtimePanel();
    }
}

function bindStorefrontForegroundNotifications() {
    if (storefrontForegroundPushBound) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (!firebase.messaging || typeof firebase.messaging !== 'function') return;

    try {
        const messaging = firebase.messaging();
        if (!messaging || typeof messaging.onMessage !== 'function') return;

        storefrontForegroundPushBound = true;
        messaging.onMessage((payload) => {
            const title = sanitizePlainText(payload?.notification?.title || payload?.data?.title || 'Lamed VS', 120);
            const body = sanitizePlainText(payload?.notification?.body || payload?.data?.body || 'Voce recebeu uma nova atualizacao.', 240);
            const link = sanitizePlainText(payload?.fcmOptions?.link || payload?.data?.link || 'minha-conta.html#pedidos', 500);
            const icon = normalizeUrl(payload?.notification?.icon || payload?.data?.icon) || 'https://i.ibb.co/mr93jDHT/JM.png';

            const browserNotification = new Notification(title, { body, icon });
            browserNotification.onclick = () => {
                window.focus();
                window.location.href = link;
                browserNotification.close();
            };
        });
    } catch (error) {
        storefrontForegroundPushBound = false;
    }
}

// --- INIT ---
function init() {
    console.log('Inicializando...');

    scheduleDeliveryPopupCheck();
    updateMobileBottomNavState();

    auth.onAuthStateChanged(async (user) => {
        currentUser = user;
        currentUserIsAdmin = await isAuthorizedAdminUser(user);
        await atualizarInterfaceUsuario(user, currentUserIsAdmin);
        updateAdminModeExperience(currentUserIsAdmin);
        bindStorefrontForegroundNotifications();
        if(currentUser && currentProduct) checkFavoriteStatus(currentProduct.id);
        checkAuthPrompt(user);
        if (typeof syncCheckoutAccountUI === 'function') syncCheckoutAccountUI();
    });

    validarELimparCarrinho();
    updateCartUI(); 
    carregarDadosLoja(); 
    setupEventListeners();
    if (typeof setupShippingQuoteInteractions === 'function') setupShippingQuoteInteractions();

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1, rootMargin: '120px 0px' });
    document.querySelectorAll('.scroll-animate').forEach((el) => observer.observe(el));
}

function scheduleDeliveryPopupCheck() {
    if (localStorage.getItem('lamed_hide_delivery_notice') === 'true') return;

    if ('requestIdleCallback' in window) {
        requestIdleCallback(() => {
            deliveryPopupTimer = window.setTimeout(checkDeliveryPopup, 700);
        }, { timeout: 1200 });
        return;
    }

    deliveryPopupTimer = window.setTimeout(checkDeliveryPopup, 1000);
}

function checkDeliveryPopup() {
    const popup = elements.deliveryPopupOverlay;
    if (!popup) return;

    const hideNotice = localStorage.getItem('lamed_hide_delivery_notice');
    if (hideNotice === 'true') return;
    popup.classList.add('active');
    lockBodyScroll('delivery-popup');
}

function closeDeliveryPopup(hideForever = false) {
    const popup = elements.deliveryPopupOverlay;
    if (!popup) return;

    if (deliveryPopupTimer) {
        clearTimeout(deliveryPopupTimer);
        deliveryPopupTimer = null;
    }

    popup.classList.remove('active');
    unlockBodyScroll('delivery-popup');

    if (hideForever) {
        localStorage.setItem('lamed_hide_delivery_notice', 'true');
    }
}

// --- SETUP EVENT LISTENERS (Restaurada) ---
function setupEventListeners() {
    window.addEventListener('hashchange', () => {
        handleRouting();
        updateMobileBottomNavState();
    });
    
    // Sidebar Toggles
    if (elements.sidebarToggle) elements.sidebarToggle.addEventListener('click', toggleSidebar);
    if (elements.closeSidebarBtn) elements.closeSidebarBtn.addEventListener('click', toggleSidebar);
    if (elements.sidebarOverlay) elements.sidebarOverlay.addEventListener('click', toggleSidebar);
    if (elements.sidebarCollectionsToggle) elements.sidebarCollectionsToggle.addEventListener('click', toggleSidebarCollections);

    // Links da Sidebar para fechar ao clicar
    document.querySelectorAll('.sidebar-link').forEach(link => {
        link.addEventListener('click', () => {
            if (typeof closeCart === 'function') closeCart();
            toggleSidebar();
        });
    });

    const backBtn = document.getElementById('back-to-gallery');
    if(backBtn) backBtn.addEventListener('click', () => { window.history.back(); });
    
    if (elements.cartButton) elements.cartButton.addEventListener('click', openCart);
    if (elements.mobileCartButton) {
        elements.mobileCartButton.addEventListener('click', () => {
            if (window.location.hash === '#sacola') {
                openCart();
                return;
            }

            window.location.hash = '#sacola';
        });
    }
    if (elements.closeCartButton) elements.closeCartButton.addEventListener('click', closeCart);
    if (elements.cartOverlay) elements.cartOverlay.addEventListener('click', closeCart);

    mobileBottomNavLinks.forEach((link) => {
        link.addEventListener('click', () => {
            if (typeof closeCart === 'function') closeCart();
            if (elements.sidebarMenu?.classList.contains('open')) toggleSidebar();
        });
    });
    
    if (elements.finalizarPedidoBtn) elements.finalizarPedidoBtn.addEventListener('click', openCheckoutModal);
    document.querySelectorAll('.close-modal').forEach(btn => btn.addEventListener('click', closeCheckoutModal));
    if (elements.checkoutForm) elements.checkoutForm.addEventListener('submit', (e) => { e.preventDefault(); finalizarPedido(new FormData(elements.checkoutForm)); });
    
    // Delega??o de eventos para op??es din?micas
    document.body.addEventListener('click', (e) => {
        if(e.target.classList.contains('size-option')) selectSize(e.target);
    });

    if (elements.addToCartBtn) elements.addToCartBtn.addEventListener('click', addToCart);
    if (elements.cartItemsContainer) elements.cartItemsContainer.addEventListener('click', handleCartItemClick);
    if (elements.favoriteBtn) elements.favoriteBtn.addEventListener('click', toggleFavorite);
    
    document.querySelectorAll('.accordion-toggle').forEach(btn => { btn.addEventListener('click', toggleAccordion); });
    
    if (elements.closeAuthPromptBtn) elements.closeAuthPromptBtn.addEventListener('click', () => {
        elements.authPromptModal.classList.add('hidden');
        elements.authPromptModal.classList.remove('flex');
    });
    if (elements.dismissAuthPromptBtn) elements.dismissAuthPromptBtn.addEventListener('click', () => {
        elements.authPromptModal.classList.add('hidden');
        elements.authPromptModal.classList.remove('flex');
    });

        if (elements.closeDeliveryPopupBtn) {
        elements.closeDeliveryPopupBtn.addEventListener('click', () => closeDeliveryPopup(false));
    }

    if (elements.dismissDeliveryPopupBtn) {
        elements.dismissDeliveryPopupBtn.addEventListener('click', () => closeDeliveryPopup(true));
    }

    if (elements.deliveryPopupOverlay) {
        elements.deliveryPopupOverlay.addEventListener('click', (event) => {
            if (event.target === elements.deliveryPopupOverlay) {
                closeDeliveryPopup(false);
            }
        });
    }

    if(elements.checkoutCepInput) {
        elements.checkoutCepInput.addEventListener('blur', updateCheckoutSummary);
    }

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;

        if (elements.deliveryPopupOverlay?.classList.contains('active')) {
            closeDeliveryPopup(false);
            return;
        }

        if (elements.cartDrawer?.classList.contains('open')) {
            closeCart();
            return;
        }

        if (elements.sidebarMenu?.classList.contains('open')) {
            toggleSidebar();
        }
    });
    
    setupPaymentOptions();
}

// --- UTILIT?RIOS ---
function formatarReal(v) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

function sanitizePlainText(value, maxLength = 160) {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function stripAccents(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function normalizeUrl(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';

    try {
        const parsed = new URL(raw, window.location.origin);
        if (!['http:', 'https:'].includes(parsed.protocol)) return '';
        return parsed.toString();
    } catch (error) {
        return '';
    }
}
function buildAvatarUrl(name) {
    const safeName = sanitizePlainText(name || 'Cliente', 80) || 'Cliente';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(safeName)}&background=A58A5C&color=fff`;
}

function getPaymentKey(value) {
    return stripAccents(sanitizePlainText(value, 40)).toLowerCase();
}

function roundCurrency(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function parseCurrencyText(value) {
    return roundCurrency(parseFloat(String(value ?? '').replace(/[^\d,.-]/g, '').replace(',', '.')) || 0);
}

function normalizePostalCode(value) {
    return String(value ?? '').replace(/\D/g, '').slice(0, 8);
}

function formatPostalCode(value) {
    const digits = normalizePostalCode(value);
    if (digits.length <= 5) return digits;
    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

function resolveApiBaseUrl() {
    const configured = document.querySelector('meta[name="lamed-api-base-url"]')?.getAttribute('content')?.trim();
    if (configured) return configured.replace(/\/+$/, '');

    try {
        const stored = window.localStorage.getItem('lamed_api_base_url')?.trim();
        if (stored) return stored.replace(/\/+$/, '');
    } catch (error) {
        // Ignora bloqueios de storage e segue para os fallbacks seguros.
    }

    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'http://localhost:3001';
    }

    return '';
}

function buildBackendUrl(pathname) {
    const safePath = String(pathname || '').startsWith('/') ? pathname : `/${pathname || ''}`;
    return API_BASE_URL ? `${API_BASE_URL}${safePath}` : safePath;
}

function sanitizeHexColor(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '#000000';
    const normalized = raw.startsWith('#') ? raw : `#${raw}`;
    return /^#[0-9a-fA-F]{3,8}$/.test(normalized) ? normalized : '#000000';
}

function normalizeShippingProfile(profile) {
    if (!profile || typeof profile !== 'object') return null;

    const peso = roundCurrency(Number(profile.peso));
    const largura = Math.max(1, parseInt(profile.largura, 10) || 0);
    const altura = Math.max(1, parseInt(profile.altura, 10) || 0);
    const comprimento = Math.max(1, parseInt(profile.comprimento, 10) || 0);

    if (!Number.isFinite(peso) || peso <= 0 || !largura || !altura || !comprimento) {
        return null;
    }

    return {
        peso: Math.round((peso + Number.EPSILON) * 1000) / 1000,
        largura,
        altura,
        comprimento
    };
}

function normalizeShippingSelection(selection) {
    if (!selection || typeof selection !== 'object') return null;

    const id = sanitizePlainText(selection.id || selection.serviceCode || selection.serviceId, 120);
    const serviceId = sanitizePlainText(selection.serviceId || selection.id, 120);
    const serviceCode = sanitizePlainText(selection.serviceCode || selection.id, 120);
    const name = sanitizePlainText(selection.name, 120);
    const company = sanitizePlainText(selection.company, 80);
    const price = roundCurrency(Number(selection.price));
    const originalPrice = roundCurrency(Number(selection.originalPrice ?? selection.price));
    const deliveryTime = Math.max(1, parseInt(selection.deliveryTime, 10) || 0);
    const fromPostalCode = normalizePostalCode(selection.fromPostalCode);
    const toPostalCode = normalizePostalCode(selection.toPostalCode);

    if (!id || !serviceId || !serviceCode || !name || !company || !Number.isFinite(price) || price < 0 || !Number.isFinite(originalPrice) || originalPrice < 0 || deliveryTime < 1) {
        return null;
    }

    return {
        id,
        serviceId,
        serviceCode,
        name,
        company,
        price,
        originalPrice,
        deliveryTime,
        fromPostalCode,
        toPostalCode
    };
}

function normalizeColorSelection(color) {
    if (!color || typeof color !== 'object') return null;
    const nome = sanitizePlainText(color.nome, 40);
    if (!nome) return null;

    return {
        nome,
        hex: sanitizeHexColor(color.hex)
    };
}

function normalizePersonalization(input) {
    if (!input || typeof input !== 'object') return null;

    const texto = sanitizePlainText(input.texto, 120);
    const observacoes = sanitizePlainText(input.observacoes, 280);

    if (!texto && !observacoes) return null;

    return {
        texto,
        observacoes
    };
}

function buildPersonalizationKey(personalizacao) {
    const safe = normalizePersonalization(personalizacao);
    if (!safe) return 'padrao';

    const raw = `${safe.texto || ''}-${safe.observacoes || ''}`;
    return stripAccents(raw)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'padrao';
}

function normalizeComboSelections(input) {
    if (!input || typeof input !== 'object') return {};

    return Object.entries(input).reduce((acc, [key, value]) => {
        const idx = parseInt(key, 10);
        if (!Number.isInteger(idx) || idx < 0 || !value || typeof value !== 'object') return acc;

        const nextValue = {};
        const safeColor = normalizeColorSelection(value.cor);
        const safeSize = sanitizePlainText(value.tamanho, 20);

        if (safeColor) nextValue.cor = safeColor;
        if (safeSize) nextValue.tamanho = safeSize;
        if (Object.keys(nextValue).length > 0) acc[idx] = nextValue;
        return acc;
    }, {});
}

function sanitizeCartItem(item) {
    if (!item || typeof item !== 'object') return null;

    const cartId = sanitizePlainText(item.cartId, 120);
    const nome = sanitizePlainText(item.nome, 120);
    const preco = roundCurrency(Number(item.preco));
    const quantity = Math.max(1, Math.min(99, parseInt(item.quantity, 10) || 0));

    if (!cartId || !nome || !Number.isFinite(preco) || preco < 0 || quantity < 1) return null;

    return {
        cartId,
        id: sanitizePlainText(item.id, 120),
        categoria: sanitizePlainText(item.categoria, 40),
        nome,
        preco,
        imagem: normalizeUrl(item.imagem),
        frete: normalizeShippingProfile(item.frete),
        tamanho: sanitizePlainText(item.tamanho, 20),
        cor: normalizeColorSelection(item.cor),
        quantity,
        isCombo: item.isCombo === true,
        componentes: Array.isArray(item.componentes)
            ? item.componentes.map((comp) => ({
                id: sanitizePlainText(comp?.id, 120),
                nome: sanitizePlainText(comp?.nome, 120),
                quantidade: Math.max(1, parseInt(comp?.quantidade, 10) || 1),
                categoria: sanitizePlainText(comp?.categoria, 40)
            }))
            : null,
        comboSelections: normalizeComboSelections(item.comboSelections),
        personalizacao: normalizePersonalization(item.personalizacao)
    };
}

function normalizeSizeLabel(value) {
    const safe = sanitizePlainText(value, 20);
    if (!safe) return '';

    const upper = stripAccents(safe).toUpperCase();
    if (upper === 'UNICO') return 'Unico';
    if (['PP', 'P', 'M', 'G', 'GG', 'COMBO'].includes(upper)) return upper;
    return safe;
}
function isUniqueSize(value) {
    return stripAccents(sanitizePlainText(value, 20)).toUpperCase() === 'UNICO';
}

function isRoupaCategory(categoria) {
    const normalized = stripAccents(sanitizePlainText(categoria, 40)).toLowerCase();
    return ['vestido', 'conjunto', 'calca', 'camisa', 'saia', 'blusa'].includes(normalized);
}

function getDiscountedProductPrice(product) {
    const price = Number(product?.preco || 0);
    const discount = Number(product?.desconto || 0);
    return roundCurrency(price * (1 - discount / 100));
}

function calculateCheckoutTotals(cartItems, pagamento, parcelas, cep, shippingSelection = null) {
    const subtotal = roundCurrency(cartItems.reduce((acc, item) => acc + (item.preco * item.quantity), 0));
    const hanukahSubtotal = roundCurrency(cartItems.reduce((acc, item) => acc + (isHanukahProduct(item) ? item.preco * item.quantity : 0), 0));
    let final = subtotal;
    let pixDiscount = 0;
    let cardFee = 0;

    const paymentKey = getPaymentKey(pagamento);

    if (paymentKey === 'pix') {
        pixDiscount = roundCurrency(subtotal * 0.05);
        final = roundCurrency(final - pixDiscount);
    } else if (paymentKey.includes('cartao') && parcelas > 2) {
        cardFee = roundCurrency(subtotal * TAXA_JUROS);
        final = roundCurrency(final + cardFee);
    }

    const safeShipping = normalizeShippingSelection(shippingSelection);
    const freeShippingEligible = isSudeste(cep) && hanukahSubtotal >= 500;
    const shippingOriginal = safeShipping ? safeShipping.originalPrice : 0;
    const shippingCost = safeShipping ? roundCurrency(freeShippingEligible ? 0 : safeShipping.price) : 0;
    const shippingDiscount = safeShipping && freeShippingEligible ? roundCurrency(shippingOriginal) : 0;
    final = roundCurrency(final + shippingCost);

    return {
        subtotal,
        hanukahSubtotal,
        pixDiscount,
        cardFee,
        shippingCost,
        shippingOriginal,
        shippingDiscount,
        final,
        freeShipping: freeShippingEligible && !!safeShipping,
        freeShippingEligible
    };
}

async function getProductMapByIds(ids) {
    const productMap = new Map(products.map((product) => [product.id, product]));
    const missingIds = [...new Set(ids.filter((id) => id && !productMap.has(id)))];

    if (missingIds.length > 0) {
        const snapshots = await Promise.all(missingIds.map((id) => db.collection('pecas').doc(id).get()));
        snapshots.forEach((snapshot) => {
            if (!snapshot.exists) return;
            const data = snapshot.data();
            productMap.set(snapshot.id, { id: snapshot.id, ...data, preco: parseFloat(data.preco || 0) });
        });
    }

    return productMap;
}

async function ensureProductLoaded(productMap, id) {
    if (productMap.has(id)) return productMap.get(id);
    if (!id) return null;

    const snapshot = await db.collection('pecas').doc(id).get();
    if (!snapshot.exists) return null;

    const data = snapshot.data();
    const product = { id: snapshot.id, ...data, preco: parseFloat(data.preco || 0) };
    productMap.set(snapshot.id, product);
    return product;
}

async function buildCanonicalCartSnapshot(sourceCart) {
    const baseIds = Array.isArray(sourceCart) ? sourceCart.map((item) => sanitizePlainText(item?.id, 120)).filter(Boolean) : [];
    const productMap = await getProductMapByIds(baseIds);
    const canonicalCart = [];

    for (const rawItem of sourceCart) {
        const sourceItem = sanitizeCartItem(rawItem);
        if (!sourceItem?.id) {
            throw new Error('Seu carrinho contém itens inválidos. Atualize a página e tente novamente.');
        }

        const product = await ensureProductLoaded(productMap, sourceItem.id);
        if (!product || product.status !== 'active') {
            throw new Error(`O produto "${sourceItem.nome}" não está mais disponível.`);
        }

        const quantity = Math.max(1, Math.min(99, parseInt(sourceItem.quantity, 10) || 0));
        const canonicalItem = {
            cartId: sourceItem.cartId,
            id: product.id,
            categoria: sanitizePlainText(product.categoria, 40),
            nome: sanitizePlainText(product.nome, 120) || sourceItem.nome,
            preco: getDiscountedProductPrice(product),
            imagem: normalizeUrl(Array.isArray(product.imagens) ? product.imagens[0] : '') || 'https://placehold.co/600x800/eee/ccc?text=Sem+imagem',
            frete: normalizeShippingProfile(product.frete),
            quantity
        };

        if (product.tipo === 'combo') {
            if (!Array.isArray(product.componentes) || product.componentes.length === 0) {
                throw new Error(`O combo "${canonicalItem.nome}" está incompleto no cadastro.`);
            }

            const canonicalSelections = {};
            canonicalItem.isCombo = true;
            canonicalItem.tamanho = 'Combo';
            canonicalItem.cor = null;
            canonicalItem.componentes = [];

            for (let idx = 0; idx < product.componentes.length; idx++) {
                const component = product.componentes[idx];
                const componentProduct = await ensureProductLoaded(productMap, component.id);
                if (!componentProduct) {
                    throw new Error(`Um item do combo "${canonicalItem.nome}" nao foi encontrado.`);
                }

                const requestedSelection = sourceItem.comboSelections?.[idx] || sourceItem.comboSelections?.[String(idx)] || {};
                const componentQuantity = Math.max(1, parseInt(component.quantidade, 10) || 1);
                const canonicalComponent = {
                    id: sanitizePlainText(component.id, 120),
                    nome: sanitizePlainText(component.nome || componentProduct.nome, 120) || 'Item do combo',
                    quantidade: componentQuantity,
                    categoria: sanitizePlainText(component.categoria || componentProduct.categoria, 40)
                };

                const availableColors = Array.isArray(componentProduct.cores) ? componentProduct.cores : [];
                let canonicalColor = { nome: 'Padrão', hex: '#000000' };

                if (availableColors.length > 0) {
                    const requestedColorName = sanitizePlainText(requestedSelection.cor?.nome, 40);
                    const matchedColor = availableColors.find((color) => sanitizePlainText(color.nome, 40) === requestedColorName);
                    if (!matchedColor) {
                        throw new Error(`Uma cor do combo "${canonicalItem.nome}" não está mais disponível.`);
                    }

                    canonicalColor = {
                        nome: sanitizePlainText(matchedColor.nome, 40),
                        hex: sanitizeHexColor(matchedColor.hex)
                    };
                }

                let canonicalSize = 'Único';
                if (isRoupaCategory(canonicalComponent.categoria)) {
                    canonicalSize = normalizeSizeLabel(requestedSelection.tamanho);
                    if (!['PP', 'P', 'M', 'G', 'GG'].includes(canonicalSize)) {
                        throw new Error(`Um tamanho do combo "${canonicalItem.nome}" precisa ser selecionado novamente.`);
                    }
                }

                canonicalSelections[idx] = { cor: canonicalColor, tamanho: canonicalSize };
                canonicalItem.componentes.push(canonicalComponent);
            }

            canonicalItem.comboSelections = canonicalSelections;
        } else {
            const availableColors = Array.isArray(product.cores) ? product.cores : [];
            canonicalItem.isCombo = false;
            canonicalItem.personalizacao = product.personalizavel ? normalizePersonalization(sourceItem.personalizacao) : null;

            if (availableColors.length > 0) {
                const requestedColorName = sanitizePlainText(sourceItem.cor?.nome, 40);
                const matchedColor = availableColors.find((color) => sanitizePlainText(color.nome, 40) === requestedColorName);
                if (!matchedColor) {
                    throw new Error(`A cor selecionada para "${canonicalItem.nome}" não está mais disponível.`);
                }

                canonicalItem.cor = {
                    nome: sanitizePlainText(matchedColor.nome, 40),
                    hex: sanitizeHexColor(matchedColor.hex)
                };
            } else {
                canonicalItem.cor = null;
            }

            const canonicalSize = checkIsMesaPosta(product.categoria)
                ? 'Único'
                : normalizeSizeLabel(sourceItem.tamanho);

            if (!canonicalSize || canonicalSize === 'Combo') {
                throw new Error(`As opcoes de "${canonicalItem.nome}" precisam ser selecionadas novamente.`);
            }

            canonicalItem.tamanho = canonicalSize;
        }

        canonicalCart.push(canonicalItem);
    }

    return canonicalCart;
}

function isSudeste(cep) {
    if (!cep) return false;
    const cepClean = cep.replace(/\D/g, '');
    if (cepClean.length !== 8) return false;
    const prefix = parseInt(cepClean.substring(0, 2)); 
    return (prefix >= 1 && prefix <= 39);
}

function isHanukahProduct(item) {
    if (!item || !item.nome) return false;
    const term = stripAccents(String(item.nome)).toLowerCase();
    return term.includes('hanukah') || term.includes('chanukia') || term.includes('chanuka') || term.includes('judaica');
}
function checkIsMesaPosta(categoria) {
    const catsMesa = ['mesa_posta', 'lugar_americano', 'guardanapo', 'caminho_mesa', 'anel_guardanapo', 'porta_guardanapo', 'trilho_velas', 'capa_de_matza'];
    return catsMesa.includes(categoria);
}

function checkAuthPrompt(user) {
    if (user) {
        if (elements.authPromptModal) elements.authPromptModal.classList.add('hidden');
        if (elements.authPromptModal) elements.authPromptModal.classList.remove('flex');
        return;
    }
    const promptShown = sessionStorage.getItem('authPromptShown');
    if (!promptShown && elements.authPromptModal) {
        setTimeout(() => {
            if (!auth.currentUser) {
                elements.authPromptModal.classList.remove('hidden');
                elements.authPromptModal.classList.add('flex');
                sessionStorage.setItem('authPromptShown', 'true');
            }
        }, 8000);
    }
}

// --- SIDEBAR NAVIGATION ---
function toggleSidebar() {
    const isOpen = elements.sidebarMenu.classList.contains('open');
    const overlay = elements.sidebarOverlay;
    
    if(isOpen) {
        // Fechar
        elements.sidebarMenu.classList.remove('open');
        elements.sidebarMenu.classList.add('-translate-x-full'); 
        elements.sidebarMenu.classList.remove('translate-x-0'); 
        unlockBodyScroll('sidebar');
        
        // Remove classe visual para fade out e espera transi??o para esconder
        if(overlay) {
            overlay.classList.remove('visivel');
            setTimeout(() => overlay.classList.add('hidden'), 300);
        }
    } else {
        // Abrir
        elements.sidebarMenu.classList.add('open');
        elements.sidebarMenu.classList.remove('-translate-x-full');
        elements.sidebarMenu.classList.add('translate-x-0');
        lockBodyScroll('sidebar');
        
        // Remove hidden para renderizar, depois adiciona visivel para fade in
        if(overlay) {
            overlay.classList.remove('hidden');
            requestAnimationFrame(() => overlay.classList.add('visivel'));
        }
    }
}

function toggleSidebarCollections() {
    elements.sidebarSubmenu.classList.toggle('hidden');
    elements.sidebarArrow.classList.toggle('rotate-180');
}

// --- ATUALIZAÃ‡ÃƒO DO USU?RIO ---
async function atualizarInterfaceUsuario(user, isAdmin = false) {
    const sidebarUserArea = elements.sidebarUserArea;
    if (!sidebarUserArea) return;

    sidebarUserArea.replaceChildren();

    if (user) {
        let photoURL = user.photoURL;
        let displayName = sanitizePlainText(user.displayName || 'Cliente', 80) || 'Cliente';

        if (!photoURL) {
            try {
                const doc = await db.collection('usuarios').doc(user.uid).get();
                if (doc.exists) {
                    const data = doc.data();
                    if (data.fotoUrl) photoURL = normalizeUrl(data.fotoUrl);
                    if (data.nome) displayName = sanitizePlainText(data.nome, 80) || displayName;
                }
            } catch (error) {}
        }

        if (!photoURL) photoURL = buildAvatarUrl(displayName);

        const firstName = sanitizePlainText(displayName.split(' ')[0], 40) || 'Cliente';

        const avatar = document.createElement('img');
        avatar.src = photoURL;
        avatar.alt = firstName;
        avatar.className = 'w-10 h-10 rounded-full border border-[#45301F] object-cover';

        const textWrap = document.createElement('div');
        textWrap.className = 'flex flex-col';

        const hello = document.createElement('span');
        hello.className = 'text-xs text-gray-400 uppercase tracking-widest';
        hello.textContent = 'Ola,';

        const name = document.createElement('span');
        name.className = 'font-serif text-lg text-[#45301F] leading-none';
        name.textContent = firstName;

        textWrap.appendChild(hello);
        textWrap.appendChild(name);
        if (isAdmin) {
            const adminLink = document.createElement('a');
            adminLink.href = 'dashboard.html';
            adminLink.className = 'mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#A58A5C] hover:underline';
            adminLink.textContent = 'Modo admin';
            textWrap.appendChild(adminLink);
        }
        sidebarUserArea.appendChild(avatar);
        sidebarUserArea.appendChild(textWrap);
        return;
    }

    const avatarPlaceholder = document.createElement('div');
    avatarPlaceholder.className = 'w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-400';

    const icon = document.createElement('i');
    icon.className = 'fa-regular fa-user';
    avatarPlaceholder.appendChild(icon);

    const textWrap = document.createElement('div');
    textWrap.className = 'flex flex-col';

    const welcome = document.createElement('span');
    welcome.className = 'text-xs text-gray-400 uppercase tracking-widest';
    welcome.textContent = 'Bem-vindo';

    const link = document.createElement('a');
    link.href = 'minha-conta.html';
    link.className = 'font-bold text-[#A58A5C] text-sm hover:underline';
    link.textContent = 'Entrar / Cadastrar';

    textWrap.appendChild(welcome);
    textWrap.appendChild(link);
    sidebarUserArea.appendChild(avatarPlaceholder);
    sidebarUserArea.appendChild(textWrap);
}
