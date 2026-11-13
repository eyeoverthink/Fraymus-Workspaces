# Fraymus Workspaces

Self-hosted nodular workspace and agent hub. The app is in [`nodular-workspace`](nodular-workspace/README.md).

## Paid image calls stay off

Nothing here calls a billed image API unless you opt in.

- The image order is Hugging Face, Pollinations, then a local server. Pollinations needs no key. Hugging Face calls `router.huggingface.co`, which can bill after included credits, so it runs only when `HF_TOKEN` is set and `HF_IMAGE_BILLING_CONFIRMED=true`. A token alone does nothing.
- `gemini-2.5-flash-image` is billed. It runs only when `IMAGE_PROVIDERS` lists `gemini` and `GEMINI_IMAGE_BILLING_CONFIRMED=true`, and `GEMINI_API_KEY` is set. A key alone does nothing.
- The upscaler is a local sharp resize, not AI upscaling. Real-ESRGAN runs only when `ENABLE_PAID_REPLICATE=1` and `REPLICATE_API_TOKEN` are both set.
- OpenAI and Replicate image generation run only when those names are listed in `IMAGE_PROVIDERS` and their keys are set.

Leave `HF_IMAGE_BILLING_CONFIRMED`, `GEMINI_IMAGE_BILLING_CONFIRMED`, and `ENABLE_PAID_REPLICATE` unset to stay off those calls. Details are in `nodular-workspace/README.md` and `nodular-workspace/.env.example`.

`POST /api/flux` and the upscaler spend the server's keys. With `CLERK_SECRET_KEY` unset, anyone who can reach the port can trigger a billed call after you opt in. Set Clerk, or keep the port on a private network, before confirming billing.
