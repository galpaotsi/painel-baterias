<#
  Testa o painel de verdade, num navegador, sem Node e sem Python.

  Monta duas copias do site/ numa pasta temporaria:
    t1 = dado real, do dados.js atual
    t2 = o mesmo dado com cinco retornos de mentira, cobrindo os cinco casos
         da regra de retorno ao galpao

  Injeta uma sonda em cada uma, abre no Edge headless e imprime faixas da
  tabela, KPIs, bloco de validade, alertas de qualidade e a situacao de cada
  registro. Serve pra conferir qualquer mexida nas regras de preparar().

  Uso:  powershell -ExecutionPolicy Bypass -File testar-painel.ps1

  ARMADILHAS JA PAGAS -- nao "simplificar" sem ler:

  1. --headless=new NAO escreve no stdout do PowerShell. Tem que ser o
     --headless antigo, com Start-Process -RedirectStandardOutput.
  2. A tranca de senha e CSS (html:not([data-liberado])), nao so JS. Remover o
     senha.js nao basta: a pagina sai em branco no print. Tem que setar o
     data-liberado na mao.
  3. Este arquivo PRECISA de BOM. PowerShell 5.1 le .ps1 sem BOM como ANSI, e
     qualquer caractere acentuado vira lixo que quebra o parse da string.
#>
param(
  [string]$Edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
  # Guarda as copias e os prints. Some junto com o %TEMP% do Windows.
  [string]$Trabalho = (Join-Path $env:TEMP 'painel-baterias-teste'),
  # Alem do relatorio de texto, tira print das abas Painel e Bancos.
  [switch]$Prints
)

$ErrorActionPreference = 'Stop'
$Site = Join-Path $PSScriptRoot 'site'

if (-not (Test-Path $Edge))  { throw "Edge nao encontrado em $Edge. Passe -Edge com o caminho certo." }
if (-not (Test-Path "$Site\dados.js")) {
  throw "site\dados.js nao existe. Rode o converter.ps1 antes: powershell -File converter.ps1"
}

$sonda = @'
<pre id="TESTE"></pre>
<script>
document.documentElement.setAttribute('data-liberado', '1');
window.addEventListener('load', function () {
  var out = [];
  function p(s) { out.push(s); }
  try {
    trocarAba('bancos');
    p('FAIXAS: ' + [].map.call(document.querySelectorAll('tr.grupo-linha'), function (tr) {
      return tr.className.replace('grupo-linha ', '').trim() + '=' + tr.querySelector('.grupo-qtd').textContent;
    }).join(' | '));
    p('LINHAS roxas=' + document.querySelectorAll('tbody tr.voltou').length +
      ' laranja=' + document.querySelectorAll('tbody tr.em-estoque').length +
      ' total=' + document.querySelectorAll('tbody tr.clicavel').length);
    trocarAba('painel');
    p('KPIS: ' + [].map.call(document.querySelectorAll('#kpis .kpi'), function (k) {
      return k.querySelector('.rot').textContent + '=' + k.querySelector('.val').textContent;
    }).join(' | '));
    p('VALIDADE: ' + [].map.call(document.querySelectorAll('#g-resist .val-titulo'), function (t) {
      return '[' + t.className.replace('val-titulo ', '') + '] ' + t.textContent.trim().replace(/\s+/g, ' ');
    }).join('  ||  '));
    trocarAba('qualidade');
    p('QUALIDADE:');
    [].forEach.call(document.querySelectorAll('#lista-qualidade .quali-item'), function (q) {
      var t = q.querySelector('strong'), n = q.querySelector('.qtd');
      p('   ' + (n ? n.textContent.trim() : '?') + '  ' + (t ? t.textContent.trim() : '?'));
    });
    var sit = {};
    DB.registros.forEach(function (r) { sit[r.situacao] = (sit[r.situacao] || 0) + 1; });
    p('SITUACAO: ' + JSON.stringify(sit));
    p('RETORNADOS: ' + DB.registros.filter(function (r) { return r.retornado; }).map(function (r) {
      return r.serie + '[ret=' + r.dataRetorno + ' des=' + r.dataDesulf + ' dias=' + r.diasParaVencer + ']';
    }).join('  '));
  } catch (e) { p('ERRO JS: ' + e.message + ' @ ' + (e.stack || '').split('\n')[1]); }
  document.getElementById('TESTE').textContent = out.join('\n');
});
</script>
'@

$utf8 = New-Object Text.UTF8Encoding($false)

foreach ($n in @('t1', 't2')) {
  $dir = Join-Path $Trabalho $n
  if (Test-Path $dir) { [IO.Directory]::Delete($dir, $true) }
  New-Item -ItemType Directory $dir -Force | Out-Null
  Copy-Item "$Site\*" $dir -Force
  Remove-Item (Join-Path $dir 'senha.js') -Force -ErrorAction SilentlyContinue

  $idx = Join-Path $dir 'index.html'
  $h = [IO.File]::ReadAllText($idx, $utf8)
  $h = $h -replace '<script src="senha\.js"></script>\s*', ''
  $h = $h.Replace('</body>', $sonda + "`r`n</body>")
  [IO.File]::WriteAllText($idx, $h, $utf8)
}

# t2 recebe os retornos de mentira. Datas relativas a hoje pra que o teste nao
# apodreca: o que hoje esta "em dia" continuaria em dia daqui a seis meses.
$hoje = Get-Date
$dj = Join-Path $Trabalho 't2\dados.js'
$t = [IO.File]::ReadAllText($dj, $utf8)
$i = $t.IndexOf('{', $t.IndexOf('window.DADOS'))
$pre = $t.Substring(0, $i)
$d = $t.Substring($i).TrimEnd("`r", "`n", ";") | ConvertFrom-Json
$ct = @($d.registros | Where-Object { $_.tag -and $_.tag -notmatch '^(?i)sem\s*info$' })
function Dia([int]$n) { $hoje.AddDays($n).ToString('yyyy-MM-dd') }

# desulfatou DEPOIS do retorno -> prazo corre, sobra bastante  => "em dia"
$ct[0].retorno = 'Sim'; $ct[0].dataRetorno = (Dia -26); $ct[0].dataDesulf = (Dia -17)
# desulfatou DEPOIS do retorno, mas ja perto do fim           => "vencendo"
$ct[1].retorno = 'Sim'; $ct[1].dataRetorno = (Dia -148); $ct[1].dataDesulf = (Dia -83)
# desulfatacao ANTERIOR ao retorno -> prazo parado            => nenhum grupo
$ct[2].retorno = 'Sim'; $ct[2].dataRetorno = (Dia -26); $ct[2].dataDesulf = (Dia -553)
# retornou sem data de retorno -> prazo parado + alerta proprio
$ct[3].retorno = 'Sim'; $ct[3].dataRetorno = $null; $ct[3].dataDesulf = (Dia -544)
# anotacao livre em vez de "sim" -> conta igual, e a nota aparece no detalhe
$ct[4].retorno = 'Devolvido com defeito na caixa'; $ct[4].dataRetorno = (Dia -38); $ct[4].dataDesulf = (Dia -594)

[IO.File]::WriteAllText($dj, $pre + ($d | ConvertTo-Json -Depth 10 -Compress) + ";`r`n", $utf8)

$base = 'file:///' + $Trabalho.Replace('\', '/')

foreach ($n in @('t1', 't2')) {
  $dom = Join-Path $Trabalho "dom_$n.html"
  Start-Process -FilePath $Edge -ArgumentList @(
    '--headless', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=9000',
    "--user-data-dir=$Trabalho\prof_$n", '--dump-dom', "$base/$n/index.html"
  ) -RedirectStandardOutput $dom -RedirectStandardError (Join-Path $Trabalho "err_$n.txt") -NoNewWindow -Wait | Out-Null

  $rot = if ($n -eq 't1') { 'DADO REAL' } else { 'COM 5 RETORNOS DE TESTE' }
  Write-Host "================ $n - $rot ================"
  $m = [regex]::Match([IO.File]::ReadAllText($dom, $utf8), '(?s)<pre id="TESTE">(.*?)</pre>')
  if ($m.Success) {
    ($m.Groups[1].Value -replace '&amp;', '&' -replace '&lt;', '<' -replace '&gt;', '>') -split "`n" |
      ForEach-Object { "  $_" }
  } else {
    Write-Host "  A sonda nao rodou. Veja $dom e err_$n.txt."
  }
  Write-Host ""
}

if ($Prints) {
  foreach ($aba in @('painel', 'bancos')) {
    $dir = Join-Path $Trabalho "print_$aba"
    if (Test-Path $dir) { [IO.Directory]::Delete($dir, $true) }
    Copy-Item (Join-Path $Trabalho 't2') $dir -Recurse -Force
    $idx = Join-Path $dir 'index.html'
    $h = [IO.File]::ReadAllText($idx, $utf8)
    $h = [regex]::Replace($h, '(?s)<pre id="TESTE"></pre>.*?</script>',
         "<script>document.documentElement.setAttribute('data-liberado','1');" +
         "window.addEventListener('load',function(){var t=document.getElementById('tranca');" +
         "if(t)t.remove();trocarAba('$aba');});</script>")
    [IO.File]::WriteAllText($idx, $h, $utf8)

    $png = Join-Path $Trabalho "print_$aba.png"
    $alt = if ($aba -eq 'bancos') { 1500 } else { 1250 }
    Start-Process -FilePath $Edge -ArgumentList @(
      '--headless', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=9000',
      "--user-data-dir=$Trabalho\profp_$aba", "--window-size=1600,$alt",
      "--screenshot=$png", "$base/print_$aba/index.html"
    ) -NoNewWindow -Wait | Out-Null
    Write-Host "print: $png"
  }
}

Write-Host "Copias e saidas em: $Trabalho"
