import importlib.util
import urllib.request

mods = ["aiohttp", "aiolimiter", "dotenv", "openai", "requests", "tqdm"]
for mod in mods:
    print(mod, "OK" if importlib.util.find_spec(mod) else "MISSING")

for url in ["http://127.0.0.1:3100/health", "http://localhost:3100/health"]:
    try:
        body = urllib.request.urlopen(url, timeout=5).read().decode()
        print(url, body)
    except Exception as exc:
        print(url, "ERR", repr(exc))
