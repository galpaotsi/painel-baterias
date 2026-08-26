/* Controle de Bancos de Bateria — Icatel Telemática
   Vanilla JS, sem dependência, sem build. Lê window.DADOS (site/dados.js). */

'use strict';

/* ============================================================
   CONFIG — limiares de saúde. Ajuste aqui, sem mexer no resto.
   ============================================================

   Por que a resistência é avaliada em RELAÇÃO ao próprio banco, e não
   por um número fixo: os dados mostram duas populações bem separadas —
   bancos de 4 baterias (G3 / Carretinha) vivem em ~2,1–2,4 mOhm e os de
   8 baterias (G4) em ~2,7–3,9 mOhm. Um limiar fixo que serve pra um
   acusa falso positivo no outro. Comparando cada bateria com a MEDIANA
   das irmãs do mesmo banco, a regra se adapta sozinha — inclusive a
   uma versão nova que ainda não existe hoje.

   O sinal que importa num banco em série é o ELO FRACO: a bateria que
   destoa das vizinhas é a que vai derrubar o conjunto. */
const CONFIG = {
  // PROVISÓRIO — deduzido dos dados, não é regra da operação.
  // O parâmetro oficial de resistência ainda vai ser informado; quando vier,
  // troque estes números (e provavelmente a própria lógica, se o critério
  // dele for um valor absoluto em vez de comparação com o próprio banco).
  // resistência da bateria ÷ mediana do banco
  razaoResistCritico: 1.8,
  razaoResistAtencao: 1.35,
  // teto absoluto, independente do banco (mOhm)
  resistAbsolutoCritico: 8.0,
  // Tensão em repouso depois da desulfatação (V). Regra da operação:
  // abaixo de 12,30 V o banco está descarregado. Acima disso está ok —
  // não existe faixa intermediária, é uma linha só.
  tensaoBaixa: 12.30,
  // amplitude (max-min) da resistência dentro do banco (mOhm)
  spreadCritico: 1.0,
  spreadAtencao: 0.6,
  // temperatura de medição (°C) — fora disso a leitura perde comparabilidade
  tempMin: 15,
  tempMax: 35
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

function mediana(arr) {
  const v = arr.filter(x => typeof x === 'number').slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
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
    const resistencias = r.baterias.map(b => b.resistDepois).filter(v => typeof v === 'number');
    const med = mediana(resistencias);
    r.medianaResist = med;
    r.spread = resistencias.length >= 2
      ? +(Math.max(...resistencias) - Math.min(...resistencias)).toFixed(2)
      : null;

    r.baterias = r.baterias.map(b0 => {
      const b = Object.assign({}, b0);
      const motivos = [];
      let st = 'sem';

      if (typeof b.resistDepois === 'number') {
        st = 'ok';
        b.razao = med ? +(b.resistDepois / med).toFixed(2) : null;
        if (b.resistDepois >= CONFIG.resistAbsolutoCritico) {
          st = 'critico';
          motivos.push(`Resistência ${n2(b.resistDepois)} mΩ acima do teto absoluto (${CONFIG.resistAbsolutoCritico} mΩ)`);
        } else if (b.razao && b.razao >= CONFIG.razaoResistCritico) {
          st = 'critico';
          motivos.push(`Resistência ${b.razao}× a mediana do banco (${n2(med)} mΩ)`);
        } else if (b.razao && b.razao >= CONFIG.razaoResistAtencao) {
          st = 'atencao';
          motivos.push(`Resistência ${b.razao}× a mediana do banco (${n2(med)} mΩ)`);
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
    let st = piorStatus(statusBat);
    const motivosBanco = [];
    if (r.spread !== null) {
      if (r.spread >= CONFIG.spreadCritico) {
        st = 'critico';
        motivosBanco.push(`Amplitude de ${n2(r.spread)} mΩ entre as baterias — banco desbalanceado`);
      } else if (r.spread >= CONFIG.spreadAtencao) {
        if (st !== 'critico') st = 'atencao';
        motivosBanco.push(`Amplitude de ${n2(r.spread)} mΩ entre as baterias`);
      }
    }
    r.status = st;
    r.motivosBanco = motivosBanco;
    r.nCriticas = statusBat.filter(s => s === 'critico').length;
    r.nAtencao = statusBat.filter(s => s === 'atencao').length;
    r.temAntes = r.baterias.some(b => typeof b.tensaoAntes === 'number' || typeof b.resistAntes === 'number');
    r.tagLimpa = r.tag && !/^sem\s*info$/i.test(r.tag) ? r.tag : null;
    // Regra da operação: banco COM TAG de sirene já está implantado; SEM TAG
    // está em estoque. Quem manda é a TAG, não a data — a data de implantação
    // falta em boa parte dos registros e usá-la marcava como "em estoque"
    // banco que já estava em campo há meses.
    r.implantado = !!r.tagLimpa;
    r.implantSemData = r.implantado && !r.dataImplant;
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
    if (estado.situacao === 'implantado' && !r.implantado) return false;
    if (estado.situacao === 'estoque' && r.implantado) return false;
    if (estado.situacao === 'sem-data' && !r.implantSemData) return false;
    if (!q) return true;
    const alvo = [
      r.serie, r.tag, r.versao, r.tecMontagem, r.tecConferencia,
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
  const implantados = regs.filter(r => r.implantado).length;

  $('#kpis').innerHTML = [
    kpi('Bancos distintos', DB.porSerie.size, `${regs.length} registros no formulário`),
    kpi('Baterias medidas', todasBat.length, `${todasBat.filter(b => b.serie).length} com nº de série`),
    kpi('Implantados em campo', implantados, `${regs.length - implantados} em estoque, sem TAG`),
    kpi('Baterias críticas', criticas.length, criticas.length ? 'exigem troca ou reteste' : 'nenhuma fora de faixa', criticas.length ? 'ruim' : ''),
    kpi('Baterias em atenção', atencao.length, 'acompanhar na próxima ronda', atencao.length ? 'aviso' : ''),
    kpi('Bancos a revisar', bancosProblema.length, 'com ao menos um alerta', bancosProblema.length ? 'aviso' : '')
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
  $('#g-resist').innerHTML = desequilibrioPorBanco(regs);

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

function desequilibrioPorBanco(regs) {
  // Num banco em serie a corrente e a mesma em todas as baterias, entao a de
  // MAIOR resistencia e a que limita o conjunto inteiro. O numero absoluto nao
  // serve de comparacao (G3/Carretinha vivem em ~2,2 mOhm e G4 em ~3,3), mas a
  // DIFERENCA dentro do mesmo banco serve pra qualquer versao. Por isso o
  // grafico mostra amplitude, nao valor bruto: banco parelho tem barra curta,
  // banco com uma bateria destoando tem barra longa.
  var br = function (v) { return (typeof v === 'number') ? v.toFixed(2).replace('.', ',') : '—'; };

  var itens = regs
    .filter(function (r) { return r.spread !== null; })
    .map(function (r) {
      return {
        linha: r.linha,
        serie: r.serie || 'sem série',
        tag: r.tagLimpa,
        spread: r.spread,
        med: r.medianaResist,
        nBat: r.baterias.length,
        status: r.spread >= CONFIG.spreadCritico ? 'critico'
              : r.spread >= CONFIG.spreadAtencao ? 'atencao' : 'ok'
      };
    })
    .sort(function (a, b) { return b.spread - a.spread; });

  if (!itens.length) return '<p class="vazio">Sem medições suficientes de resistência.</p>';

  var MOSTRAR = 12;
  var topo = itens.slice(0, MOSTRAR);
  var resto = itens.length - topo.length;

  // A escala nunca encolhe abaixo do limiar de atencao, senao um dia em que
  // todos os bancos estao bons faria a maior barra parecer alarmante.
  var maior = topo[0].spread;
  var escala = Math.max(maior, CONFIG.spreadAtencao * 1.25);

  var linhas = topo.map(function (i) {
    var pct = Math.max(1.5, i.spread / escala * 100);
    var rotulo = i.tag ? esc(i.serie) + ' <span class="deseq-tag">' + esc(i.tag) + '</span>'
                       : esc(i.serie);
    return '<button class="deseq-item" data-linha="' + i.linha + '"' +
           ' title="Mediana do banco: ' + br(i.med) + ' mΩ · ' + i.nBat + ' baterias. Clique para abrir.">' +
             '<span class="deseq-rot">' + rotulo + '</span>' +
             '<span class="deseq-trilho">' +
               '<span class="deseq-barra ' + i.status + '" style="width:' + pct.toFixed(1) + '%"></span>' +
             '</span>' +
             '<span class="deseq-val ' + i.status + '">' + br(i.spread) + '</span>' +
           '</button>';
  }).join('');

  var equilibrados = itens.filter(function (i) { return i.status === 'ok'; }).length;

  return '<div class="deseq">' + linhas + '</div>' +
    '<div class="deseq-rodape">' +
      '<span><span class="ponto critico"></span>a partir de ' + br(CONFIG.spreadCritico) + ' mΩ — desbalanceado</span>' +
      '<span><span class="ponto atencao"></span>' + br(CONFIG.spreadAtencao) + ' a ' + br(CONFIG.spreadCritico) + ' mΩ — observar</span>' +
      '<span><span class="ponto ok"></span>abaixo — equilibrado (' + equilibrados + ' de ' + itens.length + ' bancos)</span>' +
      (resto > 0
        ? '<span class="deseq-resto">Mostrando os ' + MOSTRAR + ' maiores. Os outros ' + resto +
          ' ficam abaixo de ' + br(topo[topo.length - 1].spread) + ' mΩ.</span>'
        : '') +
    '</div>';
}

/* ============================================================
   Render — lista de bancos
   ============================================================ */
const COLUNAS = [
  { k: 'status', r: 'Saúde', ord: true },
  { k: 'serie', r: 'Nº de série', ord: true },
  { k: 'tag', r: 'TAG da sirene', ord: true },
  { k: 'versao', r: 'Versão', ord: true },
  { k: 'nBat', r: 'Baterias', ord: true },
  { k: 'dataDesulf', r: 'Desulfatação', ord: true },
  { k: 'dataImplant', r: 'Implantação', ord: true },
  { k: 'tecMontagem', r: 'Montagem', ord: true },
  { k: 'tecConferencia', r: 'Conferência', ord: true },
  { k: 'relatorio', r: 'PDF', ord: false }
];

function renderBancos() {
  const lista = filtrados();
  $('#contagem').textContent = lista.length === DB.registros.length
    ? `${lista.length} registros`
    : `${lista.length} de ${DB.registros.length} registros`;

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

  const corpo = lista.map(r => `
    <tr class="clicavel" data-linha="${r.linha}">
      <td>${selo(r)}</td>
      <td class="serie-cel">${esc(r.serie) || '<span class="vazio-cel">sem série</span>'}</td>
      <td class="tag-cel">${r.tagLimpa ? esc(r.tagLimpa) : '<span class="vazio-cel">sem TAG</span>'}</td>
      <td><span class="pilula versao">${esc(r.versao) || '?'}</span></td>
      <td class="num">${r.baterias.length}</td>
      <td class="num">${dataBR(r.dataDesulf) || '<span class="vazio-cel">—</span>'}</td>
      <td class="num">${dataBR(r.dataImplant)
        || (r.implantado ? '<span class="vazio-cel">sem data</span>'
                         : '<span class="vazio-cel">estoque</span>')}</td>
      <td>${esc(r.tecMontagem) || '<span class="vazio-cel">—</span>'}</td>
      <td>${esc(r.tecConferencia) || '<span class="vazio-cel">—</span>'}</td>
      <td>${r.relatorio ? `<a href="${esc(r.relatorio)}" target="_blank" rel="noopener" title="Abrir relatório no SharePoint">PDF</a>` : '<span class="vazio-cel">—</span>'}</td>
    </tr>`).join('');

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
    if (r.motivosBanco.length) itens.push({ r, b: null });
  });
  itens.sort((a, b) => {
    const sa = a.b ? a.b.status : r0(a.r), sb = b.b ? b.b.status : r0(b.r);
    return ORDEM_STATUS[sb] - ORDEM_STATUS[sa];
  });
  function r0(r) { return r.status; }

  $('#contagem-alertas').textContent = itens.length ? `${itens.length} pontos de atenção` : '';

  if (!itens.length) {
    $('#lista-alertas').innerHTML =
      '<div class="vazio"><strong>Nenhum alerta</strong>Todas as medições estão dentro das faixas configuradas.</div>';
    return;
  }

  $('#lista-alertas').innerHTML = `<div class="lista-quali">${itens.map(({ r, b }) => {
    const st = b ? b.status : r.status;
    const motivos = b ? b.motivos : r.motivosBanco;
    const titulo = b
      ? `Bateria ${b.pos} do banco ${esc(r.serie || '—')}${b.serie ? ` · ${esc(b.serie)}` : ''}`
      : `Banco ${esc(r.serie || '—')} — conjunto desbalanceado`;
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
      d: 'Mesmo número de série lançado em mais de um registro (às vezes escrito diferente, com ou sem zeros à esquerda). O site já agrupa, mas vale conferir se é reteste ou lançamento duplicado.',
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
      t: 'Baterias sem número de série',
      d: 'Sem série não há rastreio: não dá pra saber se uma bateria ruim já tinha sido reprovada antes, nem acionar garantia do fabricante.',
      n: bat.filter(b => !b.serie).length,
      alvos: []
    },
    {
      st: 'info',
      t: 'Bancos em estoque (sem TAG de sirene)',
      d: 'Pela regra da operação, banco sem TAG ainda não foi implantado. Se algum destes já estiver em campo, falta preencher a TAG no formulário.',
      n: regs.filter(r => !r.tagLimpa).length,
      alvos: regs.filter(r => !r.tagLimpa).map(r => ({ rot: r.serie || '—', linha: r.linha }))
    },
    {
      st: 'atencao',
      t: 'Implantados sem data de implantação',
      d: 'Têm TAG de sirene — ou seja, estão em campo — mas ninguém registrou quando foram instalados. Sem a data não dá pra calcular há quanto tempo o banco está em operação, que é o que prevê a próxima manutenção.',
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
        <div class="val ${r.tagLimpa ? '' : 'ausente'}">${r.tagLimpa ? esc(r.tagLimpa) : 'sem TAG'}</div></div>
      <div class="cartao-topo"><div class="rot">Nº de Série do Banco</div>
        <div class="val">${esc(r.serie) || '—'}</div></div>
      <div class="cartao-topo"><div class="rot">Versão</div>
        <div class="val">${esc(r.versao) || '—'}</div></div>
      <div class="cartao-topo"><div class="rot">Desulfatação</div>
        <div class="val pequeno">${dataBR(r.dataDesulf) || '—'}</div></div>
      <div class="cartao-topo"><div class="rot">Implantação</div>
        <div class="val pequeno ${r.dataImplant ? '' : 'ausente'}">${dataBR(r.dataImplant)
          || (r.implantado ? 'em campo, sem data' : 'em estoque')}</div></div>
      <div class="cartao-topo"><div class="rot">Relatório</div>${pdf}</div>
    </div>`;

  const avisos = [];
  r.motivosBanco.forEach(m => avisos.push({ st: r.spread >= CONFIG.spreadCritico ? 'critico' : 'atencao', txt: m }));
  if (!r.temAntes) {
    avisos.push({
      st: 'atencao',
      txt: 'Este registro não tem medição <strong>antes</strong> da desulfatação — só o depois. Não dá pra demonstrar o ganho do processo.'
    });
  }
  const blocoAvisos = avisos.map(a =>
    `<div class="aviso-faixa ${a.st === 'critico' ? 'critico' : ''}"><div>${a.txt}</div></div>`).join('');

  // tabela de baterias — mesma leitura do BI (grupos Antes / Depois)
  const linhas = r.baterias.map(b => {
    const cls = s => s === 'critico' ? 'marc-critico' : s === 'atencao' ? 'marc-atencao' : '';
    const stT = (typeof b.tensaoDepois === 'number' && b.tensaoDepois < CONFIG.tensaoBaixa)
      ? 'critico' : '';
    const stR = typeof b.resistDepois !== 'number' ? '' :
      (b.resistDepois >= CONFIG.resistAbsolutoCritico || (b.razao && b.razao >= CONFIG.razaoResistCritico)) ? 'critico' :
      (b.razao && b.razao >= CONFIG.razaoResistAtencao) ? 'atencao' : '';
    const cel = (v, extra) => v === null
      ? `<td class="medida sem ${extra || ''}">—</td>`
      : `<td class="medida ${extra || ''}">${v}</td>`;
    return `<tr class="${b.status === 'critico' ? 'linha-critica' : ''}">
      <td class="pos">B${b.pos}</td>
      <td class="serie-bat">${esc(b.serie) || '<span class="vazio-cel">sem série</span>'}</td>
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
            <th style="text-align:left">Nº de série</th>
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

  // barras de desequilíbrio no painel — cada uma abre o banco
  $('#g-resist').addEventListener('click', e => {
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

  const criticos = DB.registros.flatMap(r => r.baterias).filter(b => b.status === 'critico').length
    + DB.registros.filter(r => r.motivosBanco.length).length;
  if (criticos) {
    $('#cont-alertas').textContent = criticos;
    $('#aba-alertas').classList.add('alerta');
  }
  $('#cont-bancos').textContent = DB.registros.length;

  $('#atualizado').textContent = DB.geradoEm
    ? `Dados de ${dataBR(DB.geradoEm.slice(0, 10))} · ${DB.geradoEm.slice(11)}`
    : '';

  popularFiltros();
  ligarEventos();
  trocarAba('painel');
})();
