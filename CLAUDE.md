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

### O que acumula com o tempo (checado em 27/08/2026)

Nada trava por volume. O que cresce, e quanto:

- **Caixa do Gmail: não cresce.** O `limpar_()` manda pra lixeira tudo que
  processou, menos a mais nova, e a busca é `newer_than:2d` limitada a 20
  threads. Steady state: 1–2 e-mails na caixa e ~30 dias na lixeira (a lixeira
  se esvazia sozinha), uns 28 MB contra 15 GB de cota. Irrelevante.
- **Cotas do Apps Script: irrelevantes.** 2–3 `UrlFetch` por hora contra 20.000
  por dia; execução de segundos contra 90 min/dia de gatilho.
- **Histórico do git: esse cresce, e é o único que merece olho.** Cada commit
  guarda o `.xlsx` inteiro (~40 KB) — zip não faz delta, então não tem
  compressão salvando a pátria. O `enviarPraGitHub_` compara os **bytes** antes
  de commitar, e isso segura muita coisa: em 18 horas de madrugada sem ninguém
  mexer, zero commits. Mas segura só *byte* igual, não *dado* igual — em
  27/08 saiu um commit às 16:07 UTC com dado idêntico ao das 15:07, só o
  envelope do zip mudou porque alguém salvou a planilha. Conta: ~4 commits/dia
  = ~58 MB/ano; travando em 24/dia = ~350 MB/ano. O GitHub reclama de repo
  perto de 1 GB. Ou seja: anos até virar assunto, e quando virar, a saída é
  espremer o histórico (`--orphan` + commit único), não redesenhar a ponte.
- **Actions: não conta.** Repositório público tem minuto ilimitado (o
  "~10 de 2.000/mês" escrito no workflow é a cota de repo privado). E o
  workflow tem `contents: read` — não commita nada de volta.

### O selo do cabeçalho mede a corrente, não a idade do dado (28/08/2026)

Em 28/08 o painel amanheceu com **"⚠ Sem atualizar há 23h"** em amarelo, e não
havia nada quebrado: as Execuções do Apps Script estavam de hora em hora, todas
"Concluído", e o `enviarPraGitHub_` só commita quando os bytes mudam. Ninguém
tinha mexido na planilha desde a noite anterior — o alarme era do desenho, não
da corrente.

A causa é o selo medir **idade do dado**, que num laboratório onde se monta ~1
banco por semana não diz nada sobre saúde. Agora ele mede a corrente:

- toda rodada do Apps Script grava `ultima-checagem.json` no branch **`ponte`**,
  com `checadoEm`, `emailEm` (data do e-mail mais novo que achou),
  `ultimaMudanca` (última vez que entrou planilha nova) e `planilha`
- o branch é separado de propósito: fica fora do `paths` do workflow, então não
  rebuilda o site nem gasta Actions, e o histórico do `main` não leva 24 commits
  de robô por dia. O `garantirBranch_` cria o branch sozinho na primeira rodada
- a página lê pelo `raw.githubusercontent` (manda `Access-Control-Allow-Origin: *`
  e aceita `?t=` como cache-buster, checado em 28/08). Se o arquivo não existir
  ou a rede da empresa bloquear, o selo cai no estado neutro — **nunca inventa
  alarme por falta de resposta**

Os cinco estados, e o que cada um acusa:

| Selo | O que quebrou |
|---|---|
| `Atualizado 28/08, 19:55` | nada, dado fresco |
| `✓ Sem alterações há 23h · 27/08, 20:08` | nada — ninguém preencheu o Forms |
| `⚠ Sincronização parada desde …` | o Apps Script não roda (gatilho, token, cota) |
| `⚠ Planilha não chega desde …` | o Power Automate parou de mandar o e-mail |
| `⚠ Planilha nova não publicada` | entrou planilha e o Actions não publicou |

**O limiar de 3h é três rodadas perdidas.** Vem da cadência das máquinas — as
duas metades rodam de hora em hora —, não do ritmo do laboratório: uma rodada
perdida é ruído, três seguidas é padrão. Os nove estados foram conferidos no
Edge headless com batimento de mentira, pelo mesmo método do `testar-painel.ps1`.

---

## Regras da operação (vieram dele, não deduzir)

**TAG da sirene define implantação.** Banco COM TAG está em campo; SEM TAG está
em estoque. **Não usar a data de implantação pra isso** — ela falta em boa parte
dos registros e marcava como "estoque" banco que já estava instalado há meses.
A data continua útil como informação, e a falta dela virou alerta próprio
("Implantados sem data de implantação").

**O que conta é o campo TAG estar preenchido, não o conteúdo dele.** Confirmado
por ele em 27/08/2026: alguns bancos antigos foram pra campo sem ninguém dar
baixa, e a equipe vai regularizar escrevendo **"sem info"** na TAG, porque a TAG
real ninguém anotou na época. Isso é implantação válida — o painel mostra uma
pílula neutra "sem info" na coluna e o banco fica no grupo de campo. O código
faz `r.implantado = !!r.tag` e guarda `r.tagSemInfo` só pra decidir a exibição.
Antes o `"Sem Info"` era filtrado como se fosse célula vazia e 3 registros caíam
no estoque — o oposto da intenção.

Consequência que veio junto, e é correta: implantado não corre prazo de
desulfatação, então esses 3 saíram de "Estoque vencido" (**7 → 4**). Os
implantados sem data foram de 10 pra 13, e o estoque de 9 pra 6.

**Duplicata na planilha (aberta, não é bug do painel):** `0020730`/`20730` e
`9216840` têm dois registros cada — um com `"Sem Info"` e outro com a TAG em
branco. Depois dessa mudança o mesmo banco aparece nos dois grupos. Conserto é
na origem, apagando a submissão velha do Forms, não no conversor.

**Retorno ao galpão — colunas BT e BU** (decidido com ele em 27/08/2026, criado
por ele na planilha depois disso). `BT` = retornou (vazio = não voltou;
preenchido com qualquer coisa = voltou), `BU` = data do retorno. Mesma lógica da
TAG: **conta o campo estar preenchido, não o conteúdo.**

Duas decisões que vieram dele e não devem ser reinterpretadas:

1. **Retornado sai de "implantado em campo" e vira grupo próprio.** A aba Bancos
   tem três faixas agora — estoque (laranja), retornados (roxo), campo. A TAG
   continua aparecendo no retornado, como histórico de onde ele esteve.
2. **O prazo de desulfatação NÃO volta a correr no retorno.** Só volta quando
   alguém desulfatar de novo — e "de novo" é `dataDesulf > dataRetorno`. Sem
   essa trava, banco que passou um ano em campo voltava pro galpão já vermelho
   no dia seguinte, e o vermelho não diria nada além de "esse banco é antigo".
   Retornado sem data de retorno também não corre, e cai num alerta próprio.

O conversor acha BT/BU **pelo texto do cabeçalho** (`AchaColuna`), com 71/72 como
reserva. Nenhum cabeçalho atual casa com "retorn", então não há colisão. Foi
feito assim porque o pior caso da posição fixa seria ler a coluna errada calado.

**Aba "Saúde da frota" virou "Saúde do estoque"** e o bloco de validade ganhou um
terceiro grupo, **"Em dia" em verde**, com a data de vencimento e quantos dias
faltam — no mesmo formato dos outros dois (pedido dele, 27/08/2026). Antes "em
dia" era só um número no rodapé. O bloco sempre mostrou só quem tem prazo
correndo, que é o estoque; isso não mudou.

Uma ressalva que ele deve saber: banco **em estoque nunca tem TAG** (é a
definição). Por isso a lista de validade identifica pelo **nº de série**, não
pela TAG — uma coluna de TAG ali seria vazia em todas as linhas.

**Ritmo real do laboratório (dele, 28/08/2026): planilha parada não é falha.**
Monta-se ~1 banco por semana hoje — já foram 3 a 4 implantações por semana numa
época, mas a maior parte da frota já está em campo. Banco só é montado quando há
demanda de implantação; sem demanda, ficam 2 a 3 prontos no estoque. E o
preenchimento do Forms às vezes é acumulado: uma semana inteira pode passar e as
alterações entrarem todas de uma vez. Nada disso é regra fechada — foi como ele
descreveu o momento. Consequência de projeto: **nenhum alarme pode nascer da
idade do dado**, só da corrente parar.

### Como isso foi testado (vale repetir quando mexer nas regras)

Sem Node nem Python na máquina. O caminho que funciona é **Edge headless**:

```
msedge --headless --disable-gpu --virtual-time-budget=9000 --dump-dom <url>
```

Três armadilhas já pagas nesse teste:
- `--headless=new` **não** escreve no stdout do PowerShell. Use o `--headless`
  antigo com `Start-Process -RedirectStandardOutput`.
- **A tranca de senha é CSS**, não só JS (`html:not([data-liberado])`). Tirar o
  `senha.js` não basta pra tirar print — a página sai em branco. Tem que setar
  `data-liberado` na mão.
- **`.ps1` gravado sem BOM é lido como ANSI** pelo PowerShell 5.1, e um travessão
  UTF-8 vira aspas no meio da string, quebrando o parse. Grave com BOM.

O script que monta duas cópias (dado real e dado com retornos de mentira
cobrindo os cinco casos da regra), injeta uma sonda e imprime faixas, KPIs,
alertas e situação de cada registro está em `scratchpad/testar.ps1` da sessão de
27/08. Vale reescrever se precisar — é meia hora que não volta.

Na aba **Bancos** os dois grupos vêm separados por faixa, estoque em cima
(pedido dele, 27/08/2026). A ordenação escolhida no cabeçalho vale **dentro** de
cada grupo — clicar numa coluna não mistura estoque com campo de novo.

**Tensão: abaixo de 12,30 V a bateria está descarregada.** Acima disso está ok —
é uma linha só, sem faixa intermediária. Os 12,50/12,70 que estavam aqui antes
eram chute meu por conhecimento genérico de AGM e produziam **8 falsos positivos**
num conjunto onde a menor leitura é 12,49 V.

**Desulfatação vale 3 meses — e o prazo só corre para banco EM ESTOQUE.**
Implantado não vence: fica ligado ao carregador da sirene. Aplicar a regra a
todos os bancos marcava **34 dos 38** como vencidos e transformava o painel numa
parede vermelha; restrita ao estoque sobram **7**, parados há 321 a 465 dias, que
é problema de verdade. O filtro está em `preparar()`, na linha do `!r.implantado`.

**Resistência: teto fixo por versão do banco. G4 até 4,5 mΩ, G3 até 2,6 mΩ.**
Veio dele em 27/08/2026. Passou do limite é crítico, abaixo está ok — linha só,
sem faixa de atenção. Fica em `CONFIG.limiteResist`, no topo de `site/app.js`.

O que existia aqui antes — comparar cada bateria com a mediana das irmãs e
alertar por amplitude dentro do banco — era dedução minha em cima dos dados e
**saiu inteiro**, junto com o aviso de "banco desbalanceado". O status do banco
agora é só o pior status entre as baterias dele.

**Carretinha ficou sem limite** — ele só informou G3 e G4. Versão fora do mapa
não é avaliada por resistência, e o detalhe do banco diz isso na cara em vez de
fingir que está ok. As 12 baterias de Carretinha medem 2,25–2,42 mΩ, então mesmo
o limite do G3 não mudaria nada hoje; ainda assim, **não deduzir** — perguntar.

Os limites batem com os dados: G3 vai até 2,42 e G4 até 3,95 (fora um 12,95 que
era erro de digitação, corrigido na planilha em 27/08). Zero baterias acima do
limite hoje.

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
- **Limite de resistência da Carretinha** — G3 e G4 vieram; Carretinha não.
  Enquanto não vier, essas 12 baterias não são avaliadas por resistência
- **Intervalo de 1h é escolha, não limitação.** Foi o que ele comunicou à equipe.
  Se um dia trocar o gatilho do Power Automate pra disparar no envio do Forms,
  trocar o do Apps Script pra `everyMinutes(15)` junto — senão o ganho se perde
