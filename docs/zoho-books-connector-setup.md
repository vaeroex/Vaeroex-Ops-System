# Zoho Books connection

Executive Intelligence offers a read-only Zoho Books connection for U.S. organizations. The workspace owner authorizes a Zoho Books account and, if more than one eligible organization is available, chooses which organization to use. A manual import accepts up to 366 UTC calendar dates per batch, including older years. It retains minimized invoice/expense IDs, dates, currencies and numeric contributions, with no customer, vendor, document text, or line-item details. Draft and void invoices contribute zero. Invoices are amounts billed, not recognized revenue or cash received. Non-USD transactions are counted as omitted rather than combined with USD.

## Provider setup

The server-based application **Vaeroex Executive Intelligence** is registered in the Zoho API Console with this exact redirect URI:

`https://www.vaeroex.com/api/integrations/zoho-books/callback`

The OAuth scopes are `ZohoBooks.settings.READ`, `ZohoBooks.invoices.READ`, and `ZohoBooks.expenses.READ`. The app requests offline access and uses the U.S. Zoho Accounts and API domains. Zoho Books API documentation lists 1,000 API requests per day on the Free plan. Zoho Books's free plan has its own eligibility limits; customers with paid Books plans can also connect. The connector itself does not request a Vaeroex-paid API tier.

In Vercel Production only, set the server-side variables `ZOHO_BOOKS_ENABLED=true`, `ZOHO_BOOKS_CLIENT_ID`, `ZOHO_BOOKS_CLIENT_SECRET`, `ZOHO_BOOKS_REDIRECT_URI`, and `ZOHO_BOOKS_TOKEN_ENCRYPTION_KEY`. Generate the encryption key as 32 random bytes, standard base64. Treat the client secret and encryption key as secret values. Apply migration `20261017023221_zoho_books_read_only_connection.sql` before enabling the connector. Do not put credentials in `NEXT_PUBLIC_` variables or the repository.

## Data and operations

The owner connects at `/app/integrations/zoho-books`, approves access at Zoho, chooses an organization when needed, then selects **Import selected dates**. Every page must complete before that period replaces its saved facts. Other periods remain; matching provider IDs are updated without duplicates. Saved-history filters are independent of imports, and database aggregation avoids API row-limit truncation. Outstanding amounts are the balances observed when invoices were imported, not historical balances as of their invoice dates. Re-import to refresh changed records.

Apply additive migration `20261019070949_zoho_books_import_history.sql` before deploying the history controls. Completed empty dates, partial dates and missing dates are distinguished. A partial date remains partial until refreshed. Existing aggregate-only summaries remain available separately and can be re-imported to join the new history without fabricated IDs or double counting. Signing out retains saved history; explicit disconnect removes credentials, OAuth state, facts, coverage and legacy summaries. The owner can also revoke the app in Zoho Connected Apps. See [historical import behavior](integrations/historical-imports.md) for batch limits and release ordering.

The provider does not currently have a connected real customer. Test the OAuth callback and first sync with the designated test organization before declaring end-to-end production verification.

Official documentation: [OAuth](https://www.zoho.com/books/api/v3/oauth/), [API limits](https://www.zoho.com/books/api/v3/introduction/), [pricing](https://www.zoho.com/us/books/pricing/).
