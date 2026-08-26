# Bancos de Bateria — painel de controle

Frente interna da **Icatel Telemática** (laboratório), não é cliente de serviço.
Substitui o Power BI de controle de bancos de bateria, que travava pra navegar e
estava servindo dado de 29/01/26 quando o export já ia até 24/08/26.

**No ar:** https://galpaotsi.github.io/painel-baterias/ — senha `galpaotsi`
**Repositório:** `github.com/galpaotsi/painel-baterias` (público)

---

## Como o dado chega (não desmontar sem ler o porquê)

```
alguém preenche o Microsoft Forms
   ↓
planilha atualiza no SharePoint da Icatel
   ↓  Power Automate — recorrência de 1h, conectores standard
e-mail com a planilha anexada → galpaotsi@gmail.com  (assunto PAINEL-BATERIAS)
   ↓  Google Apps Script — gatilho de 1h
commit em dados/ no GitHub
   ↓  GitHub Actions (windows-latest)
converter.ps1 → site/dados.js → GitHub Pages
```

**Por que essa volta absurda pelo e-mail.** Parece gambiarra e não é — é o único
caminho que sobrou depois de quatro portas fechadas, todas testadas em 26/08/2026:

| Caminho | Por que morreu |
|---|---|
| Link anônimo no SharePoint | Bloqueado no tenant. A opção "Qualquer pessoa com o link" **nem aparece** no diálogo |
| Link anônimo no OneDrive empresarial | Mesmo bloqueio — o teto é do tenant, OneDrive não escapa |
| Power Automate → OneDrive pessoal | Conector quebrado. A conta dele foi migrada pro SharePoint (`migratedtospo=true`) e os IDs mudaram de `CONTA!123` pra `CONTA!s<guid>`. O próprio seletor de arquivo do conector gera ID corrompido (come o zero à esquerda). `BadRequest` sempre |
| Ação HTTP no Power Automate | Conector **premium**, ~R$ 75/usuário/mês |
| Registro de app no Entra ID | Precisa da TI, que "só se move com supervisão" |

E-mail com anexo é conector standard, não depende de link anônimo, e sai de
qualquer empresa. Foi o que passou.

**Antes de tentar "simplificar" isso, releia a tabela acima.** Cada linha custou
uma rodada de teste.

---

## Regras da operação (vieram dele, não deduzir)

**TAG da sirene define implantação.** Banco COM TAG está em campo; SEM TAG está
em estoque. **Não usar a data de implantação pra isso** — ela falta em boa parte
dos registros e marcava como "estoque" banco que já estava instalado há meses.
A data continua útil como informação, e a falta dela virou alerta próprio
("Implantados sem data de implantação").

**Tensão: abaixo de 12,30 V a bateria está descarregada.** Acima disso está ok —
é uma linha só, sem faixa intermediária. Os 12,50/12,70 que estavam aqui antes
eram chute meu por conhecimento genérico de AGM e produziam **8 falsos positivos**
num conjunto onde a menor leitura é 12,49 V.

**Resistência: parâmetro oficial ainda não informado.** O critério atual está
marcado como `PROVISÓRIO` no topo de `site/app.js`. Hoje compara cada bateria com
a **mediana das irmãs do mesmo banco**, porque os dados têm duas populações
separadas — G3/Carretinha em ~2,1–2,4 mΩ e G4 em ~2,7–3,9 mΩ. Um limiar fixo que
serve pra uma família acusa falso positivo na outra.

Quando o parâmetro vier, **perguntar antes**: é valor absoluto ou relativo ao
banco? Considera temperatura? Se for absoluto e único, provavelmente repete o
erro que a regra de tensão acabou de expor.

---

## Estrutura

- `converter.ps1` — lê o `.xlsx` (zip + XML, sem Excel instalado) e gera `site/dados.js`
- `automatizar.ps1` — agendador local; **não está em uso**, ficou como plano B
- `apps-script/Codigo.gs` — a ponte Gmail → GitHub (cópia de referência; o que
  roda mora no projeto Apps Script da conta `galpaotsi@gmail.com`)
- `.github/workflows/publicar.yml` — converte e publica
- `site/` — a página. `dados.js` é gerado, fora do git
- `dados/` — a planilha, empurrada pelo Apps Script

---

## Armadilhas já pagas

**`dados.js` e não `dados.json`.** Abrindo o `index.html` com duplo clique, o
navegador bloqueia `fetch()` de arquivo local por CORS. Um `.js` via `<script>`
passa.

**Workflow em `windows-latest`.** O `converter.ps1` foi escrito e testado no
Windows PowerShell 5.1. Em Linux "provavelmente" rodaria — e "provavelmente"
vira bug que aparece duas semanas depois. Gasta o dobro de minutos e continua
irrelevante (~10 de 2.000/mês).

**`[System.IO.File]::WriteAllText` com caminho relativo** resolve contra o
diretório do processo .NET, que **não** acompanha o `Set-Location` do PowerShell.
Por isso o `-Saida` é convertido pra absoluto no topo do conversor.

**Mapa de apelidos de técnico no conversor.** O campo é texto livre no Forms:
"Marcelo Georgius/Giorgius Lucas Ferreira" e "Marcelo Ferreira" são a mesma
pessoa; "Leandro"/"Leandro Fagner"/"Leandro Fagner Moreira" também. Sem o mapa o
agrupamento por técnico quebra. **Conferir quando aparecer nome novo.**

**A planilha certa é a `Oficial`, dentro de `Lista Baterias`.** Existe um
`Controle de Bancos de Bateria.xlsx` solto na pasta `LABORATÓRIO` que é cópia
morta parada desde 09/11/2025.

**Colar token/ID de página web traz caractere invisível junto.** Já mordeu duas
vezes: `\n` no ID do OneDrive e `Bad credentials` no token do GitHub. O
`lerConfig_` do Apps Script limpa espaço, quebra de linha, zero-width e BOM.

**O `gh` CLI está logado na conta `Marcel0gs`**, e o `.gitconfig` global delega a
autenticação do github.com pra ele. Este repositório é da conta `galpaotsi`, então
tem override local (`credential.https://github.com.helper = manager`) pra pular o
`gh`. Sem isso, `git push` dá 403.

---

## Pendente

- **Senha do site** — está `galpaotsi`, igual ao nome do usuário do GitHub, em
  repositório público. Quem achar o repo adivinha. Ele foi avisado três vezes e
  ainda não decidiu trocar
- **Parâmetro de resistência** — ver acima
- **Intervalo de 1h é escolha, não limitação.** Foi o que ele comunicou à equipe.
  Se um dia trocar o gatilho do Power Automate pra disparar no envio do Forms,
  trocar o do Apps Script pra `everyMinutes(15)` junto — senão o ganho se perde
