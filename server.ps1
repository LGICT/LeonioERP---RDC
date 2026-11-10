# Leonio ERP - local web server
# Serves the app from .\app and stores all data in .\data\db.json
# Uses only built-in Windows PowerShell, no installation required.
param([int]$Port = 8080)

$ErrorActionPreference = 'Stop'
$Root      = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir    = [IO.Path]::GetFullPath((Join-Path $Root 'app'))
$DataDir   = Join-Path $Root 'data'
$BackupDir = Join-Path $DataDir 'backups'
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$DbFile  = Join-Path $DataDir 'db.json'

$utf8 = New-Object System.Text.UTF8Encoding($false)
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'application/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8';  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'; '.png' = 'image/png'; '.ico' = 'image/x-icon'
}

# Start listener (try the next ports if 8080 is busy)
$listener = $null
foreach ($p in $Port..($Port + 10)) {
  try {
    $l = New-Object System.Net.HttpListener
    $l.Prefixes.Add("http://localhost:$p/")
    $l.Start()
    $listener = $l; $Port = $p; break
  } catch { }
}
if (-not $listener) { Write-Host 'Could not start the server (ports busy).' -ForegroundColor Red; exit 1 }

$url = "http://localhost:$Port/"
Write-Host ''
Write-Host '  Leonio ERP is running.' -ForegroundColor Green
Write-Host "  Open: $url"
Write-Host "  Data file: $DbFile"
Write-Host '  Keep this window open while using the ERP. Close it to stop.'
Write-Host ''
if (-not $env:ERP_NO_BROWSER) { Start-Process $url }

# Remove backups older than 60 days
Get-ChildItem $BackupDir -Filter '*-*.json' -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-60) } | Remove-Item -Force -ErrorAction SilentlyContinue

function Send-Bytes($res, [int]$code, [byte[]]$bytes, [string]$type) {
  $res.StatusCode = $code
  $res.ContentType = $type
  $res.Headers['Cache-Control'] = 'no-store'
  $res.ContentLength64 = $bytes.Length
  if ($bytes.Length -gt 0) { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
}
function Send-Text($res, [int]$code, [string]$text) {
  Send-Bytes $res $code ($utf8.GetBytes($text)) 'text/plain; charset=utf-8'
}

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request; $res = $ctx.Response
  try {
    $path = $req.Url.AbsolutePath
    if ($path -eq '/api/db' -or $path -eq '/api/md') {
      # db = transactions & settings, md = master data (chart of accounts, items, vendors, posting setup)
      $store = $path.Substring(5)
      $DbFile = Join-Path $DataDir "$store.json"
      $VerFile = Join-Path $DataDir "$store.version.txt"
      if (-not (Test-Path $VerFile)) { [IO.File]::WriteAllText($VerFile, '0') }
      $ver = [int]([IO.File]::ReadAllText($VerFile).Trim())
      if ($req.HttpMethod -eq 'GET') {
        $bytes = if (Test-Path $DbFile) { [IO.File]::ReadAllBytes($DbFile) } else { [byte[]]@() }
        $res.Headers['X-Version'] = "$ver"
        Send-Bytes $res 200 $bytes 'application/json; charset=utf-8'
      }
      elseif ($req.HttpMethod -eq 'POST') {
        $base = 0; [void][int]::TryParse([string]$req.Headers['X-Base-Version'], [ref]$base)
        if ($base -ne $ver) {
          $res.Headers['X-Version'] = "$ver"
          Send-Text $res 409 'Data was changed by another user or tab. Reload.'
        } else {
          $reader = New-Object IO.StreamReader($req.InputStream, $utf8)
          $body = $reader.ReadToEnd(); $reader.Close()
          if ($body.Length -lt 2 -or $body[0] -ne '{') { Send-Text $res 400 'Invalid data'; continue }
          if (Test-Path $DbFile) {
            $bk = Join-Path $BackupDir ("$store-" + (Get-Date -Format 'yyyyMMdd-HH') + '.json')
            if (-not (Test-Path $bk)) { Copy-Item $DbFile $bk }
          }
          $tmp = "$DbFile.tmp"
          [IO.File]::WriteAllText($tmp, $body, $utf8)
          [IO.File]::Copy($tmp, $DbFile, $true)
          [IO.File]::Delete($tmp)
          $ver++
          [IO.File]::WriteAllText($VerFile, "$ver")
          $res.Headers['X-Version'] = "$ver"
          Send-Text $res 200 'OK'
        }
      }
      else { Send-Text $res 405 'Method not allowed' }
    }
    else {
      $rel = [Uri]::UnescapeDataString($path.TrimStart('/'))
      if ($rel -eq '') { $rel = 'index.html' }
      $full = [IO.Path]::GetFullPath((Join-Path $AppDir $rel))
      if ($full.StartsWith($AppDir, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path $full -PathType Leaf)) {
        $ext = [IO.Path]::GetExtension($full).ToLower()
        $type = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
        Send-Bytes $res 200 ([IO.File]::ReadAllBytes($full)) $type
      } else { Send-Text $res 404 'Not found' }
    }
  } catch {
    Write-Host ("Error: " + $_.Exception.Message) -ForegroundColor Yellow
    try { Send-Text $res 500 $_.Exception.Message } catch { }
  } finally {
    try { $res.Close() } catch { }
  }
}
