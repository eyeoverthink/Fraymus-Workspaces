# Google Gmail and Calendar

The app implements per-user Google OAuth. Each connected user gets isolated Gmail and primary-calendar tools; credentials belong to the server operator, while each user grants the app account access.

## Server setup

1. Create a Google Cloud OAuth client of type **Web application** and enable the Gmail API and Google Calendar API.
2. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `INTEGRATION_ENCRYPTION_KEY`, and `PUBLIC_URL` in the server environment. Generate a private random encryption secret of at least 32 characters and keep it stable: changing it makes stored refresh tokens unreadable.
3. Add the exact redirect URI shown on Connect, normally `https://your-host/api/integrations/google/callback`, to the Google OAuth client.
4. Configure the OAuth consent screen. While the app is in testing, add the intended Google accounts as test users. Google may require verification for Gmail scopes before a public production rollout.
5. Restart the server and connect an account from **Connect → Google Gmail + Calendar**.

The app stores access and refresh tokens encrypted with AES-256-GCM in the same SQLite database used for agent data. Do not copy the encryption key into the repository or browser bundle. Back up the key separately from the database.

## Available operations and limits

- `google_gmail_search`: searches Gmail and returns at most ten message snippets and basic headers; attachments and full message bodies are not fetched.
- `google_gmail_create_draft`: creates one plain-text Gmail draft and requires app approval.
- `google_gmail_send`: sends one plain-text email only with `confirmSend: true` and app approval. Bulk sending is not supported.
- `google_calendar_list_events`: reads events from the primary calendar for at most 31 days.
- `google_calendar_create_event`: creates one event after app approval. Event editing, deletion, attendee invitations, and Google Calendar push notifications are not implemented.

Disconnect removes the locally stored tokens and attempts Google token revocation. If revocation cannot be confirmed, the UI reports that local access was removed and directs the user to revoke Nodular in Google Account settings.
