<#
  Deixa o painel de bancos de bateria automatico.

  O que ele faz:
    1. Procura a planilha do SharePoint sincronizada no PC
    2. Grava o caminho encontrado em caminho.local.txt
    3. Registra uma tarefa no Agendador de Tarefas do Windows
    4. Roda uma vez pra confirmar que funcionou

  PRE-REQUISITO (so voce pode fazer, precisa do login da Icatel):
    Sincronizar a biblioteca do SharePoint onde a planilha mora.
    Abra a planilha no navegador -> volte pra pasta que a contem ->
    botao "Sincronizar" na barra de cima -> confirme no OneDrive.
    Espere o icone de nuvem virar check verde antes de rodar este script.

  Uso:
    powershell -ExecutionPolicy Bypass -File automatizar.ps1
    powershell -ExecutionPolicy Bypass -File automatizar.ps1 -Minutos 30
    powershell -ExecutionPolicy Bypass -File automatizar.ps1 -Xlsx "C:\caminho\exato.xlsx"
    powershell -ExecutionPolicy Bypass -File automatizar.ps1 -Remover
#>
param(
  [string]$Xlsx,
  [int]$Minutos = 60,
  [switch]$Remover
)

$ErrorActionPreference = 'Stop'
$NomeTarefa = 'MazyOS - Painel Bancos de Bateria'
$Converter  = "$PSScriptRoot\converter.ps1"
$CfgPath    = "$PSScriptRoot\caminho.local.txt"

function Titulo($t) { Write-Host ""; Write-Host "== $t" -ForegroundColor Cyan }
function Ok($t)     { Write-Host "   [ok] $t" -ForegroundColor Green }
function Aviso($t)  { Write-Host "   [!]  $t" -ForegroundColor Yellow }
function Erro($t)   { Write-Host "   [X]  $t" -ForegroundColor Red }

# ---------------------------------------------------------------- remover
if ($Remover) {
  Titulo "Removendo a automacao"
  $t = Get-ScheduledTask -TaskName $NomeTarefa -ErrorAction SilentlyContinue
  if ($t) {
    Unregister-ScheduledTask -TaskName $NomeTarefa -Confirm:$false
    Ok "tarefa removida do Agendador"
  } else {
    Aviso "nao havia tarefa registrada"
  }
  Write-Host ""
  Write-Host "O site continua funcionando; so nao atualiza mais sozinho."
  Write-Host "Pra atualizar na mao:  powershell -ExecutionPolicy Bypass -File converter.ps1"
  return
}

# ------------------------------------------------- 1. achar a planilha
Titulo "1/4  Procurando a planilha sincronizada"

$Alvo = 'Controle de Bancos de Bateria Oficial.xlsx'

if ($Xlsx) {
  if (-not (Test-Path $Xlsx)) { Erro "caminho informado nao existe: $Xlsx"; return }
  $escolhido = (Resolve-Path $Xlsx).Path
  Ok "usando o caminho informado"
} else {
  # Bibliotecas do SharePoint sincronizadas aparecem como pastas na raiz do
  # perfil do usuario, com o nome do tenant (ex.: "Icatel Telematica").
  $raizes = @()
  Get-ChildItem $env:USERPROFILE -Directory -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match 'OneDrive|SharePoint|Icatel|Telem' } |
    ForEach-Object { $raizes += $_.FullName }
  if ($env:OneDriveCommercial -and (Test-Path $env:OneDriveCommercial)) { $raizes += $env:OneDriveCommercial }
  $raizes = $raizes | Select-Object -Unique

  if (-not $raizes) {
    Erro "nenhuma pasta de sincronismo encontrada no perfil"
    Write-Host ""
    Write-Host "   A biblioteca do SharePoint ainda nao foi sincronizada." -ForegroundColor Yellow
    Write-Host "   Abra a planilha no navegador, volte pra pasta que a contem,"
    Write-Host "   clique em Sincronizar e espere o check verde. Depois rode de novo."
    return
  }

  Write-Host "   procurando em:"
  $raizes | ForEach-Object { Write-Host "     $_" -ForegroundColor DarkGray }

  $achados = @()
  foreach ($r in $raizes) {
    $achados += Get-ChildItem $r -Recurse -File -Filter '*.xlsx' -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -eq $Alvo -or $_.Name -match 'Bancos? de Bateria' }
  }
  # ignora o export manual em dados/Info -- esse nao se atualiza sozinho
  $achados = $achados | Where-Object { $_.FullName -notmatch '\\MazyOS\\dados\\' } | Select-Object -Unique

  if (-not $achados) {
    Erro "planilha nao encontrada nas pastas sincronizadas"
    Write-Host ""
    Write-Host "   Provavel causa: a biblioteca ainda nao foi sincronizada," -ForegroundColor Yellow
    Write-Host "   ou terminou de sincronizar agora. Confira o icone do OneDrive."
    Write-Host "   Se souber o caminho exato, rode com:"
    Write-Host "     .\automatizar.ps1 -Xlsx `"C:\caminho\da\planilha.xlsx`""
    return
  }

  if ($achados.Count -gt 1) {
    Aviso "achei mais de uma planilha; usando a modificada mais recentemente:"
    $achados | Sort-Object LastWriteTime -Descending | ForEach-Object {
      Write-Host "     $($_.LastWriteTime.ToString('dd/MM/yyyy HH:mm'))  $($_.FullName)" -ForegroundColor DarkGray
    }
  }
  $escolhido = ($achados | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
  Ok "encontrada: $escolhido"
}

Set-Content -Path $CfgPath -Value $escolhido -Encoding utf8
Ok "caminho gravado em caminho.local.txt"

# ------------------------------------------------- 2. testar a leitura
Titulo "2/4  Testando a leitura da planilha"
& powershell -ExecutionPolicy Bypass -File $Converter -Xlsx $escolhido
if ($LASTEXITCODE -ne 0) { Erro "o conversor falhou; automacao nao registrada"; return }
Ok "conversao funcionou"

# ------------------------------------------------- 3. registrar a tarefa
Titulo "3/4  Registrando no Agendador de Tarefas"

$existente = Get-ScheduledTask -TaskName $NomeTarefa -ErrorAction SilentlyContinue
if ($existente) {
  Unregister-ScheduledTask -TaskName $NomeTarefa -Confirm:$false
  Aviso "tarefa anterior substituida"
}

$acao = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Converter`" -Silencioso" `
  -WorkingDirectory $PSScriptRoot

# Dois gatilhos: um no login, outro repetindo a cada $Minutos.
# A duracao da repeticao NAO pode ser [TimeSpan]::MaxValue -- vira
# "P99999999DT23H59M59S" e o Agendador rejeita o XML. 10 anos resolve.
$gatilhos = @(
  (New-ScheduledTaskTrigger -AtLogOn),
  (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
     -RepetitionInterval (New-TimeSpan -Minutes $Minutos) `
     -RepetitionDuration (New-TimeSpan -Days 3650))
)

$cfg = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
  -MultipleInstances IgnoreNew

try {
  # Sem -User/-RunLevel de proposito: com eles, o Windows exige elevacao
  # ("Access is denied") mesmo pra registrar tarefa do proprio usuario.
  # Omitindo, a tarefa entra no contexto de quem rodou e nao pede admin.
  Register-ScheduledTask -TaskName $NomeTarefa -Action $acao -Trigger $gatilhos `
    -Settings $cfg -Description 'Le a planilha do SharePoint e regenera o painel de bancos de bateria.' `
    -Force | Out-Null
  Ok "tarefa registrada: roda no login e a cada $Minutos minutos"
} catch {
  $msg = $_.Exception.Message
  Erro "nao consegui registrar a tarefa: $msg"
  Write-Host ""
  if ($msg -match 'Access|Acesso|denied|negad') {
    Write-Host "   Parece falta de permissao. Abra o PowerShell como administrador" -ForegroundColor Yellow
    Write-Host "   e rode este script de novo."
  } else {
    Write-Host "   Erro inesperado do Agendador. Me manda essa mensagem." -ForegroundColor Yellow
  }
  return
}

# ------------------------------------------------- 4. disparar uma vez
Titulo "4/4  Rodando uma vez pelo Agendador"
Start-ScheduledTask -TaskName $NomeTarefa
Start-Sleep -Seconds 4
$info = Get-ScheduledTaskInfo -TaskName $NomeTarefa
Ok "ultimo resultado: $($info.LastTaskResult) (0 = sucesso)"

Write-Host ""
Write-Host "Pronto. A partir de agora:" -ForegroundColor Green
Write-Host "  - alguem preenche o Forms"
Write-Host "  - o OneDrive baixa a planilha atualizada sozinho"
Write-Host "  - a cada $Minutos min a tarefa regenera o site"
Write-Host "  - voce so abre o index.html e ve o dado novo (F5 se ja estiver aberto)"
Write-Host ""
Write-Host "Log das rodadas:  converter.log"
Write-Host "Desfazer tudo:    .\automatizar.ps1 -Remover"
