// Configurações do Firebase
const firebaseConfig = {
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
try { app = firebase.app(); } catch (e) { app = firebase.initializeApp(firebaseConfig); }
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();
const ADMIN_UIDS = new Set(["NoGsCqiKc0VJwWb6rppk7QVLV1B2"]);
const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_REMOTE_IMAGE_HOSTS = new Set([
    'firebasestorage.googleapis.com',
    'storage.googleapis.com',
    'ui-avatars.com',
    'lh3.googleusercontent.com'
]);

// Variáveis de Estado
let currentUser = null;
let currentUserIsAdmin = false;
let unsubscribeChat = null;
let unsubscribeOrders = null;
let unsubscribeAdminChats = null;
let ordersCache = [];
let selectedOrderId = '';
let activeChatOrderId = '';
let activeChatThreadId = 'geral';
let currentChatMessages = [];
let pushMessagingInstance = null;
let currentPushToken = "";
let pushConfigCache = null;
let pushRequestInFlight = false;
let pushForegroundListenerBound = false;
let infinitePayReturnInFlight = false;

function resolveApiBaseUrl() {
    const configured = document.querySelector('meta[name="lamed-api-base-url"]')?.getAttribute('content')?.trim();
    if (configured) return configured.replace(/\/+$/, '');

    try {
        const stored = window.localStorage.getItem('lamed_api_base_url')?.trim();
        if (stored) return stored.replace(/\/+$/, '');
    } catch (error) {}

    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'http://localhost:3001';
    }

    return '';
}

const API_BASE_URL = resolveApiBaseUrl();

function buildBackendUrl(pathname) {
    const safePath = String(pathname || '').startsWith('/') ? pathname : `/${pathname || ''}`;
    return API_BASE_URL ? `${API_BASE_URL}${safePath}` : safePath;
}

function sanitizePlainText(value, maxLength = 160) {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function sanitizePhone(value) {
    return String(value ?? '')
        .replace(/[^\d+\-() ]/g, '')
        .trim()
        .slice(0, 30);
}

function normalizeImageUrl(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';

    try {
        const parsed = new URL(raw, window.location.origin);
        if (!['http:', 'https:'].includes(parsed.protocol)) return '';
                if (
            parsed.origin !== window.location.origin &&
            !ALLOWED_REMOTE_IMAGE_HOSTS.has(parsed.hostname) &&
            !String(parsed.hostname || '').toLowerCase().endsWith('.firebasestorage.app')
        ) {
            return '';
        }
        return parsed.toString();
    } catch (error) {
        return '';
    }
}

function normalizeHttpUrl(value) {
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

function normalizeProfileDocument(value) {
    return String(value ?? '')
        .replace(/\D/g, '')
        .slice(0, 14);
}

function mergeProfileAddressRecords(primaryAddress, fallbackAddress) {
    const primary = normalizeProfileAddress(primaryAddress) || {};
    const fallback = normalizeProfileAddress(fallbackAddress) || {};

    return {
        rua: primary.rua || fallback.rua || '',
        numero: primary.numero || fallback.numero || '',
        complemento: primary.complemento || fallback.complemento || '',
        bairro: primary.bairro || fallback.bairro || '',
        cidade: primary.cidade || fallback.cidade || '',
        estado: primary.estado || fallback.estado || '',
        cep: primary.cep || fallback.cep || ''
    };
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

function sanitizeProfileAddressId(value, fallback = '') {
    const normalized = sanitizePlainText(value, 80)
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-|-$/g, '');

    return normalized || fallback || '';
}

function buildProfileAddressSignature(address) {
    const normalized = normalizeProfileAddress(address);
    if (!normalized) return '';

    return [
        sanitizePlainText(normalized.rua, 140).toLowerCase(),
        sanitizePlainText(normalized.numero, 40).toLowerCase(),
        sanitizePlainText(normalized.complemento, 120).toLowerCase(),
        sanitizePlainText(normalized.bairro, 80).toLowerCase(),
        sanitizePlainText(normalized.cidade, 120).toLowerCase(),
        sanitizePlainText(normalized.estado, 2).toLowerCase(),
        sanitizePlainText(normalized.cep, 12)
    ].join('|');
}

function extractProfileAddressFields(address) {
    const normalized = normalizeProfileAddress(address);
    if (!normalized) return null;
    return { ...normalized };
}

function normalizeSavedProfileAddressEntry(address, index = 0) {
    const normalized = normalizeProfileAddress(address);
    if (!normalized) return null;

    return {
        id: sanitizeProfileAddressId(address?.id, `address-${index + 1}`),
        label: sanitizePlainText(address?.label, 60),
        principal: address?.principal === true,
        ...normalized
    };
}

function normalizeSavedProfileAddressBook(list, primaryAddress = null, primaryAddressId = '') {
    const sourceList = Array.isArray(list) ? list : [];
    const entries = sourceList
        .map((item, index) => normalizeSavedProfileAddressEntry(item, index))
        .filter(Boolean)
        .slice(0, 10);

    const normalizedPrimary = normalizeProfileAddress(primaryAddress);
    let selectedId = sanitizeProfileAddressId(primaryAddressId);

    if (!selectedId) {
        selectedId = entries.find((item) => item.principal)?.id || '';
    }

    if (normalizedPrimary) {
        const primarySignature = buildProfileAddressSignature(normalizedPrimary);
        let primaryEntry = entries.find((item) => item.id === selectedId);

        if (!primaryEntry && primarySignature) {
            primaryEntry = entries.find((item) => buildProfileAddressSignature(item) === primarySignature);
        }

        if (primaryEntry) {
            Object.assign(primaryEntry, normalizedPrimary);
            selectedId = primaryEntry.id;
        } else {
            selectedId = selectedId || `address-${entries.length + 1}`;
            entries.unshift({
                id: selectedId,
                label: 'Endereco principal',
                principal: true,
                ...normalizedPrimary
            });
        }
    }

    const normalizedEntries = entries
        .slice(0, 10)
        .map((item, index) => ({
            ...item,
            id: sanitizeProfileAddressId(item.id, `address-${index + 1}`),
            label: sanitizePlainText(item.label, 60),
            principal: false
        }));

    if (!selectedId) {
        selectedId = normalizedEntries[0]?.id || '';
    }

    const selectedEntry = normalizedEntries.find((item) => item.id === selectedId) || normalizedEntries[0] || null;

    if (selectedEntry) {
        selectedEntry.principal = true;
        if (!selectedEntry.label) {
            selectedEntry.label = 'Endereco principal';
        }
    }

    normalizedEntries.forEach((item, index) => {
        if (!item.label) {
            item.label = item.principal ? 'Endereco principal' : `Endereco salvo ${index + 1}`;
        }
    });

    return {
        enderecos: normalizedEntries,
        enderecoPrincipalId: selectedEntry?.id || null,
        endereco: extractProfileAddressFields(selectedEntry) || normalizedPrimary || null
    };
}

function normalizeFavoritesList(list) {
    if (!Array.isArray(list)) return [];

    return Array.from(new Set(
        list
            .map((item) => sanitizePlainText(item, 120))
            .filter(Boolean)
    )).slice(0, 200);
}

function getPersistedCreatedAt(value) {
    return value && typeof value.toDate === 'function' ? value : null;
}

function buildUserProfileRecord(source = {}, user = null, overrides = {}) {
    const base = source && typeof source === 'object' ? source : {};
    const extra = overrides && typeof overrides === 'object' ? overrides : {};
    const createdAt = Object.prototype.hasOwnProperty.call(extra, 'createdAt')
        ? extra.createdAt
        : getPersistedCreatedAt(base.createdAt);
    const addressBook = normalizeSavedProfileAddressBook(
        extra.enderecos ?? base.enderecos,
        mergeProfileAddressRecords(extra.endereco, base.endereco),
        extra.enderecoPrincipalId ?? base.enderecoPrincipalId
    );

    return {
        nome: sanitizePlainText(extra.nome ?? base.nome ?? user?.displayName ?? user?.email?.split('@')[0] ?? 'Cliente', 120) || 'Cliente',
        email: sanitizePlainText(extra.email ?? base.email ?? user?.email, 120),
        telefone: sanitizePhone(extra.telefone ?? base.telefone),
        documento: normalizeProfileDocument(extra.documento ?? base.documento),
        endereco: addressBook.endereco,
        enderecos: addressBook.enderecos,
        enderecoPrincipalId: addressBook.enderecoPrincipalId,
        fotoUrl: normalizeImageUrl(extra.fotoUrl ?? base.fotoUrl ?? user?.photoURL),
        createdAt: createdAt ?? null,
        favoritos: normalizeFavoritesList(extra.favoritos ?? base.favoritos)
    };
}

function buildAvatarUrl(name) {
    const safeName = sanitizePlainText(name || 'U', 80) || 'U';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(safeName)}&background=A58A5C&color=fff`;
}

function isFirestorePermissionError(error) {
    const code = String(error?.code || '').toLowerCase();
    const message = String(error?.message || '').toLowerCase();
    return code === 'permission-denied' || message.includes('missing or insufficient permissions');
}

async function getUserSessionAuthToken(user = currentUser || auth.currentUser) {
    if (!user) {
        throw new Error('Entre na sua conta para continuar.');
    }

    return user.getIdToken();
}

async function sendProfileSyncToBackend(profile = {}, user = currentUser || auth.currentUser) {
    const authToken = await getUserSessionAuthToken(user);
    const response = await fetch(buildBackendUrl('/api/notifications/profile-sync'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ profile })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) {
        throw new Error(sanitizePlainText(payload?.error || 'Nao foi possivel sincronizar sua conta agora.', 220));
    }

    return payload;
}

async function signInWithGoogleSafe() {
    if (!firebase.auth || typeof firebase.auth.GoogleAuthProvider !== 'function') {
        throw new Error('O login com Google nao esta disponivel agora.');
    }

    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await auth.signInWithRedirect(provider);
    return null;
}

async function syncGoogleUserProfileDoc(user) {
    if (!user) return;
    await sendProfileSyncToBackend({
        nome: sanitizePlainText(user.displayName, 120) || 'Cliente',
        email: sanitizePlainText(user.email, 120),
        fotoUrl: normalizeImageUrl(user.photoURL) || null
    }, user);
}

function splitFullName(name) {
    const safe = sanitizePlainText(name, 80);
    if (!safe) return { firstName: 'Cliente', fullName: 'Cliente' };
    const parts = safe.split(' ').filter(Boolean);
    return {
        firstName: parts[0] || safe,
        fullName: safe
    };
}

function updateAccountStat(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
}

function updateNotificationSummaryState() {
    const statusCopy = document.getElementById('account-notification-copy');
    const granted = typeof Notification !== 'undefined' && Notification.permission === 'granted';
    updateAccountStat('account-stat-notifications', granted ? 'On' : 'Off');

    if (statusCopy) {
        statusCopy.textContent = granted
            ? 'Este aparelho pode receber avisos de pedido, respostas do suporte e alertas de promocao dos seus favoritos.'
            : 'Ative neste aparelho para receber avisos de pedido, suporte, promocao e novas etapas.';
    }
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

function formatAdminChatTimestamp(value) {
    if (typeof value?.toDate === 'function') {
        return value.toDate().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    }
    if (typeof value?.seconds === 'number') {
        return new Date(value.seconds * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    }
    return 'Agora';
}

function stopAdminActiveChatsFeed() {
    if (unsubscribeAdminChats) {
        unsubscribeAdminChats();
        unsubscribeAdminChats = null;
    }
}

function renderAdminActiveChatsList(chats) {
    const card = document.getElementById('account-admin-chat-card');
    const container = document.getElementById('account-admin-active-chats');
    if (!card || !container) return;

    if (!currentUserIsAdmin) {
        card.classList.add('hidden');
        container.innerHTML = '';
        return;
    }

    card.classList.remove('hidden');

    if (!Array.isArray(chats) || chats.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-400 py-8">Nenhum chat ativo no momento.</p>';
        return;
    }

    container.innerHTML = chats.map((chat) => {
        const chatId = sanitizePlainText(chat.id, 120);
        const threadId = sanitizePlainText(chat.activeThreadId, 120) || 'geral';
        const orderId = sanitizePlainText(chat.orderId, 120);
        const userName = sanitizePlainText(chat.userName || 'Cliente', 80) || 'Cliente';
        const lastMessage = sanitizePlainText(chat.lastMessage || 'Sem mensagens ainda.', 120);
        const lastUpdate = formatAdminChatTimestamp(chat.lastUpdate);
        const href = `chat-admin.html?chat=${encodeURIComponent(chatId)}&thread=${encodeURIComponent(threadId)}${orderId ? `&pedido=${encodeURIComponent(orderId)}` : ''}`;

        return `
            <a href="${href}" class="account-order-card">
                <div class="account-order-top">
                    <div>
                        <strong>${userName}</strong>
                        <span>${lastUpdate}</span>
                    </div>
                    <span class="account-order-status ${chat.unread ? 'is-highlight' : ''}">${chat.unread ? 'Nao lido' : 'Aberto'}</span>
                </div>
                <p class="account-panel-copy mt-3">${lastMessage}</p>
            </a>
        `;
    }).join('');
}

function startAdminActiveChatsFeed() {
    stopAdminActiveChatsFeed();
    if (!currentUserIsAdmin) {
        renderAdminActiveChatsList([]);
        return;
    }

    unsubscribeAdminChats = db.collection('chats_ativos').onSnapshot((snapshot) => {
        const chats = snapshot.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }))
            .sort((left, right) => {
                const leftTime = typeof left.lastUpdate?.seconds === 'number' ? left.lastUpdate.seconds : 0;
                const rightTime = typeof right.lastUpdate?.seconds === 'number' ? right.lastUpdate.seconds : 0;
                return rightTime - leftTime;
            });
        renderAdminActiveChatsList(chats);
    }, () => {
        renderAdminActiveChatsList([]);
    });
}

function getStatusLabel(status) {
    const safeStatus = sanitizePlainText(status, 30).toLowerCase();
    const labels = {
        pendente: 'Pendente',
        pago: 'Pago',
        processando: 'Em producao',
        enviado: 'Enviado',
        entregue: 'Entregue',
        cancelado: 'Cancelado'
    };
    return labels[safeStatus] || (safeStatus ? safeStatus.charAt(0).toUpperCase() + safeStatus.slice(1) : 'Pendente');
}

function isAwaitingInfinitePay(order) {
    if (!order || typeof order !== 'object') return false;

    const gateway = sanitizePlainText(order.paymentGateway || order.payment?.gateway, 40).toLowerCase();
    const paymentStatus = sanitizePlainText(order.paymentStatus || order.payment?.status, 40).toLowerCase();
    return gateway === 'infinitepay' && paymentStatus === 'pending';
}

function getOrderDisplayStatus(order) {
    if (isAwaitingInfinitePay(order)) {
        return 'Aguardando pagamento';
    }

    return getStatusLabel(order?.status);
}

function getOrderDisplayStatusClass(order) {
    if (isAwaitingInfinitePay(order)) {
        return 'text-amber-700 bg-amber-50';
    }

    return getStatusClass(order?.status);
}

function getOrderPaymentMeta(order) {
    if (isAwaitingInfinitePay(order)) {
        return {
            label: 'InfinitePay',
            detail: 'Finalize o pagamento no checkout seguro da InfinitePay.'
        };
    }

    const parcelas = Number(order?.parcelas || 1);
    return {
        label: sanitizePlainText(order?.pagamento, 60) || 'A combinar',
        detail: `${parcelas}x ${parcelas > 1 ? 'no cartao' : 'na finalizacao'}`
    };
}

function formatOrderDate(value) {
    if (typeof value?.toDate === 'function') {
        return value.toDate().toLocaleDateString('pt-BR');
    }
    if (typeof value?.seconds === 'number') {
        return new Date(value.seconds * 1000).toLocaleDateString('pt-BR');
    }
    return 'Data desconhecida';
}

function getOrderCode(orderId) {
    return `#${String(orderId || '').slice(0, 6).toUpperCase()}`;
}

function getRequestedOrderId() {
    const params = new URLSearchParams(window.location.search);
    const queryOrderId = sanitizePlainText(params.get('pedido'), 120);
    if (queryOrderId) return queryOrderId;

    try {
        return sanitizePlainText(sessionStorage.getItem('lamed_last_order_id'), 120);
    } catch (error) {
        return '';
    }
}

function persistFocusedOrder(orderId) {
    if (!orderId) return;

    try {
        sessionStorage.setItem('lamed_last_order_id', orderId);
    } catch (error) {}

    const url = new URL(window.location.href);
    url.searchParams.set('pedido', orderId);
    url.hash = '#pedidos';
    window.history.replaceState({}, '', url.toString());
}

function getInfinitePayReturnContext() {
    const url = new URL(window.location.href);
    const gateway = sanitizePlainText(url.searchParams.get('gateway'), 40).toLowerCase();
    if (gateway !== 'infinitepay') return null;

    const orderId = sanitizePlainText(url.searchParams.get('order_nsu') || url.searchParams.get('pedido'), 120);
    if (!orderId) return null;

    return {
        orderId,
        slug: sanitizePlainText(url.searchParams.get('slug'), 180),
        transactionNsu: sanitizePlainText(url.searchParams.get('transaction_nsu'), 180)
    };
}

function cleanupInfinitePayReturnUrl(orderId) {
    const url = new URL(window.location.href);
    [
        'gateway',
        'order_nsu',
        'slug',
        'transaction_nsu',
        'capture_method',
        'receipt_url'
    ].forEach((key) => url.searchParams.delete(key));

    if (orderId) {
        url.searchParams.set('pedido', orderId);
    }

    url.hash = '#pedidos';
    window.history.replaceState({}, '', url.toString());
}

async function maybeHandleInfinitePayReturn(user) {
    const context = getInfinitePayReturnContext();
    if (!user || !context || infinitePayReturnInFlight) return;

    const sessionKey = `lamed_infinitepay_return_${context.orderId}_${context.transactionNsu || context.slug || 'paid'}`;

    try {
        if (sessionStorage.getItem(sessionKey) === 'done') {
            cleanupInfinitePayReturnUrl(context.orderId);
            return;
        }
    } catch (error) {}

    infinitePayReturnInFlight = true;

    try {
        const idToken = await user.getIdToken();
        const response = await fetch(buildBackendUrl('/api/payments/infinitepay/confirm'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                Authorization: `Bearer ${idToken}`
            },
            body: JSON.stringify(context)
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) {
            throw new Error(sanitizePlainText(payload?.error || 'Nao foi possivel confirmar o pagamento da InfinitePay.', 220));
        }

        try {
            sessionStorage.setItem(sessionKey, 'done');
        } catch (error) {}

        persistFocusedOrder(context.orderId);
        activateAccountTab('pedidos');
        cleanupInfinitePayReturnUrl(context.orderId);

        const whatsappUrl = normalizeHttpUrl(payload?.whatsappUrl);
        if (whatsappUrl) {
            const popup = window.open(whatsappUrl, '_blank', 'noopener');
            if (!popup) {
                window.location.href = whatsappUrl;
                return;
            }
        }
    } catch (error) {
        console.error('[infinitepay.return]', error);
        alert(sanitizePlainText(error?.message || 'Nao foi possivel concluir a volta do pagamento agora.', 220));
    } finally {
        infinitePayReturnInFlight = false;
    }
}

function buildSupportPrefixedMessage(text, orderId) {
    const safeText = sanitizePlainText(text, 1000);
    if (!safeText) return '';
    if (!orderId) return safeText;
    return `[Pedido ${getOrderCode(orderId)}] ${safeText}`.slice(0, 1000);
}

function updateChatOrderContextUI() {
    const context = document.getElementById('chat-order-context');
    const orderLabel = document.getElementById('chat-selected-order');
    const input = document.getElementById('message-input');
    if (!context || !orderLabel) return;

    if (!activeChatOrderId) {
        context.classList.add('hidden');
        orderLabel.textContent = 'Sem pedido em foco';
        if (input) input.placeholder = 'Digite sua duvida sobre pedido, medidas, personalizacao ou entrega...';
        updateAccountStat('account-stat-support', 'Ativo');
        return;
    }

    const order = ordersCache.find((item) => item.id === activeChatOrderId);
    orderLabel.textContent = order
        ? `${getOrderCode(order.id)} - ${getOrderDisplayStatus(order.data)}`
        : getOrderCode(activeChatOrderId);
    context.classList.remove('hidden');
    if (input) input.placeholder = `Fale sobre ${orderLabel.textContent.toLowerCase()}...`;
    updateAccountStat('account-stat-support', getOrderCode(activeChatOrderId));
}

function getChatThreadOptions() {
    const options = [
        { id: 'geral', label: 'Conversa geral', orderId: '' }
    ];

    ordersCache.forEach((entry) => {
        options.push({
            id: `pedido:${entry.id}`,
            label: `Pedido ${getOrderCode(entry.id)}`,
            orderId: entry.id
        });
    });

    currentChatMessages.forEach((message) => {
        const threadId = sanitizePlainText(message?.threadId, 120);
        if (!threadId || options.some((item) => item.id === threadId)) return;

        const orderId = sanitizePlainText(message?.orderId, 120);
        options.push({
            id: threadId,
            label: sanitizePlainText(message?.threadLabel, 120) || (orderId ? `Pedido ${getOrderCode(orderId)}` : 'Conversa geral'),
            orderId
        });
    });

    if (activeChatThreadId && activeChatThreadId !== 'geral' && !options.some((item) => item.id === activeChatThreadId)) {
        options.push({
            id: activeChatThreadId,
            label: activeChatOrderId ? `Pedido ${getOrderCode(activeChatOrderId)}` : 'Conversa geral',
            orderId: activeChatOrderId || ''
        });
    }

    return options;
}

function renderChatThreadList() {
    const container = document.getElementById('chat-thread-list');
    if (!container) return;

    const threads = getChatThreadOptions();
    if (!threads.some((item) => item.id === activeChatThreadId)) {
        activeChatThreadId = activeChatOrderId ? `pedido:${activeChatOrderId}` : 'geral';
    }
    const activeThread = threads.find((item) => item.id === activeChatThreadId);
    activeChatOrderId = sanitizePlainText(activeThread?.orderId, 120) || (activeChatThreadId === 'geral' ? '' : activeChatOrderId);

    container.replaceChildren();

    threads.forEach((thread) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `account-thread-chip ${thread.id === activeChatThreadId ? 'is-active' : ''}`;

        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-hashtag text-[10px]';

        const label = document.createElement('span');
        label.textContent = sanitizePlainText(thread.label, 120);

        button.appendChild(icon);
        button.appendChild(label);
        button.addEventListener('click', () => {
            window.selecionarThreadChat(thread.id, thread.orderId || '');
        });

        container.appendChild(button);
    });
}

function getFilteredChatMessages() {
    if (!Array.isArray(currentChatMessages)) return [];
    const safeThreadId = sanitizePlainText(activeChatThreadId, 120) || 'geral';
    return currentChatMessages.filter((message) => {
        const messageThreadId = sanitizePlainText(message?.threadId, 120) || 'geral';
        return messageThreadId === safeThreadId;
    });
}

function renderSelectedOrderDetail() {
    const panel = document.getElementById('selected-order-panel');
    if (!panel) return;

    const selectedOrder = ordersCache.find((item) => item.id === selectedOrderId);
    if (!selectedOrder) {
        panel.innerHTML = `
            <div class="account-order-detail-empty">
                <i class="fa-regular fa-note-sticky"></i>
                <h3>Selecione um pedido</h3>
                <p>O detalhe completo aparece aqui, junto com os atalhos para suporte e acompanhamento.</p>
            </div>
        `;
        return;
    }

    const pedido = selectedOrder.data || {};
    const paymentMeta = getOrderPaymentMeta(pedido);
    const totalFormatado = Number(pedido.total || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const subtotalFormatado = Number(pedido.subtotal || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const dataPedido = formatOrderDate(pedido.data);
    const paymentLink = normalizeHttpUrl(pedido?.payment?.checkoutUrl);
    const endereco = [
        sanitizePlainText(pedido?.cliente?.endereco?.rua, 140),
        sanitizePlainText(pedido?.cliente?.endereco?.numero, 40),
        sanitizePlainText(pedido?.cliente?.endereco?.cidade, 120),
        sanitizePlainText(pedido?.cliente?.endereco?.cep, 12)
    ].filter(Boolean).join(' | ');

    const itensHtml = (Array.isArray(pedido.produtos) ? pedido.produtos : []).map((item) => {
        const detalhes = [];
        const tamanho = sanitizePlainText(item?.tamanho, 20);
        const cor = sanitizePlainText(item?.cor?.nome, 40);
        if (tamanho) detalhes.push(`Tam: ${tamanho}`);
        if (cor) detalhes.push(`Cor: ${cor}`);
        if (item?.personalizacao?.texto) detalhes.push(`Personalizacao: ${sanitizePlainText(item.personalizacao.texto, 120)}`);

        return `
            <div class="account-detail-item">
                <div class="account-detail-item-header">
                    <span>${item.quantity}x ${sanitizePlainText(item.nome, 120)}</span>
                    <span>${Number((item.preco || 0) * (item.quantity || 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                </div>
                <div class="account-detail-item-meta">${detalhes.join(' | ') || 'Sob demanda'}</div>
            </div>
        `;
    }).join('');

    panel.innerHTML = `
        <div class="flex items-start justify-between gap-4">
            <div>
                <p class="account-detail-label">Pedido em foco</p>
                <h3>${getOrderCode(selectedOrder.id)}</h3>
                <p class="account-panel-copy mt-2">Criado em ${dataPedido} e atualmente em ${getOrderDisplayStatus(pedido).toLowerCase()}.</p>
            </div>
            <span class="account-order-status ${getOrderDisplayStatusClass(pedido)}">${getOrderDisplayStatus(pedido)}</span>
        </div>

        <div class="account-detail-section">
            <span class="account-detail-label">Resumo financeiro</span>
            <div class="account-detail-list">
                <div class="account-detail-item">
                    <div class="account-detail-item-header">
                        <span>Subtotal</span>
                        <span>${subtotalFormatado}</span>
                    </div>
                    <div class="account-detail-item-meta">Total final do pedido: ${totalFormatado}</div>
                </div>
                <div class="account-detail-item">
                    <div class="account-detail-item-header">
                        <span>Pagamento</span>
                        <span>${paymentMeta.label}</span>
                    </div>
                    <div class="account-detail-item-meta">${paymentMeta.detail}</div>
                </div>
            </div>
        </div>

        <div class="account-detail-section">
            <span class="account-detail-label">Entrega</span>
            <div class="account-detail-value">${endereco || 'Endereco salvo no pedido.'}</div>
        </div>

        <div class="account-detail-section">
            <span class="account-detail-label">Itens do pedido</span>
            <div class="account-detail-list">${itensHtml || '<div class="account-detail-item">Nenhum item encontrado.</div>'}</div>
        </div>

        <div class="account-order-actions">
            ${isAwaitingInfinitePay(pedido) && paymentLink ? `
            <a href="${paymentLink}" target="_blank" rel="noopener" class="account-soft-btn account-highlight-btn">
                <i class="fa-solid fa-arrow-up-right-from-square"></i>
                Continuar pagamento
            </a>
            ` : ''}
            <button type="button" class="account-soft-btn account-highlight-btn" onclick="iniciarSuportePedido('${selectedOrder.id}')">
                <i class="fa-regular fa-comments"></i>
                Falar sobre este pedido
            </button>
            <a href="https://wa.me/5527999287657?text=${encodeURIComponent(`Oi! Quero falar sobre o pedido ${getOrderCode(selectedOrder.id)}.`)}" target="_blank" class="account-soft-btn">
                <i class="fa-brands fa-whatsapp"></i>
                Continuar no WhatsApp
            </a>
        </div>
    `;
}

function selectAccountOrder(orderId, { updateLocation = true, switchToTab = false } = {}) {
    selectedOrderId = sanitizePlainText(orderId, 120);
    if (!selectedOrderId) return;

    if (switchToTab) {
        activateAccountTab('pedidos');
    }

    document.querySelectorAll('.account-order-card').forEach((card) => {
        card.classList.toggle('is-selected', card.dataset.orderId === selectedOrderId);
    });

    if (updateLocation) {
        persistFocusedOrder(selectedOrderId);
    }

    renderSelectedOrderDetail();
}

async function ensureUserProfileDoc(user) {
    if (!user) return;
    await sendProfileSyncToBackend({}, user);
}

function getPushStatusElement() {
    return document.getElementById('push-status-text');
}

function setPushStatus(message) {
    const statusEl = getPushStatusElement();
    if (statusEl) {
        statusEl.textContent = sanitizePlainText(message, 220);
    }
    updateNotificationSummaryState();
}

function updatePushButtonsState({ enableDisabled = false, disableDisabled = false, enableLabel = 'Ativar neste aparelho' } = {}) {
    const enableBtn = document.getElementById('push-enable-btn');
    const disableBtn = document.getElementById('push-disable-btn');

    if (enableBtn) {
        enableBtn.disabled = enableDisabled;
        enableBtn.textContent = enableLabel;
        enableBtn.classList.toggle('opacity-60', enableDisabled);
        enableBtn.classList.toggle('cursor-not-allowed', enableDisabled);
    }

    if (disableBtn) {
        disableBtn.disabled = disableDisabled;
        disableBtn.classList.toggle('opacity-60', disableDisabled);
        disableBtn.classList.toggle('cursor-not-allowed', disableDisabled);
    }
}

async function fetchPushConfig() {
    if (pushConfigCache) return pushConfigCache;

    const response = await fetch(buildBackendUrl('/api/notifications/config'), {
        method: 'GET',
        headers: { Accept: 'application/json' }
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
        throw new Error(sanitizePlainText(payload?.error || 'Nao foi possivel carregar a configuracao de notificacoes.', 220));
    }

    pushConfigCache = payload;
    return pushConfigCache;
}

function getPushMessagingInstance() {
    if (pushMessagingInstance) return pushMessagingInstance;
    if (!firebase.messaging || typeof firebase.messaging !== 'function') return null;
    pushMessagingInstance = firebase.messaging();
    return pushMessagingInstance;
}

async function ensurePushServiceWorkerRegistration() {
    if (!('serviceWorker' in navigator)) {
        throw new Error('Seu navegador nao oferece suporte completo a notificacoes web.');
    }

    await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none'
    });
    const registration = await navigator.serviceWorker.ready;
    if (!registration?.active) {
        throw new Error('O service worker de notificacoes ainda nao ficou ativo. Atualize a pagina e tente novamente.');
    }
    return registration;
}

async function sendPushSubscriptionToBackend(pathname, token) {
    const authToken = await currentUser.getIdToken();
    const response = await fetch(buildBackendUrl(pathname), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
            token,
            permission: Notification.permission
        })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) {
        throw new Error(sanitizePlainText(payload?.error || 'Nao foi possivel atualizar sua inscricao de notificacoes.', 220));
    }

    return payload;
}

async function sendChatMessageToBackend(payload) {
    if (!currentUser) {
        throw new Error('Entre na sua conta para continuar o atendimento.');
    }

    const authToken = await currentUser.getIdToken();
    const response = await fetch(buildBackendUrl('/api/chat/send'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify(payload)
    });

    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok === false) {
        throw new Error(sanitizePlainText(result?.error || 'Nao foi possivel enviar sua mensagem agora.', 220));
    }

    return result;
}

async function ativarPushNotifications() {
    if (pushRequestInFlight || !currentUser) return;
    pushRequestInFlight = true;
    updatePushButtonsState({ enableDisabled: true, disableDisabled: true, enableLabel: 'Ativando...' });

    try {
        const config = await fetchPushConfig();
        if (!config?.enabled || !config?.vapidPublicKey) {
            throw new Error('As notificacoes ainda nao foram configuradas pela loja.');
        }

        if (!('Notification' in window)) {
            throw new Error('Seu navegador nao suporta notificacoes.');
        }

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            throw new Error('Permissao de notificacao nao concedida.');
        }

        const messaging = getPushMessagingInstance();
        if (!messaging) {
            throw new Error('O navegador nao suportou o Firebase Messaging neste aparelho.');
        }

        const registration = await ensurePushServiceWorkerRegistration();
        const token = await messaging.getToken({
            vapidKey: config.vapidPublicKey,
            serviceWorkerRegistration: registration
        });

        if (!token) {
            throw new Error('Nao foi possivel gerar o token de notificacao deste aparelho.');
        }

        currentPushToken = token;
        await sendPushSubscriptionToBackend('/api/notifications/register', token);
        setPushStatus('Notificacoes ativas neste aparelho. Vamos avisar voce sobre pedidos e suporte.');
    } catch (error) {
        console.error('[push.enable]', error);
        setPushStatus(error?.message || 'Nao foi possivel ativar as notificacoes agora.');
    } finally {
        pushRequestInFlight = false;
        updatePushButtonsState();
    }
}

async function desativarPushNotifications() {
    if (pushRequestInFlight || !currentUser) return;
    pushRequestInFlight = true;
    updatePushButtonsState({ enableDisabled: true, disableDisabled: true, enableLabel: 'Ativar neste aparelho' });

    try {
        const messaging = getPushMessagingInstance();
        let token = currentPushToken;

        if (!token && messaging) {
            const config = await fetchPushConfig().catch(() => null);
            const registration = await ensurePushServiceWorkerRegistration().catch(() => null);
            if (config?.vapidPublicKey && registration) {
                token = await messaging.getToken({
                    vapidKey: config.vapidPublicKey,
                    serviceWorkerRegistration: registration
                }).catch(() => '');
            }
        }

        if (token) {
            await sendPushSubscriptionToBackend('/api/notifications/unregister', token);
            if (messaging && typeof messaging.deleteToken === 'function') {
                await messaging.deleteToken(token).catch(() => {});
            }
        }

        currentPushToken = '';
        setPushStatus('Notificacoes desativadas neste aparelho.');
    } catch (error) {
        console.error('[push.disable]', error);
        setPushStatus(error?.message || 'Nao foi possivel desativar as notificacoes agora.');
    } finally {
        pushRequestInFlight = false;
        updatePushButtonsState();
    }
}

async function iniciarNotificacoesWeb() {
    const enableBtn = document.getElementById('push-enable-btn');
    const disableBtn = document.getElementById('push-disable-btn');
    if (!enableBtn || !disableBtn) return;

    enableBtn.onclick = ativarPushNotifications;
    disableBtn.onclick = desativarPushNotifications;

    if (!currentUser) {
        setPushStatus('Entre na sua conta para ativar notificacoes neste aparelho.');
        updatePushButtonsState({ enableDisabled: true, disableDisabled: true });
        return;
    }

    if (!('Notification' in window) || !('serviceWorker' in navigator) || !firebase.messaging) {
        setPushStatus('Este navegador nao oferece suporte completo a notificacoes web.');
        updatePushButtonsState({ enableDisabled: true, disableDisabled: true });
        return;
    }

    try {
        const config = await fetchPushConfig();
        if (!config?.enabled || !config?.vapidPublicKey) {
            setPushStatus('As notificacoes ainda estao em configuracao na loja.');
            updatePushButtonsState({ enableDisabled: true, disableDisabled: true });
            return;
        }

        if (Notification.permission === 'granted') {
            const messaging = getPushMessagingInstance();
            const registration = await ensurePushServiceWorkerRegistration();
            currentPushToken = await messaging.getToken({
                vapidKey: config.vapidPublicKey,
                serviceWorkerRegistration: registration
            }).catch(() => '');

            setPushStatus(
                currentPushToken
                    ? 'Notificacoes prontas neste aparelho.'
                    : 'Permissao concedida, mas o token ainda nao foi sincronizado. Toque para ativar novamente.'
            );

            if (!pushForegroundListenerBound && typeof messaging.onMessage === 'function') {
                pushForegroundListenerBound = true;
                messaging.onMessage((payload) => {
                    const title = sanitizePlainText(payload?.notification?.title || payload?.data?.title || 'Laméd vs', 120);
                    const body = sanitizePlainText(payload?.notification?.body || payload?.data?.body || 'Voce recebeu uma nova atualizacao.', 240);
                    const link = sanitizePlainText(payload?.fcmOptions?.link || payload?.data?.link || 'minha-conta.html#pedidos', 500);
                    const icon = normalizeImageUrl(payload?.notification?.icon || payload?.data?.icon) || 'https://i.ibb.co/mr93jDHT/JM.png';
                    if (document.visibilityState === 'visible' && Notification.permission === 'granted') {
                        const browserNotification = new Notification(title, { body, icon });
                        browserNotification.onclick = () => {
                            window.focus();
                            window.location.href = link;
                            browserNotification.close();
                        };
                    }
                });
            }
        } else if (Notification.permission === 'denied') {
            setPushStatus('As notificacoes foram bloqueadas neste navegador. Libere nas configuracoes do aparelho para voltar a usar.');
        } else {
            setPushStatus('Ative as notificacoes para receber atualizacoes de pedido e suporte.');
        }
    } catch (error) {
        console.error('[push.init]', error);
        setPushStatus('Nao foi possivel carregar a configuracao de notificacoes agora.');
    } finally {
        updatePushButtonsState({ disableDisabled: !currentPushToken && Notification.permission !== 'granted' });
    }
}

// --- GERENCIAMENTO DE ESTADO ---

auth.onAuthStateChanged(async (user) => {
    const authContainer = document.getElementById('auth-container');
    const userPanel = document.getElementById('user-panel');

    try {
        if (user) {
            currentUser = user;
            currentUserIsAdmin = await isAuthorizedAdminUser(user);
            if(authContainer) authContainer.classList.add('hidden');
            if(userPanel) userPanel.classList.remove('hidden');

            const startupTasks = [
                ['profile.sync', () => ensureUserProfileDoc(user)],
                ['profile.load', () => carregarPerfilUsuario()],
                ['push.init', () => iniciarNotificacoesWeb()],
                ['payments.return', () => maybeHandleInfinitePayReturn(user)]
            ];

            for (const [label, task] of startupTasks) {
                try {
                    await task();
                } catch (error) {
                    console.error(`[account.authState.${label}]`, error);
                }
            }

            try { carregarMeusPedidos(); } catch (error) { console.error('[account.authState.orders]', error); }
            try { carregarFavoritos(); } catch (error) { console.error('[account.authState.favorites]', error); }
            try { iniciarChat(); } catch (error) { console.error('[account.authState.chat]', error); }
            try { startAdminActiveChatsFeed(); } catch (error) { console.error('[account.authState.adminChats]', error); }
            try { applyTabFromHash(); } catch (error) { console.error('[account.authState.tabs]', error); }
            
        } else {
            currentUser = null;
            currentUserIsAdmin = false;
            ordersCache = [];
            selectedOrderId = '';
            activeChatOrderId = '';
            activeChatThreadId = 'geral';
            currentChatMessages = [];
            if (unsubscribeOrders) {
                unsubscribeOrders();
                unsubscribeOrders = null;
            }
            if (unsubscribeChat) {
                unsubscribeChat();
                unsubscribeChat = null;
            }
            stopAdminActiveChatsFeed();
            currentPushToken = '';
            if(authContainer) authContainer.classList.remove('hidden');
            if(userPanel) userPanel.classList.add('hidden');
            switchAuthView('login');
            setPushStatus('Entre na sua conta para ativar notificacoes neste aparelho.');
            updatePushButtonsState({ enableDisabled: true, disableDisabled: true });
            updateAccountStat('account-stat-orders', 0);
            updateAccountStat('account-stat-favorites', 0);
            updateAccountStat('account-stat-support', 'Ativo');
            renderAdminActiveChatsList([]);
        }
    } catch (error) {
        console.error('[account.authState]', error);
        alert('Nao foi possivel carregar ou atualizar sua conta agora.');
    }
});

window.switchAuthView = (view) => {
    document.querySelectorAll('.auth-view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${view}`).classList.add('active');
}

// --- LOGIN ---
const loginForm = document.getElementById('login-form');
if(loginForm) {
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const pass = document.getElementById('login-pass').value;
        auth.signInWithEmailAndPassword(email, pass)
            .catch(() => alert("Nao foi possivel entrar com esse email e senha."));
    });
}

// --- CADASTRO COMPLETO ---
const regForm = document.getElementById('register-form');
if(regForm) {
    regForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('reg-email').value;
        const pass = document.getElementById('reg-pass').value;
        const nome = sanitizePlainText(document.getElementById('reg-nome').value, 60);
        const sobrenome = sanitizePlainText(document.getElementById('reg-sobrenome').value, 60);
        const phone = sanitizePhone(document.getElementById('reg-phone').value);
        const documento = normalizeProfileDocument(document.getElementById('reg-documento')?.value);
        
        const endereco = {
            cep: sanitizePlainText(document.getElementById('reg-cep').value, 12),
            cidade: sanitizePlainText(document.getElementById('reg-cidade').value, 80),
            rua: sanitizePlainText(document.getElementById('reg-rua').value, 120),
            numero: sanitizePlainText(document.getElementById('reg-numero').value, 40)
        };

        try {
            const btn = regForm.querySelector('button');
            btn.textContent = 'Criando conta...';
            btn.disabled = true;

            const userCred = await auth.createUserWithEmailAndPassword(email, pass);
            const user = userCred.user;
            const nomeCompleto = sanitizePlainText(`${nome} ${sobrenome}`, 80);
            
            await user.updateProfile({ displayName: nomeCompleto });
            await sendProfileSyncToBackend({
                nome: nomeCompleto,
                email,
                telefone: phone,
                documento,
                endereco,
                fotoUrl: null,
                favoritos: []
            }, user);
            
        } catch(err) {
            const errorCode = String(err?.code || '');
            if (errorCode === 'auth/weak-password') {
                alert("A senha precisa ter pelo menos 6 caracteres.");
            } else if (errorCode === 'auth/invalid-email') {
                alert("Digite um email valido.");
            } else {
                alert("Nao foi possivel concluir o cadastro agora.");
            }
            const btn = regForm.querySelector('button');
            btn.textContent = 'Finalizar Cadastro';
            btn.disabled = false;
        }
    });
}

// --- GOOGLE LOGIN ---
window.fazerLoginGoogle = () => {
    signInWithGoogleSafe()
        .then(async (user) => {
            if (!user) return;
            await syncGoogleUserProfileDoc(user);
        })
        .catch((err) => {
            console.error(err);
            if (isFirestorePermissionError(err)) {
                alert('Sua conta entrou, mas o perfil ainda nao conseguiu sincronizar. Tente novamente em instantes.');
                return;
            }
            alert('Nao foi possivel entrar com Google agora.');
        });
};

window.fazerLogout = () => auth.signOut();

// --- PERFIL E DADOS ---

async function carregarPerfilUsuario() {
    if(!currentUser) return;
    
    const safeDisplayName = sanitizePlainText(currentUser.displayName || 'Cliente', 80) || 'Cliente';
    const { firstName } = splitFullName(safeDisplayName);
    document.getElementById('user-name-display').textContent = safeDisplayName;
    const heroTitle = document.getElementById('account-hero-title');
    const heroCopy = document.getElementById('account-hero-copy');
    const avatarEl = document.getElementById('user-avatar-display');
    
    try {
        const doc = await db.collection('usuarios').doc(currentUser.uid).get();
        const data = doc.data() || {};
        
        const photo = normalizeImageUrl(data.fotoUrl) || normalizeImageUrl(currentUser.photoURL) || buildAvatarUrl(safeDisplayName);
        if(avatarEl) avatarEl.src = photo;

        const editAvatar = document.getElementById('profile-edit-avatar');
        if(editAvatar) editAvatar.src = photo;
        
        document.getElementById('profile-photo-url').value = data.fotoUrl || '';
        document.getElementById('profile-nome').value = data.nome || safeDisplayName || '';
        document.getElementById('profile-phone').value = data.telefone || '';
        
        if(data.endereco) {
            document.getElementById('profile-cep').value = data.endereco.cep || '';
            document.getElementById('profile-cidade').value = data.endereco.cidade || '';
            document.getElementById('profile-rua').value = data.endereco.rua || '';
            document.getElementById('profile-numero').value = data.endereco.numero || '';
        }

        if (heroTitle) {
            heroTitle.textContent = `${firstName}, acompanhe seus pedidos aqui.`;
        }

        if (heroCopy) {
            heroCopy.textContent = data.telefone
                ? 'Seu perfil ja esta pronto para acompanhar pedidos e falar com o suporte com mais facilidade.'
                : 'Complete seus dados para agilizar os proximos pedidos e facilitar o atendimento.';
        }
    } catch(e) { console.error("Erro perfil:", e); }
}

// --- UPLOAD DE FOTO ---
window.uploadFotoPerfil = async (input) => {
    const file = input.files[0];
    if (!file || !currentUser) return;

    if (!String(file.type || '').startsWith('image/')) {
        alert("Selecione um arquivo de imagem valido.");
        input.value = '';
        return;
    }

    if (Number(file.size || 0) > MAX_PROFILE_IMAGE_BYTES) {
        alert("A imagem precisa ter no maximo 5 MB.");
        input.value = '';
        return;
    }

    const imgPreview = document.getElementById('profile-edit-avatar');
    imgPreview.style.opacity = '0.5';
    
    try {
        const ref = storage.ref(`profile_images/${currentUser.uid}_${Date.now()}`);
        await ref.put(file);
        const url = await ref.getDownloadURL();

        await currentUser.updateProfile({ photoURL: url });
        await sendProfileSyncToBackend({ fotoUrl: url });

        imgPreview.src = url;
        document.getElementById('user-avatar-display').src = url;
        document.getElementById('profile-photo-url').value = url;
        alert("Foto de perfil atualizada!");

    } catch (error) {
        console.error("Erro no upload:", error);
        alert("Nao foi possivel enviar a imagem agora.");
    } finally {
        imgPreview.style.opacity = '1';
        input.value = '';
    }
};

// Salvar Perfil
const profileForm = document.getElementById('profile-form');
if(profileForm) {
    profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = profileForm.querySelector('button');
        btn.textContent = 'Salvando...';
        btn.disabled = true;

        const nome = sanitizePlainText(document.getElementById('profile-nome').value, 80);
        const phone = sanitizePhone(document.getElementById('profile-phone').value);
        const fotoUrl = normalizeImageUrl(document.getElementById('profile-photo-url').value);
        const endereco = {
            cep: sanitizePlainText(document.getElementById('profile-cep').value, 12),
            cidade: sanitizePlainText(document.getElementById('profile-cidade').value, 80),
            rua: sanitizePlainText(document.getElementById('profile-rua').value, 120),
            numero: sanitizePlainText(document.getElementById('profile-numero').value, 40)
        };

        try {
            if(nome) {
                await currentUser.updateProfile({
                    displayName: nome,
                    photoURL: fotoUrl || normalizeImageUrl(currentUser.photoURL) || null
                });
            }
            await sendProfileSyncToBackend({
                nome,
                telefone: phone,
                fotoUrl,
                endereco
            });
            
            alert("Dados atualizados!");
            location.reload(); 
        } catch(e) {
            alert("Nao foi possivel salvar suas alteracoes agora.");
            btn.textContent = 'Salvar alteracoes';
            btn.disabled = false;
        }
    });
}

// --- NAVEGAÇÃO ---
function activateAccountTab(tab, trigger = null) {
    const safeTab = ['pedidos', 'favoritos', 'dados', 'chat'].includes(tab) ? tab : 'pedidos';
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    document.getElementById(`tab-${safeTab}`)?.classList.remove('hidden');

    document.querySelectorAll('.tab-btn').forEach((button) => {
        const tabName = button.getAttribute('onclick')?.match(/switchTab\('([^']+)'\)/)?.[1];
        button.classList.toggle('active', tabName === safeTab);
    });

    if (trigger?.currentTarget) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        trigger.currentTarget.classList.add('active');
    }

    if (window.location.hash !== `#${safeTab}`) {
        window.location.hash = safeTab;
    }

    if (safeTab === 'chat') {
        updateChatOrderContextUI();
        rolarChatParaBaixo();
    }
}

function applyTabFromHash() {
    const hashTab = String(window.location.hash || '').replace(/^#/, '');
    if (['pedidos', 'favoritos', 'dados', 'chat'].includes(hashTab)) {
        activateAccountTab(hashTab);
    }
}

window.switchTab = (tab) => {
    const trigger = typeof event !== 'undefined' ? event : null;
    activateAccountTab(tab, trigger);
}

window.abrirPedidoNaConta = (orderId) => {
    selectAccountOrder(orderId, { updateLocation: true, switchToTab: true });
};

window.iniciarSuportePedido = (orderId) => {
    activeChatOrderId = sanitizePlainText(orderId, 120);
    activeChatThreadId = activeChatOrderId ? `pedido:${activeChatOrderId}` : 'geral';
    updateChatOrderContextUI();
    renderChatThreadList();
    activateAccountTab('chat');
    rolarChatParaBaixo();
};

window.selecionarThreadChat = (threadId, orderId = '') => {
    activeChatThreadId = sanitizePlainText(threadId, 120) || 'geral';
    activeChatOrderId = sanitizePlainText(orderId, 120);
    updateChatOrderContextUI();
    renderChatThreadList();
    renderizarMensagensAtuais();
};

window.addEventListener('hashchange', applyTabFromHash);

// --- PEDIDOS (ATUALIZADO) ---
function carregarMeusPedidosLegacy() {
    const list = document.getElementById('orders-list');
    if(!list || !currentUser) return;
    
    db.collection('pedidos')
        .where('userId', '==', currentUser.uid)
        .onSnapshot(snap => {
            list.innerHTML = '';
            const pedidosOrdenados = [...snap.docs].sort((leftDoc, rightDoc) => {
                const leftData = leftDoc.data()?.data;
                const rightData = rightDoc.data()?.data;
                const leftTime = typeof leftData?.toDate === 'function'
                    ? leftData.toDate().getTime()
                    : (typeof leftData?.seconds === 'number' ? leftData.seconds * 1000 : 0);
                const rightTime = typeof rightData?.toDate === 'function'
                    ? rightData.toDate().getTime()
                    : (typeof rightData?.seconds === 'number' ? rightData.seconds * 1000 : 0);
                return rightTime - leftTime;
            });
            
            // MUDANÇA AQUI: Mensagem personalizada quando não há pedidos
            if(pedidosOrdenados.length === 0) { 
                list.innerHTML = `
                    <div class="text-center py-12">
                        <i class="fa-solid fa-bag-shopping text-4xl text-gray-300 mb-4"></i>
                        <p class="text-gray-600 mb-4">Você ainda não realizou nenhum pedido.</p>
                        <a href="index.html" class="inline-block text-[#643f21] font-medium border-b border-[#643f21] pb-0.5 hover:text-[#A58A5C] hover:border-[#A58A5C] transition-colors">
                            Que tal dar uma olhada em nossos produtos?
                        </a>
                    </div>
                `;
                return; 
            }
            
            pedidosOrdenados.forEach(doc => {
                const p = doc.data();
                const valorTotal = typeof p.total === 'number' ? p.total : 0;
                const totalFormatado = valorTotal.toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
                
                let dataPedido = 'Data desconhecida';
                if(p.data && p.data.seconds) {
                    dataPedido = new Date(p.data.seconds*1000).toLocaleDateString('pt-BR');
                }

                let itensHtml = (p.produtos || []).map(i => `
                    <div class="flex justify-between text-xs text-gray-500 mt-1 border-b border-gray-50 pb-1 last:border-0">
                        <span>${i.quantity}x ${i.nome} - <span class="text-[10px] bg-gray-100 px-1 rounded">${i.tamanho || 'U'}</span></span>
                        <span>${(i.preco * i.quantity).toLocaleString('pt-BR', {style:'currency', currency:'BRL'})}</span>
                    </div>
                `).join('');

                list.innerHTML += `
                    <div class="bg-white border border-gray-100 p-5 rounded-lg shadow-sm hover:shadow-md transition">
                        <div class="flex justify-between mb-3 border-b border-gray-50 pb-2">
                            <div>
                                <span class="font-bold text-gray-800">#${doc.id.slice(0,6).toUpperCase()}</span>
                                <span class="text-xs text-gray-400 block">${dataPedido}</span>
                            </div>
                            <span class="text-xs px-3 py-1 rounded-full uppercase tracking-wider font-bold ${getStatusClass(p.status)} h-fit flex items-center">${p.status}</span>
                        </div>
                        <div class="mb-3 space-y-1">${itensHtml}</div>
                        <div class="text-right">
                            <span class="text-xs text-gray-400 mr-2">Total</span>
                            <span class="font-serif text-lg text-[#643f21] font-bold">${totalFormatado}</span>
                        </div>
                    </div>
                `;
            });
        });
}

function getStatusClass(status) {
    if(status === 'pago') return 'text-emerald-700 bg-emerald-50';
    if(status === 'entregue') return 'text-green-600 bg-green-50';
    if(status === 'cancelado') return 'text-red-600 bg-red-50';
    if(status === 'enviado') return 'text-blue-600 bg-blue-50';
    return 'text-yellow-600 bg-yellow-50';
}

function carregarMeusPedidos() {
    const list = document.getElementById('orders-list');
    if (!list || !currentUser) return;

    if (unsubscribeOrders) {
        unsubscribeOrders();
        unsubscribeOrders = null;
    }

    unsubscribeOrders = db.collection('pedidos')
        .where('userId', '==', currentUser.uid)
        .onSnapshot((snap) => {
            list.innerHTML = '';
            ordersCache = [...snap.docs]
                .map((doc) => ({ id: doc.id, data: doc.data() || {} }))
                .sort((leftItem, rightItem) => {
                    const leftData = leftItem.data?.data;
                    const rightData = rightItem.data?.data;
                    const leftTime = typeof leftData?.toDate === 'function'
                        ? leftData.toDate().getTime()
                        : (typeof leftData?.seconds === 'number' ? leftData.seconds * 1000 : 0);
                    const rightTime = typeof rightData?.toDate === 'function'
                        ? rightData.toDate().getTime()
                        : (typeof rightData?.seconds === 'number' ? rightData.seconds * 1000 : 0);
                    return rightTime - leftTime;
                });

            updateAccountStat('account-stat-orders', ordersCache.length);

            if (ordersCache.length === 0) {
                selectedOrderId = '';
                renderSelectedOrderDetail();
                list.innerHTML = `
                    <div class="text-center py-12">
                        <i class="fa-solid fa-bag-shopping text-4xl text-gray-300 mb-4"></i>
                        <p class="text-gray-600 mb-4">Voce ainda nao realizou nenhum pedido.</p>
                        <a href="index.html" class="inline-block text-[#643f21] font-medium border-b border-[#643f21] pb-0.5 hover:text-[#A58A5C] hover:border-[#A58A5C] transition-colors">
                            Que tal dar uma olhada em nossos produtos?
                        </a>
                    </div>
                `;
                return;
            }

            list.innerHTML = ordersCache.map((entry) => {
                const pedido = entry.data || {};
                const valorTotal = Number(pedido.total || 0);
                const totalFormatado = valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                const dataPedido = formatOrderDate(pedido.data);
                const previewItens = (pedido.produtos || []).slice(0, 3).map((item) => `
                    <div class="account-order-line">
                        <span>${Number(item.quantity || 0)}x ${sanitizePlainText(item.nome, 120)}</span>
                        <span>${Number((item.preco || 0) * (item.quantity || 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                    </div>
                `).join('');

                return `
                    <article class="account-order-card ${entry.id === selectedOrderId ? 'is-selected' : ''}" data-order-id="${entry.id}" onclick="abrirPedidoNaConta('${entry.id}')">
                        <div class="account-order-card-header">
                            <div>
                                <div class="account-order-code">${getOrderCode(entry.id)}</div>
                                <div class="account-order-date">${dataPedido}</div>
                            </div>
                            <span class="account-order-status ${getOrderDisplayStatusClass(pedido)}">${getOrderDisplayStatus(pedido)}</span>
                        </div>
                        <div class="account-order-lines">${previewItens}</div>
                        <div class="account-order-card-footer">
                            <div>
                                <span class="text-[0.68rem] uppercase tracking-[0.18em] text-[#a49382] font-bold">Total</span>
                                <div class="account-order-total">${totalFormatado}</div>
                            </div>
                            <button type="button" class="account-soft-btn" onclick="event.stopPropagation(); iniciarSuportePedido('${entry.id}')">
                                <i class="fa-regular fa-comments"></i>
                                Suporte
                            </button>
                        </div>
                    </article>
                `;
            }).join('');

            const requestedOrderId = getRequestedOrderId();
            const fallbackOrderId = ordersCache[0]?.id || '';
            const preferredOrderId = ordersCache.some((item) => item.id === requestedOrderId)
                ? requestedOrderId
                : (ordersCache.some((item) => item.id === selectedOrderId) ? selectedOrderId : fallbackOrderId);

            if (preferredOrderId) {
                selectAccountOrder(preferredOrderId, { updateLocation: true });
                if (window.location.hash === '#chat' && (!activeChatOrderId || activeChatOrderId === preferredOrderId)) {
                    activeChatOrderId = preferredOrderId;
                    activeChatThreadId = `pedido:${preferredOrderId}`;
                    updateChatOrderContextUI();
                    renderChatThreadList();
                }
            }
        }, (error) => {
            console.error('Erro ao carregar pedidos:', error);
            ordersCache = [];
            selectedOrderId = '';
            updateAccountStat('account-stat-orders', 0);
            renderSelectedOrderDetail();
            list.innerHTML = '<p class="text-center text-red-400 py-8">Nao foi possivel carregar seus pedidos agora.</p>';
        });
}

// --- FAVORITOS ---
async function carregarFavoritos() {
    const grid = document.getElementById('favorites-grid');
    if (!grid || !currentUser) return;

    try {
        const userDoc = await db.collection('usuarios').doc(currentUser.uid).get();
        const favoritosIds = userDoc.data()?.favoritos || [];
        updateAccountStat('account-stat-favorites', favoritosIds.length);

        if (favoritosIds.length === 0) {
            grid.innerHTML = '<div class="col-span-full text-center py-10"><i class="fa-regular fa-heart text-4xl text-gray-200 mb-3"></i><p class="text-gray-400">Sua lista de desejos está vazia.</p></div>';
            return;
        }

        grid.innerHTML = '<p class="col-span-full text-center text-sm text-gray-400">Carregando...</p>';
        
        const promises = favoritosIds.map(id => db.collection('pecas').doc(id).get());
        const snapshots = await Promise.all(promises);
        
        grid.replaceChildren();
        let itemsFound = 0;

        snapshots.forEach((doc) => {
            if (!doc.exists) return;

            itemsFound++;
            const p = doc.data() || {};
            const imageUrl = normalizeImageUrl((p.imagens && p.imagens[0]) ? p.imagens[0] : '');
            const preco = parseFloat(p.preco || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'bg-white border border-[#eadfce] rounded-[22px] overflow-hidden shadow-sm hover:shadow-md transition cursor-pointer group text-left';
            card.addEventListener('click', () => {
                window.location.href = `index.html#/produto/${encodeURIComponent(doc.id)}`;
            });

            const imageWrap = document.createElement('div');
            imageWrap.className = 'aspect-[3/4] relative bg-gray-50';

            const image = document.createElement('img');
            image.src = imageUrl || 'https://placehold.co/600x800/eee/ccc?text=Sem+imagem';
            image.className = 'w-full h-full object-cover group-hover:scale-105 transition duration-500';
            image.alt = sanitizePlainText(p.nome, 120) || 'Peca favorita';
            image.loading = 'lazy';
            image.decoding = 'async';
            imageWrap.appendChild(image);

            const info = document.createElement('div');
            info.className = 'p-4 text-center';

            const title = document.createElement('h4');
            title.className = 'text-sm font-medium text-gray-800 truncate';
            title.textContent = sanitizePlainText(p.nome, 120) || 'Peca favorita';

            const price = document.createElement('p');
            price.className = 'text-xs text-[#643f21] font-bold mt-1';
            price.textContent = preco;

            info.appendChild(title);
            info.appendChild(price);
            card.appendChild(imageWrap);
            card.appendChild(info);
            grid.appendChild(card);
        });

        if (itemsFound === 0) {
            grid.innerHTML = '<p class="col-span-full text-center text-gray-400">Produtos não encontrados.</p>';
        }

    } catch (e) {
        console.error("Erro ao carregar favoritos:", e);
        updateAccountStat('account-stat-favorites', 0);
        grid.innerHTML = '<p class="col-span-full text-center text-red-400">Erro ao carregar.</p>';
    }
}

// --- CHAT ---
function renderizarMensagensAtuais() {
    const div = document.getElementById('chat-messages');
    if (!div) return;

    div.replaceChildren();
    const mensagens = getFilteredChatMessages();

    if (!mensagens.length) {
        const empty = document.createElement('div');
        empty.className = 'text-center text-sm text-gray-500 py-12';
        empty.textContent = activeChatThreadId === 'geral'
            ? 'Nenhuma mensagem ainda nesta conversa.'
            : 'Nenhuma mensagem ainda neste pedido.';
        div.appendChild(empty);
        return;
    }

    mensagens.forEach((msg) => {
        const cls = msg.sender === 'user' ? 'msg-user' : 'msg-admin';
        const bubble = document.createElement('div');
        bubble.className = `mb-2 text-sm ${cls} break-words shadow-sm`;
        bubble.textContent = sanitizePlainText(msg.text, 1000);
        div.appendChild(bubble);
    });

    rolarChatParaBaixo();
}

function iniciarChat() {
    if (!currentUser) return;
    const chatId = currentUser.uid;
    const div = document.getElementById('chat-messages');
    if(!div) return;

    updateChatOrderContextUI();

    if (unsubscribeChat) unsubscribeChat();
    unsubscribeChat = db.collection('chats').doc(chatId).collection('messages').orderBy('timestamp')
        .onSnapshot(snap => {
            currentChatMessages = snap.docs.map((doc) => doc.data() || {});
            renderChatThreadList();
            renderizarMensagensAtuais();
        });

    const form = document.getElementById('chat-form');
    const clearContextBtn = document.getElementById('clear-chat-order-context');
    if (clearContextBtn) {
        clearContextBtn.onclick = () => {
            activeChatOrderId = '';
            activeChatThreadId = 'geral';
            updateChatOrderContextUI();
            renderChatThreadList();
            renderizarMensagensAtuais();
        };
    }

    const newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);
    
    newForm.onsubmit = async (e) => {
        e.preventDefault();
        const inp = document.getElementById('message-input');
        const text = sanitizePlainText(inp.value, 1000);
        if(!text) return;
        inp.disabled = true;

        try {
            await sendChatMessageToBackend({
                chatId,
                text,
                threadId: activeChatThreadId || 'geral',
                orderId: activeChatOrderId || ''
            });
            inp.value = '';
        } catch (error) {
            console.error('[chat.user.send]', error);
            alert(sanitizePlainText(error?.message || 'Nao foi possivel enviar sua mensagem agora.', 220));
        } finally {
            inp.disabled = false;
            inp.focus();
        }
    }
}

function rolarChatParaBaixo() {
    const d = document.getElementById('chat-messages');
    if(d) setTimeout(() => d.scrollTop = d.scrollHeight, 100);
}
