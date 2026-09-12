# Richtet den taeglichen Lauf in der Windows-Aufgabenplanung ein.
#
# Einmal ausfuehren, danach laeuft contentbot von selbst, sobald der PC an ist.
# Rechtsklick auf die Datei, "Mit PowerShell ausfuehren", oder im Terminal:
#   powershell -ExecutionPolicy Bypass -File scripts\aufgabe-einrichten.ps1
#
# Entfernen mit:
#   schtasks /delete /tn contentbot /f

param(
    [string]$Zeit = "08:00",
    [switch]$Entfernen
)

$ErrorActionPreference = "Stop"
$Projekt = Split-Path -Parent $PSScriptRoot
$Name = "contentbot"

if ($Entfernen) {
    schtasks /delete /tn $Name /f
    Write-Host "Aufgabe '$Name' entfernt."
    exit 0
}

# node muss ueber den vollen Pfad angesprochen werden. Die Aufgabenplanung
# startet ohne die PATH-Ergaenzungen einer interaktiven Sitzung.
$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) {
    $Node = "$env:ProgramFiles\nodejs\node.exe"
}
if (-not (Test-Path $Node)) {
    throw "node.exe nicht gefunden. Node installieren oder Pfad im Skript eintragen."
}

Write-Host "Projekt : $Projekt"
Write-Host "Node    : $Node"
Write-Host "Uhrzeit : $Zeit taeglich"

$Aktion   = New-ScheduledTaskAction -Execute $Node -Argument "src\autopilot.mjs" -WorkingDirectory $Projekt
$Ausloesr = New-ScheduledTaskTrigger -Daily -At $Zeit

# StartWhenAvailable holt den Lauf nach, wenn der PC zur eigentlichen Zeit aus
# war. DontStopIfGoingOnBatteries, damit der Lauf am Notebook nicht abbricht.
$Optionen = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $Name -Action $Aktion -Trigger $Ausloesr -Settings $Optionen -Description "Taeglicher contentbot-Lauf: Themen finden, Artikel schreiben, Seite bauen und veroeffentlichen." -Force | Out-Null

Write-Host ""
Write-Host "Aufgabe '$Name' eingerichtet."
Write-Host ""
Write-Host "Sofort testen : schtasks /run /tn $Name"
Write-Host "Status sehen  : schtasks /query /tn $Name /v /fo list"
Write-Host "Protokolle    : $Projekt\logs"
Write-Host "Entfernen     : schtasks /delete /tn $Name /f"
