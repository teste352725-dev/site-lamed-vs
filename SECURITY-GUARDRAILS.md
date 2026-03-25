# Security Guardrails

Estas regras valem para toda alteracao futura neste projeto.

## Principios

1. Nunca confiar no frontend.
   Toda regra de negocio sensivel deve ser validada no backend ou em um servico privilegiado.

2. Toda mudanca precisa de uma passada de seguranca.
   Antes de considerar uma tarefa pronta, revisar pelo menos:
   - autenticacao e autorizacao
   - validacao de entrada
   - abuso de custo e spam
   - upload de arquivos
   - exposicao de diagnosticos e segredos
   - inconsistencias entre frontend, backend e rules

3. O backend e a fonte de verdade para valores sensiveis.
   Preco, subtotal, frete, total, permissao administrativa e operacoes em lote nao podem depender do cliente.

4. Toda escrita publica precisa de controles compensatorios.
   Se uma operacao aceitar usuarios anonimos ou baixo atrito, aplicar schema estrito, limite de tamanho, rate limit e, quando fizer sentido, CAPTCHA ou idempotencia.

5. Uploads e URLs remotas sao superficies de ataque.
   Validar tipo, tamanho e destino permitido. Evitar carregar URLs externas arbitrarias quando for possivel usar storage proprio.

6. Endpoints de saude, diagnostico e manutencao nao devem ficar publicos.
   Restringir por token, ambiente local ou autenticacao administrativa.

## Checklist Minimo por Alteracao

- O frontend pode manipular esse dado? Se sim, o backend esta recalculando ou validando?
- Existe schema e limite de tamanho para os campos novos?
- A operacao precisa de rate limit?
- Existe risco de dupla submissao ou race condition?
- Algum endpoint novo vaza configuracao interna?
- Alguma regra do Firestore/Storage ficou mais permissiva do que o necessario?
- Houve pelo menos uma validacao tecnica apos a mudanca, como teste manual dirigido ou verificacao de sintaxe?
