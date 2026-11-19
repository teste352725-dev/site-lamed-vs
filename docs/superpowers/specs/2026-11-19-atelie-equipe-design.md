# Ateliê — área simples da equipe (2026-11-19)

## Por quê
A dona e a encarregada precisam, pelo celular e sem treinamento: (1) ver se há gente
visitando o site e chamando no WhatsApp, (2) corrigir nome/preço de uma peça,
(3) movimentar o estoque (em produção / pronta, por peça e cor) e registrar vendas
feitas fora do site (quase todas fecham pelo WhatsApp). Se for chato, ninguém usa.

## Decisões
- **Página separada `/atelie`** (atelie.html + css/atelie.css + js/atelie.js), leve,
  feita para celular, com login próprio (usuário + senha da equipe). O painel completo
  (dashboard) continua para a administração.
- **Tudo passa pelo servidor** (ações `atelie.*` na função já existente
  `api/admin/storefront/update` — o plano Hobby está no limite de 12 funções).
  O servidor confere a permissão de cada ação.
- **Permissões por conta** (claims): `production` = estoque + visitas;
  `catalog` = corrigir nome/preço; `admin` = tudo. Novo papel de equipe
  "Estoque e peças" (`role: team`) além de "Somente estoque" e "Administração".
- **Estoque por movimentos atômicos**, não por regravação da lista inteira de cores
  (o fluxo antigo perdia alterações simultâneas e apagava campos extras das cores):
  - `produzir +n`, `pronta n` (produzindo → pronta), `venda n` (+ canal: WhatsApp,
    Instagram, evento, outro), `ajuste` (corrigir contagem).
  - Venda sem peça pronta: o servidor recusa com código; a tela oferece "vender uma
    que está em produção" (encomenda), que baixa do "produzindo".
  - Cada movimento tem id gerado no celular (toque repetido / rede ruim não duplica),
    fica em `estoque_movimentos` com antes/depois, e pode ser desfeito em 15 min.
  - Total da peça (`estoque`) = soma das prontas; `historicoEstoque` continua sendo
    alimentado para as telas antigas.
- **Visitas próprias e anônimas** (sem cookie): `POST /api/eventos` (reescrito para
  `api/status`) grava contadores diários em `estatisticas_dia/{AAAA-MM-DD}` (horário
  de Brasília): visitas (1 por sessão do navegador), produtos vistos, cliques no
  WhatsApp por peça e origem. Robôs ignorados; limite por IP; ids validados contra o
  catálogo (o documento não incha). Celulares da equipe não contam.
- Regras Firestore: `cores_estoque` ganha regra (era negada); `estatisticas_dia`,
  `estoque_movimentos`, `pecas_alteracoes` só via servidor.

## Fora desta etapa
Planejador de lançamentos, reforma do painel completo, retirar as ferramentas de ADM
da vitrine, login com senha da administração.

## A confirmar antes de publicar
Publicação mexe em permissões e grava dados reais → pedir autorização. Política de
Privacidade precisa de uma frase sobre estatísticas anônimas (aprovação da dona).
