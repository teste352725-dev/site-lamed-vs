function addToCart() {
    const corObj = selectedColor !== null ? currentProduct.cores[selectedColor] : null;
    const precoFinal = currentProduct.preco * (1 - (currentProduct.desconto||0)/100);
    const isCombo = currentProduct.tipo === 'combo';
    const isMesaPosta = checkIsMesaPosta(currentProduct.categoria);
    const tamanhoFinal = (isMesaPosta || isCombo) ? (isCombo ? 'Combo' : 'Ãšnico') : selectedSize;
    const personalizacao = currentProduct.personalizavel ? getCurrentPersonalization() : null;
    
    const cartId = isCombo
        ? `${currentProduct.id}-combo-${Date.now()}`
        : `${currentProduct.id}-${tamanhoFinal}-${corObj?.nome || 'unico'}-${buildPersonalizationKey(personalizacao)}`;
    const existing = cart.find(i => i.cartId === cartId);
    
    if (existing) existing.quantity++;
    else cart.push({ 
        cartId, 
        id: currentProduct.id, 
        nome: currentProduct.nome, 
        preco: precoFinal, 
        imagem: getProductImages(currentProduct)[0], 
        tamanho: tamanhoFinal, 
        cor: corObj, 
        quantity: 1,
        isCombo: isCombo,
        componentes: isCombo ? currentProduct.componentes : null,
        comboSelections: isCombo ? comboSelections : null,
        personalizacao
    });
    
    localStorage.setItem('lamedCart', JSON.stringify(cart));
    updateCartUI(); openCart();
}

function updateCartUI() {
    const container = elements.cartItemsContainer;
    let total = 0, count = 0;
    const itemMarkup = [];
    container.innerHTML = '';
    if (cart.length === 0) { elements.cartEmptyMsg.classList.remove('hidden'); elements.cartCountBadge.style.display = 'none'; elements.cartSubtotalEl.textContent = 'R$ 0,00'; return; }
    elements.cartEmptyMsg.classList.add('hidden');
    
    cart.forEach(item => {
        total += item.preco * item.quantity; count += item.quantity;
        
        let detailsHtml = '';
        if (item.isCombo && item.comboSelections) {
            detailsHtml = `<div class="text-[10px] text-gray-500 mt-1 pl-2 border-l-2 border-purple-200">`;
            item.componentes.forEach((comp, idx) => {
                const sel = item.comboSelections[idx];
                const cor = sel?.cor?.nome || '-';
                const tam = sel?.tamanho !== 'Ãšnico' ? `(${sel.tamanho})` : '';
                detailsHtml += `<div>${comp.quantidade}x ${comp.nome} <strong>${cor}</strong> ${tam}</div>`;
            });
            detailsHtml += `</div>`;
        } else {
            detailsHtml = `<p class="text-xs text-gray-500 mb-1">${item.tamanho} ${item.cor ? `| ${item.cor.nome}` : ''}</p>`;
            if (item.personalizacao?.texto) detailsHtml += `<p class="text-[11px] text-amber-800 mb-1">Personalizacao: ${item.personalizacao.texto}</p>`;
            if (item.personalizacao?.observacoes) detailsHtml += `<p class="text-[11px] text-gray-500 mb-1">Obs: ${item.personalizacao.observacoes}</p>`;
        }

        itemMarkup.push(`
            <div class="flex gap-4 mb-4 border-b border-[#E5E0D8] pb-4 last:border-0">
                <img src="${item.imagem}" class="w-16 h-20 object-cover rounded-sm border border-[#E5E0D8]" loading="lazy" decoding="async">
                <div class="flex-grow">
                    <h4 class="font-medium text-sm text-[--cor-texto]">${item.nome}</h4>
                    ${detailsHtml}
                    <div class="flex justify-between items-center mt-1">
                        <span class="font-semibold text-sm">${formatarReal(item.preco)}</span>
                        <div class="flex items-center border border-[#dcdcdc] rounded bg-white">
                            <button class="px-2 text-gray-500 hover:bg-gray-100" data-action="dec" data-id="${item.cartId}">-</button>
                            <span class="px-2 text-xs">${item.quantity}</span>
                            <button class="px-2 text-gray-500 hover:bg-gray-100" data-action="inc" data-id="${item.cartId}">+</button>
                        </div>
                    </div>
                </div>
            </div>`);
    });
    container.innerHTML = itemMarkup.join('');
    elements.cartSubtotalEl.textContent = formatarReal(total);
    elements.cartCountBadge.textContent = count;
    elements.cartCountBadge.style.display = 'flex';
}

function handleCartItemClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const { action, id } = btn.dataset;
    const item = cart.find(i => i.cartId === id);
    if (!item) return;
    if (action === 'inc') item.quantity++;
    if (action === 'dec') { item.quantity--; if (item.quantity <= 0) cart = cart.filter(i => i.cartId !== id); }
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
function toggleAccordion(e) { e.currentTarget.nextElementSibling.classList.toggle('hidden'); e.currentTarget.querySelector('.accordion-icon').classList.toggle('rotate'); }

function setupPaymentOptions() {
    document.querySelectorAll('input[name="pagamento"]').forEach(r => {
        r.addEventListener('change', () => {
            document.getElementById('parcelamento-container').classList.toggle('hidden', r.value !== 'CartÃ£o de CrÃ©dito');
            if(r.value === 'CartÃ£o de CrÃ©dito') preencherParcelas();
            updateCheckoutSummary();
        });
    });
}

function preencherParcelas() {
    const total = cart.reduce((s, i) => s + i.preco*i.quantity, 0);
    const select = document.getElementById('parcelas-select');
    select.innerHTML = '';
    
    for(let i=1; i<=12; i++) { 
        let val = total;
        let suffix = '(sem juros)';
        
        if(i > 2) {
            val = total * (1 + TAXA_JUROS);
            suffix = '(c/ juros)';
        }
        
        select.innerHTML += `<option value="${i}">${i}x de ${formatarReal(val/i)} ${suffix}</option>`; 
    }
    select.addEventListener('change', updateCheckoutSummary);
}

function validarELimparCarrinho() {
    const s = localStorage.getItem('lamedCart');
    if(s) {
        try {
            let t = JSON.parse(s);
            cart = Array.isArray(t) ? t.map((item) => sanitizeCartItem(item)).filter(Boolean) : [];
        } catch(e){
            cart = [];
        }
    } else {
        cart = [];
    }
}

async function toggleFavorite() {
    if(!currentUser) return alert("FaÃ§a login para favoritar.");
    if(!currentProduct) return;
    const icon = elements.favoriteBtn.querySelector('i');
    const isFav = icon.classList.contains('fa-solid');
    icon.className = isFav ? "fa-regular fa-heart" : "fa-solid fa-heart text-red-500";
    try {
        const ref = db.collection('usuarios').doc(currentUser.uid);
        const doc = await ref.get();
        let favs = doc.exists && doc.data().favoritos ? doc.data().favoritos : [];
        if(isFav) favs = favs.filter(id=>id!==currentProduct.id); else if(!favs.includes(currentProduct.id)) favs.push(currentProduct.id);
        await ref.set({favoritos:favs}, {merge:true});
    } catch(e){console.error(e);}
}

async function checkFavoriteStatus(pid) {
    if(!currentUser||!pid) return;
    const icon = elements.favoriteBtn?.querySelector('i');
    if(!icon) return;
    icon.className = "fa-regular fa-heart";
    try { const doc = await db.collection('usuarios').doc(currentUser.uid).get(); if(doc.data()?.favoritos?.includes(pid)) icon.className = "fa-solid fa-heart text-red-500"; } catch(e){}
}

function closeCheckoutModal() {
    elements.checkoutModal.classList.add('hidden');
    elements.checkoutModal.classList.remove('flex');
    if (typeof unlockBodyScroll === 'function') unlockBodyScroll('checkout');
}

async function openCheckoutModal() {
    if (cart.length === 0) return alert('Sua sacola esta vazia.');
    updateCheckoutSummary();
    if (currentUser) {
        try {
            const doc = await db.collection('usuarios').doc(currentUser.uid).get();
            if (doc.exists) {
                const data = doc.data();
                const form = elements.checkoutForm;
                if (data.nome) form.nome.value = data.nome;
                if (data.email) form.email.value = data.email;
                if (data.telefone) form.telefone.value = data.telefone;
                if (data.endereco) {
                    form.rua.value = data.endereco.rua || '';
                    form.numero.value = data.endereco.numero || '';
                    form.cep.value = data.endereco.cep || '';
                    form.cidade.value = data.endereco.cidade || '';
                    if (data.endereco.cep) updateCheckoutSummary();
                }
            } else {
                elements.checkoutForm.email.value = currentUser.email;
                if (currentUser.displayName) elements.checkoutForm.nome.value = currentUser.displayName;
            }
        } catch (error) {}
    }

    elements.checkoutModal.classList.remove('hidden');
    elements.checkoutModal.classList.add('flex');
    if (typeof lockBodyScroll === 'function') lockBodyScroll('checkout');
    closeCart();
}

function updateCheckoutSummary() {
    const summary = elements.checkoutSummary;
    if (!summary) return;

    summary.replaceChildren();

    const appendItemRow = (labelText, valueText) => {
        const row = document.createElement('div');
        row.className = 'flex justify-between text-sm mb-1 pb-1 border-b border-dashed border-[#dcdcdc]';

        const info = document.createElement('div');
        const label = document.createElement('span');
        label.className = 'font-medium text-[--cor-texto]';
        label.textContent = labelText;
        info.appendChild(label);

        const value = document.createElement('span');
        value.textContent = valueText;

        row.appendChild(info);
        row.appendChild(value);
        summary.appendChild(row);
    };

    const appendSummaryRow = (labelText, valueText, className = '') => {
        const row = document.createElement('div');
        row.className = `flex justify-between text-sm ${className}`.trim();

        const label = document.createElement('span');
        label.textContent = labelText;

        const value = document.createElement('span');
        value.textContent = valueText;

        row.appendChild(label);
        row.appendChild(value);
        summary.appendChild(row);
    };

    const msgBox = document.getElementById('shipping-cost-msg');
    const setShippingMessage = (iconClass, text, textClass = '') => {
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

    const pagamento = document.querySelector('input[name="pagamento"]:checked')?.value;
    const parcelas = parseInt(document.getElementById('parcelas-select')?.value, 10) || 1;
    const cep = document.getElementById('checkout-cep')?.value || '';
    const totals = calculateCheckoutTotals(cart, pagamento, parcelas, cep);

    if (totals.pixDiscount > 0) {
        appendSummaryRow('Desconto PIX', `-${formatarReal(totals.pixDiscount)}`, 'text-green-600 font-medium mt-1');
    } else if (totals.cardFee > 0) {
        appendSummaryRow('Taxa Cartao (>2x)', `+${formatarReal(totals.cardFee)}`, 'text-gray-500 font-medium mt-1');
    }

    if (totals.freeShipping) {
        appendSummaryRow('Frete (Hanukah Sudeste)', 'GRATIS', 'text-green-700 font-bold mt-2 pt-2 border-t border-gray-200');
        setShippingMessage(
            'fa-solid fa-gift text-green-600',
            'Parabens! Frete gratis disponivel para sua regiao.',
            'text-green-700 font-bold'
        );
    } else {
        appendSummaryRow('Frete', 'A calcular (WhatsApp)', 'text-gray-500 mt-2 pt-2 border-t border-gray-200');
        setShippingMessage('fa-solid fa-truck-fast', 'O frete e calculado e pago diretamente no WhatsApp.');
    }

    elements.checkoutTotal.textContent = formatarReal(totals.final);
}

async function finalizarPedido(formData) {
    const cliente = {
        nome: sanitizePlainText(formData.get('nome'), 120),
        telefone: sanitizePlainText(formData.get('telefone'), 30),
        email: sanitizePlainText(formData.get('email'), 120),
        endereco: {
            rua: sanitizePlainText(formData.get('rua'), 140),
            numero: sanitizePlainText(formData.get('numero'), 40),
            cep: sanitizePlainText(formData.get('cep'), 12),
            cidade: sanitizePlainText(formData.get('cidade'), 120)
        }
    };
    const pagamento = sanitizePlainText(formData.get('pagamento'), 40);
    const paymentKey = getPaymentKey(pagamento);
    const parcelasSeguras = paymentKey.includes('cartao')
        ? (parseInt(document.getElementById('parcelas-select')?.value, 10) || 1)
        : 1;
    const pagamentoSeguro = paymentKey.includes('cartao')
        ? 'Cartao de Credito'
        : paymentKey === 'pix'
            ? 'PIX'
            : pagamento;

    try {
        if (!cart.length) {
            throw new Error('Sua sacola esta vazia.');
        }

        if (!cliente.nome || !cliente.telefone || !cliente.email || !cliente.endereco.rua || !cliente.endereco.numero || !cliente.endereco.cep || !cliente.endereco.cidade) {
            throw new Error('Preencha todos os dados obrigatorios antes de finalizar.');
        }

        const displayedTotal = parseCurrencyText(elements.checkoutTotal.textContent);
        const originalCartSnapshot = JSON.stringify(cart);
        const canonicalCart = await buildCanonicalCartSnapshot(cart);

        if (!canonicalCart.length) {
            throw new Error('Os itens do carrinho nao estao mais disponiveis.');
        }

        const totals = calculateCheckoutTotals(canonicalCart, pagamentoSeguro, parcelasSeguras, cliente.endereco.cep);
        const cartWasAdjusted = JSON.stringify(canonicalCart) !== originalCartSnapshot;

        cart = canonicalCart;
        localStorage.setItem('lamedCart', JSON.stringify(canonicalCart));
        updateCartUI();
        updateCheckoutSummary();

        if (cartWasAdjusted || Math.abs(displayedTotal - totals.final) > 0.01) {
            throw new Error('Seu carrinho foi atualizado com os valores e configuracoes mais recentes. Revise o pedido e confirme novamente.');
        }

        if (currentUser) {
            await db.collection('usuarios').doc(currentUser.uid).set({
                nome: cliente.nome,
                telefone: cliente.telefone,
                endereco: cliente.endereco
            }, { merge: true });
        }

        const pedido = {
            cliente,
            pagamento: pagamentoSeguro,
            parcelas: parcelasSeguras,
            produtos: canonicalCart,
            subtotal: totals.subtotal,
            total: totals.final,
            ajustes: {
                pixDiscount: totals.pixDiscount,
                cardFee: totals.cardFee,
                freeShipping: totals.freeShipping
            },
            data: firebase.firestore.FieldValue.serverTimestamp(),
            status: 'pendente',
            userId: currentUser ? currentUser.uid : null,
            estoque_baixado: false
        };

        const ref = await db.collection('pedidos').add(pedido);

        let msg = `*Novo Pedido #${ref.id.slice(0, 6).toUpperCase()}*\n`;
        msg += `*Cliente:* ${cliente.nome}\n`;
        msg += `*Pagamento:* ${pedido.pagamento}`;
        if (paymentKey.includes('cartao')) msg += ` (${pedido.parcelas}x)`;
        msg += `\n\n*Itens do Pedido:*\n`;

        canonicalCart.forEach((item) => {
            msg += '------------------------------\n';
            msg += `- *${item.quantity}x ${item.nome}*\n`;

            if (item.isCombo && item.comboSelections) {
                msg += '  _Combo Personalizado:_\n';
                item.componentes.forEach((comp, idx) => {
                    const selection = item.comboSelections[idx];
                    const color = sanitizePlainText(selection?.cor?.nome, 40) || 'Padrao';
                    const size = normalizeSizeLabel(selection?.tamanho);
                    const detailParts = [color];
                    if (size && size !== 'Unico') detailParts.push(`(${size})`);
                    msg += `  - ${comp.quantidade}x ${comp.nome} [${detailParts.join(' ')}]\n`;
                });
            } else {
                const detailParts = [];
                const size = normalizeSizeLabel(item.tamanho);
                if (size && size !== 'Unico') detailParts.push(`Tam: ${size}`);
                if (item.cor?.nome) detailParts.push(`Cor: ${sanitizePlainText(item.cor.nome, 40)}`);
                if (item.personalizacao?.texto) detailParts.push(`Personalizacao: ${sanitizePlainText(item.personalizacao.texto, 120)}`);
                if (detailParts.length) msg += `  (${detailParts.join(' | ')})\n`;
                if (item.personalizacao?.observacoes) msg += `  Obs: ${sanitizePlainText(item.personalizacao.observacoes, 240)}\n`;
            }

            msg += `  Valor: ${formatarReal(item.preco * item.quantity)}\n`;
        });

        msg += '------------------------------\n';
        msg += `*Total Final:* ${formatarReal(pedido.total)}\n`;

        if (totals.freeShipping) {
            msg += '\n*Frete Gratis Aplicado (Promocao Hanukah)*';
        }

        window.open(`https://wa.me/5527999287657?text=${encodeURIComponent(msg)}`, '_blank');

        cart = [];
        localStorage.setItem('lamedCart', '[]');
        updateCartUI();
        closeCheckoutModal();
    } catch (error) {
        console.error(error);
        alert(`Erro ao enviar pedido: ${sanitizePlainText(error?.message || 'Erro inesperado', 220)}`);
    }
}

document.addEventListener('DOMContentLoaded', init);
