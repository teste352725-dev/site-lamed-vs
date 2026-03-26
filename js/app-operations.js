const STORE_OPERATIONS_COLLECTION = 'site_config';
const STORE_OPERATIONS_DOC_ID = 'store_operations';

let storeOperationsState = getDefaultStoreOperationsState();
let unsubscribeStoreOperations = null;
let storeOperationsModalBound = false;
let operationsCollectionsCache = [];

const storeOperationsElements = {
    openFabBtn: document.getElementById('admin-open-operations-editor'),
    modal: document.getElementById('store-operations-modal'),
    closeBtn: document.getElementById('close-store-operations-modal'),
    cancelBtn: document.getElementById('cancel-store-operations'),
    saveBtn: document.getElementById('save-store-operations'),
    runNowBtn: document.getElementById('run-store-operations-now'),
    form: document.getElementById('store-operations-form'),
    publicStoreEnabled: document.getElementById('store-operations-public-enabled'),
    maintenanceMode: document.getElementById('store-operations-maintenance-mode'),
    maintenanceTitle: document.getElementById('store-operations-maintenance-title'),
    maintenanceBody: document.getElementById('store-operations-maintenance-body'),
    closedTitle: document.getElementById('store-operations-closed-title'),
    closedBody: document.getElementById('store-operations-closed-body'),
    notifyOrderStatus: document.getElementById('store-operations-notify-order-status'),
    notifyChatReply: document.getElementById('store-operations-notify-chat-reply'),
    notifyFavoritePromotion: document.getElementById('store-operations-notify-favorite-promotion'),
    notifyPurchasePromotion: document.getElementById('store-operations-notify-purchase-promotion'),
    notifyFavoriteLowStock: document.getElementById('store-operations-notify-favorite-low-stock'),
    notifyCollectionLaunch: document.getElementById('store-operations-notify-collection-launch'),
    lowStockThreshold: document.getElementById('store-operations-low-stock-threshold'),
    discountSchedules: document.getElementById('store-operations-discount-schedules'),
    addDiscountScheduleBtn: document.getElementById('store-operations-add-discount-schedule'),
    collectionSchedules: document.getElementById('store-operations-collection-schedules'),
    addCollectionScheduleBtn: document.getElementById('store-operations-add-collection-schedule'),
    storeStatusPage: document.getElementById('page-store-status'),
    storeStatusTitle: document.getElementById('store-status-title'),
    storeStatusBody: document.getElementById('store-status-body'),
    storeStatusTag: document.getElementById('store-status-tag'),
    storeStatusHomeLink: document.getElementById('store-status-home-link')
};

function getDefaultStoreOperationsState() {
    return {
        publicStoreEnabled: true,
        maintenanceMode: false,
        maintenanceTitle: 'Estamos ajustando a loja',
        maintenanceBody: 'Voltamos em instantes com a vitrine pronta para receber seu pedido.',
        closedTitle: 'Loja temporariamente fechada',
        closedBody: 'Estamos preparando novidades e em breve a loja volta ao ar.',
        notificationRules: {
            orderStatus: true,
            chatReply: true,
            favoritePromotion: true,
            purchasePromotion: true,
            favoriteLowStock: false,
            collectionLaunch: true,
            lowStockThreshold: 3
        },
        discountSchedules: [],
        collectionSchedules: []
    };
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return fallback;
}

function normalizeIsoDateTime(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function formatDateTimeLocalInput(value) {
    const parsed = normalizeIsoDateTime(value);
    if (!parsed) return '';
    return parsed.slice(0, 16);
}

function normalizeStoreOperationsState(rawValue) {
    const defaults = getDefaultStoreOperationsState();
    const raw = rawValue && typeof rawValue === 'object' ? rawValue : {};
    const notificationRules = raw.notificationRules && typeof raw.notificationRules === 'object' ? raw.notificationRules : {};

    return {
        publicStoreEnabled: normalizeBoolean(raw.publicStoreEnabled, defaults.publicStoreEnabled),
        maintenanceMode: normalizeBoolean(raw.maintenanceMode, defaults.maintenanceMode),
        maintenanceTitle: sanitizePlainText(raw.maintenanceTitle || defaults.maintenanceTitle, 120) || defaults.maintenanceTitle,
        maintenanceBody: sanitizePlainText(raw.maintenanceBody || defaults.maintenanceBody, 400) || defaults.maintenanceBody,
        closedTitle: sanitizePlainText(raw.closedTitle || defaults.closedTitle, 120) || defaults.closedTitle,
        closedBody: sanitizePlainText(raw.closedBody || defaults.closedBody, 400) || defaults.closedBody,
        notificationRules: {
            orderStatus: normalizeBoolean(notificationRules.orderStatus, defaults.notificationRules.orderStatus),
            chatReply: normalizeBoolean(notificationRules.chatReply, defaults.notificationRules.chatReply),
            favoritePromotion: normalizeBoolean(notificationRules.favoritePromotion, defaults.notificationRules.favoritePromotion),
            purchasePromotion: normalizeBoolean(notificationRules.purchasePromotion, defaults.notificationRules.purchasePromotion),
            favoriteLowStock: normalizeBoolean(notificationRules.favoriteLowStock, defaults.notificationRules.favoriteLowStock),
            collectionLaunch: normalizeBoolean(notificationRules.collectionLaunch, defaults.notificationRules.collectionLaunch),
            lowStockThreshold: Math.max(1, Math.min(50, parseInt(notificationRules.lowStockThreshold, 10) || defaults.notificationRules.lowStockThreshold))
        },
        discountSchedules: (Array.isArray(raw.discountSchedules) ? raw.discountSchedules : []).map((entry, index) => ({
            id: sanitizePlainText(entry?.id, 120) || `discount-${index + 1}`,
            label: sanitizePlainText(entry?.label, 120) || `Remover descontos ${index + 1}`,
            runAt: normalizeIsoDateTime(entry?.runAt || entry?.at),
            enabled: normalizeBoolean(entry?.enabled, true),
            lastRunAt: normalizeIsoDateTime(entry?.lastRunAt)
        })).filter((entry) => entry.runAt),
        collectionSchedules: (Array.isArray(raw.collectionSchedules) ? raw.collectionSchedules : []).map((entry, index) => ({
            id: sanitizePlainText(entry?.id, 120) || `collection-${index + 1}`,
            label: sanitizePlainText(entry?.label, 120) || `Colecao ${index + 1}`,
            collectionId: sanitizePlainText(entry?.collectionId, 120),
            startAt: normalizeIsoDateTime(entry?.startAt),
            endAt: normalizeIsoDateTime(entry?.endAt),
            enabled: normalizeBoolean(entry?.enabled, true),
            lastStartRunAt: normalizeIsoDateTime(entry?.lastStartRunAt),
            lastEndRunAt: normalizeIsoDateTime(entry?.lastEndRunAt)
        })).filter((entry) => entry.collectionId && (entry.startAt || entry.endAt))
    };
}

function isStorefrontBlockedForPublic() {
    return !currentUserIsAdmin && (storeOperationsState.maintenanceMode || storeOperationsState.publicStoreEnabled === false);
}

function applyStoreOperationsPublicState() {
    const blocked = isStorefrontBlockedForPublic();

    if (storeOperationsElements.storeStatusTag) {
        storeOperationsElements.storeStatusTag.textContent = storeOperationsState.maintenanceMode ? 'Manutencao' : 'Loja fechada';
    }

    if (storeOperationsElements.storeStatusTitle) {
        storeOperationsElements.storeStatusTitle.textContent = storeOperationsState.maintenanceMode
            ? storeOperationsState.maintenanceTitle
            : storeOperationsState.closedTitle;
    }

    if (storeOperationsElements.storeStatusBody) {
        storeOperationsElements.storeStatusBody.textContent = storeOperationsState.maintenanceMode
            ? storeOperationsState.maintenanceBody
            : storeOperationsState.closedBody;
    }

    document.body.classList.toggle('storefront-blocked', blocked);

    if (typeof handleRouting === 'function') {
        handleRouting();
    }
}

window.shouldShowStoreStatusPage = function() {
    return isStorefrontBlockedForPublic();
};

window.isStorefrontOrderingBlocked = function() {
    return isStorefrontBlockedForPublic();
};

window.getStoreOperationsState = function() {
    return storeOperationsState;
};

function createScheduleButton(label, onClick, variant = 'secondary') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = variant === 'danger'
        ? 'rounded-full border border-red-200 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-red-600'
        : 'rounded-full border border-[#D8C9B6] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#6B5139]';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
}

function renderDiscountSchedules() {
    const container = storeOperationsElements.discountSchedules;
    if (!container) return;
    container.replaceChildren();

    if (!storeOperationsState.discountSchedules.length) {
        const empty = document.createElement('p');
        empty.className = 'text-sm text-gray-400';
        empty.textContent = 'Nenhum horario programado para remover descontos.';
        container.appendChild(empty);
        return;
    }

    storeOperationsState.discountSchedules.forEach((entry, index) => {
        const card = document.createElement('div');
        card.className = 'rounded-2xl border border-[#E5E0D8] bg-white p-4 space-y-3';
        card.dataset.scheduleId = entry.id;
        card.innerHTML = `
            <div class="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
                <label class="space-y-2">
                    <span class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#9C8564]">Etiqueta</span>
                    <input type="text" class="ops-discount-label w-full rounded-2xl border border-[#E5E0D8] px-4 py-3 text-sm" value="${entry.label}">
                </label>
                <label class="space-y-2">
                    <span class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#9C8564]">Executar em</span>
                    <input type="datetime-local" class="ops-discount-run-at w-full rounded-2xl border border-[#E5E0D8] px-4 py-3 text-sm" value="${formatDateTimeLocalInput(entry.runAt)}">
                </label>
                <label class="flex items-center gap-2 rounded-2xl border border-[#EFE5D8] px-4 py-3 text-sm text-gray-600">
                    <input type="checkbox" class="ops-discount-enabled" ${entry.enabled ? 'checked' : ''}>
                    Ativo
                </label>
            </div>
        `;

        const actions = document.createElement('div');
        actions.className = 'flex justify-end';
        actions.appendChild(createScheduleButton('Remover', () => {
            storeOperationsState.discountSchedules.splice(index, 1);
            renderDiscountSchedules();
        }, 'danger'));
        card.appendChild(actions);

        container.appendChild(card);
    });
}

function buildCollectionOptions(selectedId = '') {
    const entries = operationsCollectionsCache.length
        ? operationsCollectionsCache
        : (Array.isArray(activeCollections) ? activeCollections : []);
    const options = [
        '<option value="">Selecione uma colecao</option>',
        ...entries.map((entry) => {
            const id = sanitizePlainText(entry?.id, 120);
            const label = sanitizePlainText(entry?.nome, 120) || 'Colecao';
            return `<option value="${id}" ${id === selectedId ? 'selected' : ''}>${label}</option>`;
        })
    ];

    if (selectedId && !entries.some((entry) => sanitizePlainText(entry?.id, 120) === selectedId)) {
        options.push(`<option value="${selectedId}" selected>${selectedId}</option>`);
    }

    return options.join('');
}

function renderCollectionSchedules() {
    const container = storeOperationsElements.collectionSchedules;
    if (!container) return;
    container.replaceChildren();

    if (!storeOperationsState.collectionSchedules.length) {
        const empty = document.createElement('p');
        empty.className = 'text-sm text-gray-400';
        empty.textContent = 'Nenhuma colecao com janela programada.';
        container.appendChild(empty);
        return;
    }

    storeOperationsState.collectionSchedules.forEach((entry, index) => {
        const card = document.createElement('div');
        card.className = 'rounded-2xl border border-[#E5E0D8] bg-white p-4 space-y-3';
        card.dataset.scheduleId = entry.id;
        card.innerHTML = `
            <div class="grid gap-3 md:grid-cols-2">
                <label class="space-y-2">
                    <span class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#9C8564]">Etiqueta</span>
                    <input type="text" class="ops-collection-label w-full rounded-2xl border border-[#E5E0D8] px-4 py-3 text-sm" value="${entry.label}">
                </label>
                <label class="space-y-2">
                    <span class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#9C8564]">Colecao</span>
                    <select class="ops-collection-id w-full rounded-2xl border border-[#E5E0D8] px-4 py-3 text-sm">${buildCollectionOptions(entry.collectionId)}</select>
                </label>
                <label class="space-y-2">
                    <span class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#9C8564]">Abrir em</span>
                    <input type="datetime-local" class="ops-collection-start w-full rounded-2xl border border-[#E5E0D8] px-4 py-3 text-sm" value="${formatDateTimeLocalInput(entry.startAt)}">
                </label>
                <label class="space-y-2">
                    <span class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#9C8564]">Fechar em</span>
                    <input type="datetime-local" class="ops-collection-end w-full rounded-2xl border border-[#E5E0D8] px-4 py-3 text-sm" value="${formatDateTimeLocalInput(entry.endAt)}">
                </label>
            </div>
        `;

        const footer = document.createElement('div');
        footer.className = 'flex flex-wrap items-center justify-between gap-3';

        const enabledLabel = document.createElement('label');
        enabledLabel.className = 'flex items-center gap-2 rounded-2xl border border-[#EFE5D8] px-4 py-3 text-sm text-gray-600';
        enabledLabel.innerHTML = `<input type="checkbox" class="ops-collection-enabled" ${entry.enabled ? 'checked' : ''}> Ativo`;
        footer.appendChild(enabledLabel);

        footer.appendChild(createScheduleButton('Remover', () => {
            storeOperationsState.collectionSchedules.splice(index, 1);
            renderCollectionSchedules();
        }, 'danger'));

        card.appendChild(footer);
        container.appendChild(card);
    });
}

function fillStoreOperationsForm() {
    const current = normalizeStoreOperationsState(storeOperationsState);

    if (storeOperationsElements.publicStoreEnabled) storeOperationsElements.publicStoreEnabled.checked = current.publicStoreEnabled;
    if (storeOperationsElements.maintenanceMode) storeOperationsElements.maintenanceMode.checked = current.maintenanceMode;
    if (storeOperationsElements.maintenanceTitle) storeOperationsElements.maintenanceTitle.value = current.maintenanceTitle;
    if (storeOperationsElements.maintenanceBody) storeOperationsElements.maintenanceBody.value = current.maintenanceBody;
    if (storeOperationsElements.closedTitle) storeOperationsElements.closedTitle.value = current.closedTitle;
    if (storeOperationsElements.closedBody) storeOperationsElements.closedBody.value = current.closedBody;
    if (storeOperationsElements.notifyOrderStatus) storeOperationsElements.notifyOrderStatus.checked = current.notificationRules.orderStatus;
    if (storeOperationsElements.notifyChatReply) storeOperationsElements.notifyChatReply.checked = current.notificationRules.chatReply;
    if (storeOperationsElements.notifyFavoritePromotion) storeOperationsElements.notifyFavoritePromotion.checked = current.notificationRules.favoritePromotion;
    if (storeOperationsElements.notifyPurchasePromotion) storeOperationsElements.notifyPurchasePromotion.checked = current.notificationRules.purchasePromotion;
    if (storeOperationsElements.notifyFavoriteLowStock) storeOperationsElements.notifyFavoriteLowStock.checked = current.notificationRules.favoriteLowStock;
    if (storeOperationsElements.notifyCollectionLaunch) storeOperationsElements.notifyCollectionLaunch.checked = current.notificationRules.collectionLaunch;
    if (storeOperationsElements.lowStockThreshold) storeOperationsElements.lowStockThreshold.value = current.notificationRules.lowStockThreshold;

    renderDiscountSchedules();
    renderCollectionSchedules();
}

function readStoreOperationsForm() {
    const discountSchedules = Array.from(storeOperationsElements.discountSchedules?.querySelectorAll('[data-schedule-id]') || []).map((entry) => {
        const scheduleId = sanitizePlainText(entry.dataset.scheduleId, 120);
        const current = storeOperationsState.discountSchedules.find((item) => item.id === scheduleId);
        return {
            id: scheduleId,
            label: sanitizePlainText(entry.querySelector('.ops-discount-label')?.value, 120),
            runAt: normalizeIsoDateTime(entry.querySelector('.ops-discount-run-at')?.value),
            enabled: entry.querySelector('.ops-discount-enabled')?.checked === true,
            lastRunAt: current?.lastRunAt || ''
        };
    }).filter((entry) => entry.runAt);

    const collectionSchedules = Array.from(storeOperationsElements.collectionSchedules?.querySelectorAll('[data-schedule-id]') || []).map((entry) => {
        const scheduleId = sanitizePlainText(entry.dataset.scheduleId, 120);
        const current = storeOperationsState.collectionSchedules.find((item) => item.id === scheduleId);
        return {
            id: scheduleId,
            label: sanitizePlainText(entry.querySelector('.ops-collection-label')?.value, 120),
            collectionId: sanitizePlainText(entry.querySelector('.ops-collection-id')?.value, 120),
            startAt: normalizeIsoDateTime(entry.querySelector('.ops-collection-start')?.value),
            endAt: normalizeIsoDateTime(entry.querySelector('.ops-collection-end')?.value),
            enabled: entry.querySelector('.ops-collection-enabled')?.checked === true,
            lastStartRunAt: current?.lastStartRunAt || '',
            lastEndRunAt: current?.lastEndRunAt || ''
        };
    }).filter((entry) => entry.collectionId && (entry.startAt || entry.endAt));

    return normalizeStoreOperationsState({
        publicStoreEnabled: storeOperationsElements.publicStoreEnabled?.checked === true,
        maintenanceMode: storeOperationsElements.maintenanceMode?.checked === true,
        maintenanceTitle: storeOperationsElements.maintenanceTitle?.value,
        maintenanceBody: storeOperationsElements.maintenanceBody?.value,
        closedTitle: storeOperationsElements.closedTitle?.value,
        closedBody: storeOperationsElements.closedBody?.value,
        notificationRules: {
            orderStatus: storeOperationsElements.notifyOrderStatus?.checked === true,
            chatReply: storeOperationsElements.notifyChatReply?.checked === true,
            favoritePromotion: storeOperationsElements.notifyFavoritePromotion?.checked === true,
            purchasePromotion: storeOperationsElements.notifyPurchasePromotion?.checked === true,
            favoriteLowStock: storeOperationsElements.notifyFavoriteLowStock?.checked === true,
            collectionLaunch: storeOperationsElements.notifyCollectionLaunch?.checked === true,
            lowStockThreshold: parseInt(storeOperationsElements.lowStockThreshold?.value, 10) || 3
        },
        discountSchedules,
        collectionSchedules
    });
}

async function loadOperationsCollections() {
    if (!currentUserIsAdmin) return;

    try {
        const snapshot = await db.collection('colecoes').get();
        operationsCollectionsCache = snapshot.docs
            .filter((doc) => doc.id !== '__catalog_settings')
            .map((doc) => ({ id: doc.id, ...doc.data() }))
            .sort((left, right) => (Number(left?.ordem) || 0) - (Number(right?.ordem) || 0));
    } catch (error) {
        operationsCollectionsCache = Array.isArray(activeCollections) ? [...activeCollections] : [];
    }
}

async function openStoreOperationsModal() {
    if (!currentUserIsAdmin || !storeOperationsElements.modal) return;
    await loadOperationsCollections();
    fillStoreOperationsForm();
    storeOperationsElements.modal.classList.remove('hidden');
    storeOperationsElements.modal.classList.add('flex');
    if (typeof lockBodyScroll === 'function') lockBodyScroll('store-operations');
    if (typeof toggleAdminFabPanel === 'function') toggleAdminFabPanel(false);
}

function closeStoreOperationsModal() {
    if (!storeOperationsElements.modal) return;
    storeOperationsElements.modal.classList.add('hidden');
    storeOperationsElements.modal.classList.remove('flex');
    if (typeof unlockBodyScroll === 'function') unlockBodyScroll('store-operations');
}

window.openStoreOperationsEditor = openStoreOperationsModal;

async function saveStoreOperations() {
    if (!currentUser || !currentUserIsAdmin) return;

    try {
        if (storeOperationsElements.saveBtn) {
            storeOperationsElements.saveBtn.disabled = true;
            storeOperationsElements.saveBtn.textContent = 'Salvando...';
        }

        const nextState = readStoreOperationsForm();
        const idToken = await currentUser.getIdToken();
        const response = await fetch(buildBackendUrl('/api/admin/storefront/update'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Bearer ${idToken}`
            },
            body: JSON.stringify({
                action: 'store_operations_save',
                payload: nextState
            })
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.ok === false) {
            throw new Error(sanitizePlainText(payload?.error || 'Nao foi possivel salvar a operacao da loja.', 220));
        }

        storeOperationsState = normalizeStoreOperationsState(payload?.result?.operations || nextState);
        applyStoreOperationsPublicState();
        closeStoreOperationsModal();
    } catch (error) {
        alert(sanitizePlainText(error?.message || 'Nao foi possivel salvar agora.', 220));
    } finally {
        if (storeOperationsElements.saveBtn) {
            storeOperationsElements.saveBtn.disabled = false;
            storeOperationsElements.saveBtn.textContent = 'Salvar operacao';
        }
    }
}

async function runStoreAutomationNow() {
    if (!currentUser || !currentUserIsAdmin) return;

    try {
        if (storeOperationsElements.runNowBtn) {
            storeOperationsElements.runNowBtn.disabled = true;
            storeOperationsElements.runNowBtn.textContent = 'Executando...';
        }

        const idToken = await currentUser.getIdToken();
        const response = await fetch(buildBackendUrl('/api/automation/run'), {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${idToken}`
            }
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.ok === false) {
            throw new Error(sanitizePlainText(payload?.error || 'Nao foi possivel rodar a automacao agora.', 220));
        }

        alert('Automacao executada. Agenda, colecoes e notificacoes foram verificadas.');
    } catch (error) {
        alert(sanitizePlainText(error?.message || 'Nao foi possivel rodar a automacao.', 220));
    } finally {
        if (storeOperationsElements.runNowBtn) {
            storeOperationsElements.runNowBtn.disabled = false;
            storeOperationsElements.runNowBtn.textContent = 'Executar agora';
        }
    }
}

function bindStoreOperationsModal() {
    if (storeOperationsModalBound) return;
    storeOperationsModalBound = true;

    if (storeOperationsElements.openFabBtn) {
        storeOperationsElements.openFabBtn.addEventListener('click', openStoreOperationsModal);
    }

    if (storeOperationsElements.closeBtn) {
        storeOperationsElements.closeBtn.addEventListener('click', closeStoreOperationsModal);
    }

    if (storeOperationsElements.cancelBtn) {
        storeOperationsElements.cancelBtn.addEventListener('click', closeStoreOperationsModal);
    }

    if (storeOperationsElements.saveBtn) {
        storeOperationsElements.saveBtn.addEventListener('click', saveStoreOperations);
    }

    if (storeOperationsElements.runNowBtn) {
        storeOperationsElements.runNowBtn.addEventListener('click', runStoreAutomationNow);
    }

    if (storeOperationsElements.modal) {
        storeOperationsElements.modal.addEventListener('click', (event) => {
            if (event.target === storeOperationsElements.modal) {
                closeStoreOperationsModal();
            }
        });
    }

    if (storeOperationsElements.addDiscountScheduleBtn) {
        storeOperationsElements.addDiscountScheduleBtn.addEventListener('click', () => {
            storeOperationsState.discountSchedules.push({
                id: `discount-${Date.now()}`,
                label: `Remover descontos ${storeOperationsState.discountSchedules.length + 1}`,
                runAt: '',
                enabled: true
            });
            renderDiscountSchedules();
        });
    }

    if (storeOperationsElements.addCollectionScheduleBtn) {
        storeOperationsElements.addCollectionScheduleBtn.addEventListener('click', () => {
            storeOperationsState.collectionSchedules.push({
                id: `collection-${Date.now()}`,
                label: `Colecao ${storeOperationsState.collectionSchedules.length + 1}`,
                collectionId: '',
                startAt: '',
                endAt: '',
                enabled: true
            });
            renderCollectionSchedules();
        });
    }
}

function startStoreOperationsFeed() {
    bindStoreOperationsModal();

    if (unsubscribeStoreOperations) {
        unsubscribeStoreOperations();
        unsubscribeStoreOperations = null;
    }

    unsubscribeStoreOperations = db.collection(STORE_OPERATIONS_COLLECTION).doc(STORE_OPERATIONS_DOC_ID)
        .onSnapshot((snapshot) => {
            storeOperationsState = normalizeStoreOperationsState(snapshot.exists ? snapshot.data() : null);
            applyStoreOperationsPublicState();
        }, () => {
            storeOperationsState = getDefaultStoreOperationsState();
            applyStoreOperationsPublicState();
        });
}

document.addEventListener('DOMContentLoaded', startStoreOperationsFeed);
