/**
 * Ponte Gmail -> GitHub  (Google Apps Script, gratuito, roda nos servidores do Google)
 *
 * O QUE FAZ
 * De hora em hora procura o e-mail que o Power Automate manda com a planilha
 * anexada, pega o anexo e envia pro GitHub. O push dispara o GitHub Actions,
 * que converte a planilha e republica o site.
 *
 * Toda rodada grava tambem um batimento em ultima-checagem.json (branch
 * ponte) -- e como o painel sabe que a corrente esta viva quando a planilha
 * fica dias sem mudar.
 *
 * POR QUE ESSE CAMINHO
 * O tenant da Icatel bloqueia link anonimo no SharePoint e no OneDrive
 * empresarial, o conector do OneDrive pessoal esta quebrado pra contas
 * migradas pro SharePoint, e a acao HTTP do Power Automate e paga.
 * E-mail com anexo foi a unica saida gratuita que passou.
 *
 * CONFIGURACAO (nao mexe no codigo, use Propriedades do Script)
 * No editor: engrenagem "Configuracoes do projeto" -> "Propriedades do script"
 *   GITHUB_TOKEN  = o token fine-grained do GitHub (comeca com github_pat_)
 *   GITHUB_OWNER  = seu usuario do GitHub
 *   GITHUB_REPO   = nome do repositorio
 *
 * O token fica nas propriedades e NAO no codigo de proposito: assim ele nao
 * vaza se voce compartilhar o script ou versionar esse arquivo.
 *
 * GATILHO
 * Rode instalarGatilho() uma vez. Ela cria o agendamento de hora em hora.
 */

// ---------------------------------------------------------------- ajustes
var ASSUNTO      = 'PAINEL-BATERIAS';                        // assunto fixo que o fluxo usa
var CAMINHO_REPO = 'dados/Controle de Bancos de Bateria Oficial.xlsx';
var BRANCH       = 'main';
var MAX_IDADE_H  = 48;                                       // ignora e-mail mais velho que isso

// O batimento vai num branch proprio e nao no main por dois motivos: esse
// caminho nao dispara o workflow (nao rebuilda o site nem gasta Actions) e o
// historico do main continua legivel, sem 24 commits de robo por dia.
var BRANCH_PONTE  = 'ponte';
var CAMINHO_PONTE = 'ultima-checagem.json';

// ---------------------------------------------------------------- principal
/* O painel nao consegue separar "planilha sem alteracao" de "ponte morta"
   olhando so a idade do dado -- as duas coisas chegam la iguais. Por isso
   toda rodada, dando certo ou dando errado, grava um batimento no GitHub com
   tres fatos: quando o script rodou, a data do e-mail mais novo que achou e
   quando entrou planilha nova pela ultima vez. O selo do site le esse arquivo
   e diz qual metade parou, em vez de acusar quebra quando ninguem mexeu na
   planilha por uma semana -- o que, no laboratorio, e normal. */
function processar() {
  var cfg = lerConfig_();
  var estado = { emailEm: null, planilha: 'sem-email', erro: null };

  try {
    rodar_(cfg, estado);
  } catch (e) {
    estado.erro = String((e && e.message) || e).slice(0, 200);
    throw e;   // continua aparecendo como falha nas Execucoes do Apps Script
  } finally {
    // Batimento nao derruba rodada: se ele falhar sozinho, a planilha ja foi.
    try { baterPonte_(cfg, estado); } catch (e2) { Logger.log('Batimento falhou: %s', e2); }
  }
}

function rodar_(cfg, estado) {
  // Busca so o que interessa: assunto exato, com anexo, recente.
  var busca = 'subject:"' + ASSUNTO + '" has:attachment newer_than:2d';
  var threads = GmailApp.search(busca, 0, 20);

  if (!threads.length) {
    Logger.log('Nenhum e-mail encontrado com assunto "%s".', ASSUNTO);
    return;
  }

  // Junta todas as mensagens e pega a MAIS RECENTE. O fluxo manda de hora em
  // hora, entao a caixa acumula -- processar a errada publicaria dado velho.
  var msgs = [];
  threads.forEach(function (t) {
    t.getMessages().forEach(function (m) { msgs.push(m); });
  });
  msgs.sort(function (a, b) { return b.getDate() - a.getDate(); });

  var limite = new Date(Date.now() - MAX_IDADE_H * 3600 * 1000);
  var msg = null;
  for (var i = 0; i < msgs.length; i++) {
    if (msgs[i].getDate() < limite) break;
    if (acharAnexo_(msgs[i])) { msg = msgs[i]; break; }
  }

  if (!msg) {
    Logger.log('Achei e-mails, mas nenhum recente com anexo .xlsx.');
    return;
  }

  // A data do e-mail e a prova de que a outra metade da corrente (o Power
  // Automate) continua viva. Guarda mesmo que a planilha venha igual.
  estado.emailEm = msg.getDate();

  var anexo = acharAnexo_(msg);
  var bytes = anexo.getBytes();
  Logger.log('Anexo: %s (%s bytes), de %s', anexo.getName(), bytes.length, msg.getDate());

  if (bytes.length < 1000) {
    throw new Error('Anexo tem so ' + bytes.length + ' bytes -- provavelmente veio vazio ou foi removido no caminho.');
  }

  var conteudo = Utilities.base64Encode(bytes);
  var r = enviarPraGitHub_(cfg, conteudo);
  estado.planilha = r;

  if (r === 'igual') {
    Logger.log('Planilha nao mudou desde a ultima vez. Nada enviado.');
  } else {
    // Marca quando entrou planilha nova. O selo compara isso com a data do
    // dados.js publicado: se ficou pra tras, quem travou foi o Actions.
    PropertiesService.getScriptProperties().setProperty('ULTIMA_MUDANCA', new Date().toISOString());
    Logger.log('Enviado pro GitHub (%s).', r);
  }

  // Limpa os processados pra caixa nao encher com 24 e-mails por dia.
  limpar_(msgs, msg);
}

// ---------------------------------------------------------------- auxiliares
function lerConfig_() {
  var p = PropertiesService.getScriptProperties();

  // trim() nao e paranoia: copiar token de pagina web traz espaco ou quebra
  // de linha junto o tempo todo, e o GitHub responde "Bad credentials" sem
  // dizer que o problema e um caractere invisivel no fim.
  // \s pega espaco/tab/quebra de linha; os \u sao os invisiveis que paginas
  // web costumam colar junto (zero-width space, joiners e BOM).
  function ler(nome) {
    var v = p.getProperty(nome);
    return v ? String(v).replace(/[\s\u200B\u200C\u200D\uFEFF]/g, "") : v;
  }

  var cfg = { token: ler('GITHUB_TOKEN'), owner: ler('GITHUB_OWNER'), repo: ler('GITHUB_REPO') };

  var faltando = [];
  if (!cfg.token) faltando.push('GITHUB_TOKEN');
  if (!cfg.owner) faltando.push('GITHUB_OWNER');
  if (!cfg.repo)  faltando.push('GITHUB_REPO');
  if (faltando.length) {
    throw new Error('Faltam propriedades do script: ' + faltando.join(', ') +
      '. Configuracoes do projeto -> Propriedades do script.');
  }

  // Erra cedo e com mensagem util, em vez de deixar o GitHub devolver 401.
  if (!/^(github_pat_|ghp_)/.test(cfg.token)) {
    throw new Error('GITHUB_TOKEN nao parece um token do GitHub (deveria comecar com ' +
      '"github_pat_" ou "ghp_"). Valor tem ' + cfg.token.length + ' caracteres e comeca com "' +
      cfg.token.slice(0, 4) + '".');
  }

  return cfg;
}

function acharAnexo_(msg) {
  var as = msg.getAttachments({ includeInlineImages: false });
  for (var i = 0; i < as.length; i++) {
    if (/\.xlsx$/i.test(as[i].getName())) return as[i];
  }
  return null;
}

function urlConteudo_(cfg) {
  return 'https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo +
         '/contents/' + encodeURI(CAMINHO_REPO);
}

function cabecalhos_(cfg) {
  return {
    Authorization: 'Bearer ' + cfg.token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

function enviarPraGitHub_(cfg, conteudoB64) {
  // 1) Ve se o arquivo ja existe e se o conteudo e o mesmo.
  var atual = UrlFetchApp.fetch(urlConteudo_(cfg) + '?ref=' + BRANCH, {
    method: 'get',
    headers: cabecalhos_(cfg),
    muteHttpExceptions: true
  });

  var sha = null;
  if (atual.getResponseCode() === 200) {
    var j = JSON.parse(atual.getContentText());
    sha = j.sha;
    // A API devolve base64 quebrado em linhas; tira tudo que nao e base64.
    var antigo = (j.content || '').replace(/\s/g, '');
    if (antigo && antigo === conteudoB64.replace(/\s/g, '')) return 'igual';
  } else if (atual.getResponseCode() !== 404) {
    throw new Error('GitHub respondeu ' + atual.getResponseCode() +
                    ' ao consultar o arquivo: ' + atual.getContentText().slice(0, 400));
  }

  // 2) Cria ou atualiza.
  var corpo = {
    message: 'Planilha de bancos de bateria atualizada automaticamente',
    content: conteudoB64,
    branch: BRANCH
  };
  if (sha) corpo.sha = sha;

  var resp = UrlFetchApp.fetch(urlConteudo_(cfg), {
    method: 'put',
    headers: cabecalhos_(cfg),
    contentType: 'application/json',
    payload: JSON.stringify(corpo),
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  if (code !== 200 && code !== 201) {
    throw new Error('GitHub recusou o envio (' + code + '): ' +
                    resp.getContentText().slice(0, 400));
  }
  return code === 201 ? 'criado' : 'atualizado';
}

function limpar_(todas, processada) {
  todas.forEach(function (m) {
    try {
      if (m.getId() === processada.getId()) { m.markRead(); return; }
      m.moveToTrash();
    } catch (e) { /* mensagem ja movida, ignora */ }
  });
}

// ---------------------------------------------------------------- gatilho
// 1 HORA e proposital, nao limitacao: foi o intervalo comunicado a equipe
// ("sincroniza em ate 1h"), e alinhar expectativa vale mais que latencia.
// O Power Automate tambem roda de hora em hora, entao os dois lados batem.
//
// Se um dia trocar o gatilho do Power Automate para disparar no envio do
// Forms, troque aqui tambem para .everyMinutes(15) -- senao o e-mail sai em
// segundos e fica parado ate o script olhar a caixa, jogando fora o ganho.
// O Apps Script aceita apenas 1, 5, 10, 15 ou 30 minutos.
function instalarGatilho() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processar') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processar').timeBased().everyHours(1).create();
  Logger.log('Gatilho instalado: processar() a cada 1 hora.');
}

function removerGatilho() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processar') ScriptApp.deleteTrigger(t);
  });
  Logger.log('Gatilho removido.');
}

/** Roda uma vez a mao pra conferir que token, repo e anexo estao certos. */
function testar() {
  var cfg = lerConfig_();
  Logger.log('Repo: %s/%s', cfg.owner, cfg.repo);
  var r = UrlFetchApp.fetch('https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo, {
    method: 'get', headers: cabecalhos_(cfg), muteHttpExceptions: true
  });
  Logger.log('Acesso ao repo: HTTP %s', r.getResponseCode());
  if (r.getResponseCode() !== 200) {
    Logger.log('Resposta: %s', r.getContentText().slice(0, 300));
    return;
  }
  processar();
}

// ---------------------------------------------------------------- batimento
/* Grava ultima-checagem.json no branch `ponte`:
     { checadoEm, emailEm, ultimaMudanca, planilha, erro? }
   Nao versiona nada util -- e sinal de vida, sobrescrito de hora em hora. */
function baterPonte_(cfg, estado) {
  var corpo = {
    checadoEm: new Date().toISOString(),
    emailEm: estado.emailEm ? new Date(estado.emailEm).toISOString() : null,
    ultimaMudanca: PropertiesService.getScriptProperties().getProperty('ULTIMA_MUDANCA') || null,
    planilha: estado.planilha
  };
  if (estado.erro) corpo.erro = estado.erro;

  garantirBranch_(cfg, BRANCH_PONTE);

  var url = 'https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo +
            '/contents/' + encodeURI(CAMINHO_PONTE);

  var atual = UrlFetchApp.fetch(url + '?ref=' + BRANCH_PONTE, {
    method: 'get', headers: cabecalhos_(cfg), muteHttpExceptions: true
  });

  var payload = {
    message: 'Batimento da ponte',
    content: Utilities.base64Encode(JSON.stringify(corpo), Utilities.Charset.UTF_8),
    branch: BRANCH_PONTE
  };
  if (atual.getResponseCode() === 200) payload.sha = JSON.parse(atual.getContentText()).sha;

  var resp = UrlFetchApp.fetch(url, {
    method: 'put',
    headers: cabecalhos_(cfg),
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  if (code !== 200 && code !== 201) {
    throw new Error('GitHub recusou o batimento (' + code + '): ' +
                    resp.getContentText().slice(0, 300));
  }
  Logger.log('Batimento gravado (planilha: %s).', corpo.planilha);
}

/* Cria o branch na primeira vez, apontando pro topo do main. Ele nunca volta
   pro main -- so serve de prateleira pro batimento. */
function garantirBranch_(cfg, nome) {
  var base = 'https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo;

  var r = UrlFetchApp.fetch(base + '/git/ref/heads/' + nome, {
    method: 'get', headers: cabecalhos_(cfg), muteHttpExceptions: true
  });
  if (r.getResponseCode() === 200) return;
  if (r.getResponseCode() !== 404) {
    throw new Error('GitHub respondeu ' + r.getResponseCode() +
                    ' ao consultar o branch ' + nome + ': ' + r.getContentText().slice(0, 200));
  }

  var main = UrlFetchApp.fetch(base + '/git/ref/heads/' + BRANCH, {
    method: 'get', headers: cabecalhos_(cfg), muteHttpExceptions: true
  });
  if (main.getResponseCode() !== 200) {
    throw new Error('Nao consegui ler o branch ' + BRANCH + ' pra criar o ' + nome +
                    ' (' + main.getResponseCode() + ').');
  }

  var criar = UrlFetchApp.fetch(base + '/git/refs', {
    method: 'post',
    headers: cabecalhos_(cfg),
    contentType: 'application/json',
    payload: JSON.stringify({
      ref: 'refs/heads/' + nome,
      sha: JSON.parse(main.getContentText()).object.sha
    }),
    muteHttpExceptions: true
  });
  if (criar.getResponseCode() !== 201) {
    throw new Error('Nao consegui criar o branch ' + nome + ' (' + criar.getResponseCode() +
                    '): ' + criar.getContentText().slice(0, 200));
  }
  Logger.log('Branch %s criado.', nome);
}
