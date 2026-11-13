# Fraymus Workspaces

Self-hosted nodular workspace and agent hub. The app is in [`nodular-workspace`](nodular-workspace/README.md).

## Paid image calls stay off

Nothing here calls a billed image API unless you opt in.

- Image generation defaults to Hugging Face, Pollinations, then a local server. `gemini-2.5-flash-image` is billed. It runs only when `IMAGE_PROVIDERS` lists `gemini` and `GEMINI_IMAGE_BILLING_CONFIRMED=true`, and `GEMINI_API_KEY` is set. A key alone does nothing.
- The upscaler is a local sharp resize, not AI upscaling. Real-ESRGAN runs only when `ENABLE_PAID_REPLICATE=1` and `REPLICATE_API_TOKEN` are both set.
- OpenAI and Replicate image generation run only when those names are listed in `IMAGE_PROVIDERS` and their keys are set.

Leave `GEMINI_IMAGE_BILLING_CONFIRMED` and `ENABLE_PAID_REPLICATE` unset to stay off those calls. Details are in `nodular-workspace/README.md` and `nodular-workspace/.env.example`.
