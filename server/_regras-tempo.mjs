// Regras de horário (iguais às da loja em js/app-core.js):
// - desconto da peça vale até `descontoAte` (data e hora);
// - "tirar todos os descontos" agendado vale na hora marcada para os descontos
//   que já existiam nessa hora (`descontoDefinidoEm` antes do horário);
// - coleção: antes do início as peças não aparecem nem podem ser compradas;
//   depois do fim a coleção sai do site.
export function msDe(value) {
  if (!value) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") { const t = new Date(value).getTime(); return Number.isNaN(t) ? 0 : t; }
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  if (typeof value._seconds === "number") return value._seconds * 1000;
  return 0;
}

// Datas antigas eram só dia, gravadas ao meio-dia: viram o dia inteiro.
function eraSoDia(ms) {
  if (!ms) return false;
  const d = new Date(ms);
  // meio-dia no horário de Brasília (15h UTC) ou meio-dia local de quem salvou
  return (d.getUTCHours() === 15 || d.getUTCHours() === 12) && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
}
const DIA = 24 * 60 * 60 * 1000;
const BRASILIA = -3 * 60 * 60 * 1000;
function inicioDoDia(ms) { const local = ms + BRASILIA; return local - (((local % DIA) + DIA) % DIA) - BRASILIA; }

export function inicioDaColecao(colecao) {
  const ms = msDe(colecao?.dataInicio || colecao?.dataLancamento);
  return !colecao?.datasComHorario && eraSoDia(ms) ? inicioDoDia(ms) : ms;
}
export function fimDaColecao(colecao) {
  const ms = msDe(colecao?.dataFim);
  return !colecao?.datasComHorario && eraSoDia(ms) ? inicioDoDia(ms) + DIA - 1 : ms;
}
export function colecaoAindaNaoComecou(colecao, agora = Date.now()) {
  const inicio = inicioDaColecao(colecao);
  return Boolean(inicio && agora < inicio);
}
export function colecaoJaTerminou(colecao, agora = Date.now()) {
  const fim = fimDaColecao(colecao);
  return Boolean(fim && agora > fim);
}

export function agendamentosVencidos(schedules, agora = Date.now()) {
  return (Array.isArray(schedules) ? schedules : []).filter((s) => {
    const runAt = msDe(s?.runAt);
    const lastRunAt = msDe(s?.lastRunAt);
    return s?.enabled !== false && runAt && runAt <= agora && (!lastRunAt || lastRunAt < runAt);
  });
}

export function descontoEfetivo(produto, agora = Date.now(), schedules = []) {
  const desconto = Math.max(0, Math.min(100, Number(produto?.desconto) || 0));
  if (!desconto) return 0;
  const ate = msDe(produto?.descontoAte);
  if (ate && agora >= ate) return 0;
  const definidoEm = msDe(produto?.descontoDefinidoEm);
  const corte = agendamentosVencidos(schedules, agora).some((s) => !definidoEm || definidoEm <= msDe(s.runAt));
  return corte ? 0 : desconto;
}
