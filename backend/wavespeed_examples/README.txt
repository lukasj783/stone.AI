WaveSpeed image-edit models for storyboard frames
=================================================

One file per model, each with:
  1. the parameters it takes,
  2. a Python SDK example (pip install wavespeed),
  3. the same call as plain REST with requests,
  4. how this app calls it.

Default storyboard model: google/nano-banana-2/edit

IMPORTANT - where these examples come from
------------------------------------------
The wavespeed.ai model pages could not be fetched when these were written (the site was
blocked by the fetch proxy), so the examples are NOT copied from those pages, except
section 4 of nano_banana_2_1_edit.txt, gpt_image_2_6_sunburst_edit.txt,
gpt_image_2_6_flare_edit.txt, seedream_v5_0_lite_edit.txt, seedream_v5_0_flash_edit.txt and
seedream_v5_5_edit.txt, which are WaveSpeed's own examples pasted by you.

- The SDK calls (wavespeed.Client, client.run, client.upload, wavespeed.run, timeout,
  poll_interval) and the REST endpoints (/api/v3/{model}, /api/v3/predictions/{id}/result)
  were checked against the installed SDK source, wavespeed 1.0.10.
- Model parameters come from WaveSpeed's API docs as quoted in web search results.
  Each file's Status line says where its parameters were confirmed and which values are
  still assumptions.

All models are now VERIFIED: their model IDs and parameter names were confirmed by WaveSpeed's
own examples or API docs. Values not shown in an example (other aspect ratios, 2k/4k,
image limits) are assumptions noted in each file. If WaveSpeed rejects a request, compare the
model page's schema and update both the file and backend/services/storyboard_models.py.

Files
-----
nano_banana_2_edit.txt          google/nano-banana-2/edit           VERIFIED   (default)
nano_banana_2_1_edit.txt        google/nano-banana-2.1/edit         VERIFIED   (official example included)
gpt_image_2_5_sunburst_edit.txt openai/gpt-image-2.5-sunburst/edit  VERIFIED
gpt_image_2_6_sunburst_edit.txt openai/gpt-image-2.6-sunburst/edit  VERIFIED   (official example included)
gpt_image_2_6_flare_edit.txt    openai/gpt-image-2.6-flare/edit     VERIFIED   (official example included)
seedream_v5_0_lite_edit.txt     bytedance/seedream-v5.0-lite/edit   VERIFIED   (official example included)
seedream_v5_0_flash_edit.txt    bytedance/seedream-v5.0-flash/edit  VERIFIED   (official example included)
seedream_v5_5_edit.txt          bytedance/seedream-v5.5/edit        VERIFIED   (official example included)
