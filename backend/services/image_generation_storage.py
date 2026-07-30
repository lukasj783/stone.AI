import httpx
import uuid

from core.supabase_client import get_supabase_client
from schemas.image_generation import CreateImageRequest, CreateImageResponse


def extract_storage_filename(url: str | None) -> str:
    if not url or not isinstance(url, str):
        return ""

    return url.split("/")[-1].split("?")[0]


def log_generation_to_supabase(payload: CreateImageRequest, response: CreateImageResponse) -> None:
    supabase = get_supabase_client()
    if not supabase:
        return

    try:
        permanent_images = []
        for image_url in response.images:
            if image_url and image_url.startswith("http"):
                try:
                    download = httpx.get(image_url, timeout=30.0)
                    download.raise_for_status()
                    file_ext = image_url.split(".")[-1].split("?")[0]
                    if file_ext not in ["png", "jpg", "jpeg", "webp"]:
                        file_ext = "png"

                    filename = f"{uuid.uuid4()}.{file_ext}"
                    content_type = f"image/{'jpeg' if file_ext == 'jpg' else file_ext}"
                    supabase.storage.from_("output-images").upload(
                        file=download.content,
                        path=filename,
                        file_options={"content-type": content_type},
                    )
                    permanent_images.append(
                        supabase.storage.from_("output-images").get_public_url(filename)
                    )
                except Exception as upload_error:
                    print(f"Failed to upload image {image_url}: {upload_error}")
                    permanent_images.append(image_url)
            else:
                permanent_images.append(image_url)

        response.images = permanent_images
        model_value = payload.model.value if hasattr(payload.model, "value") else payload.model
        supabase.table("image_generations").insert({
            "model": model_value,
            "prompt": payload.prompt,
            "aspect_ratio": payload.aspect_ratio,
            "num_images": payload.num_images,
            "resolution": payload.resolution,
            "image_mapping": payload.image_mapping,
            "result_images": permanent_images,
        }).execute()
    except Exception as error:
        print(f"Failed to log generation to Supabase: {error}")