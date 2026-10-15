# Independent Codex candidate launcher. DryRun/Inspect never start processes or open a browser.
[CmdletBinding()]
param(
    [ValidateSet('Solo', 'Multiplayer')][string]$Mode = 'Solo',
    [switch]$DryRun,
    [switch]$Inspect,
    [switch]$NoBrowser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$candidateRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$distRoot = Join-Path $candidateRoot 'dist'
$runtimeRoot = Join-Path $candidateRoot 'runtime\codex-launcher'
$universeData = Join-Path $candidateRoot 'server-data\codex-candidate'
$universeName = 'codex-candidate'
$webPort = 5195
$multiplayerPort = 8875
$webAddress = "http://127.0.0.1:$webPort/"
$multiplayerAddress = "ws://127.0.0.1:$multiplayerPort/universe"
$browserAddress = if ($Mode -eq 'Multiplayer') {
    $webAddress + '?mode=multiplayer&server=' + [Uri]::EscapeDataString($multiplayerAddress)
} else { $webAddress + '?mode=campaign' }

function Quote-NativeArgument([string]$Value) {
    # Windows CommandLineToArgvW quoting, including paths ending in a backslash.
    if ($Value -notmatch '[\s"]' -and $Value.Length -gt 0) { return $Value }
    return '"' + (($Value -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"'
}

function Get-ServicePlan([string]$Name, [int]$Port, [string]$ScriptPath, [string[]]$Arguments) {
    return [pscustomobject]@{
        Name = $Name; Port = $Port; ScriptPath = $ScriptPath; Arguments = $Arguments
        Receipt = Join-Path $runtimeRoot ($Name + '.json')
        Stdout = Join-Path $runtimeRoot ($Name + '.stdout.log')
        Stderr = Join-Path $runtimeRoot ($Name + '.stderr.log')
    }
}

$previewScript = Join-Path $candidateRoot 'node_modules\vite\bin\vite.js'
$serverScript = Join-Path $candidateRoot 'server\index.mjs'
$webPlan = Get-ServicePlan 'web' $webPort $previewScript @('preview', '--host', '127.0.0.1', '--port', [string]$webPort, '--strictPort', '--outDir', $distRoot)
$serverPlan = Get-ServicePlan 'multiplayer' $multiplayerPort $serverScript @('--host', '127.0.0.1', '--port', [string]$multiplayerPort, '--universe', $universeName, '--data', $universeData, '--max-players', '16', '--backup-days', '14', '--no-console', '--admin-token', '')
$plans = @($webPlan)
if ($Mode -eq 'Multiplayer') { $plans += $serverPlan }

function Read-OwnedProcess($Plan) {
    if (-not (Test-Path -LiteralPath $Plan.Receipt)) { return $null }
    try {
        $receipt = Get-Content -LiteralPath $Plan.Receipt -Raw | ConvertFrom-Json
        foreach ($key in @('Root', 'ScriptPath', 'Port', 'Pid', 'CreatedUtc')) {
            if ($null -eq $receipt -or $null -eq $receipt.PSObject.Properties[$key]) { return $null }
        }
    } catch { return $null }
    if ($receipt.Root -ne $candidateRoot -or $receipt.ScriptPath -ne $Plan.ScriptPath -or $receipt.Port -ne $Plan.Port -or $receipt.Pid -le 0) { return $null }
    # A PID alone is insufficient: verify its executable, full candidate script path,
    # fixed port/host arguments and creation time before reusing the recorded service.
    $servicePid = [int]$receipt.Pid
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $servicePid" -ErrorAction Stop
    if ($null -eq $process -or $process.Name -notmatch '^node(?:\.exe)?$') { return $null }
    $commandLine = [string]$process.CommandLine
    if (-not $commandLine.Contains($Plan.ScriptPath) -or $commandLine -notmatch ('--port\s+"?' + $Plan.Port + '(?:"?\s|$)') -or $commandLine -notmatch '--host\s+"?127\.0\.0\.1(?:"?\s|$)') { return $null }
    if ([Math]::Abs((([datetime]$process.CreationDate).ToUniversalTime() - ([datetime]$receipt.CreatedUtc).ToUniversalTime()).TotalSeconds) -gt 2) { return $null }
    return $process
}

function Test-ServiceHealth($Plan) {
    try {
        if ($Plan.Name -eq 'web') {
            $reply = Invoke-WebRequest -UseBasicParsing -Uri ($webAddress + 'index.html') -TimeoutSec 3
            if ($reply.StatusCode -ne 200) { return $false }
            $localIndex = [IO.File]::ReadAllText((Join-Path $distRoot 'index.html'))
            return ([string]$reply.Content).Trim() -eq $localIndex.Trim()
        }
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$multiplayerPort/health" -TimeoutSec 3
        return $health.ok -eq $true -and $health.transport -eq 'colyseus' -and $health.universe.name -eq $universeName
    } catch { return $false }
}

function Test-LoopbackPortAvailable([int]$Port) {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
    try { $listener.Start(); return $true } catch { return $false } finally { $listener.Stop() }
}

function Start-OwnedService($Plan, [string]$NodePath) {
    $owned = Read-OwnedProcess $Plan
    if ($null -ne $owned) {
        if (Test-ServiceHealth $Plan) { Write-Host "Using the running candidate $($Plan.Name) service (PID $($owned.ProcessId))."; return }
        throw "The candidate $($Plan.Name) service is recorded but is not healthy. Review $($Plan.Stderr). No process was stopped."
    }
    if (-not (Test-LoopbackPortAvailable $Plan.Port)) {
        throw "Port $($Plan.Port) is in use by an unverified process. No process was reused or stopped. Close that program or ask for a different candidate port."
    }
    $nativeArguments = @($Plan.ScriptPath) + @($Plan.Arguments)
    $argumentLine = ($nativeArguments | ForEach-Object { Quote-NativeArgument $_ }) -join ' '
    # Force a local unknown build marker; inherited unrelated build settings cannot
    # report this candidate's same-build server as a different public release.
    $previousBuild = [Environment]::GetEnvironmentVariable('BUILD_HASH', 'Process')
    try {
        [Environment]::SetEnvironmentVariable('BUILD_HASH', 'dev', 'Process')
        $child = Start-Process -FilePath $NodePath -ArgumentList $argumentLine -WorkingDirectory $candidateRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $Plan.Stdout -RedirectStandardError $Plan.Stderr
    } finally { [Environment]::SetEnvironmentVariable('BUILD_HASH', $previousBuild, 'Process') }
    $child.Refresh()
    $record = [ordered]@{ Root = $candidateRoot; Pid = $child.Id; CreatedUtc = $child.StartTime.ToUniversalTime().ToString('o'); ScriptPath = $Plan.ScriptPath; Port = $Plan.Port; StartedUtc = [datetime]::UtcNow.ToString('o') }
    $record | ConvertTo-Json | Set-Content -LiteralPath $Plan.Receipt -Encoding UTF8
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $child.Refresh()
        if ($child.HasExited) { throw "The candidate $($Plan.Name) service exited. See $($Plan.Stderr)." }
        if (Test-ServiceHealth $Plan) { Write-Host "Started the candidate $($Plan.Name) service on 127.0.0.1:$($Plan.Port)."; return }
        Start-Sleep -Milliseconds 250
    }
    throw "The candidate $($Plan.Name) service did not become ready. Review $($Plan.Stderr). Its recorded PID is $($child.Id); no other process was touched."
}

try {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    $readiness = [ordered]@{
        CandidateRoot = $candidateRoot; Mode = $Mode; BrowserUrl = $browserAddress
        NodeAvailable = $null -ne $node; DistReady = Test-Path -LiteralPath (Join-Path $distRoot 'index.html')
        PreviewRuntimeReady = Test-Path -LiteralPath $previewScript
        ServerRuntimeReady = Test-Path -LiteralPath $serverScript
        PersistentMultiplayerData = $universeData
        ProcessReceiptsAndLogs = $runtimeRoot
        Services = @($plans | ForEach-Object { [ordered]@{ Name = $_.Name; Script = $_.ScriptPath; Arguments = $_.Arguments; Host = '127.0.0.1'; Port = $_.Port } })
    }
    if ($DryRun -or $Inspect) {
        if ($Inspect) {
            $readiness['ExistingServices'] = @($plans | ForEach-Object {
                $owned = Read-OwnedProcess $_
                [ordered]@{ Name = $_.Name; OwnedPid = if ($null -ne $owned) { $owned.ProcessId } else { $null }; Healthy = if ($null -ne $owned) { Test-ServiceHealth $_ } else { $false } }
            })
        }
        $readiness | ConvertTo-Json -Depth 7
        return
    }
    if ($null -eq $node) { throw 'Node.js is not available. Install Node.js 22 LTS, then run this launcher again.' }
    if (-not $readiness.DistReady) { throw "The final built game is not ready in $distRoot. Build this candidate first; the launcher will not build or modify source automatically." }
    if (-not $readiness.PreviewRuntimeReady) { throw 'Candidate Vite dependencies are missing from node_modules. Restore this candidate dependency folder first.' }
    if ($Mode -eq 'Multiplayer' -and -not $readiness.ServerRuntimeReady) { throw 'The candidate multiplayer server is missing.' }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $rootTag = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($candidateRoot.ToLowerInvariant())))).Replace('-', '').Substring(0, 16) } finally { $sha.Dispose() }
    $launchMutex = [Threading.Mutex]::new($false, ('Local\HyptileCodexLauncher-' + $rootTag))
    $ownsMutex = $false
    try {
        try { $ownsMutex = $launchMutex.WaitOne(30000) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
        if (-not $ownsMutex) { throw 'Another candidate launcher is still starting. Wait a moment, then run this launcher again.' }
        New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
        if ($Mode -eq 'Multiplayer') { New-Item -ItemType Directory -Path $universeData -Force | Out-Null }
        foreach ($plan in $plans) { Start-OwnedService $plan $node.Source }
    } finally {
        if ($ownsMutex) { $launchMutex.ReleaseMutex() }
        $launchMutex.Dispose()
    }
    Write-Host ''
    Write-Host "Codex candidate: $browserAddress"
    if ($Mode -eq 'Multiplayer') {
        Write-Host 'Choose Multiplayer, enter your captain name, and Join the candidate universe.'
        Write-Host "Server saves: $universeData"
        Write-Host 'Run this launcher again to open another browser window; each player needs a distinct browser profile or private window.'
    } else { Write-Host 'Choose Campaign or Sandbox in the menu. Your original game and its ports are separate.' }
    Write-Host "Background service receipts and logs: $runtimeRoot"
    if (-not $NoBrowser) { Start-Process -FilePath $browserAddress }
} catch {
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    exit 1
}
