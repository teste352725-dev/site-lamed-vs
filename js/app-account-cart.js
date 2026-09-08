const ACCOUNT_CART_STORAGE_KEY = 'lamedCart';
const ACCOUNT_CART_OWNER_KEY = 'lamed_cart_owner';
let cartHydrationPromise = null;
let cartRemoteSyncPromise = Promise.resolve();

function buildCartSyncItems() {
    return (Array.isArray(cart) ? cart : [])
        .map((item) => typeof sanitizeCartItem === 'function' ? sanitizeCartItem(item) : item)
        .filter(Boolean);
}

function saveCartLocally(items = cart) {
    try {
        localStorage.setItem(ACCOUNT_CART_STORAGE_KEY, JSON.stringify(items));
    } catch (error) {}
}

function setLocalCartOwner(value) {
    try {
        localStorage.setItem(ACCOUNT_CART_OWNER_KEY, String(value || 'guest'));
    } catch (error) {}
}

function getLocalCartOwner() {
    try {
        return String(localStorage.getItem(ACCOUNT_CART_OWNER_KEY) || 'guest');
    } catch (error) {
        return 'guest';
    }
}

function refreshCartUiAfterSync() {
    if (typeof updateCartUI === 'function') updateCartUI();
    if (typeof renderShippingOptions === 'function') renderShippingOptions();
    if (typeof updateCheckoutSummary === 'function') updateCheckoutSummary();
}

function mergeAccountCartItems(localItems, remoteItems) {
    const merged = new Map();

    (Array.isArray(remoteItems) ? remoteItems : []).forEach((item) => {
        const safe = typeof sanitizeCartItem === 'function' ? sanitizeCartItem(item) : item;
        if (!safe?.cartId) return;
        merged.set(safe.cartId, safe);
    });

    (Array.isArray(localItems) ? localItems : []).forEach((item) => {
        const safe = typeof sanitizeCartItem === 'function' ? sanitizeCartItem(item) : item;
        if (!safe?.cartId) return;
        merged.set(safe.cartId, safe);
    });

    return [...merged.values()];
}

async function fetchAccountCart(user) {
    if (!user) return [];
    const idToken = await user.getIdToken();
    const response = await fetch(buildBackendUrl('/api/cart/get'), {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${idToken}`
        }
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) {
        throw new Error(sanitizePlainText(payload?.error || 'Nao foi possivel carregar o carrinho da conta.', 220));
    }

    return Array.isArray(payload?.items) ? payload.items : [];
}

async function syncAccountCart(user, items, mode = 'replace') {
    if (!user) return [];
    const idToken = await user.getIdToken();
    const response = await fetch(buildBackendUrl('/api/cart/sync'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
            mode,
            items
        })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) {
        throw new Error(sanitizePlainText(payload?.error || 'Nao foi possivel sincronizar o carrinho da conta.', 220));
    }

    return Array.isArray(payload?.items) ? payload.items : [];
}

window.persistAccountCartState = async function({ mode = 'replace' } = {}) {
    const items = buildCartSyncItems();
    cart = items;
    saveCartLocally(items);
    refreshCartUiAfterSync();

    const user = currentUser || auth.currentUser;
    if (!user) {
        setLocalCartOwner('guest');
        return items;
    }

    setLocalCartOwner(user.uid);

    cartRemoteSyncPromise = cartRemoteSyncPromise
        .catch(() => [])
        .then(async () => {
            const synced = await syncAccountCart(user, items, mode);
            cart = mergeAccountCartItems(items, synced);
            saveCartLocally(cart);
            refreshCartUiAfterSync();
            return cart;
        })
        .catch((error) => {
            console.error('[cart.sync]', error);
            refreshCartUiAfterSync();
            return items;
        });

    return cartRemoteSyncPromise;
};

window.hydrateAccountCartState = async function(user) {
    if (cartHydrationPromise) {
        return cartHydrationPromise;
    }

    cartHydrationPromise = (async () => {
        const localItems = buildCartSyncItems();

        if (!user) {
            cart = localItems;
            saveCartLocally(cart);
            setLocalCartOwner('guest');
            refreshCartUiAfterSync();
            return cart;
        }

        try {
            const remoteItems = await fetchAccountCart(user);
            const previousOwner = getLocalCartOwner();
            const canMergeLocal = previousOwner === 'guest' || previousOwner === user.uid;
            const mergedItems = canMergeLocal
                ? mergeAccountCartItems(localItems, remoteItems)
                : mergeAccountCartItems([], remoteItems);
            cart = mergedItems;
            saveCartLocally(mergedItems);
            setLocalCartOwner(user.uid);
            refreshCartUiAfterSync();
            await syncAccountCart(user, mergedItems, 'replace');
            return mergedItems;
        } catch (error) {
            console.error('[cart.hydrate]', error);
            cart = localItems;
            saveCartLocally(localItems);
            setLocalCartOwner(user.uid);
            refreshCartUiAfterSync();
            return localItems;
        } finally {
            cartHydrationPromise = null;
        }
    })();

    return cartHydrationPromise;
};

window.clearAccountCartState = async function() {
    cart = [];
    saveCartLocally([]);
    setLocalCartOwner(currentUser?.uid || auth.currentUser?.uid || 'guest');
    refreshCartUiAfterSync();

    const user = currentUser || auth.currentUser;
    if (!user) return [];

    try {
        await syncAccountCart(user, [], 'replace');
    } catch (error) {
        console.error('[cart.clear]', error);
    }

    return [];
};

// Mantem a vitrine sincronizada com alteracoes administrativas de preco/desconto.
let storefrontProductsRealtimeUnsubscribe = null;
let storefrontProductsRealtimeStarted = false;

function buildStorefrontProductsSignature(items) {
    return (Array.isArray(items) ? items : [])
        .map((item) => [
            item?.id || '',
            Number(item?.preco || 0),
            Number(item?.desconto || 0),
            String(item?.status || ''),
            Number(item?.ordem || 0),
            String(item?.categoria || ''),
            String(item?.colecaoId || '')
        ].join('|'))
        .sort()
        .join('::');
}

function refreshVisibleStorefrontAfterProductsSync() {
    if (typeof renderSidebarCategoryLinks === 'function') renderSidebarCategoryLinks();
    if (typeof renderHomeShopFilters === 'function') renderHomeShopFilters();
    if (typeof renderHomeShopGrid === 'function') renderHomeShopGrid();
    if (typeof renderizarSecoesColecoes === 'function') renderizarSecoesColecoes();
    if (typeof popularPreviewColecao === 'function') popularPreviewColecao();

    const hash = String(window.location.hash || '');
    if (hash === '#loja' && typeof renderShopPage === 'function') {
        renderShopPage(typeof currentShopFilter === 'string' ? currentShopFilter : 'all');
        return;
    }

    if (hash.startsWith('#/colecao/') && typeof renderizarGridColecao === 'function') {
        renderizarGridColecao(hash.split('/')[2]);
        return;
    }

    if (hash.startsWith('#/categoria/') && typeof renderShopPage === 'function') {
        renderShopPage(hash.split('/')[2]);
        return;
    }

    if (hash.startsWith('#/produto/')) {
        const productId = hash.split('/')[2];
        const syncedProduct = Array.isArray(products)
            ? products.find((item) => item.id === productId)
            : null;

        if (syncedProduct) {
            currentProduct = syncedProduct;
            const priceElement = document.getElementById('detail-price');
            if (priceElement && typeof formatarReal === 'function') {
                const discountedPrice = Number(syncedProduct.preco || 0) * (1 - Number(syncedProduct.desconto || 0) / 100);
                priceElement.innerHTML = `
                    <span class="text-3xl font-light text-[--cor-marrom-cta]">${formatarReal(discountedPrice)}</span>
                    ${Number(syncedProduct.desconto || 0) > 0 ? `<span class="ml-2 text-lg text-gray-400 line-through">${formatarReal(syncedProduct.preco)}</span>` : ''}
                `;
            }
        }
    }
}

function startStorefrontProductsRealtimeSync() {
    if (storefrontProductsRealtimeStarted) return;
    if (typeof db === 'undefined' || typeof products === 'undefined' || !db?.collection) return;

    storefrontProductsRealtimeStarted = true;
    let previousSignature = buildStorefrontProductsSignature(products);

    storefrontProductsRealtimeUnsubscribe = db.collection('pecas').onSnapshot((snapshot) => {
        const nextProducts = snapshot.docs
            .map((document) => ({
                id: document.id,
                ...document.data(),
                preco: parseFloat(document.data()?.preco || 0),
                desconto: Number(document.data()?.desconto || 0)
            }))
            .filter((product) => String(product?.status || '').trim().toLowerCase() !== 'inactive');

        const nextSignature = buildStorefrontProductsSignature(nextProducts);
        if (nextSignature === previousSignature) return;

        previousSignature = nextSignature;
        products = nextProducts;
        refreshVisibleStorefrontAfterProductsSync();
        console.info('[storefront.sync] Catalogo atualizado em tempo real.');
    }, (error) => {
        storefrontProductsRealtimeStarted = false;
        storefrontProductsRealtimeUnsubscribe = null;
        console.warn('[storefront.sync] Nao foi possivel acompanhar alteracoes do catalogo.', error);
    });
}

// O checkout nao concede mais desconto adicional por forma de pagamento.
// O desconto promocional do catalogo continua sendo respeitado normalmente.
if (typeof calculateCheckoutTotals === 'function') {
    const calculateCheckoutTotalsWithLegacyPaymentRules = calculateCheckoutTotals;
    calculateCheckoutTotals = function(...args) {
        const totals = calculateCheckoutTotalsWithLegacyPaymentRules(...args);
        const legacyPixDiscount = Number(totals?.pixDiscount || 0);

        if (legacyPixDiscount <= 0) return totals;

        return {
            ...totals,
            pixDiscount: 0,
            final: typeof roundCurrency === 'function'
                ? roundCurrency(Number(totals.final || 0) + legacyPixDiscount)
                : Number(totals.final || 0) + legacyPixDiscount
        };
    };
}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof checkoutRuntimeConfig !== 'undefined') {
        checkoutRuntimeConfig.pixProductDiscountEnabled = false;
    }
    window.setTimeout(startStorefrontProductsRealtimeSync, 0);
});
