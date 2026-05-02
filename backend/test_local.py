import asyncio
from core.supabase_client import get_supabase_client
from schemas.image_generation import CreateImageRequest, CreateImageResponse, ImageModel
from routers.image_generation import log_generation_to_supabase
import logging

req = CreateImageRequest(model=ImageModel.seedream45, prompt="test")
res = CreateImageResponse(model=ImageModel.seedream45, images=["https://i.ibb.co/3s2R1y6/sample.jpg"])

log_generation_to_supabase(req, res)
print("Finished logging")
