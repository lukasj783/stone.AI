import requests
import json
import os

url = "http://localhost:8000/api/images/generate"
payload = {
    "prompt": "a cute cat",
    "model": "nanobanana",
    "num_images": 1,
    "aspect_ratio": "1:1"
}

try:
    response = requests.post(url, json=payload)
    print(f"Status Code: {response.status_code}")
    print("Response Body:")
    print(response.text)
except Exception as e:
    print(f"Error: {e}")
