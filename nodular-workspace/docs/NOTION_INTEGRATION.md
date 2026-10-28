# Notion integration

The app connects one Notion internal integration per Nodular user. The integration secret is entered in **Connect → Notion**, verified with Notion’s `/users/me` endpoint, encrypted at rest with `INTEGRATION_ENCRYPTION_KEY`, and never returned to the browser.

## Setup

1. Create an internal integration in Notion at [My integrations](https://www.notion.so/profile/integrations).
2. Grant it only the capabilities needed: read content and insert content. Do not grant update/delete access unless a future implementation specifically requires it.
3. Share only the pages that should be visible to the integration. A valid token alone does not grant access to every workspace page.
4. Ensure the Nodular server has a stable, private `INTEGRATION_ENCRYPTION_KEY` of at least 32 characters, then paste the internal integration secret into the Connect page.
5. To fully revoke access, disconnect it in Nodular and revoke the integration secret from Notion.

## Implemented operations

- Search returns at most ten matching pages/databases with IDs, titles, URLs, and edit timestamps.
- Read fetches one shared page and up to 12,000 characters from its direct child blocks. It does not recursively crawl nested pages or download files.
- Create adds one child page under a selected parent page, with plain text split into bounded paragraph blocks. The action requires explicit app approval.
- Existing page content cannot be updated or deleted by these tools. A missing, invalid, or unshared page produces the Notion API error instead of a success-shaped response.
