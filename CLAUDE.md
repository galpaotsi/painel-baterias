# Bancos de Bateria — painel de controle

Frente interna da **Icatel Telemática** (laboratório), não é cliente de serviço.
Substitui o Power BI atual de controle de bancos de bateria, que trava pra
navegar e estava servindo dado de 29/01/26 quando o export já ia até 24/08/26.

## O que é

Site estático que lê o export do Microsoft Forms → Excel (SharePoint) e mostra
os bancos de bateria de forma navegável. Sem servidor, sem build, sem
dependência. Abre com duplo clique no `index.html`.

## Estrutura

- `converter.ps1` — lê o `.xlsx` e gera `site/dados.js`
- `site/index.html` — a página
- `site/estilo.css` — estilo (paleta herdada do BI: teal + laranja)
- `site/app.js` — lógica, filtros, gráficos e **as regras de saúde (`CONFIG` no topo)**
- `site/dados.js` — **gerado**, fora do git (ver "Dado sensível")
- `briefing.md` — o pedido de origem e as decisões tomadas

## Como atualizar os dados

```powershell
cd projetos\Bancos-Bateria
powershell -ExecutionPolicy Bypass -File converter.ps1
```

Aponta pra outro arquivo com `-Xlsx "C:\caminho\planilha.xlsx"`.
O export padrão vem de `dados/Info/Controle de Bancos de Bateria Oficial.xlsx`.

## Decisões de projeto (não desfazer sem motivo)

**`dados.js` e não `dados.json`.** Abrindo o `index.html` via `file://`, o
navegador bloqueia `fetch()` de arquivo local por CORS. Um `.js` carregado por
`<script>` passa. É isso que faz o site rodar com duplo clique, sem servidor.

**Resistência avaliada em relação à mediana do próprio banco, não por limiar
fixo.** Os dados têm duas populações separadas: bancos de 4 baterias
(G3 / Carretinha) ficam em ~2,1–2,4 mΩ e os de 8 (G4) em ~2,7–3,9 mΩ. Um
limiar fixo que serve pra um gera falso positivo no outro. Comparando cada
bateria com as irmãs do mesmo banco, a regra se adapta sozinha — inclusive a
uma versão futura que ainda não existe. Também é o modelo certo pro problema:
num banco em série o que importa é o **elo fraco**.

**Mapa de apelidos de técnico no `converter.ps1`.** O campo de nome no Forms é
texto livre, então a mesma pessoa aparece como "Marcelo Georgius Lucas
Ferreira", "Marcelo Giorgius Lucas Ferreira" e "Marcelo Ferreira". Sem o mapa,
o agrupamento por técnico quebra. **Conferir com ele quando aparecer nome novo.**

**O conversor aceita data-serial do Excel e texto `dd/MM/yyyy`.** A planilha
mistura os dois (o Forms deixou o campo de implantação livre). Não simplificar
esse parser sem antes travar o campo no formulário.

## Dado sensível

`site/dados.js` contém número de série de bateria, TAG e localização de sirene
da Icatel. **Está no `.gitignore` de propósito.** Não commitar nem publicar em
GitHub Pages / Netlify / Artifact sem decisão explícita dele — em Pages isso
fica público e indexável.

Quem clonar o repo precisa rodar o `converter.ps1` pra ter o site funcionando.

## Pendente

- Definir onde o site roda (só local, rede interna, ou hospedado com acesso)
- Automatizar o refresh (ver `briefing.md`, seção "Automação")
