"""
SageMaker Embedding Provider
=============================

Calls a HuggingFace TEI (Text Embeddings Inference) endpoint deployed on
AWS SageMaker.  Matches the platform backend's embed_using_qwen() behaviour:
  - Input:  {"inputs": [text]}
  - Output: first `embedding_dims` dimensions (default 768, Matryoshka truncation)

Config keys (in mem0-config.yaml under embedder.config):
  sagemaker_endpoint_name:  e.g. "tei-qwen-600m-staging"
  aws_region:               e.g. "us-west-2"
  embedding_dims:           e.g. 768  (truncation length)
  aws_access_key_id:        optional, falls back to env / instance role
  aws_secret_access_key:    optional, falls back to env / instance role
"""

import json
import logging
import os
from typing import Literal, Optional

from mem0.configs.embeddings.base import BaseEmbedderConfig
from mem0.embeddings.base import EmbeddingBase

logger = logging.getLogger(__name__)


class SageMakerEmbedding(EmbeddingBase):

    def __init__(self, config: Optional[BaseEmbedderConfig] = None):
        super().__init__(config)

        try:
            import boto3
        except ImportError:
            raise ImportError("boto3 is required for SageMaker embeddings: pip install boto3")

        self.endpoint_name = (
            getattr(self.config, "sagemaker_endpoint_name", None)
            or os.getenv("SAGEMAKER_ENDPOINT_NAME", "tei-qwen-600m-staging")
        )
        self.dims = self.config.embedding_dims or 768

        region = (
            getattr(self.config, "aws_region", None)
            or os.getenv("AWS_REGION")
            or os.getenv("AWS_DEFAULT_REGION")
            or "us-west-2"
        )
        access_key = os.getenv("AWS_ACCESS_KEY_ID")
        secret_key = os.getenv("AWS_SECRET_ACCESS_KEY")

        kwargs = {"region_name": region}
        if access_key and secret_key:
            kwargs["aws_access_key_id"] = access_key
            kwargs["aws_secret_access_key"] = secret_key

        self.client = boto3.client(
            "sagemaker-runtime",
            endpoint_url=f"https://runtime.sagemaker.{region}.amazonaws.com",
            **kwargs,
        )
        logger.info("SageMaker embedder: endpoint=%s, region=%s, dims=%d", self.endpoint_name, region, self.dims)

    def embed(self, text: str, memory_action: Optional[Literal["add", "search", "update"]] = None) -> list[float]:
        text = text.replace("\n", " ")
        response = self.client.invoke_endpoint(
            EndpointName=self.endpoint_name,
            ContentType="application/json",
            Body=json.dumps({"inputs": [text]}),
        )
        result = json.loads(response["Body"].read().decode("utf-8"))
        return result[0][: self.dims]

    def embed_batch(self, texts: list[str], memory_action: str = "add") -> list[list[float]]:
        texts = [t.replace("\n", " ") for t in texts]
        response = self.client.invoke_endpoint(
            EndpointName=self.endpoint_name,
            ContentType="application/json",
            Body=json.dumps({"inputs": texts}),
        )
        result = json.loads(response["Body"].read().decode("utf-8"))
        return [vec[: self.dims] for vec in result]
