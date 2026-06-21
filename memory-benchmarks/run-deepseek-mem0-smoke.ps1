$ErrorActionPreference = "Stop"

$rootEnv = Get-Content -LiteralPath "D:\coding\onemillionbrain\.env"
$env:DEEPSEEK_API_KEY = (($rootEnv | Select-String '^DEEPSEEK_API_KEY=').Line -replace '^DEEPSEEK_API_KEY=', '')
$env:DEEPSEEK_BASE_URL = (($rootEnv | Select-String '^DEEPSEEK_BASE_URL=').Line -replace '^DEEPSEEK_BASE_URL=', '')
$env:MEM0_HOST = "http://127.0.0.1:8888"
$env:MEM0_BACKEND = "oss"
$env:HTTP_PROXY = ""
$env:HTTPS_PROXY = ""
$env:ALL_PROXY = ""

python -m benchmarks.locomo.run `
  --project-name mem0-deepseek-smoke `
  --backend oss `
  --mem0-host $env:MEM0_HOST `
  --answerer-model deepseek-v4-flash `
  --judge-model deepseek-v4-flash `
  --provider openai `
  --top-k 50 `
  --top-k-cutoffs 10,20,50 `
  --max-questions 1 `
  --rpm 20 `
  --max-workers 2
