# Canva, local transcription, and social publishing

## Canva

Create a Canva Connect API app with these scopes enabled: `design:meta:read`, `design:content:read`, and `design:content:write`. Set `CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET`, the stable `INTEGRATION_ENCRYPTION_KEY`, and `PUBLIC_URL` on the server. In production, `PUBLIC_URL` must be the publicly reachable HTTPS origin. Add the exact OAuth callback shown in Connect to the Canva app's redirect URLs. OAuth uses authorization code + PKCE; user access and rotating refresh tokens are encrypted at rest.

- `canva_list_designs` lists design metadata, not content.
- `canva_create_design` creates a blank document, email, presentation, or whiteboard design and requires app approval. Canva may permanently delete a blank design if it is not edited within seven days.
- `canva_create_export_job` creates a PNG, JPG, PDF, MP4, GIF, or PPTX export job and requires app approval. `canva_get_export_job` checks its status. Canva's completed download links expire after 24 hours.
- Canva bulk generation, asset uploads, and auto-publishing are not implemented.

The Canva app must be configured and approved for the requested scopes by Canva. Provider API access is not available until those credentials and permissions are supplied.

## Whisper.cpp

Whisper transcription runs offline on the Nodular server using a locally installed whisper.cpp CLI and model. Set `WHISPER_CPP_PATH` to the `whisper-cli` executable and `WHISPER_MODEL_PATH` to a compatible local ggml model file. No API key is used and audio is not sent to a transcription provider.

The Connect page accepts PCM 16-bit WAV files up to 50 MiB. The `whisper_transcribe_audio` tool accepts the same WAV content from a local `/outputs/*.wav` file or public HTTPS URL; private/local network URLs are blocked. MP3, video, automatic diarization, timestamps, and batch transcription are not provided by this connector. The server must have a working whisper.cpp build and sufficient memory for its selected model.

## LinkedIn text publishing

Set `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, the stable `INTEGRATION_ENCRYPTION_KEY`, and `PUBLIC_URL`. In production, `PUBLIC_URL` must be the publicly reachable HTTPS origin. Configure the OAuth redirect URI shown in Connect, and enable LinkedIn OpenID Connect plus the Share on LinkedIn product/scopes (`openid`, `profile`, `w_member_social`) in the LinkedIn Developer Portal. LinkedIn may require app review or product approval. Access tokens expire; this connector asks the user to reconnect after expiry.

`linkedin_publish_text` is an approval-required action and publishes exactly one public text post to the connected member profile after `confirmPublish: true`. No scheduled posting, organization pages, media uploads, analytics, cross-posting, or automatic publishing are implemented. The provider API may reject the request until LinkedIn approves the app's product access.

## Repurpose.io

No public Repurpose.io developer API or OAuth integration was verified for this implementation, so the app does not claim to connect or publish through Repurpose.io. If the provider supplies an official MCP server or API contract, it can be connected through **Connect → MCP servers (import)**; imported tool calls remain approval-gated.
