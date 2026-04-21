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
const STOREFRONT_COPY_COLLECTION = "site_config";
const STOREFRONT_COPY_DOC_ID = "homepage";

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
let entryAssistTimer = null;
let storefrontCopyState = null;
let storefrontAdminToolsBound = false;

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
    floatingWhatsapp: document.querySelector('.floating-whatsapp'),
    adminFabShell: document.getElementById('admin-fab-shell'),
    adminFabToggle: document.getElementById('admin-fab-toggle'),
    adminFabPanel: document.getElementById('admin-fab-panel'),
    adminQuickbar: document.getElementById('admin-quickbar'),
    adminQuickbarOperations: document.getElementById('admin-quickbar-operations'),
    adminQuickbarProducts: document.getElementById('admin-quickbar-products'),
    adminQuickbarCollections: document.getElementById('admin-quickbar-collections'),
    adminQuickbarCategories: document.getElementById('admin-quickbar-categories'),
    adminOpenCopyEditor: document.getElementById('admin-open-copy-editor'),
    adminOpenOperationsEditor: document.getElementById('admin-open-operations-editor'),
    adminOpenProductsEditor: document.getElementById('admin-open-products-editor'),
    adminOpenCollectionsEditor: document.getElementById('admin-open-collections-editor'),
    adminOpenCategoriesEditor: document.getElementById('admin-open-categories-editor'),
    sidebarAdminOperationItem: document.getElementById('sidebar-admin-operation-item'),
    sidebarAdminOperationLink: document.getElementById('sidebar-admin-operation-link'),
    entryAssistTitle: document.getElementById('entry-assist-title'),
    entryAssistCopy: document.getElementById('entry-assist-copy'),
    entryAssistIcon: document.getElementById('entry-assist-icon'),
    entryAssistLink: document.getElementById('entry-assist-link'),
    entryAssistActionBtn: document.getElementById('entry-assist-action-btn'),
    storefrontCopyModal: document.getElementById('storefront-copy-modal'),
    storefrontCopyForm: document.getElementById('storefront-copy-form'),
    closeStorefrontCopyModalBtn: document.getElementById('close-storefront-copy-modal'),
    cancelStorefrontCopyBtn: document.getElementById('cancel-storefront-copy'),
    saveStorefrontCopyBtn: document.getElementById('save-storefront-copy'),

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
    closeDeliveryPopupBtn: document.getElementById('close-delivery-popup'),

    // Offline
    offlineBanner: document.getElementById('offline-banner'),
    offlineBannerRetry: document.getElementById('offline-banner-retry')
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

function updateOfflineBannerState() {
    if (!elements.offlineBanner) return;
    const isOnline = navigator.onLine !== false;
    elements.offlineBanner.classList.toggle('hidden', isOnline);
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

async function ensureEntryAssistUserProfileDoc(user) {
    if (!user) return;

    const profileRef = db.collection('usuarios').doc(user.uid);
    const snapshot = await profileRef.get();
    const existingData = snapshot.data() || {};
    const normalizedProfile = normalizeUserProfileRecordForFirestore(existingData, user, {
        createdAt: snapshot.exists ? getPersistedProfileCreatedAt(existingData.createdAt) : firebase.firestore.FieldValue.serverTimestamp()
    });

    await profileRef.set(normalizedProfile);
}

function getDefaultStorefrontCopy() {
    return {
        heroTitle: 'Mesa Posta Lamed',
        heroSubtitle: 'Pecas artesanais para transformar sua mesa',
        heroCta: 'Conheca a Loja',
        shopTitle: 'Conheca nossa Loja',
        shopSubtitle: 'Explore as pecas, filtre por categoria e encontre o que faz sentido para o seu momento.',
        philosophyTitle: 'Nossa Filosofia',
        philosophyBody: 'A Lamed VS nasce da harmonia entre elegancia, proposito e cuidado com voce. Cada peca e confeccionada em fibras naturais, escolhidas por sua capacidade de transmitir bem-estar e elevar sua frequencia. Mais que roupas, criamos experiencias atemporais, conscientes e unicas - feitas para vestir seu corpo e inspirar sua mente.',
        messageTitle: 'Uma Mensagem Para Voce',
        messageBody1: 'Ao escolher uma de nossas criacoes, voce se conecta com a sua essencia. Nossos produtos sao um convite ao bem-estar, desenvolvidos com o cuidado das fibras naturais e um design que honra quem voce e.',
        messageBody2: 'Os materiais que escolhemos dialogam com a energia do seu corpo e do seu ambiente, cultivando uma sensacao de vitalidade e paz interior. Lamed vs e um lembrete do poder que reside em suas escolhas diarias, especialmente naquelas feitas com consciencia e amor.'
    };
}

function normalizeStorefrontCopy(rawValue) {
    const defaults = getDefaultStorefrontCopy();
    const raw = rawValue && typeof rawValue === 'object' ? rawValue : {};

    return {
        heroTitle: sanitizePlainText(raw.heroTitle || defaults.heroTitle, 120) || defaults.heroTitle,
        heroSubtitle: sanitizePlainText(raw.heroSubtitle || defaults.heroSubtitle, 220) || defaults.heroSubtitle,
        heroCta: sanitizePlainText(raw.heroCta || defaults.heroCta, 60) || defaults.heroCta,
        shopTitle: sanitizePlainText(raw.shopTitle || defaults.shopTitle, 120) || defaults.shopTitle,
        shopSubtitle: sanitizePlainText(raw.shopSubtitle || defaults.shopSubtitle, 260) || defaults.shopSubtitle,
        philosophyTitle: sanitizePlainText(raw.philosophyTitle || defaults.philosophyTitle, 120) || defaults.philosophyTitle,
        philosophyBody: sanitizePlainText(raw.philosophyBody || defaults.philosophyBody, 1400) || defaults.philosophyBody,
        messageTitle: sanitizePlainText(raw.messageTitle || defaults.messageTitle, 120) || defaults.messageTitle,
        messageBody1: sanitizePlainText(raw.messageBody1 || defaults.messageBody1, 1400) || defaults.messageBody1,
        messageBody2: sanitizePlainText(raw.messageBody2 || defaults.messageBody2, 1400) || defaults.messageBody2
    };
}

function setTextContentById(id, value) {
    const target = document.getElementById(id);
    if (target) {
        target.textContent = sanitizePlainText(value, 1400);
    }
}

function applyStorefrontCopy(copyValue) {
    storefrontCopyState = normalizeStorefrontCopy(copyValue || storefrontCopyState || getDefaultStorefrontCopy());

    setTextContentById('home-hero-title', storefrontCopyState.heroTitle);
    setTextContentById('home-hero-subtitle', storefrontCopyState.heroSubtitle);
    setTextContentById('home-shop-title', storefrontCopyState.shopTitle);
    setTextContentById('home-shop-subtitle', storefrontCopyState.shopSubtitle);
    setTextContentById('home-philosophy-title', storefrontCopyState.philosophyTitle);
    setTextContentById('home-philosophy-copy', storefrontCopyState.philosophyBody);
    setTextContentById('home-message-title', storefrontCopyState.messageTitle);
    setTextContentById('home-message-copy-1', storefrontCopyState.messageBody1);
    setTextContentById('home-message-copy-2', storefrontCopyState.messageBody2);

    const cta = document.getElementById('home-hero-cta');
    if (cta) {
        cta.textContent = storefrontCopyState.heroCta;
    }
}

function setEntryAssistActionStyle(variant = 'primary') {
    if (!elements.entryAssistActionBtn) return;

    elements.entryAssistActionBtn.className = variant === 'secondary'
        ? 'w-full border border-[#D8C9B6] bg-white py-3 rounded text-xs font-bold uppercase tracking-widest text-[#643f21] hover:bg-[#F8F6F0] transition shadow-sm'
        : 'w-full bg-[#643f21] text-white py-3 rounded text-xs font-bold uppercase tracking-widest hover:bg-[#4a2e18] transition shadow-md';
}

function createAdminInlineChip({ label, href = '', icon = 'fa-pen', onClick = null }) {
    const element = href ? document.createElement('a') : document.createElement('button');
    if (href) {
        element.href = href;
    } else {
        element.type = 'button';
    }

    element.className = 'admin-inline-chip';
    element.innerHTML = `<i class="fa-solid ${icon}"></i><span>${label}</span>`;

    if (typeof onClick === 'function') {
        element.addEventListener('click', onClick);
    }

    return element;
}

function toggleAdminFabPanel(forceOpen = null) {
    if (!elements.adminFabPanel) return;

    const shouldOpen = typeof forceOpen === 'boolean'
        ? forceOpen
        : elements.adminFabPanel.classList.contains('hidden');

    elements.adminFabPanel.classList.toggle('hidden', !shouldOpen);
    if (elements.adminFabToggle) {
        elements.adminFabToggle.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    }
}

function fillStorefrontCopyForm() {
    const copy = storefrontCopyState || getDefaultStorefrontCopy();
    const fieldMap = {
        'storefront-copy-hero-title': copy.heroTitle,
        'storefront-copy-hero-subtitle': copy.heroSubtitle,
        'storefront-copy-hero-cta': copy.heroCta,
        'storefront-copy-shop-title': copy.shopTitle,
        'storefront-copy-shop-subtitle': copy.shopSubtitle,
        'storefront-copy-philosophy-title': copy.philosophyTitle,
        'storefront-copy-philosophy-body': copy.philosophyBody,
        'storefront-copy-message-title': copy.messageTitle,
        'storefront-copy-message-body-1': copy.messageBody1,
        'storefront-copy-message-body-2': copy.messageBody2
    };

    Object.entries(fieldMap).forEach(([id, value]) => {
        const field = document.getElementById(id);
        if (field) field.value = value;
    });
}

function readStorefrontCopyForm() {
    return normalizeStorefrontCopy({
        heroTitle: document.getElementById('storefront-copy-hero-title')?.value,
        heroSubtitle: document.getElementById('storefront-copy-hero-subtitle')?.value,
        heroCta: document.getElementById('storefront-copy-hero-cta')?.value,
        shopTitle: document.getElementById('storefront-copy-shop-title')?.value,
        shopSubtitle: document.getElementById('storefront-copy-shop-subtitle')?.value,
        philosophyTitle: document.getElementById('storefront-copy-philosophy-title')?.value,
        philosophyBody: document.getElementById('storefront-copy-philosophy-body')?.value,
        messageTitle: document.getElementById('storefront-copy-message-title')?.value,
        messageBody1: document.getElementById('storefront-copy-message-body-1')?.value,
        messageBody2: document.getElementById('storefront-copy-message-body-2')?.value
    });
}

function openStorefrontCopyModal() {
    if (!currentUserIsAdmin || !elements.storefrontCopyModal) return;

    fillStorefrontCopyForm();
    elements.storefrontCopyModal.classList.remove('hidden');
    elements.storefrontCopyModal.classList.add('flex');
    lockBodyScroll('storefront-copy');
    toggleAdminFabPanel(false);
}

function closeStorefrontCopyModal() {
    if (!elements.storefrontCopyModal) return;

    elements.storefrontCopyModal.classList.add('hidden');
    elements.storefrontCopyModal.classList.remove('flex');
    unlockBodyScroll('storefront-copy');
}

function openInlineProductEditing() {
    if (typeof window.openStorefrontProductManager === 'function') {
        window.openStorefrontProductManager();
        return;
    }

    window.location.hash = '#loja';
}

function openInlineCollectionsEditing() {
    if (typeof window.openStorefrontCollectionsEditor === 'function') {
        window.openStorefrontCollectionsEditor();
        return;
    }
}

function openInlineCategoriesEditing() {
    if (typeof window.openStorefrontCategoriesEditor === 'function') {
        window.openStorefrontCategoriesEditor();
        return;
    }
}

function openInlineOperationsEditing() {
    if (typeof window.openStoreOperationsEditor === 'function') {
        window.openStoreOperationsEditor();
    }
}

async function signInWithGoogleFromEntryAssist() {
    try {
        if (!firebase.auth || typeof firebase.auth.GoogleAuthProvider !== 'function') {
            throw new Error('O login com Google nao esta disponivel agora.');
        }

        if (elements.entryAssistActionBtn) {
            elements.entryAssistActionBtn.disabled = true;
            elements.entryAssistActionBtn.textContent = 'Conectando...';
        }

        const provider = new firebase.auth.GoogleAuthProvider();
        const result = await auth.signInWithPopup(provider);
        const authenticatedUser = result?.user || auth.currentUser;

        if (!authenticatedUser) {
            throw new Error('Nao foi possivel concluir sua entrada com Google.');
        }

        await ensureEntryAssistUserProfileDoc(authenticatedUser);
        closeEntryAssistPrompt(true);

        if (typeof syncCheckoutAccountUI === 'function') syncCheckoutAccountUI();
        if (typeof populateCheckoutFormFromUser === 'function') {
            await populateCheckoutFormFromUser(authenticatedUser).catch(() => {});
        }
    } catch (error) {
        alert(sanitizePlainText(error?.message || 'Nao foi possivel entrar com Google agora.', 220));
    } finally {
        if (elements.entryAssistActionBtn) {
            elements.entryAssistActionBtn.disabled = false;
            const actionMode = sanitizePlainText(elements.entryAssistActionBtn.dataset.mode, 40);
            elements.entryAssistActionBtn.textContent = actionMode === 'login_google'
                ? 'Continuar com Google'
                : 'Ativar notificacoes';
        }
    }
}

async function saveStorefrontCopy() {
    if (!currentUserIsAdmin || !currentUser) return;

    const saveButton = elements.saveStorefrontCopyBtn;
    const nextCopy = readStorefrontCopyForm();

    try {
        if (saveButton) {
            saveButton.disabled = true;
            saveButton.textContent = 'Salvando...';
        }

        const idToken = await currentUser.getIdToken();
        const response = await fetch(buildBackendUrl('/api/admin/storefront/update'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Bearer ${idToken}`
            },
            body: JSON.stringify({
                action: 'site_copy',
                payload: nextCopy
            })
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.ok === false) {
            throw new Error(sanitizePlainText(payload?.error || 'Nao foi possivel salvar os textos da home.', 220));
        }

        applyStorefrontCopy(nextCopy);
        closeStorefrontCopyModal();
    } catch (error) {
        alert(sanitizePlainText(error?.message || 'Nao foi possivel salvar os textos agora.', 220));
    } finally {
        if (saveButton) {
            saveButton.disabled = false;
            saveButton.textContent = 'Salvar textos';
        }
    }
}

function bindStorefrontAdminTools() {
    if (storefrontAdminToolsBound) return;
    storefrontAdminToolsBound = true;

    const mountTools = (id, actions = []) => {
        const container = document.getElementById(id);
        if (!container) return;
        container.replaceChildren();
        actions.forEach((action) => container.appendChild(createAdminInlineChip(action)));
    };

    mountTools('admin-hero-inline-tools', [
        { label: 'Editar texto', icon: 'fa-pen-nib', onClick: openStorefrontCopyModal },
        { label: 'Operacao', icon: 'fa-sliders', onClick: openInlineOperationsEditing },
        { label: 'Pecas', icon: 'fa-shirt', onClick: openInlineProductEditing }
    ]);
    mountTools('admin-collections-inline-tools', [
        { label: 'Operacao', icon: 'fa-sliders', onClick: openInlineOperationsEditing },
        { label: 'Colecoes', icon: 'fa-layer-group', onClick: openInlineCollectionsEditing },
        { label: 'Pecas', icon: 'fa-shirt', onClick: openInlineProductEditing }
    ]);
    mountTools('admin-shop-inline-tools', [
        { label: 'Editar texto', icon: 'fa-pen-nib', onClick: openStorefrontCopyModal },
        { label: 'Operacao', icon: 'fa-sliders', onClick: openInlineOperationsEditing },
        { label: 'Categorias', icon: 'fa-tags', onClick: openInlineCategoriesEditing },
        { label: 'Pecas', icon: 'fa-shirt', onClick: openInlineProductEditing }
    ]);
    mountTools('admin-philosophy-inline-tools', [
        { label: 'Editar texto', icon: 'fa-pen-nib', onClick: openStorefrontCopyModal }
    ]);
    mountTools('admin-message-inline-tools', [
        { label: 'Editar texto', icon: 'fa-pen-nib', onClick: openStorefrontCopyModal }
    ]);

    if (elements.adminFabToggle) {
        elements.adminFabToggle.setAttribute('aria-expanded', 'false');
        elements.adminFabToggle.addEventListener('click', () => toggleAdminFabPanel());
    }

    if (elements.adminOpenCopyEditor) {
        elements.adminOpenCopyEditor.addEventListener('click', openStorefrontCopyModal);
    }

    if (elements.adminQuickbarOperations) {
        elements.adminQuickbarOperations.addEventListener('click', openInlineOperationsEditing);
    }

    if (elements.adminQuickbarProducts) {
        elements.adminQuickbarProducts.addEventListener('click', openInlineProductEditing);
    }

    if (elements.adminQuickbarCollections) {
        elements.adminQuickbarCollections.addEventListener('click', openInlineCollectionsEditing);
    }

    if (elements.adminQuickbarCategories) {
        elements.adminQuickbarCategories.addEventListener('click', openInlineCategoriesEditing);
    }

    if (elements.adminOpenOperationsEditor) {
        elements.adminOpenOperationsEditor.addEventListener('click', openInlineOperationsEditing);
    }

    if (elements.adminOpenProductsEditor) {
        elements.adminOpenProductsEditor.addEventListener('click', openInlineProductEditing);
    }

    if (elements.adminOpenCollectionsEditor) {
        elements.adminOpenCollectionsEditor.addEventListener('click', openInlineCollectionsEditing);
    }

    if (elements.adminOpenCategoriesEditor) {
        elements.adminOpenCategoriesEditor.addEventListener('click', openInlineCategoriesEditing);
    }

    if (elements.sidebarAdminOperationLink) {
        elements.sidebarAdminOperationLink.addEventListener('click', () => {
            if (elements.sidebarMenu?.classList.contains('open')) toggleSidebar();
            openInlineOperationsEditing();
        });
    }

    if (elements.closeStorefrontCopyModalBtn) {
        elements.closeStorefrontCopyModalBtn.addEventListener('click', closeStorefrontCopyModal);
    }

    if (elements.cancelStorefrontCopyBtn) {
        elements.cancelStorefrontCopyBtn.addEventListener('click', closeStorefrontCopyModal);
    }

    if (elements.saveStorefrontCopyBtn) {
        elements.saveStorefrontCopyBtn.addEventListener('click', saveStorefrontCopy);
    }

    if (elements.storefrontCopyModal) {
        elements.storefrontCopyModal.addEventListener('click', (event) => {
            if (event.target === elements.storefrontCopyModal) {
                closeStorefrontCopyModal();
            }
        });
    }

    document.addEventListener('click', (event) => {
        if (!elements.adminFabPanel || !elements.adminFabToggle || elements.adminFabPanel.classList.contains('hidden')) return;

        const clickedInsidePanel = elements.adminFabPanel.contains(event.target);
        const clickedToggle = elements.adminFabToggle.contains(event.target);
        if (!clickedInsidePanel && !clickedToggle) {
            toggleAdminFabPanel(false);
        }
    });
}

function updateAdminModeExperience(isAdmin) {
    bindStorefrontAdminTools();

    document.querySelectorAll('.admin-inline-tools').forEach((container) => {
        container.classList.toggle('hidden', !isAdmin);
    });

    if (elements.adminFabShell) {
        elements.adminFabShell.classList.toggle('hidden', !isAdmin);
    }

    if (elements.adminQuickbar) {
        elements.adminQuickbar.classList.toggle('hidden', !isAdmin);
    }

    if (elements.sidebarAdminOperationItem) {
        elements.sidebarAdminOperationItem.classList.toggle('hidden', !isAdmin);
    }

    if (elements.floatingWhatsapp) {
        elements.floatingWhatsapp.classList.toggle('hidden', isAdmin);
    }

    if (!isAdmin) {
        toggleAdminFabPanel(false);
        closeStorefrontCopyModal();
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
    updateOfflineBannerState();

    auth.onAuthStateChanged(async (user) => {
        currentUser = user;
        currentUserIsAdmin = await isAuthorizedAdminUser(user);
        if (typeof window.hydrateAccountCartState === 'function') {
            await window.hydrateAccountCartState(user);
        }
        await atualizarInterfaceUsuario(user, currentUserIsAdmin);
        updateAdminModeExperience(currentUserIsAdmin);
        if (typeof handleRouting === 'function') handleRouting();
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
    
    if (elements.closeAuthPromptBtn) elements.closeAuthPromptBtn.addEventListener('click', () => closeEntryAssistPrompt(true));
    if (elements.dismissAuthPromptBtn) elements.dismissAuthPromptBtn.addEventListener('click', () => closeEntryAssistPrompt(true));
    if (elements.entryAssistActionBtn) {
        elements.entryAssistActionBtn.addEventListener('click', async () => {
            const actionMode = sanitizePlainText(elements.entryAssistActionBtn.dataset.mode, 40);

            if (actionMode === 'push' && typeof window.enablePushNotificationsFromCheckout === 'function') {
                await window.enablePushNotificationsFromCheckout();
                closeEntryAssistPrompt(true);
                return;
            }

            if (actionMode === 'login_google') {
                await signInWithGoogleFromEntryAssist();
            }
        });
    }

    if (elements.authPromptModal) {
        elements.authPromptModal.addEventListener('click', (event) => {
            if (event.target === elements.authPromptModal) {
                closeEntryAssistPrompt(true);
            }
        });
    }

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

    if (elements.offlineBannerRetry) {
        elements.offlineBannerRetry.addEventListener('click', () => {
            if (navigator.onLine) {
                window.location.reload();
                return;
            }

            updateOfflineBannerState();
        });
    }

    window.addEventListener('online', () => {
        updateOfflineBannerState();
    });

    window.addEventListener('offline', () => {
        updateOfflineBannerState();
    });

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

        if (elements.storefrontCopyModal?.classList.contains('flex')) {
            closeStorefrontCopyModal();
            return;
        }

        if (elements.authPromptModal?.classList.contains('flex')) {
            closeEntryAssistPrompt(true);
            return;
        }

        if (elements.checkoutPushModal?.classList.contains('flex') && typeof closeCheckoutPushModal === 'function') {
            closeCheckoutPushModal(true);
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

function sanitizeProfilePhone(value) {
    return String(value ?? '')
        .replace(/[^\d+\-() ]/g, '')
        .trim()
        .slice(0, 30);
}

function normalizeProfileDocument(value) {
    return String(value ?? '')
        .replace(/\D/g, '')
        .slice(0, 14);
}

function mergeProfileAddressRecords(primaryAddress, fallbackAddress) {
    const primary = primaryAddress && typeof primaryAddress === 'object' ? primaryAddress : {};
    const fallback = fallbackAddress && typeof fallbackAddress === 'object' ? fallbackAddress : {};
    return { ...fallback, ...primary };
}

function normalizeProfileAddress(address) {
    if (!address || typeof address !== 'object') return null;

    const normalized = {
        rua: sanitizePlainText(address.rua, 140),
        numero: sanitizePlainText(address.numero, 40),
        complemento: sanitizePlainText(address.complemento, 120),
        bairro: sanitizePlainText(address.bairro, 80),
        cidade: sanitizePlainText(address.cidade, 120),
        estado: sanitizePlainText(address.estado, 2).toUpperCase(),
        cep: sanitizePlainText(address.cep, 12)
    };

    return Object.values(normalized).some(Boolean) ? normalized : null;
}

function normalizeFavoritesList(list) {
    if (!Array.isArray(list)) return [];

    return Array.from(new Set(
        list
            .map((item) => sanitizePlainText(item, 120))
            .filter(Boolean)
    )).slice(0, 200);
}

function getPersistedProfileCreatedAt(value) {
    return value && typeof value.toDate === 'function' ? value : null;
}

function normalizeUserProfileRecordForFirestore(source = {}, user = null, overrides = {}) {
    const base = source && typeof source === 'object' ? source : {};
    const extra = overrides && typeof overrides === 'object' ? overrides : {};
    const createdAt = Object.prototype.hasOwnProperty.call(extra, 'createdAt')
        ? extra.createdAt
        : getPersistedProfileCreatedAt(base.createdAt);

    return {
        nome: sanitizePlainText(extra.nome ?? base.nome ?? user?.displayName ?? user?.email?.split('@')[0] ?? 'Cliente', 120) || 'Cliente',
        email: sanitizePlainText(extra.email ?? base.email ?? user?.email, 120),
        telefone: sanitizeProfilePhone(extra.telefone ?? base.telefone),
        documento: normalizeProfileDocument(extra.documento ?? base.documento),
        endereco: normalizeProfileAddress(mergeProfileAddressRecords(extra.endereco, base.endereco)),
        fotoUrl: normalizeUrl(extra.fotoUrl ?? base.fotoUrl ?? user?.photoURL),
        createdAt: createdAt ?? null,
        favoritos: normalizeFavoritesList(extra.favoritos ?? base.favoritos)
    };
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

function closeEntryAssistPrompt(markSeen = true) {
    if (!elements.authPromptModal) return;

    elements.authPromptModal.classList.add('hidden');
    elements.authPromptModal.classList.remove('flex');
    unlockBodyScroll('entry-assist');

    if (markSeen) {
        const promptType = sanitizePlainText(elements.authPromptModal.dataset.promptType || 'generic', 30) || 'generic';
        try {
            sessionStorage.setItem(`lamed_entry_prompt_${promptType}`, 'true');
        } catch (error) {}
    }
}

function configureEntryAssistPrompt({ type, title, copy, iconClass, linkLabel = '', actionLabel = '' }) {
    if (!elements.authPromptModal) return;

    elements.authPromptModal.dataset.promptType = sanitizePlainText(type, 30) || 'generic';
    if (elements.entryAssistTitle) elements.entryAssistTitle.textContent = title;
    if (elements.entryAssistCopy) elements.entryAssistCopy.textContent = copy;

    if (elements.entryAssistIcon) {
        elements.entryAssistIcon.className = `${iconClass} text-5xl`;
    }

    if (elements.entryAssistLink) {
        elements.entryAssistLink.classList.toggle('hidden', !linkLabel);
        elements.entryAssistLink.textContent = linkLabel || 'Entrar ou cadastrar';
    }

    if (elements.entryAssistActionBtn) {
        setEntryAssistActionStyle(type === 'login' ? 'secondary' : 'primary');
        elements.entryAssistActionBtn.classList.toggle('hidden', !actionLabel);
        elements.entryAssistActionBtn.textContent = actionLabel || 'Ativar notificacoes';
        elements.entryAssistActionBtn.dataset.mode = type === 'login' ? 'login_google' : type;
    }

    if (elements.dismissAuthPromptBtn) {
        elements.dismissAuthPromptBtn.textContent = type === 'push' ? 'Agora nao' : 'Continuar explorando';
    }

    elements.authPromptModal.classList.remove('hidden');
    elements.authPromptModal.classList.add('flex');
    lockBodyScroll('entry-assist');
}

function checkAuthPrompt(user) {
    if (!elements.authPromptModal) return;

    if (entryAssistTimer) {
        window.clearTimeout(entryAssistTimer);
        entryAssistTimer = null;
    }

    closeEntryAssistPrompt(false);

    if (currentUserIsAdmin) return;

    const notificationsSupported = typeof Notification !== 'undefined' && 'serviceWorker' in navigator;
    const shouldPromptPush = Boolean(user) && notificationsSupported && Notification.permission === 'default';
    const shouldPromptLogin = !user;

    if (!shouldPromptPush && !shouldPromptLogin) return;

    const promptType = shouldPromptPush ? 'push' : 'login';
    try {
        if (sessionStorage.getItem(`lamed_entry_prompt_${promptType}`) === 'true') {
            return;
        }
    } catch (error) {}

    entryAssistTimer = window.setTimeout(() => {
        if (promptType === 'push' && auth.currentUser) {
            configureEntryAssistPrompt({
                type: 'push',
                title: 'Ative avisos neste aparelho',
                copy: 'Receba novidades e atualizacoes do seu pedido sem precisar ficar entrando no site o tempo todo.',
                iconClass: 'fa-regular fa-bell',
                actionLabel: 'Ativar notificacoes'
            });
            return;
        }

        if (!auth.currentUser) {
            configureEntryAssistPrompt({
                type: 'login',
                title: 'Entre para acompanhar seus pedidos',
                copy: 'Fazendo login, voce acompanha o historico do pedido, favoritos, suporte e depois ainda pode ativar notificacoes neste aparelho.',
                iconClass: 'fa-regular fa-user-circle',
                linkLabel: 'Entrar ou cadastrar',
                actionLabel: 'Continuar com Google'
            });
        }
    }, 2200);
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
