(() => {
    const DOC_ID = 'store_operations';
    const $ = (selector, root = document) => root.querySelector(selector);
    const sanitize = (value, max = 160) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
    let db = null;
    let auth = null;
    let schedules = [];

    function log(message, type = 'info') {
        if (typeof window.log === 'function') window.log(message, type);
        else console.log(message);
    }

    function toLocalInput(iso) {
        if (!iso) return '';
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return '';
        const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
        return local.toISOString().slice(0, 16);
    }

    function render() {
        const list = $('#discount-schedule-list');
        if (!list) return;
        if (!schedules.length) {
            list.innerHTML = '<p class="micro-note">Nenhuma retirada de descontos agendada.</p>';
            return;
        }
        list.innerHTML = schedules.map((entry, index) => `
            <div class="discount-schedule-row" data-schedule-index="${index}">
                <div><strong>${sanitize(entry.label || 'Retirar descontos')}</strong><small>${entry.runAt ? new Date(entry.runAt).toLocaleString('pt-BR') : 'Sem horário'}${entry.lastRunAt ? ' · executado em ' + new Date(entry.lastRunAt).toLocaleString('pt-BR') : ''}</small></div>
                <span class="${entry.enabled === false ? 'is-off' : ''}">${entry.enabled === false ? 'Desativado' : 'Ativo'}</span>
                <button type="button" data-remove-schedule="${index}" class="text-button">Remover</button>
            </div>`).join('');
        list.querySelectorAll('[data-remove-schedule]').forEach((button) => button.addEventListener('click', async () => {
            schedules.splice(Number(button.dataset.removeSchedule), 1);
            await saveSchedules();
        }));
    }

    async function loadSchedules() {
        const snap = await db.collection('site_config').doc(DOC_ID).get();
        const data = snap.exists ? (snap.data() || {}) : {};
        schedules = Array.isArray(data.discountSchedules) ? data.discountSchedules.map((entry) => ({ ...entry })) : [];
        render();
    }

    async function saveSchedules() {
        await db.collection('site_config').doc(DOC_ID).set({
            discountSchedules: schedules,
            updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        render();
        log('Agenda de retirada de descontos atualizada.', 'success');
    }

    async function addSchedule() {
        const label = sanitize($('#discount-schedule-label')?.value, 120) || 'Retirar descontos';
        const localValue = $('#discount-schedule-run-at')?.value || '';
        if (!localValue) return log('Escolha a data e o horário para retirar os descontos.', 'warning');
        const parsed = new Date(localValue);
        if (Number.isNaN(parsed.getTime())) return log('Data ou horário inválido.', 'error');
        schedules.push({
            id: `discount-${Date.now()}`,
            label,
            runAt: parsed.toISOString(),
            enabled: true,
            lastRunAt: ''
        });
        await saveSchedules();
        $('#discount-schedule-run-at').value = '';
    }

    async function runNow() {
        const user = auth.currentUser;
        if (!user) return log('Sessão administrativa indisponível.', 'error');
        const button = $('#discount-schedule-run-now');
        try {
            if (button) { button.disabled = true; button.textContent = 'Executando…'; }
            const token = await user.getIdToken();
            const response = await fetch('/api/automation/run', {
                method: 'POST',
                headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok || payload?.ok === false) throw new Error(payload?.error || 'Falha ao executar automação.');
            const discountRuns = Array.isArray(payload?.discounts) ? payload.discounts : [];
            if (discountRuns.length) {
                discountRuns.forEach((item) => log(`Agenda executada: ${item.label || item.id} · ${item.updatedProducts || 0} peça(s) sem desconto.`, 'success'));
            } else {
                log('Automação executada. Nenhuma retirada de desconto estava vencida.', 'info');
            }
            await loadSchedules();
        } catch (error) {
            log(`Erro na automação: ${error?.message || error}`, 'error');
        } finally {
            if (button) { button.disabled = false; button.textContent = 'Executar agora'; }
        }
    }

    function injectUi() {
        const card = $('.discount-card');
        if (!card || $('#discount-schedule-panel')) return false;
        const panel = document.createElement('div');
        panel.id = 'discount-schedule-panel';
        panel.className = 'discount-schedule-panel';
        panel.innerHTML = `
            <div class="divider"></div>
            <div class="operation-card-head"><span class="operation-icon"><i class="fa-regular fa-clock"></i></span><div><span class="panel-kicker">Automação</span><h3>Retirada programada</h3></div></div>
            <p>Agende quando todos os descontos ativos devem voltar a 0%.</p>
            <label class="field"><span>Nome</span><input id="discount-schedule-label" type="text" value="Encerrar campanha de desconto"></label>
            <label class="field"><span>Data e horário</span><input id="discount-schedule-run-at" type="datetime-local"></label>
            <div class="operation-actions split-actions"><button id="discount-schedule-add" type="button" class="btn btn-secondary"><i class="fa-solid fa-calendar-plus"></i> Agendar</button><button id="discount-schedule-run-now" type="button" class="btn btn-ghost">Executar agora</button></div>
            <div id="discount-schedule-list" class="discount-schedule-list"></div>`;
        card.appendChild(panel);
        const style = document.createElement('style');
        style.textContent = `.discount-schedule-list{display:grid;gap:8px;margin-top:12px}.discount-schedule-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px;align-items:center;padding:10px 12px;border:1px solid rgba(95,61,47,.1);border-radius:14px;background:rgba(255,255,255,.7)}.discount-schedule-row strong,.discount-schedule-row small{display:block}.discount-schedule-row small{margin-top:3px;font-size:10px;color:#7a7068}.discount-schedule-row>span{font-size:10px;font-weight:800;color:#166534}.discount-schedule-row>span.is-off{color:#64748b}@media(max-width:640px){.discount-schedule-row{grid-template-columns:1fr auto}.discount-schedule-row .text-button{grid-column:1/-1;justify-self:start}}`;
        document.head.appendChild(style);
        $('#discount-schedule-add')?.addEventListener('click', () => addSchedule().catch((error) => log(error.message, 'error')));
        $('#discount-schedule-run-now')?.addEventListener('click', runNow);
        return true;
    }

    async function start() {
        if (!window.firebase?.firestore || !window.firebase?.auth) return;
        const app = window.firebase.apps?.length ? window.firebase.app() : null;
        if (!app) return;
        db = window.firebase.firestore(app);
        auth = window.firebase.auth(app);
        if (!injectUi()) return;
        await loadSchedules().catch((error) => log(`Não foi possível carregar a agenda: ${error.message}`, 'warning'));
    }

    let attempts = 0;
    const timer = window.setInterval(() => {
        attempts += 1;
        if (document.querySelector('.discount-card') && window.firebase?.firestore) {
            window.clearInterval(timer);
            start();
        } else if (attempts >= 160) window.clearInterval(timer);
    }, 50);
})();
