from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from core.config import get_settings
from core.provider_errors import install_provider_error_handlers
from routers.image_to_image import router as image_to_image_router
from routers.text_to_image import router as text_to_image_router
from routers.video_generation import router as video_generation_router
from routers.story import router as story_router
from routers.script_engine import router as script_engine_router
from routers.entity_references import router as entity_references_router
from routers.audio import router as audio_router


app = FastAPI(title="Qwen Image API")
settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
install_provider_error_handlers(app)

app.include_router(text_to_image_router)
app.include_router(image_to_image_router)
app.include_router(video_generation_router)
app.include_router(story_router)
app.include_router(script_engine_router)
app.include_router(entity_references_router)
app.include_router(audio_router)


@app.get("/")
def read_root() -> dict[str, str]:
    return {"message": "FastAPI is running"}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
