FROM python:3.12-slim

WORKDIR /app

# System deps for spaCy native extensions
RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential git && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download spaCy English model (used for entity extraction + lemmatization)
RUN python -m spacy download en_core_web_sm

# Allow "sagemaker" as an embedding provider in mem0's config validator
RUN sed -i 's/"aws_bedrock",/"aws_bedrock", "sagemaker",/' \
    /usr/local/lib/python3.12/site-packages/mem0/embeddings/configs.py

# History directory
RUN mkdir -p /app/history

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
