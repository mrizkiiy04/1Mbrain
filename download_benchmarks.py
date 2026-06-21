import urllib.request
import zipfile
import io
import os

url = "https://github.com/mem0ai/memory-benchmarks/archive/refs/heads/main.zip"
print(f"Downloading from {url}...")
try:
    with urllib.request.urlopen(url) as response:
        zip_data = response.read()
    print("Download completed. Extracting zip archive...")
    with zipfile.ZipFile(io.BytesIO(zip_data)) as zip_ref:
        zip_ref.extractall("d:\\coding\\onemillionbrain")
    
    # Rename extracted directory to memory-benchmarks
    if os.path.exists("d:\\coding\\onemillionbrain\\memory-benchmarks-main"):
        if os.path.exists("d:\\coding\\onemillionbrain\\memory-benchmarks"):
            print("Warning: d:\\coding\\onemillionbrain\\memory-benchmarks already exists, replacing it...")
            import shutil
            shutil.rmtree("d:\\coding\\onemillionbrain\\memory-benchmarks")
        os.rename("d:\\coding\\onemillionbrain\\memory-benchmarks-main", "d:\\coding\\onemillionbrain\\memory-benchmarks")
        print("Successfully renamed directory to memory-benchmarks")
    else:
        print("Extraction directory not found where expected.")
except Exception as e:
    print(f"Error occurred: {e}")
