#!/usr/bin/env bash
# Passo a passo para terminar a publicacao do Atelie.
# So abre paginas e arquivos: nao altera nada sozinho.
cd "$(dirname "$0")/../../.." || exit 1

B=$'\e[1m'; D=$'\e[2m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[0m'
pausa() { echo; read -r -p "${D}Aperte Enter quando terminar este passo...${R}" _; clear; }
abrir() { xdg-open "$1" >/dev/null 2>&1 & }

clear
cat <<EOF
${B}Laméd VS — terminar de publicar o Ateliê${R}

O site novo já está no ar. Faltam 4 passos seus, uns 10 minutos.
Em cada passo eu abro o que você precisa. Use a conta ${B}dona do Firebase${R}.
EOF
pausa

cat <<EOF
${B}Passo 1 de 4 — Regras do banco (Firestore)${R}

Isso destrava a lista de cores do estoque antigo e protege os
registros novos (movimentos, visitas, alterações de peças).

Vou abrir duas coisas:
  • o arquivo ${B}firestore.rules${R} no editor de texto
  • a página ${B}Firestore → Regras${R} do Firebase

No editor:     Ctrl+A e depois Ctrl+C (copia tudo)
No Firebase:   clique dentro do texto das regras,
               Ctrl+A, Ctrl+V (troca pelo novo) e clique em ${B}Publicar${R}.

${Y}Se o Firebase mostrar erro em vermelho, não publique: me mande um print.${R}
EOF
read -r -p "${D}Aperte Enter para abrir...${R}" _
abrir "firestore.rules"
abrir "https://console.firebase.google.com/project/site-lamed/firestore/databases/-default-/rules"
pausa

cat <<EOF
${B}Passo 2 de 4 — Regras das fotos (Storage)${R} ${D}(se ainda não fez)${R}

Mesma coisa, agora com o arquivo ${B}storage.rules${R}
na página ${B}Storage → Regras${R}.

No editor:     Ctrl+A, Ctrl+C
No Firebase:   Ctrl+A, Ctrl+V e ${B}Publicar${R}.

Se você já publicou essas regras antes, é só pular (Enter duas vezes).
EOF
read -r -p "${D}Aperte Enter para abrir...${R}" _
abrir "storage.rules"
abrir "https://console.firebase.google.com/project/site-lamed/storage/rules"
pausa

cat <<EOF
${B}Passo 3 de 4 — Criar os acessos da equipe${R}

Vou abrir a página ${B}Equipe${R} do painel. Entre com a sua conta Google
de administrador e, em "Novo acesso":

  • Nome: o nome da pessoa (ex.: Maria)
  • Usuário: simples, sem espaço nem acento (ex.: maria)
  • Senha: pelo menos 8 caracteres — anote para entregar a ela
  • Permissão: ${B}Estoque e peças (Ateliê)${R}

Dica: crie um acesso igual para ${B}você${R} também. Assim você edita
nome, preço e estoque pelo celular no Ateliê, sem precisar do Google.
(A administração completa continua só na sua conta Google, que é mais segura.)
EOF
read -r -p "${D}Aperte Enter para abrir...${R}" _
abrir "https://lamedvs.com.br/equipe.html"
pausa

cat <<EOF
${B}Passo 4 de 4 — Testar no celular${R}

No celular, abra:   ${B}lamedvs.com.br/atelie${R}
Entre com o usuário e a senha que você criou.

Confira:
  1. Aba ${B}Peças${R}: toque numa peça, mude o preço, salve.
     Abra o site e veja o preço novo. Depois volte o preço certo.
  2. Aba ${B}Estoque${R}: toque numa peça de mesa posta, "Produzir" 1,
     e depois toque em ${B}Desfazer${R}.
  3. Aba ${B}Início${R}: as visitas começam a contar a partir de hoje.
     (O seu celular e o da equipe não contam, depois que entram no Ateliê.)

Dica para a equipe: no Chrome do celular, menu ⋮ → "Adicionar à tela
inicial". O Ateliê vira um ícone, como um aplicativo.
EOF
pausa

cat <<EOF
${G}${B}Pronto!${R}

Falta só uma coisa, sem pressa:
  • Mostrar à dona a frase nova da Política de Privacidade
    (está na conversa com o Claude) e me avisar se ela aprovar.

Se algo der errado, o site anterior está guardado e volta em 1 minuto.
EOF
echo
read -r -p "${D}Aperte Enter para fechar.${R}" _
