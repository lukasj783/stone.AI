# Seedream 4.5 Usage Guide

## Setup

Run the following command to install the Replicate Python client:

```powershell
pip install replicate
```

## Python Usage

Here is a complete example to run the `bytedance/seedream-4.5` model.

```python
import replicate

# Run the model
output = replicate.run(
    "bytedance/seedream-4.5",
    input={
        "size": "4K",
        "width": 2048,
        "height": 2048,
        "prompt": "create an image of donald trump and putin take a selfie to each other",
        "max_images": 1,
        "image_input": [],
        "aspect_ratio": "16:9",
        "sequential_image_generation": "disabled"
    }
)

# The output is a list of file objects
# To access the file URL:
print(output[0].url)

# To write the file to the current directory:
with open("my-image.png", "wb") as file:
    file.write(output[0].read())
```
