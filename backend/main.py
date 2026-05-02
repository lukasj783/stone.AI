from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from core.config import get_settings
from routers.image_generation import router as image_generation_router
from routers.video_generation import router as video_generation_router


app = FastAPI(title="Qwen Image API")
settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(image_generation_router)
app.include_router(video_generation_router)


@app.get("/")
def read_root() -> dict[str, str]:
    return {"message": "FastAPI is running"}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
