(() => {
    "use strict";

    const presets = {
        roupa: { weight: 0.4, height: 5, width: 24, length: 32 },
        mesa: { weight: 1.5, height: 12, width: 35, length: 45 },
        "sob-medida": { weight: 3, height: 20, width: 40, length: 50 }
    };

    const form = document.getElementById("shipping-test-form");
    const presetInput = document.getElementById("shipping-test-preset");
    const postalCodeInput = document.getElementById("shipping-test-postal-code");
    const weightInput = document.getElementById("shipping-test-weight");
    const heightInput = document.getElementById("shipping-test-height");
    const widthInput = document.getElementById("shipping-test-width");
    const lengthInput = document.getElementById("shipping-test-length");
    const insuranceInput = document.getElementById("shipping-test-insurance");
    const submitButton = document.getElementById("shipping-test-submit");
    const status = document.getElementById("shipping-test-status");
    const results = document.getElementById("shipping-test-results");

    function normalizePostalCode(value) {
        return String(value || "").replace(/\D/g, "").slice(0, 8);
    }

    function formatPostalCode(value) {
        const digits = normalizePostalCode(value);
        return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
    }

    function formatCurrency(value) {
        return Number(value || 0).toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL"
        });
    }

    function setStatus(message, tone = "") {
        status.textContent = message;
        if (tone) status.dataset.tone = tone;
        else delete status.dataset.tone;
    }

    function applyPreset(name) {
        const preset = presets[name];
        if (!preset) return;
        weightInput.value = String(preset.weight);
        heightInput.value = String(preset.height);
        widthInput.value = String(preset.width);
        lengthInput.value = String(preset.length);
    }

    function getPositiveNumber(input, label) {
        const value = Number(input.value);
        if (!Number.isFinite(value) || value <= 0) {
            throw new Error(`Informe ${label} maior que zero.`);
        }
        return value;
    }

    function renderResults(options) {
        results.replaceChildren();

        options.forEach((option) => {
            const card = document.createElement("article");
            card.className = "shipping-test-result";

            const title = document.createElement("h2");
            title.textContent = String(option.name || "Entrega");

            const company = document.createElement("p");
            company.className = "shipping-test-result-company";
            company.textContent = String(option.company || "Transportadora");

            const price = document.createElement("p");
            price.className = "shipping-test-result-price";
            price.textContent = formatCurrency(option.price);

            const time = document.createElement("p");
            time.className = "shipping-test-result-time";
            const days = Math.max(1, parseInt(option.deliveryTime, 10) || 1);
            time.textContent = `Prazo estimado da transportadora: ${days} ${days === 1 ? "dia útil" : "dias úteis"}.`;

            card.append(title, company, price, time);
            results.append(card);
        });
    }

    postalCodeInput.addEventListener("input", () => {
        postalCodeInput.value = formatPostalCode(postalCodeInput.value);
    });

    presetInput.addEventListener("change", () => {
        applyPreset(presetInput.value);
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        results.replaceChildren();

        try {
            const postalCode = normalizePostalCode(postalCodeInput.value);
            if (postalCode.length !== 8) {
                throw new Error("Informe um CEP com 8 números.");
            }

            const packageOverride = {
                peso: getPositiveNumber(weightInput, "um peso"),
                altura: getPositiveNumber(heightInput, "uma altura"),
                largura: getPositiveNumber(widthInput, "uma largura"),
                comprimento: getPositiveNumber(lengthInput, "um comprimento"),
                insuranceValue: getPositiveNumber(insuranceInput, "o valor da peça")
            };

            submitButton.disabled = true;
            submitButton.textContent = "Consultando o Melhor Envio…";
            setStatus("Enviando uma cotação segura ao ambiente de teste.");

            const response = await fetch("/api/shipping/quote", {
                method: "POST",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    postalCode,
                    packageOverride,
                    cart: [{
                        id: "volume-teste",
                        nome: "Volume de teste",
                        preco: packageOverride.insuranceValue,
                        quantity: 1,
                        categoria: presetInput.value
                    }]
                })
            });

            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                const error = new Error(payload?.error || "Não foi possível calcular o frete.");
                error.code = payload?.code || "";
                throw error;
            }

            const options = Array.isArray(payload?.options) ? payload.options : [];
            if (!options.length) {
                setStatus("A conexão respondeu, mas não encontrou uma opção para esse CEP e essa embalagem.", "warning");
                return;
            }

            renderResults(options);
            setStatus(`Conexão funcionando. ${options.length} opção(ões) encontrada(s), sem criar etiqueta ou cobrança.`, "success");
        } catch (error) {
            const credentialMessage = error?.code === "SHIPPING_CREDENTIAL_EXPIRED"
                ? "A credencial do ambiente de teste ainda precisa ser renovada."
                : String(error?.message || "Não foi possível concluir a simulação.");
            setStatus(credentialMessage, "danger");
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = "Calcular frete de teste";
        }
    });

    applyPreset("roupa");
})();
