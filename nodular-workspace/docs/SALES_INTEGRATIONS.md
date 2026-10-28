# Apollo and Stripe

Apollo and Stripe use per-user credentials. The Connect page validates each credential, stores it encrypted with AES-256-GCM in the app database, and never returns it to the browser. Both require the server's stable `INTEGRATION_ENCRYPTION_KEY` (at least 32 characters). Disconnect removes the local encrypted credential; revoke the key in its provider dashboard as well if it should no longer work.

## Apollo

Enter an Apollo API key from the Apollo workspace. Nodular validates it with Apollo's `auth/health` endpoint.

- `apollo_people_search` uses Apollo's People API Search endpoint. Apollo currently documents this endpoint as zero-credit, but account eligibility, plan restrictions, and API rate limits still apply.
- Search results are limited to ten people per request and return name, job title, organization, location, and public LinkedIn URL when present.
- Apollo's search endpoint does not return email addresses or phone numbers. Enrichment, sequence enrollment, outreach, and contact creation are not implemented.
- API-key requests act as the Apollo workspace's longest-standing active admin according to Apollo's authentication documentation; review this ownership behavior before using an API key in a shared workspace.

## Stripe

Enter a Stripe secret key (`sk_*`) or restricted key (`rk_*`); publishable keys cannot be used. Nodular validates the key against `/v1/account` and displays test/live mode.

- `stripe_search_customers` performs an exact-email lookup and returns only customer ID, name, email, and creation time.
- `stripe_create_invoice_draft` is app-approval-required. It creates a draft invoice and one fixed-amount line item for an existing customer.
- The tool deliberately does not finalize, email, or charge invoices. It does not create customers, prices, subscriptions, refunds, or payment intents.
- Stripe amounts are integer minor units, for example 1250 for USD 12.50. Confirm the currency's minor-unit convention before requesting a draft.

Billing for Nodular's own workflow usage remains separately configured through the existing server-level Stripe billing settings.
