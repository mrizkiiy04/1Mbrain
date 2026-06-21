$ErrorActionPreference = "Stop"

$rootEnv = Get-Content -LiteralPath "D:\coding\onemillionbrain\.env"
$env:DEEPSEEK_API_KEY = (($rootEnv | Select-String '^DEEPSEEK_API_KEY=').Line -replace '^DEEPSEEK_API_KEY=', '')
$env:DEEPSEEK_BASE_URL = (($rootEnv | Select-String '^DEEPSEEK_BASE_URL=').Line -replace '^DEEPSEEK_BASE_URL=', '')
$env:MEM0_HOST = "http://127.0.0.1:3100"
$env:HTTP_PROXY = ""
$env:HTTPS_PROXY = ""
$env:ALL_PROXY = ""

python -m benchmarks.locomo.run `
  --project-name 1mbrain-deepseek-full-pg `
  --answerer-model deepseek-v4-flash `
  --judge-model deepseek-v4-flash `
  --provider openai `
  --top-k 50 `
  --top-k-cutoffs 10,20,50 `
  --rpm 20 `
  --max-workers 10
