/* Controle de Bancos de Bateria — Icatel Telemática
   Vanilla JS, sem dependência, sem build. Lê window.DADOS (site/dados.js). */

'use strict';

/* ============================================================
   CONFIG — limiares de saúde. Ajuste aqui, sem mexer no resto.
   ============================================================

   Resistência — regra da operação, teto fixo por versão do banco:
   G4 não passa de 4,5 mOhm, G3 não passa de 2,6 mOhm. É uma linha só,
   sem faixa intermediária de atenção. A comparação de cada bateria com
   a mediana das irmãs e a amplitude entre elas, que moravam aqui antes,
   eram dedução minha em cima dos dados — não eram regra dele, e saíram. */
const CONFIG = {
  // Teto de resistência depois da desulfatação (mOhm), por versão do banco.
  // Veio dele. Versão que não estiver neste mapa fica SEM avaliação de
  // resistência — não deduzir limite (é o caso de "Carretinha" hoje).
  limiteResist: {
    G4: 4.5,
    G3: 2.6
  },
  // Tensão em repouso depois da desulfatação (V). Regra da operação:
  // abaixo de 12,30 V o banco está descarregado. Acima disso está ok —
  // não existe faixa intermediária, é uma linha só.
  tensaoBaixa: 12.30,
  // temperatura de medição (°C) — fora disso a leitura perde comparabilidade
  tempMin: 15,
  tempMax: 35,

  // Regra da operação: a desulfatação vale 3 meses, e o prazo só corre para
  // banco EM ESTOQUE. Implantado não vence — fica ligado ao carregador da
  // sirene. Ver o filtro em preparar().
  mesesValidadeDesulf: 3,
  diasAvisoVencimento: 30
};

const ORDEM_STATUS = { critico: 3, atencao: 2, ok: 1, sem: 0 };

/* ============================================================
   Utilidades
   ============================================================ */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function dataBR(iso) {
  if (!iso) return null;
  const p = String(iso).slice(0, 10).split('-');
  if (p.length !== 3) return null;
  return `${p[2]}/${p[1]}/${p[0]}`;
}

function mesRotulo(iso) {
  if (!iso) return null;
  const m = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const p = String(iso).slice(0, 10).split('-');
  return `${m[parseInt(p[1], 10) - 1]}/${p[0].slice(2)}`;
}

// Soma meses a uma data ISO. new Date(y, m+n, d) já trata o estouro de mês:
// 30/11 + 3 meses cairia em 30/02, e o JS normaliza pra 01/03 ou 02/03.
function somarMeses(iso, n) {
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const dt = new Date(a, m - 1 + n, d);
  const p = x => String(x).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

// Dias inteiros de hoje até a data. Compara só a parte da data (meia-noite
// local dos dois lados), senão a hora atual faria o resultado oscilar em 1.
function diasAte(iso) {
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const alvo = new Date(a, m - 1, d);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((alvo - hoje) / 86400000);
}

const n1 = v => (typeof v === 'number' ? v.toFixed(1) : null);
const n2 = v => (typeof v === 'number' ? v.toFixed(2) : null);

function piorStatus(lista) {
  return lista.reduce((a, b) => (ORDEM_STATUS[b] > ORDEM_STATUS[a] ? b : a), 'sem');
}

/* ============================================================
   Derivação — calcula saúde a partir dos dados crus
   ============================================================ */
function preparar(bruto) {
  const registros = (bruto.registros || []).map(reg => {
    const r = Object.assign({}, reg);
    // Teto de resistência da versão do banco (G4 / G3). Versão que não estiver
    // no mapa fica sem avaliação de resistência — ver CONFIG.limiteResist.
    const limite = CONFIG.limiteResist[String(r.versao || '').trim().toUpperCase()] || null;
    r.limiteResist = limite;

    r.baterias = r.baterias.map(b0 => {
      const b = Object.assign({}, b0);
      const motivos = [];
      let st = 'sem';

      if (typeof b.resistDepois === 'number') {
        st = 'ok';
        if (limite && b.resistDepois > limite) {
          st = 'critico';
          motivos.push(`Resistência ${n2(b.resistDepois)} mΩ — acima do limite de ${n2(limite)} mΩ do ${r.versao}`);
        }
      }

      if (typeof b.tensaoDepois === 'number') {
        if (st === 'sem') st = 'ok';
        if (b.tensaoDepois < CONFIG.tensaoBaixa) {
          st = 'critico';
          motivos.push(`Tensão ${n2(b.tensaoDepois)} V — abaixo de ${n2(CONFIG.tensaoBaixa)} V a bateria está descarregada`);
        }
      }

      // ganho da desulfatação, só quando existe medição "antes"
      b.ganhoTensao = (typeof b.tensaoAntes === 'number' && typeof b.tensaoDepois === 'number')
        ? +(b.tensaoDepois - b.tensaoAntes).toFixed(2) : null;
      b.ganhoResist = (typeof b.resistAntes === 'number' && typeof b.resistDepois === 'number')
        ? +(b.resistAntes - b.resistDepois).toFixed(2) : null;

      b.status = st;
      b.motivos = motivos;
      return b;
    });

    const statusBat = r.baterias.map(b => b.status);
    // O status do banco é o pior status entre as baterias dele, e só. Não
    // existe mais avaliação no nível do banco — a de amplitude era minha.
    r.status = piorStatus(statusBat);
    r.nCriticas = statusBat.filter(s => s === 'critico').length;
    r.nAtencao = statusBat.filter(s => s === 'atencao').length;
    // "Sem Info" é preenchimento deliberado, não célula vazia: é como a equipe
    // dá baixa em banco que já está em campo mas cuja TAG ninguém anotou na
    // época (regra dele, 27/08/2026). Conta como implantado; o que ele não tem
    // é a TAG em si, e o painel diz isso na cara em vez de fingir estoque.
    r.tagSemInfo = !!r.tag && /^sem\s*info$/i.test(r.tag);
    r.tagLimpa = r.tag && !r.tagSemInfo ? r.tag : null;
    // Retorno ao galpão (colunas BT/BU, regra dele de 27/08/2026). Mesma
    // lógica da TAG: o que conta é o campo estar preenchido, não o conteúdo —
    // "sim", "devolvido com defeito" ou qualquer anotação valem igual.
    r.retornado = !!r.retorno;
    r.retornoSemData = r.retornado && !r.dataRetorno;

    // Regra da operação: banco com o campo TAG preenchido já está implantado;
    // campo vazio é estoque. Quem manda é a TAG, não a data — a data de
    // implantação falta em boa parte dos registros e usá-la marcava como
    // "em estoque" banco que já estava em campo há meses.
    // O retorno tem a última palavra: quem voltou pro galpão não está mais em
    // campo, mesmo mantendo a TAG — ela vira histórico de onde ele esteve.
    r.implantado = !!r.tag && !r.retornado;
    r.implantSemData = r.implantado && !r.dataImplant;

    // Três situações, nessa ordem de precedência: retornado ganha de campo, e
    // campo ganha de estoque. Estoque é quem nunca saiu.
    r.situacao = r.retornado ? 'retornado' : r.implantado ? 'campo' : 'estoque';

    // Validade da desulfatação — SÓ para banco em estoque (confirmado com ele).
    // Banco implantado fica ligado ao carregador da sirene, então o relógio não
    // corre para ele. Sem o "!r.implantado" aqui, 34 dos 38 registros apareciam
    // vencidos e o painel virava parede vermelha.
    //
    // Retornado também não corre (decisão dele, 27/08/2026): o prazo só volta a
    // valer depois que alguém desulfatar DE NOVO, e "de novo" quer dizer uma
    // desulfatação posterior ao retorno. Sem essa trava, banco que passou um ano
    // em campo voltava pro galpão já vencido no dia seguinte à chegada — o
    // vermelho não diria nada além de "esse banco é antigo".
    // As datas são strings 'yyyy-MM-dd', então comparar com > funciona.
    const desulfPosRetorno = r.retornado && r.dataRetorno && r.dataDesulf > r.dataRetorno;
    const correPrazo = r.situacao === 'estoque' || desulfPosRetorno;

    if (r.dataDesulf && correPrazo) {
      const v = somarMeses(r.dataDesulf, CONFIG.mesesValidadeDesulf);
      r.venceEm = v;
      r.diasParaVencer = diasAte(v);
      r.vencido = r.diasParaVencer < 0;
      r.vencendo = !r.vencido && r.diasParaVencer <= CONFIG.diasAvisoVencimento;
    } else {
      r.venceEm = null;
      r.diasParaVencer = null;
      r.vencido = false;
      r.vencendo = false;
    }
    return r;
  });

  // agrupa por número de série normalizado → histórico do mesmo banco físico
  const porSerie = new Map();
  registros.forEach(r => {
    const k = r.serieNorm || `__sem__${r.linha}`;
    if (!porSerie.has(k)) porSerie.set(k, []);
    porSerie.get(k).push(r);
  });
  porSerie.forEach(lista => {
    lista.sort((a, b) => String(b.dataDesulf || '').localeCompare(String(a.dataDesulf || '')));
    lista.forEach((r, i) => { r.noHistorico = lista.length; r.maisRecente = i === 0; });
  });

  return { registros, porSerie, geradoEm: bruto.geradoEm, origem: bruto.origem };
}

/* ============================================================
   Estado
   ============================================================ */
const DB = preparar(window.DADOS || { registros: [] });

const estado = {
  aba: 'painel',
  busca: '',
  versao: '',
  tecnico: '',
  status: '',
  situacao: '',
  ordem: { campo: 'dataDesulf', desc: true }
};

/* ============================================================
   Filtro
   ============================================================ */
function filtrados() {
  const q = estado.busca.trim().toLowerCase();
  let lista = DB.registros.filter(r => {
    if (estado.versao && r.versao !== estado.versao) return false;
    if (estado.status && r.status !== estado.status) return false;
    if (estado.tecnico && r.tecMontagem !== estado.tecnico && r.tecConferencia !== estado.tecnico) return false;
    if (estado.situacao === 'implantado' && r.situacao !== 'campo') return false;
    if (estado.situacao === 'estoque' && r.situacao !== 'estoque') return false;
    if (estado.situacao === 'retornado' && !r.retornado) return false;
    if (estado.situacao === 'retorno-sem-data' && !r.retornoSemData) return false;
    if (estado.situacao === 'sem-data' && !r.implantSemData) return false;
    if (estado.situacao === 'vencido' && !r.vencido) return false;
    if (estado.situacao === 'vencendo' && !r.vencendo) return false;
    if (estado.situacao === 'em-dia' && !(r.diasParaVencer !== null && !r.vencido && !r.vencendo)) return false;
    if (!q) return true;
    const alvo = [
      r.serie, r.tag, r.versao, r.tecMontagem, r.tecConferencia, r.retorno,
      ...r.baterias.map(b => b.serie)
    ].filter(Boolean).join(' ').toLowerCase();
    return alvo.includes(q);
  });

  const { campo, desc } = estado.ordem;
  lista.sort((a, b) => {
    let x = a[campo], y = b[campo];
    if (campo === 'status') { x = ORDEM_STATUS[a.status]; y = ORDEM_STATUS[b.status]; }
    if (campo === 'nBat') { x = a.baterias.length; y = b.baterias.length; }
    if (x === null || x === undefined) x = '';
    if (y === null || y === undefined) y = '';
    let c;
    if (typeof x === 'number' && typeof y === 'number') c = x - y;
    else c = String(x).localeCompare(String(y), 'pt-BR', { numeric: true });
    return desc ? -c : c;
  });
  return lista;
}

/* ============================================================
   Render — painel
   ============================================================ */
function renderPainel() {
  const regs = DB.registros;
  const todasBat = regs.flatMap(r => r.baterias);
  const criticas = todasBat.filter(b => b.status === 'critico');
  const atencao = todasBat.filter(b => b.status === 'atencao');
  const bancosProblema = regs.filter(r => r.status === 'critico' || r.status === 'atencao');
  const implantados = regs.filter(r => r.situacao === 'campo').length;
  const emEstoque = regs.filter(r => r.situacao === 'estoque').length;
  const retornados = regs.filter(r => r.retornado).length;
  const vencendo = regs.filter(r => r.vencendo);
  const vencidos = regs.filter(r => r.vencido);

  $('#kpis').innerHTML = [
    kpi('Bancos distintos', DB.porSerie.size, `${regs.length} registros no formulário`),
    kpi('Baterias medidas', todasBat.length, `${todasBat.filter(b => b.serie).length} com nº de série`),
    kpi('Implantados em campo', implantados, `${emEstoque} em estoque, sem TAG`),
    kpi('Retornados ao galpão', retornados, retornados ? 'voltaram de campo' : 'nenhum voltou de campo'),
    kpi('Baterias críticas', criticas.length, criticas.length ? 'exigem troca ou reteste' : 'nenhuma fora de faixa', criticas.length ? 'ruim' : ''),
    kpi('Baterias em atenção', atencao.length, 'acompanhar na próxima ronda', atencao.length ? 'aviso' : ''),
    kpi('Estoque vencendo', vencendo.length, `desulfatação vence em até ${CONFIG.diasAvisoVencimento} dias`, vencendo.length ? 'aviso' : ''),
    kpi('Estoque vencido', vencidos.length, 'desulfatação passou dos 3 meses', vencidos.length ? 'ruim' : '')
  ].join('');

  // desulfatações por mês
  const porMes = new Map();
  regs.forEach(r => {
    if (!r.dataDesulf) return;
    const k = r.dataDesulf.slice(0, 7);
    porMes.set(k, (porMes.get(k) || 0) + 1);
  });
  const meses = Array.from(porMes.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  $('#g-meses').innerHTML = barrasSVG(
    meses.map(([k, v]) => ({ rot: mesRotulo(k + '-01'), val: v })),
    'Desulfatações registradas'
  );

  // distribuição de resistência
  $('#g-resist').innerHTML = validadeDesulfatacao(regs);

  // técnicos
  const porTec = new Map();
  regs.forEach(r => {
    [r.tecMontagem, r.tecConferencia].forEach((t, i) => {
      if (!t) return;
      if (!porTec.has(t)) porTec.set(t, { montagem: 0, conferencia: 0 });
      porTec.get(t)[i === 0 ? 'montagem' : 'conferencia']++;
    });
  });
  const tecs = Array.from(porTec.entries())
    .map(([nome, c]) => ({ nome, total: c.montagem + c.conferencia, ...c }))
    .sort((a, b) => b.total - a.total);
  const maxTec = Math.max(1, ...tecs.map(t => t.total));
  $('#g-tecnicos').innerHTML = `<div class="barras">${tecs.map(t => `
    <div class="barra-item">
      <span class="barra-rot">${esc(t.nome)}</span>
      <span class="barra-num">${t.montagem} mont. · ${t.conferencia} conf.</span>
      <span class="barra-trilho"><span class="barra-preench" style="width:${(t.total / maxTec * 100).toFixed(1)}%"></span></span>
    </div>`).join('')}</div>`;

  // versões
  const porVer = new Map();
  regs.forEach(r => {
    const v = r.versao || 'Sem versão';
    if (!porVer.has(v)) porVer.set(v, { n: 0, bat: 0 });
    porVer.get(v).n++;
    porVer.get(v).bat += r.baterias.length;
  });
  const vers = Array.from(porVer.entries()).sort((a, b) => b[1].n - a[1].n);
  const maxVer = Math.max(1, ...vers.map(v => v[1].n));
  $('#g-versoes').innerHTML = `<div class="barras">${vers.map(([v, c]) => `
    <div class="barra-item">
      <span class="barra-rot"><span class="pilula versao">${esc(v)}</span></span>
      <span class="barra-num">${c.n} registros · ${c.bat} baterias</span>
      <span class="barra-trilho"><span class="barra-preench laranja" style="width:${(c.n / maxVer * 100).toFixed(1)}%"></span></span>
    </div>`).join('')}</div>`;
}

function kpi(rot, val, sub, cls) {
  return `<div class="kpi ${cls || ''}">
    <div class="rot">${esc(rot)}</div>
    <div class="val">${val}</div>
    <div class="sub">${esc(sub)}</div>
  </div>`;
}

function barrasSVG(dados, titulo) {
  if (!dados.length) return '<p class="vazio">Sem dados de data.</p>';
  const L = 34, B = 26, T = 10, R = 6;
  const larg = Math.max(320, dados.length * 46);
  const alt = 190;
  const maxV = Math.max(...dados.map(d => d.val));
  const passo = (larg - L - R) / dados.length;
  const escY = v => T + (alt - T - B) * (1 - v / maxV);

  const ticks = [];
  const nT = Math.min(4, maxV);
  for (let i = 0; i <= nT; i++) {
    const v = Math.round(maxV * i / nT);
    ticks.push(`<line x1="${L}" y1="${escY(v)}" x2="${larg - R}" y2="${escY(v)}" stroke="var(--borda)" stroke-width="1"/>
      <text x="${L - 6}" y="${escY(v) + 3.5}" text-anchor="end" font-size="10" fill="var(--texto-tenue)">${v}</text>`);
  }

  const barras = dados.map((d, i) => {
    const x = L + i * passo + passo * 0.18;
    const w = passo * 0.64;
    const y = escY(d.val);
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${(alt - B - y).toFixed(1)}" fill="var(--teal-600)" rx="2">
        <title>${esc(d.rot)}: ${d.val} ${esc(titulo.toLowerCase())}</title></rect>
      <text x="${(x + w / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--texto-fraco)">${d.val}</text>
      <text x="${(x + w / 2).toFixed(1)}" y="${alt - B + 13}" text-anchor="middle" font-size="10" fill="var(--texto-tenue)">${esc(d.rot)}</text>`;
  }).join('');

  return `<div class="rolagem"><svg viewBox="0 0 ${larg} ${alt}" style="min-width:${larg}px" role="img" aria-label="${esc(titulo)} por mês">
    ${ticks.join('')}
    <line x1="${L}" y1="${alt - B}" x2="${larg - R}" y2="${alt - B}" stroke="var(--borda-forte)" stroke-width="1"/>
    ${barras}
  </svg></div>`;
}

function validadeDesulfatacao(regs) {
  // A desulfatação vale por CONFIG.mesesValidadeDesulf meses. O que interessa
  // no painel é o que ainda dá pra evitar — então o topo é sempre "vence em
  // breve", ordenado pelo mais urgente. Os já vencidos entram depois, contados
  // e separados entre campo e estoque, porque a ação é diferente: banco em
  // campo exige ir até a sirene; banco em estoque está aqui do lado.
  // Só entram os que têm prazo correndo, ou seja, os em estoque. Banco
  // implantado sai com diasParaVencer null lá em preparar().
  var com = regs.filter(function (r) { return r.diasParaVencer !== null; });
  if (!com.length) {
    return '<div class="val-nada">Nenhum banco em estoque com data de desulfatação.</div>';
  }

  var vencendo = com.filter(function (r) { return r.vencendo; })
                    .sort(function (a, b) { return a.diasParaVencer - b.diasParaVencer; });
  var vencidos = com.filter(function (r) { return r.vencido; })
                    .sort(function (a, b) { return a.diasParaVencer - b.diasParaVencer; });
  // "Em dia" deixou de ser só um número no rodapé e virou lista (pedido dele,
  // 27/08/2026): ver de relance quanto tempo ainda sobra em cada banco vale
  // mais que saber que "N estão ok". Ordenado pelo que vence primeiro.
  var emDia = com.filter(function (r) { return !r.vencendo && !r.vencido; })
                 .sort(function (a, b) { return a.diasParaVencer - b.diasParaVencer; });

  function linha(r, st) {
    var dias = r.diasParaVencer;
    var texto = st === 'critico'
      ? 'venceu há ' + Math.abs(dias) + (Math.abs(dias) === 1 ? ' dia' : ' dias')
      : (dias === 0 ? 'vence hoje' : 'em ' + dias + (dias === 1 ? ' dia' : ' dias'));
    return '<button class="val-item" data-linha="' + r.linha + '"' +
           ' title="Desulfatado em ' + dataBR(r.dataDesulf) + ' · vence em ' + dataBR(r.venceEm) + '. Clique para abrir.">' +
             '<span class="val-serie">' + esc(r.serie || 'sem nº') + '</span>' +
             '<span class="val-onde">desulfatado ' + dataBR(r.dataDesulf) + '</span>' +
             '<span class="val-data">vence ' + dataBR(r.venceEm) + '</span>' +
             '<span class="val-dias ' + st + '">' + texto + '</span>' +
           '</button>';
  }

  var html = '';

  if (vencendo.length) {
    html += '<div class="val-titulo atencao">Vence nos próximos ' +
            CONFIG.diasAvisoVencimento + ' dias · ' + vencendo.length + '</div>' +
            '<div class="val-lista">' +
            vencendo.map(function (r) { return linha(r, 'atencao'); }).join('') +
            '</div>';
  } else {
    html += '<div class="val-nada">Nenhuma desulfatação vence nos próximos ' +
            CONFIG.diasAvisoVencimento + ' dias.</div>';
  }

  if (vencidos.length) {
    var MOSTRAR = 8;
    // O mais antigo primeiro: banco parado há mais tempo é o que precisa
    // voltar pra bancada antes.
    var maisVelho = Math.abs(vencidos[0].diasParaVencer);

    html += '<div class="val-titulo critico">Já vencidas · ' + vencidos.length +
            '<span class="val-quebra">o mais antigo está parado há ' + maisVelho + ' dias</span>' +
            '</div>' +
            '<div class="val-lista">' +
            vencidos.slice(0, MOSTRAR).map(function (r) { return linha(r, 'critico'); }).join('') +
            '</div>';
    if (vencidos.length > MOSTRAR) {
      html += '<button class="val-ver-todos" data-filtro="vencido">' +
              'Ver as ' + vencidos.length + ' na aba Bancos →</button>';
    }
  }

  if (emDia.length) {
    var MOSTRAR_OK = 8;
    html += '<div class="val-titulo ok">Em dia · ' + emDia.length +
            '<span class="val-quebra">o primeiro vence em ' + emDia[0].diasParaVencer + ' dias</span>' +
            '</div>' +
            '<div class="val-lista">' +
            emDia.slice(0, MOSTRAR_OK).map(function (r) { return linha(r, 'ok'); }).join('') +
            '</div>';
    if (emDia.length > MOSTRAR_OK) {
      html += '<button class="val-ver-todos" data-filtro="em-dia">' +
              'Ver os ' + emDia.length + ' na aba Bancos →</button>';
    }
  }

  html += '<div class="val-rodape">' +
          '<span>' + com.length + ' banco' + (com.length === 1 ? '' : 's') + ' com prazo correndo</span>' +
          '<span>Validade de ' + CONFIG.mesesValidadeDesulf +
          ' meses. Vale só para banco em estoque — implantado não vence, e retornado ' +
          'só volta a contar depois de desulfatar de novo.</span>' +
          '</div>';

  return html;
}

/* ============================================================
   Render — lista de bancos
   ============================================================ */
const COLUNAS = [
  { k: 'status', r: 'Saúde', ord: true },
  { k: 'serie', r: 'Nº série do banco', ord: true },
  { k: 'tag', r: 'TAG da sirene', ord: true },
  { k: 'versao', r: 'Versão', ord: true },
  { k: 'nBat', r: 'Baterias', ord: true },
  { k: 'dataDesulf', r: 'Desulfatação', ord: true },
  { k: 'dataImplant', r: 'Implantação', ord: true },
  { k: 'dataRetorno', r: 'Retorno', ord: true },
  { k: 'tecMontagem', r: 'Montagem', ord: true },
  { k: 'tecConferencia', r: 'Conferência', ord: true },
  { k: 'relatorio', r: 'PDF', ord: false }
];

function renderBancos() {
  const lista = filtrados();
  $('#contagem').textContent = lista.length === DB.registros.length
    ? `${lista.length} registros`
    : `${lista.length} de ${DB.registros.length} registros`;

  // O botão de limpar só ganha destaque quando existe algo pra limpar — assim
  // ele também serve de aviso de que a lista está filtrada, que é a causa
  // número um de alguém achar que um banco "sumiu".
  const ativos = ['busca', 'versao', 'tecnico', 'status', 'situacao']
    .filter(k => estado[k]).length;
  const btn = $('#limpar-tudo');
  btn.classList.toggle('ativo', ativos > 0);
  btn.textContent = ativos > 0
    ? `Limpar ${ativos} filtro${ativos > 1 ? 's' : ''} ✕`
    : 'Limpar';

  if (!lista.length) {
    $('#tabela-bancos').innerHTML =
      '<div class="vazio"><strong>Nenhum banco encontrado</strong>Ajuste a busca ou limpe os filtros.</div>';
    return;
  }

  const cab = COLUNAS.map(c => {
    if (!c.ord) return `<th>${esc(c.r)}</th>`;
    const ativo = estado.ordem.campo === c.k;
    const seta = ativo ? `<span class="seta">${estado.ordem.desc ? '▼' : '▲'}</span>` : '';
    return `<th class="ord" data-ord="${c.k}" title="Ordenar por ${esc(c.r)}">${esc(c.r)} ${seta}</th>`;
  }).join('');

  const linha = r => `
    <tr class="clicavel ${r.situacao === 'estoque' ? 'em-estoque' : r.situacao === 'retornado' ? 'voltou' : ''}" data-linha="${r.linha}">
      <td>${selo(r)}</td>
      <td class="serie-cel">${esc(r.serie) || '<span class="vazio-cel">sem nº do banco</span>'}</td>
      <td class="tag-cel">${r.tagLimpa
        ? esc(r.tagLimpa)
        : r.tagSemInfo ? '<span class="pilula neutro">sem info</span>'
        : '<span class="pilula estoque">sem TAG</span>'}</td>
      <td><span class="pilula versao">${esc(r.versao) || '?'}</span></td>
      <td class="num">${r.baterias.length}</td>
      <td class="num">${dataBR(r.dataDesulf) || '<span class="vazio-cel">—</span>'}</td>
      <td class="num">${dataBR(r.dataImplant)
        || (r.tag ? '<span class="vazio-cel">sem data</span>'
                  : '<span class="cel-estoque">em estoque</span>')}</td>
      <td class="num">${r.retornado
        ? (dataBR(r.dataRetorno) || '<span class="vazio-cel">sem data</span>')
        : '<span class="vazio-cel">—</span>'}</td>
      <td>${esc(r.tecMontagem) || '<span class="vazio-cel">—</span>'}</td>
      <td>${esc(r.tecConferencia) || '<span class="vazio-cel">—</span>'}</td>
      <td>${r.relatorio ? `<a href="${esc(r.relatorio)}" target="_blank" rel="noopener" title="Abrir relatório no SharePoint">PDF</a>` : '<span class="vazio-cel">—</span>'}</td>
    </tr>`;

  // Três faixas, na ordem em que interessam ao galpão: o que está parado ali
  // em cima, o que voltou no meio, o que está em campo embaixo.
  // A ordenação escolhida no cabeçalho continua valendo DENTRO de cada grupo —
  // clicar numa coluna não mistura os grupos de novo.
  const grupos = [
    ['estoque',   'Em estoque — ainda não implantados', lista.filter(r => r.situacao === 'estoque')],
    ['retornado', 'Retornados ao galpão',               lista.filter(r => r.situacao === 'retornado')],
    ['campo',     'Implantados em campo',               lista.filter(r => r.situacao === 'campo')]
  ];
  const faixa = (rot, n, cls) => `
    <tr class="grupo-linha ${cls}"><td colspan="${COLUNAS.length}">
      <span class="grupo-rot">${rot}</span><span class="grupo-qtd">${n}</span>
    </td></tr>`;

  const corpo = grupos
    .filter(([, , rs]) => rs.length)
    .map(([cls, rot, rs]) => faixa(rot, rs.length, cls) + rs.map(linha).join(''))
    .join('');

  $('#tabela-bancos').innerHTML =
    `<div class="rolagem"><table><thead><tr>${cab}</tr></thead><tbody>${corpo}</tbody></table></div>`;
}

function selo(r) {
  if (r.status === 'critico') return `<span class="pilula critico">${r.nCriticas ? r.nCriticas + ' crítica' + (r.nCriticas > 1 ? 's' : '') : 'crítico'}</span>`;
  if (r.status === 'atencao') return `<span class="pilula atencao">atenção</span>`;
  if (r.status === 'ok') return `<span class="pilula ok">ok</span>`;
  return `<span class="pilula neutro">sem medição</span>`;
}

/* ============================================================
   Render — alertas
   ============================================================ */
function renderAlertas() {
  const itens = [];
  DB.registros.forEach(r => {
    r.baterias.forEach(b => {
      if (b.status === 'critico' || b.status === 'atencao') itens.push({ r, b });
    });
  });
  itens.sort((a, b) => ORDEM_STATUS[b.b.status] - ORDEM_STATUS[a.b.status]);

  $('#contagem-alertas').textContent = itens.length ? `${itens.length} pontos de atenção` : '';

  if (!itens.length) {
    $('#lista-alertas').innerHTML =
      '<div class="vazio"><strong>Nenhum alerta</strong>Todas as medições estão dentro das faixas configuradas.</div>';
    return;
  }

  $('#lista-alertas').innerHTML = `<div class="lista-quali">${itens.map(({ r, b }) => {
    const st = b.status;
    const motivos = b.motivos;
    const titulo = `Bateria ${b.pos} do banco ${esc(r.serie || '—')}${b.serie ? ` · ${esc(b.serie)}` : ''}`;
    return `<div class="quali-item cartao" data-linha="${r.linha}" style="cursor:pointer">
      <div class="icone ${st}">${st === 'critico' ? '!' : '·'}</div>
      <div class="txt">
        <strong>${titulo}</strong>
        <span>${esc(motivos.join(' · '))}</span>
        <div class="quali-alvos">
          ${r.tagLimpa ? `<span class="chip">${esc(r.tagLimpa)}</span>` : ''}
          <span class="chip">${esc(r.versao || '?')}</span>
          ${r.dataDesulf ? `<span class="chip">desulf. ${dataBR(r.dataDesulf)}</span>` : ''}
          <span class="chip">${r.implantado ? 'em campo' : 'em estoque'}</span>
        </div>
      </div>
      <div class="qtd"><span class="pilula ${st}">${st === 'critico' ? 'crítico' : 'atenção'}</span></div>
    </div>`;
  }).join('')}</div>`;
}

/* ============================================================
   Render — qualidade dos dados
   ============================================================ */
function renderQualidade() {
  const regs = DB.registros;
  const bat = regs.flatMap(r => r.baterias);

  const dups = [];
  DB.porSerie.forEach((lista, k) => {
    if (lista.length > 1 && !k.startsWith('__sem__')) {
      dups.push({ chave: k, lista });
    }
  });

  const itens = [
    {
      st: 'atencao',
      t: 'Registros do mesmo banco físico',
      d: 'Mesmo nº de série de BANCO lançado em mais de um registro (às vezes escrito diferente, com ou sem zeros à esquerda). O site já agrupa, mas vale conferir se é reteste ou lançamento duplicado.',
      n: dups.reduce((a, d) => a + d.lista.length, 0),
      alvos: dups.flatMap(d => d.lista.map(r => ({ rot: r.serie || '—', linha: r.linha })))
    },
    {
      st: 'critico',
      t: 'Baterias sem medição "antes" da desulfatação',
      d: 'Sem o "antes" não dá pra provar o ganho da desulfatação — nem em relatório, nem pro cliente. É o buraco mais caro da planilha hoje.',
      n: bat.filter(b => typeof b.tensaoAntes !== 'number' && typeof b.resistAntes !== 'number').length,
      alvos: []
    },
    {
      st: 'atencao',
      t: 'Baterias sem nº de série',
      d: 'Sem o nº de série da bateria não há rastreio: não dá pra saber se uma bateria ruim já tinha sido reprovada antes, nem acionar garantia do fabricante.',
      n: bat.filter(b => !b.serie).length,
      alvos: []
    },
    {
      st: 'info',
      t: 'Bancos em estoque (sem TAG de sirene)',
      d: 'Pela regra da operação, banco com o campo TAG em branco ainda não foi implantado. Se algum destes já estiver em campo, falta dar baixa no formulário — com a TAG, ou com "sem info" quando ninguém souber qual é.',
      n: regs.filter(r => r.situacao === 'estoque').length,
      alvos: regs.filter(r => r.situacao === 'estoque').map(r => ({ rot: r.serie || '—', linha: r.linha }))
    },
    {
      st: 'atencao',
      t: 'Retornados sem data de retorno',
      d: 'Voltaram pro galpão, mas ninguém registrou quando. Sem a data não dá pra saber se a desulfatação feita depois é mais nova que o retorno — e é isso que decide se o prazo de 3 meses volta a correr. Enquanto faltar, o banco fica fora da conta de vencimento.',
      n: regs.filter(r => r.retornoSemData).length,
      alvos: regs.filter(r => r.retornoSemData).map(r => ({ rot: r.serie || '—', linha: r.linha }))
    },
    {
      st: 'atencao',
      t: 'Retornados esperando desulfatação',
      d: 'Voltaram de campo e a desulfatação registrada é anterior ao retorno — ou seja, ninguém desulfatou depois que o banco chegou. O prazo de 3 meses só volta a correr quando isso for feito e registrado no formulário.',
      n: regs.filter(r => r.retornado && r.dataRetorno && !(r.dataDesulf > r.dataRetorno)).length,
      alvos: regs.filter(r => r.retornado && r.dataRetorno && !(r.dataDesulf > r.dataRetorno))
        .map(r => ({ rot: r.serie || '—', linha: r.linha }))
    },
    {
      st: 'atencao',
      t: 'Implantados sem data de implantação',
      d: 'Estão em campo — o campo TAG foi preenchido — mas ninguém registrou quando foram instalados. Sem a data não dá pra calcular há quanto tempo o banco está em operação, que é o que prevê a próxima manutenção.',
      n: regs.filter(r => r.implantSemData).length,
      alvos: regs.filter(r => r.implantSemData).map(r => ({ rot: r.serie || '—', linha: r.linha }))
    },
    {
      st: 'atencao',
      t: 'Data de implantação digitada como texto',
      d: 'O Forms aceitou texto livre em vez de data. O conversor já entende os dois formatos, mas travar o campo como data no formulário evita o problema na origem.',
      n: regs.filter(r => r.dataImplantRaw && /\//.test(r.dataImplantRaw)).length,
      alvos: regs.filter(r => r.dataImplantRaw && /\//.test(r.dataImplantRaw)).map(r => ({ rot: `${r.serie}: ${r.dataImplantRaw}`, linha: r.linha }))
    },
    {
      st: 'info',
      t: 'Baterias sem data de fabricação',
      d: 'Sem ela não dá pra calcular a idade da bateria — que é o melhor previsor de falha que existe nesse tipo de ativo.',
      n: bat.filter(b => !b.fabricacao).length,
      alvos: []
    },
    {
      st: 'info',
      t: 'Registros sem PDF de relatório anexado',
      d: 'O link do relatório fica vazio nesses registros.',
      n: regs.filter(r => !r.relatorio).length,
      alvos: regs.filter(r => !r.relatorio).map(r => ({ rot: r.serie || '—', linha: r.linha }))
    },
    {
      st: 'info',
      t: 'Medições fora da faixa de temperatura',
      d: `Leituras feitas abaixo de ${CONFIG.tempMin} °C ou acima de ${CONFIG.tempMax} °C perdem comparabilidade — resistência interna varia com a temperatura.`,
      n: bat.filter(b => typeof b.temperatura === 'number' && (b.temperatura < CONFIG.tempMin || b.temperatura > CONFIG.tempMax)).length,
      alvos: []
    }
  ].filter(i => i.n > 0);

  $('#lista-qualidade').innerHTML = `<div class="lista-quali">${itens.map(i => `
    <div class="quali-item cartao">
      <div class="icone ${i.st}">${i.st === 'critico' ? '!' : i.st === 'atencao' ? '·' : 'i'}</div>
      <div class="txt">
        <strong>${esc(i.t)}</strong>
        <span>${esc(i.d)}</span>
        ${i.alvos.length ? `<div class="quali-alvos">${i.alvos.slice(0, 24).map(a =>
          `<button class="chip" data-linha="${a.linha}">${esc(a.rot)}</button>`).join('')}
          ${i.alvos.length > 24 ? `<span class="chip" style="cursor:default">+${i.alvos.length - 24}</span>` : ''}</div>` : ''}
      </div>
      <div class="qtd">${i.n}</div>
    </div>`).join('')}</div>`;
}

/* ============================================================
   Render — detalhe do banco
   ============================================================ */
function abrirDetalhe(linha) {
  const r = DB.registros.find(x => x.linha === Number(linha));
  if (!r) return;

  const pdf = r.relatorio
    ? `<a class="pdf" href="${esc(r.relatorio)}" target="_blank" rel="noopener">Abrir PDF</a>`
    : `<div class="val ausente">sem anexo</div>`;

  const cartoes = `
    <div class="cartoes-topo">
      <div class="cartao-topo"><div class="rot">TAG Sirene</div>
        <div class="val ${r.tagLimpa ? '' : r.tagSemInfo ? 'ausente' : 'em-estoque'}">${r.tagLimpa
          ? esc(r.tagLimpa)
          : r.tagSemInfo ? 'sem info' : 'EM ESTOQUE'}</div></div>
      <div class="cartao-topo"><div class="rot">Nº de Série do Banco</div>
        <div class="val">${esc(r.serie) || '—'}</div></div>
      <div class="cartao-topo"><div class="rot">Versão</div>
        <div class="val">${esc(r.versao) || '—'}</div></div>
      <div class="cartao-topo"><div class="rot">Desulfatação</div>
        <div class="val pequeno">${dataBR(r.dataDesulf) || '—'}</div>
        ${r.venceEm ? `<div class="cartao-validade ${r.vencido ? 'critico' : r.vencendo ? 'atencao' : 'ok'}">${
          r.vencido
            ? `venceu há ${Math.abs(r.diasParaVencer)} d`
            : r.diasParaVencer === 0 ? 'vence hoje'
            : `vale mais ${r.diasParaVencer} d`
        }</div>` : ''}</div>
      <div class="cartao-topo"><div class="rot">Implantação</div>
        <div class="val pequeno ${r.dataImplant ? '' : 'ausente'}">${dataBR(r.dataImplant)
          || (r.tag ? 'sem data' : 'em estoque')}</div></div>
      <div class="cartao-topo"><div class="rot">Retorno ao galpão</div>
        <div class="val pequeno ${r.retornado ? '' : 'ausente'}">${r.retornado
          ? (dataBR(r.dataRetorno) || 'voltou, sem data')
          : 'não retornou'}</div>
        ${r.retornado && r.retorno && !/^sim$/i.test(r.retorno)
          ? `<div class="cartao-nota">${esc(r.retorno)}</div>` : ''}</div>
      <div class="cartao-topo"><div class="rot">Relatório</div>${pdf}</div>
    </div>`;

  // Deixa explícito qual teto de resistência valeu para este banco — e avisa
  // quando a versão não tem teto definido, em vez de fingir que está tudo ok.
  const blocoAvisos = r.limiteResist
    ? `<div class="aviso-faixa"><div>Limite de resistência do ${esc(r.versao)}: <strong>${n2(r.limiteResist)} mΩ</strong> por bateria.</div></div>`
    : `<div class="aviso-faixa critico"><div>Versão <strong>${esc(r.versao) || '—'}</strong> não tem limite de resistência definido — as baterias deste banco não estão sendo avaliadas por resistência.</div></div>`;

  // tabela de baterias — mesma leitura do BI (grupos Antes / Depois)
  const linhas = r.baterias.map(b => {
    const cls = s => s === 'critico' ? 'marc-critico' : s === 'atencao' ? 'marc-atencao' : '';
    const stT = (typeof b.tensaoDepois === 'number' && b.tensaoDepois < CONFIG.tensaoBaixa)
      ? 'critico' : '';
    const stR = (typeof b.resistDepois === 'number' && r.limiteResist && b.resistDepois > r.limiteResist)
      ? 'critico' : '';
    const cel = (v, extra) => v === null
      ? `<td class="medida sem ${extra || ''}">—</td>`
      : `<td class="medida ${extra || ''}">${v}</td>`;
    return `<tr class="${b.status === 'critico' ? 'linha-critica' : ''}">
      <td class="pos">B${b.pos}</td>
      <td class="serie-bat">${esc(b.serie) || '<span class="vazio-cel">sem nº da bateria</span>'}</td>
      <td class="medida sem" style="font-size:12.5px">${dataBR(b.fabricacao) || '—'}</td>
      ${cel(n2(b.tensaoAntes))}
      ${cel(n2(b.resistAntes))}
      ${cel(n2(b.tensaoDepois), 'destaque divisor-v ' + cls(stT))}
      ${cel(n2(b.resistDepois), 'destaque ' + cls(stR))}
      ${cel(n1(b.temperatura))}
    </tr>`;
  }).join('');

  const tabela = `
    <div class="cartao rolagem">
      <table class="tab-bat">
        <thead>
          <tr>
            <th colspan="3"></th>
            <th class="grupo antes" colspan="2">Antes da desulfatação</th>
            <th class="grupo divisor-v" colspan="3">Depois da desulfatação</th>
          </tr>
          <tr>
            <th style="text-align:center">Pos.</th>
            <th style="text-align:left">Nº série da bateria</th>
            <th>Fabricação</th>
            <th>Tensão (V)</th>
            <th>Resist. (mΩ)</th>
            <th class="divisor-v">Tensão (V)</th>
            <th>Resist. (mΩ)</th>
            <th>Temp. (°C)</th>
          </tr>
        </thead>
        <tbody>${linhas || '<tr><td colspan="8" class="sem">Nenhuma bateria registrada.</td></tr>'}</tbody>
      </table>
    </div>`;

  // histórico do mesmo banco físico
  const irmaos = DB.porSerie.get(r.serieNorm) || [r];
  const hist = irmaos.length > 1 ? `
    <div class="secao-titulo">Outros registros deste mesmo banco (${irmaos.length})</div>
    <div class="hist-lista">${irmaos.map(o => `
      <div class="hist-item ${o.linha === r.linha ? 'atual' : ''}">
        <span class="serie-cel">${esc(o.serie)}</span>
        <span>${dataBR(o.dataDesulf) || 'sem data'}</span>
        <span>${o.baterias.length} baterias</span>
        ${selo(o)}
        ${o.linha === r.linha ? '<span class="pilula neutro" style="margin-left:auto">exibindo</span>'
          : `<button data-linha="${o.linha}">Ver</button>`}
      </div>`).join('')}</div>` : '';

  const meta = `
    <div class="meta-grade">
      ${metaItem('Técnico — montagem', r.tecMontagem)}
      ${metaItem('Técnico — conferência', r.tecConferencia)}
      ${metaItem('Já foi desulfatado?', r.jaDesulfatado)}
      ${metaItem('Formulário preenchido por', r.preenchidoPor)}
      ${metaItem('Enviado em', r.fim ? r.fim.replace(' ', ' às ') : null)}
      ${metaItem('Linha na planilha', r.linha)}
    </div>`;

  $('#gaveta-titulo').innerHTML =
    `${esc(r.serie || 'Banco sem série')}${r.tagLimpa ? ` · ${esc(r.tagLimpa)}` : ''}`;
  $('#gaveta-selo').innerHTML = selo(r);
  $('#gaveta-corpo').innerHTML = cartoes + blocoAvisos + tabela + meta + hist;
  $('#detalhe').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#gaveta').scrollTop = 0;
  $('#fechar-detalhe').focus();
}

function metaItem(rot, val) {
  return `<div class="meta-item"><div class="rot">${esc(rot)}</div>
    <div class="val ${val ? '' : 'ausente'}">${val ? esc(val) : 'não informado'}</div></div>`;
}

function fecharDetalhe() {
  $('#detalhe').hidden = true;
  document.body.style.overflow = '';
}

/* ============================================================
   Filtros — popular selects
   ============================================================ */
function popularFiltros() {
  const vers = Array.from(new Set(DB.registros.map(r => r.versao).filter(Boolean))).sort();
  $('#f-versao').innerHTML = '<option value="">Todas as versões</option>' +
    vers.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');

  const tecs = Array.from(new Set(
    DB.registros.flatMap(r => [r.tecMontagem, r.tecConferencia]).filter(Boolean)
  )).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  $('#f-tecnico').innerHTML = '<option value="">Todos os técnicos</option>' +
    tecs.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
}

/* ============================================================
   Abas
   ============================================================ */
function trocarAba(nome) {
  estado.aba = nome;
  $$('.aba').forEach(b => b.setAttribute('aria-selected', String(b.dataset.aba === nome)));
  $$('.painel').forEach(p => { p.hidden = p.dataset.painel !== nome; });
  if (nome === 'painel') renderPainel();
  if (nome === 'bancos') renderBancos();
  if (nome === 'alertas') renderAlertas();
  if (nome === 'qualidade') renderQualidade();
}

/* ============================================================
   Eventos
   ============================================================ */
function ligarEventos() {
  $$('.aba').forEach(b => b.addEventListener('click', () => trocarAba(b.dataset.aba)));

  $('#f-busca').addEventListener('input', e => {
    estado.busca = e.target.value;
    $('#limpar-busca').style.visibility = estado.busca ? 'visible' : 'hidden';
    renderBancos();
  });
  $('#limpar-busca').addEventListener('click', () => {
    estado.busca = '';
    $('#f-busca').value = '';
    $('#limpar-busca').style.visibility = 'hidden';
    renderBancos();
    $('#f-busca').focus();
  });

  ['versao', 'tecnico', 'status', 'situacao'].forEach(k => {
    $('#f-' + k).addEventListener('change', e => { estado[k] = e.target.value; renderBancos(); });
  });

  $('#limpar-tudo').addEventListener('click', () => {
    Object.assign(estado, { busca: '', versao: '', tecnico: '', status: '', situacao: '' });
    $('#f-busca').value = '';
    ['versao', 'tecnico', 'status', 'situacao'].forEach(k => { $('#f-' + k).value = ''; });
    $('#limpar-busca').style.visibility = 'hidden';
    renderBancos();
  });

  // ordenação + clique na linha
  $('#tabela-bancos').addEventListener('click', e => {
    const th = e.target.closest('th.ord');
    if (th) {
      const campo = th.dataset.ord;
      if (estado.ordem.campo === campo) estado.ordem.desc = !estado.ordem.desc;
      else estado.ordem = { campo, desc: campo === 'dataDesulf' || campo === 'status' };
      renderBancos();
      return;
    }
    if (e.target.closest('a')) return;
    const tr = e.target.closest('tr[data-linha]');
    if (tr) abrirDetalhe(tr.dataset.linha);
  });

  $('#lista-alertas').addEventListener('click', e => {
    const el = e.target.closest('[data-linha]');
    if (el) abrirDetalhe(el.dataset.linha);
  });

  // cartão de validade no painel: item abre o banco, "ver todos" leva pra
  // aba Bancos já filtrada
  $('#g-resist').addEventListener('click', e => {
    const todos = e.target.closest('button[data-filtro]');
    if (todos) {
      estado.situacao = todos.dataset.filtro;
      $('#f-situacao').value = todos.dataset.filtro;
      trocarAba('bancos');
      return;
    }
    const el = e.target.closest('button[data-linha]');
    if (el) abrirDetalhe(el.dataset.linha);
  });

  $('#lista-qualidade').addEventListener('click', e => {
    const el = e.target.closest('button[data-linha]');
    if (el) abrirDetalhe(el.dataset.linha);
  });

  $('#gaveta-corpo').addEventListener('click', e => {
    const b = e.target.closest('button[data-linha]');
    if (b) abrirDetalhe(b.dataset.linha);
  });

  $('#fechar-detalhe').addEventListener('click', fecharDetalhe);
  $('#detalhe').addEventListener('click', e => { if (e.target.id === 'detalhe') fecharDetalhe(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#detalhe').hidden) fecharDetalhe();
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      trocarAba('bancos');
      $('#f-busca').focus();
    }
  });

  // tema
  $('#btn-tema').addEventListener('click', () => {
    const escuro = document.documentElement.dataset.tema === 'escuro';
    document.documentElement.dataset.tema = escuro ? 'claro' : 'escuro';
    $('#btn-tema').textContent = escuro ? 'Escuro' : 'Claro';
    try { localStorage.setItem('tema-baterias', document.documentElement.dataset.tema); } catch (_) {}
    if (estado.aba === 'painel') renderPainel();
  });
}

/* ============================================================
   Estado da corrente
   ============================================================

   O Power BI que este painel substituiu falhava de um jeito específico:
   continuava abrindo bonito enquanto servia dado de sete meses atrás, e
   ninguém percebia. Esta corrente pode falhar igual, e em três lugares:

     Power Automate → e-mail    para: a planilha nunca chega
     Apps Script    → commit    para: nada entra no GitHub
     GitHub Actions → Pages     para: entra e não publica

   Nenhum dos três avisa ninguém. Por isso a ponte grava um batimento a cada
   rodada em ultima-checagem.json, no branch `ponte` — fora do caminho que
   dispara o workflow, então não rebuilda o site nem enche o histórico do
   main. O selo lê esse arquivo pra dizer QUAL metade parou.

   O que NÃO é alarme: planilha sem alteração. A equipe monta ~1 banco por
   semana e às vezes acumula preenchimento por dias (informado por ele em
   28/08/2026) — semana parada é operação normal, não falha. Antes o selo
   ficava vermelho nessa situação dizendo "Sem atualizar há 23h", e lia como
   sistema quebrado. A idade do dado continua visível, só que sem cor. */

const PONTE_URL = 'https://raw.githubusercontent.com/galpaotsi/painel-baterias/ponte/ultima-checagem.json';

// Os dois lados da ponte rodam de hora em hora. Uma rodada perdida é ruído —
// o Apps Script atrasa alguns minutos sozinho; três seguidas é padrão. Esse
// limiar vem da cadência das máquinas, não do ritmo do laboratório.
const HORAS_PONTE = 3;

// Acima disso o selo troca "Atualizado" por "Sem alterações há X" — mesma cor,
// só uma leitura mais honesta de dado que já dormiu.
const HORAS_PARADO = 4;

function dataDe(v) {
  if (!v) return null;
  const d = new Date(/Z$|[+-]\d{2}:\d{2}$/.test(v) ? v : String(v).replace(' ', 'T'));
  return isNaN(d) ? null : d;
}

function fmtQuando(d) {
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

function fmtIdade(ms) {
  const h = ms / 3600000;
  if (h < 24) return `há ${Math.max(1, Math.floor(h))}h`;
  const d = Math.floor(h / 24);
  return `há ${d} dia${d > 1 ? 's' : ''}`;
}

/* Arquivo minúsculo num branch que não dispara nada. O ?t= fura o cache de
   5 min do raw.githubusercontent. Se a rede da empresa bloquear, ou o arquivo
   ainda não existir, volta null — e o selo cai no estado neutro em vez de
   inventar alarme. */
function buscarPonte() {
  return fetch(PONTE_URL + '?t=' + Date.now(), { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null);
}

function selo(el, classe, texto, dica) {
  el.className = 'selo-atualizado' + (classe ? ' ' + classe : '');
  el.textContent = texto;
  el.title = dica;
}

function mostrarFrescor(ponte) {
  const el = $('#atualizado');
  const dGerado = dataDe(DB.geradoEm);
  if (!dGerado) { el.textContent = ''; return; }

  const quando = fmtQuando(dGerado);
  // Versões antigas do conversor gravavam "YYYY-MM-DD HH:MM" sem fuso. Sem
  // saber de onde a hora saiu, não dá pra calcular idade — mostra e cala.
  const temFuso = /Z$|[+-]\d{2}:\d{2}$/.test(DB.geradoEm);

  if (!ponte || !temFuso) {
    selo(el, '', `Dados de ${quando}`,
      'Última vez que a planilha foi convertida e publicada.');
    return;
  }

  const agora = Date.now();
  const limite = HORAS_PONTE * 3600000;
  const dCheck = dataDe(ponte.checadoEm);
  const dEmail = dataDe(ponte.emailEm);
  const dMudanca = dataDe(ponte.ultimaMudanca);

  // 1) O script parou de rodar (gatilho desativado, token vencido, cota).
  if (!dCheck || agora - dCheck > limite) {
    selo(el, 'critico',
      dCheck ? `⚠ Sincronização parada desde ${fmtQuando(dCheck)}` : '⚠ Sincronização parada',
      `O script que traz a planilha não roda desde então. O painel está mostrando os dados de ${quando}.`);
    return;
  }

  // 2) O script roda, mas a planilha parou de chegar — o envio automático caiu.
  if (!dEmail || agora - dEmail > limite) {
    selo(el, 'critico',
      dEmail ? `⚠ Planilha não chega desde ${fmtQuando(dEmail)}` : '⚠ Planilha não chega',
      `O envio automático da planilha parou. O painel está mostrando os dados de ${quando}.`);
    return;
  }

  // 3) Chegou planilha nova e o site não publicou. Meia hora de tolerância:
  //    converter e publicar leva alguns minutos.
  if (dMudanca && dMudanca - dGerado > 30 * 60000) {
    selo(el, 'atencao', '⚠ Planilha nova não publicada',
      `Chegou planilha em ${fmtQuando(dMudanca)}, mas o painel ainda mostra a de ${quando}.`);
    return;
  }

  // 4) Corrente inteira funcionando. Dado parado aqui é operação, não falha.
  const idade = agora - dGerado;
  const dica = `Sincronizado às ${fmtQuando(dCheck)}. A planilha só muda quando alguém preenche o Forms — dias sem alteração são normais.`;
  if (idade < HORAS_PARADO * 3600000) {
    selo(el, '', `Atualizado ${quando}`, dica);
  } else {
    selo(el, '', `✓ Sem alterações ${fmtIdade(idade)} · ${quando}`, dica);
  }
}

/* ============================================================
   Início
   ============================================================ */
(function iniciar() {
  try {
    const t = localStorage.getItem('tema-baterias');
    if (t) {
      document.documentElement.dataset.tema = t;
      $('#btn-tema').textContent = t === 'escuro' ? 'Claro' : 'Escuro';
    }
  } catch (_) {}

  const criticos = DB.registros.flatMap(r => r.baterias).filter(b => b.status === 'critico').length;
  if (criticos) {
    $('#cont-alertas').textContent = criticos;
    $('#aba-alertas').classList.add('alerta');
  }
  $('#cont-bancos').textContent = DB.registros.length;

  // Pinta com o que a página já sabe e refina quando o batimento chegar: rede
  // lenta não segura o cabeçalho, e ninguém vê alarme falso piscando.
  mostrarFrescor(null);
  buscarPonte().then(mostrarFrescor);

  popularFiltros();
  ligarEventos();
  trocarAba('painel');
})();
