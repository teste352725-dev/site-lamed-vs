(() => {
    const MAX_FILE_BYTES = 10 * 1024 * 1024;
    const $ = (selector) => document.querySelector(selector);

    function sanitizeFileName(value) {
        return String(value || 'imagem')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9._-]+/g, '_')
            .slice(0, 120) || 'imagem';
    }

    function setStatus(message, tone = 'neutral') {
        const status = $('#collection-upload-status');
        if (!status) return;
        status.textContent = message || '';
        status.className = `collection-upload-status is-${tone}`;
    }

    async function ensureStorage() {
        if (!window.firebase?.storage) {
            throw new Error('O Firebase Storage não ficou disponível nesta página.');
        }
        const app = window.firebase.apps?.length ? window.firebase.app() : null;
        if (!app) throw new Error('O Firebase não foi inicializado.');
        return window.firebase.storage(app);
    }

    async function uploadCover(file) {
        if (!file) return;
        if (!String(file.type || '').startsWith('image/')) {
            throw new Error('Selecione um arquivo de imagem.');
        }
        if (file.size > MAX_FILE_BYTES) {
            throw new Error('A imagem pode ter no máximo 10 MB.');
        }

        const user = window.firebase?.auth?.()?.currentUser;
        if (!user) throw new Error('A sessão administrativa não está disponível.');

        const storage = await ensureStorage();
        const safeName = sanitizeFileName(file.name);
        const path = `galeria/colecoes/${Date.now()}_${safeName}`;
        const reference = storage.ref(path);

        setStatus('Enviando imagem…', 'busy');
        const snapshot = await reference.put(file, { contentType: file.type });
        const url = await snapshot.ref.getDownloadURL();

        const urlInput = $('#collection-image');
        if (urlInput) {
            urlInput.value = url;
            urlInput.dispatchEvent(new Event('input', { bubbles: true }));
            urlInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

        try {
            await window.firebase.firestore().collection('galeria').add({
                url,
                path,
                nome: String(file.name || safeName).slice(0, 160),
                origem: 'colecoes',
                tipo: 'capa-colecao',
                createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
                createdBy: user.email || user.uid
            });
        } catch (error) {
            console.warn('[collections.upload.gallery]', error);
        }

        setStatus('Upload concluído. A capa já está pronta para salvar com a coleção.', 'success');
    }

    function installUi() {
        const urlInput = $('#collection-image');
        if (!urlInput || $('#collection-cover-file')) return false;

        const field = urlInput.closest('.field');
        if (!field) return false;

        const upload = document.createElement('div');
        upload.className = 'collection-upload-box';
        upload.innerHTML = `
            <div class="collection-upload-copy">
                <span class="collection-upload-icon"><i class="fa-solid fa-cloud-arrow-up"></i></span>
                <div>
                    <strong>Enviar imagem</strong>
                    <small>JPG, PNG ou WebP · até 10 MB</small>
                </div>
            </div>
            <label class="button button-primary collection-upload-button">
                <i class="fa-solid fa-image"></i> Escolher arquivo
                <input id="collection-cover-file" type="file" accept="image/*" hidden>
            </label>
            <p id="collection-upload-status" class="collection-upload-status is-neutral">Você também pode usar um link direto abaixo.</p>
        `;

        field.insertAdjacentElement('beforebegin', upload);
        const labelText = field.querySelector('span');
        if (labelText) labelText.textContent = 'Ou usar URL da imagem';

        $('#collection-cover-file')?.addEventListener('change', async (event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            if (!file) return;
            try {
                input.disabled = true;
                await uploadCover(file);
            } catch (error) {
                console.error('[collections.upload]', error);
                setStatus(error?.message || 'Não foi possível enviar a imagem.', 'error');
            } finally {
                input.disabled = false;
                input.value = '';
            }
        });

        return true;
    }

    function installStyles() {
        if ($('#collections-upload-style')) return;
        const style = document.createElement('style');
        style.id = 'collections-upload-style';
        style.textContent = `
            .collection-upload-box {
                display: flex;
                align-items: center;
                gap: 14px;
                flex-wrap: wrap;
                padding: 16px;
                margin-bottom: 14px;
                border-radius: 20px;
                border: 1px dashed rgba(95,61,47,.22);
                background: rgba(255,255,255,.66);
            }
            .collection-upload-copy { display:flex; align-items:center; gap:12px; flex:1 1 240px; }
            .collection-upload-copy strong { display:block; color:#3d241a; font-size:14px; }
            .collection-upload-copy small { display:block; margin-top:3px; color:rgba(32,24,20,.55); font-size:11px; }
            .collection-upload-icon {
                display:grid; place-items:center; width:42px; height:42px; flex:0 0 42px;
                border-radius:14px; background:#f3e8d7; color:#6b5139;
            }
            .collection-upload-button { cursor:pointer; }
            .collection-upload-status { width:100%; margin:0; font-size:11px; }
            .collection-upload-status.is-neutral { color:rgba(32,24,20,.5); }
            .collection-upload-status.is-busy { color:#8a6b4e; font-weight:700; }
            .collection-upload-status.is-success { color:#166534; font-weight:700; }
            .collection-upload-status.is-error { color:#b91c1c; font-weight:700; }
        `;
        document.head.appendChild(style);
    }

    function start() {
        installStyles();
        if (installUi()) return;
        let attempts = 0;
        const timer = window.setInterval(() => {
            attempts += 1;
            if (installUi() || attempts >= 100) window.clearInterval(timer);
        }, 60);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();
