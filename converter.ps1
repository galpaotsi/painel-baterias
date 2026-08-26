<#
  Converte o export do Forms (Controle de Bancos de Bateria Oficial.xlsx)
  para site/dados.js -- um arquivo JS que o site le direto, sem servidor.

  Uso:
    powershell -ExecutionPolicy Bypass -File converter.ps1
    powershell -ExecutionPolicy Bypass -File converter.ps1 -Xlsx "C:\caminho\outro.xlsx"

  Por que .js e nao .json: abrindo o index.html com duplo clique (file://),
  o navegador BLOQUEIA fetch() de arquivo local por CORS. Um .js carregado
  via <script> passa. Assim o site funciona sem subir servidor nenhum.
#>
param(
  [string]$Xlsx,
  [string]$Saida = "$PSScriptRoot\site\dados.js",
  # Modo desassistido (Agendador de Tarefas): nao para em erro, so registra no log.
  [switch]$Silencioso
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

# [System.IO.File]::WriteAllText resolve caminho relativo contra o diretorio do
# processo .NET, que NAO acompanha o Set-Location do PowerShell. Passando
# -Saida 'site/dados.js' o arquivo ia parar na pasta errada (ou dava
# DirectoryNotFoundException). Entao resolve pra absoluto aqui, uma vez.
if ($Saida -and -not [System.IO.Path]::IsPathRooted($Saida)) {
  $Saida = Join-Path (Get-Location).Path $Saida
}

$LogPath = "$PSScriptRoot\converter.log"
function Log($msg) {
  $linha = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
  Add-Content -Path $LogPath -Value $linha -Encoding utf8
  if (-not $Silencioso) { Write-Host $msg }
}

# Caminho da planilha: parametro > caminho.local.txt > export manual em dados/Info.
# O caminho.local.txt e escrito pelo automatizar.ps1 e fica fora do git
# (aponta pra estrutura de pastas da maquina dele).
if (-not $Xlsx) {
  $cfg = "$PSScriptRoot\caminho.local.txt"
  if (Test-Path $cfg) {
    $Xlsx = (Get-Content $cfg -Raw -Encoding UTF8).Trim()
  } else {
    $Xlsx = "$PSScriptRoot\..\..\dados\Info\Controle de Bancos de Bateria Oficial.xlsx"
  }
}

if (-not (Test-Path $Xlsx)) {
  Log "ERRO: planilha nao encontrada em $Xlsx"
  if ($Silencioso) { exit 1 }
  throw "Planilha nao encontrada: $Xlsx"
}

# Com OneDrive, o arquivo pode estar sendo sincronizado bem na hora da leitura,
# ou aberto por alguem no Excel. Em vez de falhar a rodada, tenta de novo.
$tentativas = 0
while ($true) {
  try {
    $fs = [System.IO.File]::Open((Resolve-Path $Xlsx), 'Open', 'Read', 'ReadWrite')
    $fs.Close()
    break
  } catch {
    $tentativas++
    if ($tentativas -ge 5) {
      Log "ERRO: planilha travada/indisponivel depois de 5 tentativas ($Xlsx)"
      if ($Silencioso) { exit 1 }
      throw "Nao consegui abrir a planilha: $Xlsx"
    }
    Start-Sleep -Seconds 6
  }
}

# --- Tecnicos: mesma pessoa escrita de jeitos diferentes no Forms. ---
# O campo e livre no formulario, entao cada um digita como quer. Sem esse
# mapa o agrupamento por tecnico quebra. CONFIRA e ajuste se algo estiver errado.
$AliasTecnico = @{
  'Marcelo Georgius Lucas Ferreira' = 'Marcelo Giorgius Lucas Ferreira'
  'Marcelo Ferreira'                = 'Marcelo Giorgius Lucas Ferreira'
  'Leandro'                         = 'Leandro Fagner Moreira'
  'Leandro Fagner'                  = 'Leandro Fagner Moreira'
}

function Resolve-Tecnico([string]$n) {
  if ([string]::IsNullOrWhiteSpace($n)) { return $null }
  $n = ($n -replace '\s+', ' ').Trim()
  if ($AliasTecnico.ContainsKey($n)) { return $AliasTecnico[$n] }
  return $n
}

# ---------- leitura do xlsx (zip + xml, sem dependencia externa) ----------
$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $Xlsx))
try {
  function Read-Entry([string]$name) {
    $e = $zip.Entries | Where-Object { $_.FullName -eq $name }
    if (-not $e) { return $null }
    $sr = New-Object System.IO.StreamReader($e.Open(), [System.Text.Encoding]::UTF8)
    try { return $sr.ReadToEnd() } finally { $sr.Dispose() }
  }

  [xml]$ssXml = Read-Entry 'xl/sharedStrings.xml'
  $shared = @()
  foreach ($si in $ssXml.sst.si) {
    if ($si.t -is [string]) { $shared += $si.t }
    elseif ($null -ne $si.t) { $shared += $si.t.'#text' }
    else { $shared += (($si.r | ForEach-Object { if ($_.t -is [string]) { $_.t } else { $_.t.'#text' } }) -join '') }
  }

  [xml]$sh = Read-Entry 'xl/worksheets/sheet1.xml'
} finally { $zip.Dispose() }

function ColIdx([string]$ref) {
  $l = ($ref -replace '\d', ''); $n = 0
  foreach ($ch in $l.ToCharArray()) { $n = $n * 26 + ([int][char]$ch - 64) }
  return $n - 1
}

$rows = @{}
foreach ($row in $sh.worksheet.sheetData.row) {
  $r = [int]$row.r; $cells = @{}
  foreach ($c in $row.c) {
    $idx = ColIdx $c.r; $v = $null
    if     ($c.t -eq 's')         { $v = $shared[[int]$c.v] }
    elseif ($c.t -eq 'inlineStr') { $v = $c.is.t }
    elseif ($null -ne $c.v)       { $v = $c.v }
    if ($null -ne $v -and "$v".Trim() -ne '') { $cells[$idx] = "$v".Trim() }
  }
  if ($cells.Count -gt 0) { $rows[$r] = $cells }
}

# ---------- conversores de tipo ----------
# A planilha mistura data-serial do Excel (45708) com texto "25/05/2026".
# O parser tem que aguentar os dois ou perde registro.
function To-Data($v) {
  if ([string]::IsNullOrWhiteSpace($v)) { return $null }
  $v = "$v".Trim()
  if ($v -match '^\d+(\.\d+)?$') {
    $d = [double]$v
    if ($d -lt 1 -or $d -gt 80000) { return $null }
    return (Get-Date '1899-12-30').AddDays($d).ToString('yyyy-MM-dd')
  }
  foreach ($f in @('dd/MM/yyyy', 'd/M/yyyy', 'yyyy-MM-dd', 'dd-MM-yyyy')) {
    $out = [datetime]::MinValue
    if ([datetime]::TryParseExact($v, $f, [Globalization.CultureInfo]::InvariantCulture, 'None', [ref]$out)) {
      return $out.ToString('yyyy-MM-dd')
    }
  }
  return $null
}

function To-DataHora($v) {
  if ([string]::IsNullOrWhiteSpace($v)) { return $null }
  if ("$v" -match '^\d+(\.\d+)?$') { return (Get-Date '1899-12-30').AddDays([double]$v).ToString('yyyy-MM-dd HH:mm') }
  return $null
}

function To-Num($v) {
  if ([string]::IsNullOrWhiteSpace($v)) { return $null }
  $x = "$v".Trim() -replace ',', '.'
  if ($x -match '^-?\d+(\.\d+)?$') { return [double]$x }
  return $null
}

function Norm-Serie([string]$s) {
  if ([string]::IsNullOrWhiteSpace($s)) { return $null }
  $t = ("$s" -replace '[^0-9A-Za-z]', '').ToUpper().TrimStart('0')
  if ($t -eq '') { return '0' }
  return $t
}

function Limpa([string]$s) {
  if ([string]::IsNullOrWhiteSpace($s)) { return $null }
  return ("$s" -replace '\s+', ' ').Trim()
}

# ---------- montagem dos registros ----------
$COL = @{
  Id = 0; Inicio = 1; Fim = 2; Email = 3; Nome = 4; DataDesulf = 5; Serie = 6
  TecMontagem = 7; TecConferencia = 8; Tag = 10; DataImplant = 11
  JaDesulfatado = 12; Versao = 13; Relatorio = 70
}
$BAT_BASE = 14   # 8 baterias x 7 campos, colunas O..BR

$registros = @()
foreach ($r in ($rows.Keys | Where-Object { $_ -gt 1 } | Sort-Object)) {
  $d = $rows[$r]
  $g = { param($i) if ($d.ContainsKey($i)) { $d[$i] } else { $null } }

  $baterias = @()
  for ($b = 0; $b -lt 8; $b++) {
    $i = $BAT_BASE + ($b * 7)
    $serie   = Limpa (&$g $i)
    $fab     = To-Data (&$g ($i + 1))
    $tAntes  = To-Num  (&$g ($i + 2))
    $rAntes  = To-Num  (&$g ($i + 3))
    $tDepois = To-Num  (&$g ($i + 4))
    $rDepois = To-Num  (&$g ($i + 5))
    $temp    = To-Num  (&$g ($i + 6))

    $temAlgo = $serie -or $fab -or ($null -ne $tAntes) -or ($null -ne $rAntes) -or
               ($null -ne $tDepois) -or ($null -ne $rDepois) -or ($null -ne $temp)
    if (-not $temAlgo) { continue }

    $baterias += [PSCustomObject][ordered]@{
      pos          = $b + 1
      serie        = $serie
      fabricacao   = $fab
      tensaoAntes  = $tAntes
      resistAntes  = $rAntes
      tensaoDepois = $tDepois
      resistDepois = $rDepois
      temperatura  = $temp
    }
  }

  $serieRaw = Limpa (&$g $COL.Serie)
  $registros += [PSCustomObject][ordered]@{
    id             = To-Num (&$g $COL.Id)
    linha          = $r
    serie          = $serieRaw
    serieNorm      = Norm-Serie $serieRaw
    versao         = Limpa (&$g $COL.Versao)
    tag            = Limpa (&$g $COL.Tag)
    jaDesulfatado  = Limpa (&$g $COL.JaDesulfatado)
    dataDesulf     = To-Data (&$g $COL.DataDesulf)
    dataImplant    = To-Data (&$g $COL.DataImplant)
    dataImplantRaw = Limpa (&$g $COL.DataImplant)
    tecMontagem    = Resolve-Tecnico (&$g $COL.TecMontagem)
    tecConferencia = Resolve-Tecnico (&$g $COL.TecConferencia)
    preenchidoPor  = Resolve-Tecnico (&$g $COL.Nome)
    email          = Limpa (&$g $COL.Email)
    inicio         = To-DataHora (&$g $COL.Inicio)
    fim            = To-DataHora (&$g $COL.Fim)
    relatorio      = Limpa (&$g $COL.Relatorio)
    baterias       = @($baterias)
  }
}

# SEMPRE em UTC, formato ISO com o "Z" no fim. Rodando aqui o relogio e de
# Brasilia; rodando no GitHub Actions e UTC -- gravar a hora local de cada um
# fazia o site publicado mostrar 3h a frente, sem dizer que era outro fuso.
# O navegador converte pro fuso de quem esta olhando.
$payload = [PSCustomObject][ordered]@{
  geradoEm  = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  origem    = (Split-Path $Xlsx -Leaf)
  registros = @($registros)
}

$json = $payload | ConvertTo-Json -Depth 10 -Compress
$js = "// Gerado por converter.ps1 em $((Get-Date).ToString('yyyy-MM-dd HH:mm')). Nao editar a mao.`r`nwindow.DADOS = $json;`r`n"

$dir = Split-Path $Saida -Parent
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
[System.IO.File]::WriteAllText($Saida, $js, (New-Object System.Text.UTF8Encoding $false))

$nBat = ($registros | ForEach-Object { $_.baterias.Count } | Measure-Object -Sum).Sum
$nBancos = ($registros | Where-Object { $_.serieNorm } | Select-Object -ExpandProperty serieNorm -Unique).Count

# Compara so a parte de dados (ignorando o carimbo de hora do cabecalho) pra
# saber se a planilha realmente mudou desde a ultima rodada.
# SHA256 e nao GetHashCode(): hash de string nao e estavel entre processos.
$sha = [System.Security.Cryptography.SHA256]::Create()
try {
  $assinatura = [BitConverter]::ToString(
    $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($json))
  ).Replace('-', '')
} finally { $sha.Dispose() }
$marcaPath = "$PSScriptRoot\.ultima-rodada"
$anterior = if (Test-Path $marcaPath) { (Get-Content $marcaPath -Raw).Trim() } else { '' }
Set-Content -Path $marcaPath -Value $assinatura -Encoding utf8

if ("$assinatura" -eq $anterior) {
  Log "sem mudanca na planilha ($($registros.Count) registros, $nBancos bancos, $nBat baterias)"
} else {
  Log "ATUALIZADO: $($registros.Count) registros | $nBancos bancos distintos | $nBat baterias -> $Saida"
}
