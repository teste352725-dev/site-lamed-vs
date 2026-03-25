let shippingQuoteState = createEmptyShippingQuoteState();
let shippingQuoteDebounceTimer = null;
let shippingQuoteRequestToken = 0;
let orderSubmissionInFlight = false;
let checkoutPushConfigCache = null;
let checkoutPushToken = '';

function sanitizeCheckoutPhone(value) {
    return String(value ?? '')
        .replace(/[^\d+\-() ]/g, '')
        .trim()
        .slice(0, 30);
}

function getCheckoutAccountMode() {
    return document.querySelector('input[name="checkout-account-mode"]:checked')?.value || 'create';
}

function syncCheckoutAccountUI() {
    const authenticatedUser = currentUser || auth.currentUser;
    const guestCard = elements.checkoutGuestCard;
    const loggedInCard = elements.checkoutLoggedInCard;
    const passwordWrap = elements.checkoutAccountPasswordWrap;
    const copy = elements.checkoutAccountCopy;

    if (guestCard) guestCard.classList.toggle('hidden', !!authenticatedUser);
    if (loggedInCard) loggedInCard.classList.toggle('hidden', !authenticatedUser);

    if (authenticatedUser) {
        if (copy) {
            copy.textContent = 'Sua conta ja esta ativa. O pedido sera associado automaticamente ao seu painel.';
        }
        return;
    }

    const mode = getCheckoutAccountMode();
    if (passwordWrap) {
        passwordWrap.classList.toggle('hidden', mode === 'guest');
    }

    if (copy) {
        if (mode === 'login') {
            copy.textContent = 'Entre com a senha da sua conta para este pedido cair direto no seu historico.';
        } else if (mode === 'guest') {
            copy.textContent = 'Voce pode finalizar sem conta, mas perde o painel pessoal de acompanhamento.';
        } else {
            copy.textContent = 'Crie uma senha agora e este pedido ja nasce dentro da sua conta.';
        }
    }
}

async function ensureCheckoutUserProfileDoc(user, cliente) {
    if (!user) return;

    const ref = db.collection('usuarios').doc(user.uid);
    const snapshot = await ref.get();
    const existingData = snapshot.data() || {};

    await ref.set({
        nome: sanitizePlainText(existingData.nome || cliente?.nome || user.displayName || 'Cliente', 80),
        email: sanitizePlainText(existingData.email || user.email, 120),
        telefone: sanitizeCheckoutPhone(existingData.telefone || cliente?.telefone),
        endereco: existingData.endereco || cliente?.endereco || null,
        fotoUrl: sanitizePlainText(existingData.fotoUrl || user.photoURL, 500),
        createdAt: snapshot.exists ? (existingData.createdAt || null) : firebase.firestore.FieldValue.serverTimestamp(),
        favoritos: Array.isArray(existingData.favoritos) ? existingData.favoritos : []
    }, { merge: true });
}

async function populateCheckoutFormFromUser(user) {
    if (!user || !elements.checkoutForm) return;

    try {
        const doc = await db.collection('usuarios').doc(user.uid).get();
        if (doc.exists) {
            const data = doc.data() || {};
            const form = elements.checkoutForm;
            if (data.nome) form.nome.value = data.nome;
            if (data.email) form.email.value = data.email;
            if (data.telefone) form.telefone.value = data.telefone;
            if (data.endereco) {
                form.rua.value = data.endereco.rua || '';
                form.numero.value = data.endereco.numero || '';
                form.cep.value = formatPostalCode(data.endereco.cep || '');
                form.cidade.value = data.endereco.cidade || '';
            }
        } else {
            elements.checkoutForm.email.value = user.email || '';
            if (user.displayName) elements.checkoutForm.nome.value = user.displayName;
        }
    } catch (error) {}
}

async function loginWithGoogleForCheckout() {
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        const result = await auth.signInWithPopup(provider);
        const user = result.user;

        await ensureCheckoutUserProfileDoc(user, {
            nome: sanitizePlainText(user.displayName, 80),
            telefone: '',
            endereco: null
        });

        await populateCheckoutFormFromUser(user);
        syncCheckoutAccountUI();
        await maybePromptCheckoutPushModal();
    } catch (error) {
        console.error(error);
        alert('Nao foi possivel entrar com Google agora.');
    }
}

async function prepareCheckoutAccount(formData, cliente) {
    const alreadyAuthenticatedUser = currentUser || auth.currentUser;
    if (alreadyAuthenticatedUser) {
        await ensureCheckoutUserProfileDoc(alreadyAuthenticatedUser, cliente);
        return alreadyAuthenticatedUser;
    }

    const mode = getCheckoutAccountMode();
    if (mode === 'guest') {
        return null;
    }

    const email = sanitizePlainText(formData.get('email'), 120).toLowerCase();
    const password = String(elements.checkoutAccountPasswordInput?.value || '').trim();

    if (!email) {
        throw new Error('Informe um e-mail valido para associar o pedido a sua conta.');
    }

    if (password.length < 6) {
        throw new Error('Digite uma senha com pelo menos 6 caracteres para continuar com a conta.');
    }

    try {
        const userCredential = mode === 'login'
            ? await auth.signInWithEmailAndPassword(email, password)
            : await auth.createUserWithEmailAndPassword(email, password);

        const user = userCredential.user;
        if (mode === 'create' && cliente?.nome) {
            await user.updateProfile({ displayName: sanitizePlainText(cliente.nome, 80) });
        }

        await ensureCheckoutUserProfileDoc(user, cliente);
        await populateCheckoutFormFromUser(user);
        syncCheckoutAccountUI();
        return user;
    } catch (error) {
        const errorCode = String(error?.code || '');
        if (errorCode === 'auth/email-already-in-use') {
            throw new Error('Esse e-mail ja possui conta. Escolha "Ja tenho conta" ou use Google.');
        }
        if (errorCode === 'auth/wrong-password' || errorCode === 'auth/invalid-credential' || errorCode === 'auth/user-not-found') {
            throw new Error('Nao foi possivel entrar com este e-mail e senha.');
        }
        if (errorCode === 'auth/weak-password') {
            throw new Error('A senha da conta precisa ter pelo menos 6 caracteres.');
        }
        throw new Error('Nao foi possivel preparar sua conta agora.');
    }
}

async function fetchCheckoutPushConfig() {
    if (checkoutPushConfigCache) return checkoutPushConfigCache;

    const response = await fetch(buildBackendUrl('/api/notifications/config'), {
        method: 'GET',
        headers: { Accept: 'application/json' }
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload?.ok) {
        throw new Error(sanitizePlainText(payload?.error || 'Nao foi possivel carregar a configuracao de notificacoes.', 220));
    }

    checkoutPushConfigCache = payload;
    return payload;
}

async function getCheckoutMessagingInstance() {
    if (!firebase.messaging || typeof firebase.messaging !== 'function') {
        throw new Error('Notificacoes web indisponiveis neste navegador.');
    }

    if (!checkoutPushConfigCache) {
        await fetchCheckoutPushConfig();
    }

    return firebase.messaging();
}

async function ensureCheckoutPushServiceWorkerRegistration() {
    if (!('serviceWorker' in navigator)) {
        throw new Error('Este navegador nao suporta notificacoes web.');
    }

    return navigator.serviceWorker.register('/firebase-messaging-sw.js', {
        scope: '/firebase-cloud-messaging-push-scope'
    });
}

async function sendCheckoutPushSubscription(token) {
    const authenticatedUser = currentUser || auth.currentUser;
    if (!authenticatedUser || !token) {
        throw new Error('Entre na sua conta antes de ativar notificacoes.');
    }

    const idToken = await authenticatedUser.getIdToken();
    const response = await fetch(buildBackendUrl('/api/notifications/register'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
            token,
            permission: Notification.permission,
            userAgent: navigator.userAgent
        })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
        throw new Error(sanitizePlainText(payload?.error || 'Nao foi possivel registrar as notificacoes.', 220));
    }
}

function closeCheckoutPushModal(markSeen = true) {
    if (!elements.checkoutPushModal) return;
    elements.checkoutPushModal.classList.add('hidden');
    elements.checkoutPushModal.classList.remove('flex');
    if (markSeen) {
        try {
            sessionStorage.setItem('lamed_checkout_push_prompt_seen', 'true');
        } catch (error) {}
    }
}

function openCheckoutPushModal() {
    if (!elements.checkoutPushModal) return;
    elements.checkoutPushModal.classList.remove('hidden');
    elements.checkoutPushModal.classList.add('flex');
}

async function maybePromptCheckoutPushModal() {
    const authenticatedUser = currentUser || auth.currentUser;
    if (!authenticatedUser || typeof Notification === 'undefined' || Notification.permission === 'granted') return;

    try {
        if (sessionStorage.getItem('lamed_checkout_push_prompt_seen') === 'true') {
            return;
        }
    } catch (error) {}

    try {
        const config = await fetchCheckoutPushConfig();
        if (!config?.enabled || !config?.vapidPublicKey) return;
        openCheckoutPushModal();
    } catch (error) {}
}

async function enablePushNotificationsFromCheckout() {
    try {
        const config = await fetchCheckoutPushConfig();
        if (!config?.enabled || !config?.vapidPublicKey) {
            throw new Error('As notificacoes ainda nao estao prontas neste momento.');
        }

        const messaging = await getCheckoutMessagingInstance();
        const registration = await ensureCheckoutPushServiceWorkerRegistration();
        const token = await messaging.getToken({
            vapidKey: config.vapidPublicKey,
            serviceWorkerRegistration: registration
        });

        if (!token) {
            throw new Error('Nao foi possivel ativar as notificacoes neste navegador.');
        }

        checkoutPushToken = token;
        await sendCheckoutPushSubscription(token);
        closeCheckoutPushModal();
        alert('Notificacoes ativadas neste aparelho.');
    } catch (error) {
        console.error(error);
        alert(sanitizePlainText(error?.message || 'Nao foi possivel ativar as notificacoes agora.', 220));
    }
}

function extractShippingErrorMessage(payload, response = null) {
    const rawError = payload?.error;

    if (typeof rawError === 'string' && rawError.trim()) {
        return sanitizePlainText(rawError, 220);
    }

    if (rawError && typeof rawError === 'object') {
        if (typeof rawError.message === 'string' && rawError.message.trim()) {
            return sanitizePlainText(rawError.message, 220);
        }

        if (typeof rawError.error === 'string' && rawError.error.trim()) {
            return sanitizePlainText(rawError.error, 220);
        }
    }

    if (typeof payload?.message === 'string' && payload.message.trim()) {
        return sanitizePlainText(payload.message, 220);
    }

    if (response?.status === 404) {
        return API_BASE_URL
            ? 'O endpoint de frete nao foi encontrado na API configurada.'
            : 'O backend de frete ainda nao esta publicado neste dominio.';
    }

    if (response?.status >= 500) {
        return 'O servidor de frete respondeu com erro. Tente novamente em instantes.';
    }

    return 'Nao foi possivel calcular o frete agora.';
}

function extractShippingRequestErrorMessage(error) {
    const message = sanitizePlainText(error?.message || '', 220);

    if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
        return API_BASE_URL
            ? `Nao foi possivel conectar ao backend de frete em ${API_BASE_URL}.`
            : 'O backend de frete nao esta disponivel neste dominio.';
    }

    return message || 'Falha ao calcular o frete.';
}

function createEmptyShippingQuoteState() {
    return {
        loading: false,
        requested: false,
        destinationCep: '',
        cartSignature: '',
        options: [],
        selectedOptionId: '',
        error: ''
    };
}

function buildCartSignature(cartItems) {
    return JSON.stringify(
        (Array.isArray(cartItems) ? cartItems : []).map((item) => ({
            cartId: String(item?.cartId || ''),
            id: String(item?.id || ''),
            categoria: String(item?.categoria || ''),
            preco: Number(item?.preco || 0),
            quantity: Number(item?.quantity || 0),
            isCombo: item?.isCombo === true,
            frete: normalizeShippingProfile(item?.frete)
        }))
    );
}

function buildShippingRequestItems(cartItems) {
    return (Array.isArray(cartItems) ? cartItems : []).map((item) => ({
        cartId: sanitizePlainText(item?.cartId, 120),
        id: sanitizePlainText(item?.id, 120),
        nome: sanitizePlainText(item?.nome, 120),
        categoria: sanitizePlainText(item?.categoria, 40),
        preco: roundCurrency(Number(item?.preco || 0)),
        quantity: Math.max(1, parseInt(item?.quantity, 10) || 1),
        isCombo: item?.isCombo === true,
        frete: normalizeShippingProfile(item?.frete)
    })).filter((item) => item.id);
}

function getSelectedShippingOption() {
    if (!shippingQuoteState.selectedOptionId) return null;
    const match = shippingQuoteState.options.find((option) => option.id === shippingQuoteState.selectedOptionId);
    return normalizeShippingSelection(match);
}

function buildManualShippingSelection(destinationCep = '') {
    const normalizedDestinationCep = normalizePostalCode(destinationCep) || MANUAL_SHIPPING_ORIGIN_POSTAL_CODE;

    return {
        id: 'manual-pendente',
        serviceId: 'manual-pendente',
        serviceCode: 'manual-pendente',
        name: 'Frete definido apos o pedido',
        company: 'A combinar',
        price: 0,
        originalPrice: 0,
        deliveryTime: 1,
        quotedAt: new Date().toISOString(),
        fromPostalCode: MANUAL_SHIPPING_ORIGIN_POSTAL_CODE,
        toPostalCode: normalizedDestinationCep,
        freeShippingApplied: false
    };
}

function getCheckoutContext() {
    const pagamento = document.querySelector('input[name="pagamento"]:checked')?.value || '';
    const parcelas = parseInt(document.getElementById('parcelas-select')?.value, 10) || 1;
    const cep = normalizePostalCode(elements.checkoutCepInput?.value);
    const shipping = SHIPPING_QUOTE_ENABLED ? getSelectedShippingOption() : null;
    const totals = calculateCheckoutTotals(cart, pagamento, parcelas, cep, shipping);

    return { pagamento, parcelas, cep, shipping, totals };
}

function isShippingQuoteReadyFor(cep, cartItems) {
    return shippingQuoteState.requested &&
        !shippingQuoteState.loading &&
        shippingQuoteState.destinationCep === normalizePostalCode(cep) &&
        shippingQuoteState.cartSignature === buildCartSignature(cartItems) &&
        shippingQuoteState.options.length > 0;
}

function setShippingStatus(message, extraClass = 'text-gray-500') {
    if (!elements.shippingQuoteStatus) return;
    elements.shippingQuoteStatus.className = `mt-1 text-sm ${extraClass}`;
    elements.shippingQuoteStatus.textContent = message;
}

function renderShippingOptions() {
    const container = elements.shippingOptions;
    const disabledMessage = 'Frete automatico pausado temporariamente. Nossa equipe confirma o valor e o prazo apos o pedido.';

    if (container) {
        container.replaceChildren();
    }

    if (!SHIPPING_QUOTE_ENABLED) {
        setShippingStatus('Frete manual temporario ativo.', 'text-amber-700');

        if (container) {
            const note = document.createElement('div');
            note.className = 'rounded-2xl border border-[#EADBC9] bg-[#F9F5EF] p-4 text-sm leading-relaxed text-gray-600';
            note.textContent = disabledMessage;
            container.appendChild(note);
        }

        return;
    }

    if (!container) return;

    const { cep, totals } = getCheckoutContext();
    const freeShippingEligible = totals.freeShippingEligible;
    const selectedId = shippingQuoteState.selectedOptionId;

    if (!cep) {
        setShippingStatus('Informe o CEP para ver as opcoes do Melhor Envio.');
        return;
    }

    if (shippingQuoteState.loading) {
        setShippingStatus('Calculando frete automaticamente...', 'text-[--cor-marrom-cta]');
        const skeleton = document.createElement('div');
        skeleton.className = 'space-y-2';
        skeleton.innerHTML = `
            <div class="h-16 animate-pulse rounded-2xl bg-[#F3EEE7]"></div>
            <div class="h-16 animate-pulse rounded-2xl bg-[#F3EEE7]"></div>
        `;
        container.appendChild(skeleton);
        return;
    }

    if (shippingQuoteState.error) {
        setShippingStatus(shippingQuoteState.error, 'text-red-600');
        return;
    }

    if (!shippingQuoteState.options.length) {
        setShippingStatus('Nenhuma opcao de entrega apareceu para este CEP. Tente outro ou recalcule.', 'text-amber-700');
        return;
    }

    setShippingStatus(
        freeShippingEligible
            ? 'Escolha a transportadora. A promocao de frete gratis sera aplicada no total.'
            : 'Escolha a opcao de entrega que preferir.',
        freeShippingEligible ? 'text-green-700' : 'text-gray-600'
    );

    shippingQuoteState.options.forEach((option) => {
        const normalized = normalizeShippingSelection(option);
        if (!normalized) return;

        const checked = normalized.id === selectedId;
        const card = document.createElement('label');
        card.className = `block cursor-pointer rounded-2xl border p-4 transition ${
            checked ? 'border-[--cor-marrom-cta] bg-white shadow-md' : 'border-[#E5E0D8] bg-[#FFFEFC] hover:border-[#D8C9B8]'
        }`;

        const currentPrice = freeShippingEligible ? 'Gratis' : formatarReal(normalized.price);
        const helperText = freeShippingEligible
            ? `Entrega em cerca de ${normalized.deliveryTime} dia(s) uteis - de ${formatarReal(normalized.originalPrice)} por gratis`
            : `Entrega em cerca de ${normalized.deliveryTime} dia(s) uteis`;

        card.innerHTML = `
            <div class="flex items-start gap-3">
                <input type="radio" name="shipping-option" class="mt-1 accent-[--cor-marrom-cta]" ${checked ? 'checked' : ''}>
                <div class="min-w-0 flex-1">
                    <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                            <p class="text-sm font-semibold text-[--cor-texto]">${normalized.company} - ${normalized.name}</p>
                            <p class="text-xs text-gray-500">${helperText}</p>
                        </div>
                        <div class="text-left md:text-right">
                            <p class="text-sm font-bold text-[--cor-marrom-cta]">${currentPrice}</p>
                        </div>
                    </div>
                </div>
            </div>
        `;

        card.addEventListener('click', () => {
            shippingQuoteState.selectedOptionId = normalized.id;
            renderShippingOptions();
            updateCheckoutSummary();
        });

        container.appendChild(card);
    });
}

async function quoteShippingOptions({ force = false, cartItems = cart, destinationCep = null } = {}) {
    if (!SHIPPING_QUOTE_ENABLED) {
        shippingQuoteState = createEmptyShippingQuoteState();
        renderShippingOptions();
        updateCheckoutSummary();
        return [];
    }

    const cep = normalizePostalCode(destinationCep ?? elements.checkoutCepInput?.value);
    const cartSignature = buildCartSignature(cartItems);

    if (cep.length !== 8) {
        shippingQuoteState = createEmptyShippingQuoteState();
        renderShippingOptions();
        updateCheckoutSummary();
        return [];
    }

    if (!force && isShippingQuoteReadyFor(cep, cartItems)) {
        renderShippingOptions();
        updateCheckoutSummary();
        return shippingQuoteState.options;
    }

    const previousSelectionId = shippingQuoteState.selectedOptionId;
    const requestToken = ++shippingQuoteRequestToken;
    shippingQuoteState = {
        ...shippingQuoteState,
        loading: true,
        requested: true,
        destinationCep: cep,
        cartSignature,
        error: ''
    };

    renderShippingOptions();
    updateCheckoutSummary();

    try {
        const response = await fetch(buildBackendUrl('/api/shipping/quote'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                postalCode: cep,
                cart: buildShippingRequestItems(cartItems)
            })
        });

        const payload = await response.json().catch(() => null);
        if (requestToken !== shippingQuoteRequestToken) return [];

        if (!response.ok || !payload?.ok) {
            throw new Error(extractShippingErrorMessage(payload, response));
        }

        const options = Array.isArray(payload.options)
            ? payload.options.map((option) => normalizeShippingSelection(option)).filter(Boolean)
            : [];

        shippingQuoteState = {
            loading: false,
            requested: true,
            destinationCep: cep,
            cartSignature,
            options,
            selectedOptionId: options.some((option) => option.id === previousSelectionId)
                ? previousSelectionId
                : (options[0]?.id || ''),
            error: options.length ? '' : 'Nenhuma opcao de frete foi encontrada para este CEP.'
        };

        renderShippingOptions();
        updateCheckoutSummary();
        return shippingQuoteState.options;
    } catch (error) {
        if (requestToken !== shippingQuoteRequestToken) return [];

        shippingQuoteState = {
            loading: false,
            requested: true,
            destinationCep: cep,
            cartSignature,
            options: [],
            selectedOptionId: '',
            error: extractShippingRequestErrorMessage(error)
        };

        renderShippingOptions();
        updateCheckoutSummary();
        return [];
    }
}

function scheduleShippingQuote(force = false) {
    if (!SHIPPING_QUOTE_ENABLED) return;
    clearTimeout(shippingQuoteDebounceTimer);
    shippingQuoteDebounceTimer = window.setTimeout(() => {
        quoteShippingOptions({ force }).catch(() => {});
    }, force ? 0 : 350);
}

function setupShippingQuoteInteractions() {
    if (elements.checkoutCepInput) {
        elements.checkoutCepInput.addEventListener('input', (event) => {
            const formatted = formatPostalCode(event.target.value);
            event.target.value = formatted;

            if (SHIPPING_QUOTE_ENABLED && normalizePostalCode(formatted).length === 8) {
                scheduleShippingQuote();
            } else {
                shippingQuoteState = createEmptyShippingQuoteState();
                renderShippingOptions();
                updateCheckoutSummary();
            }
        });
    }

    if (elements.shippingCalculateBtn) {
        elements.shippingCalculateBtn.addEventListener('click', () => {
            quoteShippingOptions({ force: true }).catch(() => {});
        });
    }
}

function addToCart() {
    const corObj = selectedColor !== null ? currentProduct.cores[selectedColor] : null;
    const precoFinal = currentProduct.preco * (1 - (currentProduct.desconto || 0) / 100);
    const isCombo = currentProduct.tipo === 'combo';
    const isMesaPosta = checkIsMesaPosta(currentProduct.categoria);
    const tamanhoFinal = (isMesaPosta || isCombo) ? (isCombo ? 'Combo' : 'Unico') : selectedSize;
    const personalizacao = currentProduct.personalizavel ? getCurrentPersonalization() : null;

    const cartId = isCombo
        ? `${currentProduct.id}-combo-${Date.now()}`
        : `${currentProduct.id}-${tamanhoFinal}-${corObj?.nome || 'unico'}-${buildPersonalizationKey(personalizacao)}`;
    const existing = cart.find((item) => item.cartId === cartId);

    if (existing) {
        existing.quantity++;
    } else {
        cart.push({
            cartId,
            id: currentProduct.id,
            categoria: currentProduct.categoria,
            nome: currentProduct.nome,
            preco: precoFinal,
            imagem: getProductImages(currentProduct)[0],
            frete: normalizeShippingProfile(currentProduct.frete),
            tamanho: tamanhoFinal,
            cor: corObj,
            quantity: 1,
            isCombo,
            componentes: isCombo ? currentProduct.componentes : null,
            comboSelections: isCombo ? comboSelections : null,
            personalizacao
        });
    }

    localStorage.setItem('lamedCart', JSON.stringify(cart));
    updateCartUI();
    openCart();
}

function updateCartUI() {
    const container = elements.cartItemsContainer;
    let total = 0;
    let count = 0;
    const itemMarkup = [];

    container.innerHTML = '';

    if (cart.length === 0) {
        elements.cartEmptyMsg.classList.remove('hidden');
        elements.cartCountBadge.style.display = 'none';
        elements.cartSubtotalEl.textContent = 'R$ 0,00';
        return;
    }

    elements.cartEmptyMsg.classList.add('hidden');

    cart.forEach((item) => {
        total += item.preco * item.quantity;
        count += item.quantity;

        let detailsHtml = '';
        if (item.isCombo && item.comboSelections) {
            detailsHtml = '<div class="mt-1 border-l-2 border-purple-200 pl-2 text-[10px] text-gray-500">';
            item.componentes.forEach((comp, idx) => {
                const selection = item.comboSelections[idx];
                const cor = selection?.cor?.nome || '-';
                const tamanho = selection?.tamanho && selection.tamanho !== 'Unico' ? `(${selection.tamanho})` : '';
                detailsHtml += `<div>${comp.quantidade}x ${comp.nome} <strong>${cor}</strong> ${tamanho}</div>`;
            });
            detailsHtml += '</div>';
        } else {
            detailsHtml = `<p class="mb-1 text-xs text-gray-500">${item.tamanho || 'Unico'}${item.cor ? ` | ${item.cor.nome}` : ''}</p>`;
            if (item.personalizacao?.texto) detailsHtml += `<p class="mb-1 text-[11px] text-amber-800">Personalizacao: ${item.personalizacao.texto}</p>`;
            if (item.personalizacao?.observacoes) detailsHtml += `<p class="mb-1 text-[11px] text-gray-500">Obs: ${item.personalizacao.observacoes}</p>`;
        }

        itemMarkup.push(`
            <div class="mb-4 flex gap-4 border-b border-[#E5E0D8] pb-4 last:border-0">
                <img src="${item.imagem}" class="h-20 w-16 rounded-sm border border-[#E5E0D8] object-cover" loading="lazy" decoding="async">
                <div class="flex-grow">
                    <h4 class="text-sm font-medium text-[--cor-texto]">${item.nome}</h4>
                    ${detailsHtml}
                    <div class="mt-1 flex items-center justify-between">
                        <span class="text-sm font-semibold">${formatarReal(item.preco)}</span>
                        <div class="flex items-center rounded border border-[#dcdcdc] bg-white">
                            <button class="px-2 text-gray-500 hover:bg-gray-100" data-action="dec" data-id="${item.cartId}">-</button>
                            <span class="px-2 text-xs">${item.quantity}</span>
                            <button class="px-2 text-gray-500 hover:bg-gray-100" data-action="inc" data-id="${item.cartId}">+</button>
                        </div>
                    </div>
                </div>
            </div>
        `);
    });

    container.innerHTML = itemMarkup.join('');
    elements.cartSubtotalEl.textContent = formatarReal(total);
    elements.cartCountBadge.textContent = count;
    elements.cartCountBadge.style.display = 'flex';
}

function handleCartItemClick(event) {
    const button = event.target.closest('button');
    if (!button) return;

    const { action, id } = button.dataset;
    const item = cart.find((cartItem) => cartItem.cartId === id);
    if (!item) return;

    if (action === 'inc') item.quantity++;
    if (action === 'dec') {
        item.quantity--;
        if (item.quantity <= 0) {
            cart = cart.filter((cartItem) => cartItem.cartId !== id);
        }
    }

    localStorage.setItem('lamedCart', JSON.stringify(cart));
    updateCartUI();
}

function openCart() {
    elements.cartOverlay.classList.add('visivel');
    elements.cartDrawer.classList.add('open');
    if (typeof lockBodyScroll === 'function') lockBodyScroll('cart');
}

function closeCart() {
    elements.cartDrawer.classList.remove('open');
    elements.cartOverlay.classList.remove('visivel');
    if (typeof unlockBodyScroll === 'function') unlockBodyScroll('cart');
}

function toggleAccordion(event) {
    event.currentTarget.nextElementSibling.classList.toggle('hidden');
    event.currentTarget.querySelector('.accordion-icon').classList.toggle('rotate');
}

function setupPaymentOptions() {
    document.querySelectorAll('input[name="pagamento"]').forEach((radio) => {
        radio.addEventListener('change', () => {
            syncParcelamentoVisibility();
            updateCheckoutSummary();
        });
    });

    syncParcelamentoVisibility();
}

function setupCheckoutExperience() {
    document.querySelectorAll('input[name="checkout-account-mode"]').forEach((radio) => {
        radio.addEventListener('change', syncCheckoutAccountUI);
    });

    if (elements.checkoutGoogleLoginBtn) {
        elements.checkoutGoogleLoginBtn.addEventListener('click', loginWithGoogleForCheckout);
    }

    if (elements.closeCheckoutPushModalBtn) {
        elements.closeCheckoutPushModalBtn.addEventListener('click', closeCheckoutPushModal);
    }

    if (elements.checkoutPushLaterBtn) {
        elements.checkoutPushLaterBtn.addEventListener('click', closeCheckoutPushModal);
    }

    if (elements.checkoutPushEnableBtn) {
        elements.checkoutPushEnableBtn.addEventListener('click', enablePushNotificationsFromCheckout);
    }

    syncCheckoutAccountUI();
}

function syncParcelamentoVisibility() {
    const container = document.getElementById('parcelamento-container');
    if (!container) return;

    const selectedPayment = document.querySelector('input[name="pagamento"]:checked')?.value || '';
    const paymentKey = getPaymentKey(selectedPayment);
    const isCardPayment = paymentKey.includes('cartao');

    container.classList.toggle('hidden', !isCardPayment);

    if (isCardPayment) {
        preencherParcelas();
    }
}

function preencherParcelas() {
    const total = cart.reduce((sum, item) => sum + item.preco * item.quantity, 0);
    const select = document.getElementById('parcelas-select');
    if (!select) return;

    select.innerHTML = '';

    for (let index = 1; index <= 12; index += 1) {
        let valorTotal = total;
        let suffix = '(sem juros)';

        if (index > 2) {
            valorTotal = total * (1 + TAXA_JUROS);
            suffix = '(c/ juros)';
        }

        select.innerHTML += `<option value="${index}">${index}x de ${formatarReal(valorTotal / index)} ${suffix}</option>`;
    }

    select.removeEventListener('change', updateCheckoutSummary);
    select.addEventListener('change', updateCheckoutSummary);
}

function validarELimparCarrinho() {
    const storedCart = localStorage.getItem('lamedCart');
    if (!storedCart) {
        cart = [];
        return;
    }

    try {
        const parsed = JSON.parse(storedCart);
        cart = Array.isArray(parsed) ? parsed.map((item) => sanitizeCartItem(item)).filter(Boolean) : [];
    } catch (error) {
        cart = [];
    }
}

async function toggleFavorite() {
    if (!currentUser) return alert('Faca login para favoritar.');
    if (!currentProduct) return;

    const icon = elements.favoriteBtn.querySelector('i');
    const isFavorite = icon.classList.contains('fa-solid');
    icon.className = isFavorite ? 'fa-regular fa-heart' : 'fa-solid fa-heart text-red-500';

    try {
        const ref = db.collection('usuarios').doc(currentUser.uid);
        const existingDoc = await ref.get();
        const existingData = existingDoc.data() || {};

        if (!existingDoc.exists || !sanitizePlainText(existingData.nome, 80)) {
            const fallbackName = sanitizePlainText(
                existingData.nome ||
                currentUser.displayName ||
                currentUser.email?.split('@')[0] ||
                'Cliente',
                80
            ) || 'Cliente';

            await ref.set({
                nome: fallbackName,
                email: sanitizePlainText(existingData.email || currentUser.email, 120),
                telefone: sanitizePhone(existingData.telefone),
                endereco: existingData.endereco || null,
                fotoUrl: normalizeImageUrl(existingData.fotoUrl) || normalizeImageUrl(currentUser.photoURL) || '',
                createdAt: existingDoc.exists ? (existingData.createdAt || null) : firebase.firestore.FieldValue.serverTimestamp(),
                favoritos: Array.isArray(existingData.favoritos) ? existingData.favoritos : []
            }, { merge: true });
        }

        const doc = await ref.get();
        let favorites = doc.exists && doc.data().favoritos ? doc.data().favoritos : [];

        if (isFavorite) {
            favorites = favorites.filter((productId) => productId !== currentProduct.id);
        } else if (!favorites.includes(currentProduct.id)) {
            favorites.push(currentProduct.id);
        }

        await ref.set({ favoritos: favorites }, { merge: true });
    } catch (error) {
        console.error(error);
    }
}

async function checkFavoriteStatus(productId) {
    if (!currentUser || !productId) return;

    const icon = elements.favoriteBtn?.querySelector('i');
    if (!icon) return;

    icon.className = 'fa-regular fa-heart';
    try {
        const doc = await db.collection('usuarios').doc(currentUser.uid).get();
        if (doc.data()?.favoritos?.includes(productId)) {
            icon.className = 'fa-solid fa-heart text-red-500';
        }
    } catch (error) {}
}

function closeCheckoutModal() {
    elements.checkoutModal.classList.add('hidden');
    elements.checkoutModal.classList.remove('flex');
    closeCheckoutPushModal(false);
    if (typeof unlockBodyScroll === 'function') unlockBodyScroll('checkout');
}

async function openCheckoutModal() {
    if (cart.length === 0) return alert('Sua sacola esta vazia.');

    updateCheckoutSummary();

    const authenticatedUser = currentUser || auth.currentUser;

    if (authenticatedUser) {
        await populateCheckoutFormFromUser(authenticatedUser);
    }

    elements.checkoutModal.classList.remove('hidden');
    elements.checkoutModal.classList.add('flex');
    if (typeof lockBodyScroll === 'function') lockBodyScroll('checkout');
    closeCart();

    syncCheckoutAccountUI();
    renderShippingOptions();
    syncParcelamentoVisibility();
    updateCheckoutSummary();

    if (SHIPPING_QUOTE_ENABLED && normalizePostalCode(elements.checkoutCepInput?.value).length === 8) {
        await quoteShippingOptions({ force: true });
    }

    await maybePromptCheckoutPushModal();
}

function updateCheckoutSummary() {
    const summary = elements.checkoutSummary;
    if (!summary) return;

    summary.replaceChildren();

    const appendRow = (labelText, valueText, className = 'flex justify-between text-sm') => {
        const row = document.createElement('div');
        row.className = className;

        const label = document.createElement('span');
        label.textContent = labelText;
        const value = document.createElement('span');
        value.textContent = valueText;

        row.appendChild(label);
        row.appendChild(value);
        summary.appendChild(row);
    };

    const appendItemRow = (labelText, valueText) => {
        appendRow(labelText, valueText, 'mb-1 flex justify-between border-b border-dashed border-[#dcdcdc] pb-1 text-sm');
    };

    const setShippingMessage = (iconClass, text, textClass = '') => {
        const msgBox = elements.shippingCostMsg;
        if (!msgBox) return;

        msgBox.replaceChildren();

        const icon = document.createElement('i');
        icon.className = iconClass;
        msgBox.appendChild(icon);
        msgBox.appendChild(document.createTextNode(' '));

        if (textClass) {
            const span = document.createElement('span');
            span.className = textClass;
            span.textContent = text;
            msgBox.appendChild(span);
            return;
        }

        msgBox.appendChild(document.createTextNode(text));
    };

    cart.forEach((item) => {
        const itemTotal = item.preco * item.quantity;
        let description = sanitizePlainText(item.nome, 120);
        if (item.isCombo) description += ' (Combo)';
        if (item.personalizacao?.texto || item.personalizacao?.observacoes) description += ' [Personalizada]';
        appendItemRow(`${item.quantity}x ${description}`, formatarReal(itemTotal));
    });

    const { cep, shipping, totals } = getCheckoutContext();

    if (totals.pixDiscount > 0) {
        appendRow('Desconto PIX', `-${formatarReal(totals.pixDiscount)}`, 'mt-1 flex justify-between text-sm font-medium text-green-600');
    } else if (totals.cardFee > 0) {
        appendRow('Taxa Cartao (>2x)', `+${formatarReal(totals.cardFee)}`, 'mt-1 flex justify-between text-sm font-medium text-gray-500');
    }

    if (!SHIPPING_QUOTE_ENABLED) {
        appendRow('Frete', 'A combinar', 'mt-2 flex justify-between border-t border-gray-200 pt-2 text-sm text-amber-700');
        setShippingMessage(
            'fa-solid fa-box text-[--cor-marrom-cta]',
            'Frete temporariamente definido apos o pedido. Nossa equipe confirma o valor e o prazo pelo WhatsApp.'
        );
    } else if (shipping) {
        const shippingLabel = `${shipping.company} - ${shipping.name}`;
        appendRow(
            `Frete (${shippingLabel})`,
            totals.freeShipping ? 'Gratis' : formatarReal(totals.shippingCost),
            'mt-2 flex justify-between border-t border-gray-200 pt-2 text-sm'
        );

        if (totals.freeShipping) {
            appendRow('Desconto promocional no frete', `-${formatarReal(totals.shippingDiscount)}`, 'mt-1 flex justify-between text-sm font-medium text-green-700');
            setShippingMessage(
                'fa-solid fa-gift text-green-600',
                `Frete gratis aplicado para ${shipping.company} - ${shipping.name}.`,
                'font-bold text-green-700'
            );
        } else {
            setShippingMessage(
                'fa-solid fa-truck-fast text-[--cor-marrom-cta]',
                `Entrega via ${shipping.company} - ${shipping.name} em cerca de ${shipping.deliveryTime} dia(s) uteis.`
            );
        }
    } else if (shippingQuoteState.loading) {
        appendRow('Frete', 'Calculando...', 'mt-2 flex justify-between border-t border-gray-200 pt-2 text-sm text-gray-500');
        setShippingMessage('fa-solid fa-spinner fa-spin text-[--cor-marrom-cta]', 'Calculando o frete automatico pelo Melhor Envio...');
    } else if (shippingQuoteState.error) {
        appendRow('Frete', 'Nao disponivel', 'mt-2 flex justify-between border-t border-gray-200 pt-2 text-sm text-red-600');
        setShippingMessage('fa-solid fa-circle-exclamation text-red-600', shippingQuoteState.error, 'text-red-600');
    } else if (cep.length !== 8) {
        appendRow('Frete', 'Informe o CEP', 'mt-2 flex justify-between border-t border-gray-200 pt-2 text-sm text-gray-500');
        setShippingMessage('fa-solid fa-location-dot text-[--cor-marrom-cta]', 'Digite seu CEP para calcular o frete automaticamente.');
    } else {
        appendRow('Frete', 'Selecione uma opcao', 'mt-2 flex justify-between border-t border-gray-200 pt-2 text-sm text-gray-500');
        setShippingMessage('fa-solid fa-box-open text-[--cor-marrom-cta]', 'Escolha uma opcao de entrega para concluir o pedido.');
    }

    elements.checkoutTotal.textContent = formatarReal(totals.final);
}

function setCheckoutSubmitState(isSubmitting) {
    orderSubmissionInFlight = isSubmitting;

    if (!elements.checkoutSubmitButton) return;

    elements.checkoutSubmitButton.disabled = isSubmitting;
    elements.checkoutSubmitButton.classList.toggle('opacity-60', isSubmitting);
    elements.checkoutSubmitButton.classList.toggle('cursor-not-allowed', isSubmitting);
    elements.checkoutSubmitButton.textContent = isSubmitting
        ? 'Enviando pedido...'
        : 'Finalizar pedido';
}

async function finalizarPedido(formData) {
    if (orderSubmissionInFlight) {
        return;
    }

    const cliente = {
        nome: sanitizePlainText(formData.get('nome'), 120),
        telefone: sanitizePlainText(formData.get('telefone'), 30),
        email: sanitizePlainText(formData.get('email'), 120),
        endereco: {
            rua: sanitizePlainText(formData.get('rua'), 140),
            numero: sanitizePlainText(formData.get('numero'), 40),
            cep: normalizePostalCode(formData.get('cep')),
            cidade: sanitizePlainText(formData.get('cidade'), 120)
        }
    };

    const pagamento = sanitizePlainText(formData.get('pagamento'), 40);
    const paymentKey = getPaymentKey(pagamento);
    const parcelasSeguras = paymentKey.includes('cartao')
        ? (parseInt(document.getElementById('parcelas-select')?.value, 10) || 1)
        : 1;

    try {
        setCheckoutSubmitState(true);

        if (!cart.length) {
            throw new Error('Sua sacola esta vazia.');
        }

        if (!cliente.nome || !cliente.telefone || !cliente.email || !cliente.endereco.rua || !cliente.endereco.numero || cliente.endereco.cep.length !== 8 || !cliente.endereco.cidade) {
            throw new Error('Preencha todos os dados obrigatorios antes de finalizar.');
        }

        const expectedTotal = parseCurrencyText(elements.checkoutTotal.textContent);
        const preparedUser = await prepareCheckoutAccount(formData, cliente);
        let authToken = '';
        const authenticatedUser = preparedUser || currentUser || auth.currentUser;

        if (authenticatedUser) {
            try {
                authToken = await authenticatedUser.getIdToken();
            } catch (error) {
                throw new Error('Nao foi possivel validar sua sessao. Entre novamente e tente de novo.');
            }
        }

        const response = await fetch(buildBackendUrl('/api/orders/create'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
            },
            body: JSON.stringify({
                cliente,
                pagamento,
                parcelas: parcelasSeguras,
                cart,
                expectedTotal
            })
        });

        const payload = await response.json().catch(() => null);

        if (response.status === 409 && Array.isArray(payload?.canonicalCart)) {
            cart = payload.canonicalCart;
            localStorage.setItem('lamedCart', JSON.stringify(payload.canonicalCart));
            updateCartUI();
            renderShippingOptions();
            updateCheckoutSummary();
            throw new Error(sanitizePlainText(payload?.error || 'Seu carrinho foi atualizado com os dados mais recentes. Revise o pedido e confirme novamente.', 220));
        }

        if (!response.ok || !payload?.ok || !payload?.orderId) {
            throw new Error(sanitizePlainText(payload?.error || 'Nao foi possivel criar o pedido no servidor.', 220));
        }

        const whatsappUrl = String(payload?.whatsappUrl || '').trim();

        cart = [];
        localStorage.setItem('lamedCart', '[]');
        shippingQuoteState = createEmptyShippingQuoteState();
        updateCartUI();
        renderShippingOptions();
        closeCheckoutModal();

        if (authenticatedUser) {
            try {
                sessionStorage.setItem('lamed_last_order_id', String(payload.orderId));
            } catch (error) {}

            if (whatsappUrl) {
                window.open(whatsappUrl, '_blank', 'noopener');
            } else if (payload?.whatsappMessage) {
                window.open(`https://wa.me/5527999287657?text=${encodeURIComponent(String(payload.whatsappMessage))}`, '_blank', 'noopener');
            }

            window.location.href = `minha-conta.html?pedido=${encodeURIComponent(String(payload.orderId))}#pedidos`;
            return;
        }

        if (whatsappUrl) {
            window.open(whatsappUrl, '_blank', 'noopener');
        } else if (payload?.whatsappMessage) {
            window.open(`https://wa.me/5527999287657?text=${encodeURIComponent(String(payload.whatsappMessage))}`, '_blank', 'noopener');
        }
    } catch (error) {
        console.error(error);
        alert(`Erro ao enviar pedido: ${sanitizePlainText(error?.message || 'Erro inesperado', 220)}`);
    } finally {
        setCheckoutSubmitState(false);
    }
}

document.addEventListener('DOMContentLoaded', init);
document.addEventListener('DOMContentLoaded', setupPaymentOptions);
document.addEventListener('DOMContentLoaded', setupCheckoutExperience);

const SHIPPING_QUOTE_ENABLED = false;
const MANUAL_SHIPPING_ORIGIN_POSTAL_CODE = '29056015';
