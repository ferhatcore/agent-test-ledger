# Copyright (c) 2026 Ferhat Kosger. MIT License.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
$request = $null
try {
    [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false, $true)
    $request = ConvertFrom-Json ([Console]::In.ReadToEnd())
    $source = [IO.File]::ReadAllText($env:ATL_JOB_SOURCE, [Text.Encoding]::UTF8)
    Remove-Item Env:ATL_JOB_SOURCE
    Add-Type -TypeDefinition $source -Language CSharp -ErrorAction Stop
    [LedgerJob]::Run([string]$request.program, [string[]]@($request.args), [string]$request.cwd,
        [string]$request.statePath, [string]$request.stopPath, [int]$request.parentPid, [int]$request.timeoutMs)
} catch {
    if ($null -ne $request -and $request.statePath) {
        $state = '{"phase":"completed","started":false,"rootPid":null,"status":"launch-error","exitCode":null,"errorCode":"JOB_BOOTSTRAP_ERROR","cleanup":"not-started","cleanupError":null}'
        try { [IO.File]::WriteAllText([string]$request.statePath, $state, (New-Object Text.UTF8Encoding($false))) } catch {}
    }
    exit 1
}
