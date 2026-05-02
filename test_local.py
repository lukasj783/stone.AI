import sys
import os
import importlib

# Add backend to path to import services
sys.path.insert(0, os.path.join(os.getcwd(), 'backend'))

import replicate

replicate_service = importlib.import_module('services.replicate_service')
image_generation_schemas = importlib.import_module('schemas.image_generation')

generate_images = replicate_service.generate_images
CreateImageRequest = image_generation_schemas.CreateImageRequest
ImageModel = image_generation_schemas.ImageModel

# Load env var
token = None
if os.path.exists('backend/.env'):
    with open('backend/.env', 'r') as f:
        for line in f:
            if line.startswith('REPLICATE_API_TOKEN='):
                token = line.strip().split('=', 1)[1]
                os.environ['REPLICATE_API_TOKEN'] = token
                break

if not token:
    print("ERROR: Could not find REPLICATE_API_TOKEN in backend/.env")
    sys.exit(1)

print(f"Token found: {token[:4]}...")

# Verify Replicate client configuration using the imported module
try:
    print("Verifying Replicate API access...")
    client = replicate.Client(api_token=token)
    # Check access to the model we're about to test
    model_name = "google/nano-banana-pro"
    model = client.models.get(model_name)
    print(f"Replicate API verification successful. Model '{model.owner}/{model.name}' is accessible.")
except Exception as e:
    print(f"Error: Failed to verify Replicate API access: {e}")
    sys.exit(1)

def test_nanobanana():
    print("\n--- Testing NanoBanana ---")
    payload = CreateImageRequest(
        model=ImageModel.nanobanana,
        prompt="a cute cat",
        aspect_ratio="1:1",
        num_images=1
    )
    try:
        response = generate_images(payload, token)
        print("Success!")
        print(response)
    except Exception as e:
        print(f"Failed: {e}")

def test_seedream():
    print("\n--- Testing Seedream ---")
    payload = CreateImageRequest(
        model=ImageModel.seedream45,
        prompt="a cute cat",
        aspect_ratio="16:9",
        num_images=1
    )
    try:
        response = generate_images(payload, token)
        print("Success!")
        print(response)
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    # test_nanobanana()


    # Test API Route
    print("\n--- Testing API Route ---")
    try:
        from fastapi.testclient import TestClient
        # Import main after backend path setup so editor/static analysis does not flag it.
        main = importlib.import_module('main')
        
        client = TestClient(main.app)
        
        payload = {
            "model": "nanobanana",  # Use string enum value
            "prompt": "a cute cat",
            "aspect_ratio": "1:1",
            "num_images": 1
        }
        
        print(f"Sending POST request to /api/images/generate with payload: {payload}")
        response = client.post("/api/images/generate", json=payload)
        
        if response.status_code == 200:
            print("Success!")
            print(response.json())
        else:
            print(f"Failed with status {response.status_code}: {response.text}")
            
    except ImportError as e:
        print(f"Could not import TestClient or main app: {e}")
    except Exception as e:
        print(f"API Test Failed: {e}")
