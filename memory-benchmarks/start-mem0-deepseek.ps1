$ErrorActionPreference = "Stop"

$rootEnvPath = "D:\coding\onemillionbrain\.env"
$rootEnv = Get-Content -LiteralPath $rootEnvPath

$env:DEEPSEEK_API_KEY = (($rootEnv | Select-String '^DEEPSEEK_API_KEY=').Line -replace '^DEEPSEEK_API_KEY=', '')
$env:DEEPSEEK_API_BASE = (($rootEnv | Select-String '^DEEPSEEK_BASE_URL=').Line -replace '^DEEPSEEK_BASE_URL=', '')

if (-not $env:DEEPSEEK_API_KEY) {
  throw "DEEPSEEK_API_KEY is missing in $rootEnvPath"
}

if (-not $env:DEEPSEEK_API_BASE) {
  $env:DEEPSEEK_API_BASE = "https://api.deepseek.com"
}

$env:MEM0_PORT = "8888"
$env:QDRANT_PORT = "6335"
$env:MEM0_CONFIG_FILE = "./configs/deepseek-fastembed.yaml"
$env:COLLECTION_NAME = "mem0_deepseek_fastembed"

$docker = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
if (-not (Test-Path -LiteralPath $docker)) {
  $docker = "docker"
}

& $docker compose up -d --build mem0

$deadline = (Get-Date).AddMinutes(5)
do {
  try {
    $health = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$env:MEM0_PORT/health" -TimeoutSec 5
    if ($health.StatusCode -eq 200) {
      $health.Content
      exit 0
    }
  } catch {
    Start-Sleep -Seconds 5
  }
} while ((Get-Date) -lt $deadline)

throw "Mem0 OSS did not become healthy on port $env:MEM0_PORT"
