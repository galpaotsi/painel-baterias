# Briefing — painel de bancos de bateria

**Data:** 26/08/2026
**Contexto:** Icatel Telemática, laboratório. Frente interna, não é cliente.

## O pedido

A equipe preenche um Microsoft Forms a cada banco de bateria montado /
desulfatado. O Forms alimenta uma planilha no SharePoint da empresa, que
alimenta um Power BI. **O BI trava pra navegar e é pouco didático.** Quer um
site que leia a mesma planilha e mostre a informação de forma visível e rápida.

Link da planilha (tenant Icatel, exige login):
`icateltelematica.sharepoint.com/:x:/s/Atividadessemanais-Planejamento/...`

## O que o BI atual faz (print de 26/08/2026)

- Cabeçalho "Controle de Banco de Baterias/Carretinha", teal + laranja
- Cartões: TAG Sirene · Nº de Série do Banco · Versão · Relatório (PDF)
- Tabela B1–B8 com grupos "Antes da Dessulfatação" e "Depois da Dessulfatação"
- Painel "Pesquisa de Dados": busca por série + 4 filtros

Preservado no site: a tabela B1–B8 com os mesmos grupos, os cartões do topo e a
busca. É a leitura que a equipe já conhece — não fazia sentido reinventar.

**Também notado:** o BI exibia "Dados atualizados em 29/01/26", sete meses atrás,
enquanto o export tem registros até 24/08/2026. Além de travar, estava servindo
dado velho.

## O que o site adiciona

O BI mostra **um banco por vez**. O site mostra a frota inteira e, principalmente,
responde o que o BI não responde:

1. **Painel** — KPIs, distribuição de resistência, volume por mês, por técnico, por versão
2. **Bancos** — busca e filtros instantâneos sobre os 38 registros, tabela ordenável
3. **Alertas** — quais baterias estão fora de faixa e por quê
4. **Qualidade dos dados** — o que está faltando ou inconsistente na origem

## O dado (export de 26/08/2026)

- **38 registros** no formulário → **36 bancos físicos distintos** → **274 baterias**
- Versões: G4 (31 registros, 8 baterias), G3 (4) e Carretinha (3), ambos 4 baterias
- Período: 20/02/2025 a 24/08/2026

### Achados na leitura

**Duas populações de resistência.** Bancos de 4 baterias ficam em ~2,1–2,4 mΩ;
bancos de 8, em ~2,7–3,9 mΩ. Por isso a regra de saúde compara cada bateria com
a mediana das irmãs do próprio banco, e não com um número fixo.

**212 das 274 baterias (77%) não têm medição "antes" da desulfatação.** Só o
depois foi registrado. Sem o antes não dá pra demonstrar o ganho do processo —
nem em relatório interno, nem pro cliente. É o buraco mais caro da planilha.

**122 das 274 baterias não têm número de série.** Sem série não há rastreio:
não dá pra saber se uma bateria ruim já tinha sido reprovada antes, nem
acionar garantia do fabricante.

**Registros duplicados do mesmo banco.** `0020730` e `20730` são o mesmo banco
escrito com e sem zeros à esquerda; `9216840` aparece em dois registros. O
conversor normaliza a série e o site agrupa como histórico do mesmo banco.

**Nome de técnico é texto livre.** "Marcelo Georgius Lucas Ferreira", "Marcelo
Giorgius Lucas Ferreira" e "Marcelo Ferreira" são a mesma pessoa; "Leandro",
"Leandro Fagner" e "Leandro Fagner Moreira" também. Tratado por mapa de
apelidos no `converter.ps1` — **precisa da confirmação dele**.

**Data de implantação mistura tipos.** Alguns registros gravaram data-serial do
Excel, outros texto `25/05/2026`. O parser aceita os dois.

**9 bancos sem TAG de sirene** (vazio ou "Sem Info") — não se sabe onde estão.

### Alertas que as regras atuais produzem

2 baterias críticas e 7 em atenção, de 274:

- `0020728` B2 — resistência **12,95 mΩ** contra mediana 3,3 do próprio banco.
  Quase 4× as irmãs. Ou é bateria condenada, ou é erro de digitação (3,95? 2,95?).
  **Vale conferir na fonte antes de trocar a bateria.**
- `0020714` B2 — tensão 12,49 V
- `005841` B1–B4 — todas as 4 em 12,52 V, uniformemente baixo
- `0020714` B5, `0020715` B4, `0020797` B8 — tensão entre 12,54 e 12,68 V
- `0020708` — amplitude de 0,61 mΩ entre as baterias

## Automação (pendente de decisão)

Ver a conversa. Resumo do caminho recomendado:

**Fase 1 — sincronizar a biblioteca do SharePoint no PC dele.** A conta
corporativa já está registrada no OneDrive da máquina (`Business1`), mas sem
biblioteca sincronizada. Sincronizando, o `.xlsx` vira arquivo local que o
próprio OneDrive mantém atualizado. Aí `converter.ps1` no Agendador de Tarefas
fecha o ciclo. **Zero aprovação de TI, zero token, zero API.**

**Fase 2 (só se precisar rodar com o PC dele desligado)** — Power Automate com
gatilho no Forms, publicando o `dados.js` num destino hospedado. Precisa de
conector HTTP (premium) ou de app registration no Entra ID, o que vira ticket
de TI.

## Decisão pendente sobre hospedagem

O `dados.js` tem número de série de bateria e localização de sirene da Icatel.
Em GitHub Pages fica público e indexável. Por isso está no `.gitignore` e o
site roda local por enquanto. **Decisão dele:** só local, rede interna, ou
hospedado com camada de acesso.
