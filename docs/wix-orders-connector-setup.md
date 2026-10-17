# Wix online orders connector

The unlisted Vaeroex Wix app has ID `b7039901-d1cb-42fc-988c-ed1fdf635ba9` and U.S.-only install share ID `c3627cf3-1f14-4fbd-b28d-21f57b032ec1`. Its Wix permissions are **Read Orders** for Wix Restaurants and Wix Stores. It requests no write scopes. Wix App Market publication is not required for an unlisted install link.

## Production setup

1. Apply `20261017050000_wix_orders_read_only_connection.sql` to the Vaeroex Supabase project and verify the four tables, RLS policies, and service-role functions. The credentials and install-state tables are not selectable by signed-in users.
2. In Vercel Production, set `WIX_ORDERS_APP_ID`, `WIX_ORDERS_SHARE_URL_ID`, `WIX_ORDERS_APP_SECRET`, and `WIX_ORDERS_ENCRYPTION_KEY`. Generate the encryption key as 32 random bytes in standard base64. Keep the app secret and encryption key server-side; never put them in a `NEXT_PUBLIC_` variable, a log, or the repository.
3. Deploy the application. Set `WIX_ORDERS_ENABLED=true` only after the migration and all keys are in place, then redeploy. The public catalog shows “Setup in progress” while disabled.
4. Test with a Wix site owned by the tester: connect from a Vaeroex workspace, install the app, sync seven days of orders, and disconnect. Verify another workspace cannot see the connection or its facts. A merchant site requires online ordering and a Wix plan supporting payments; Wix Restaurants orders require the Restaurants Orders app.

## What is stored

The connector stores an encrypted Wix app instance ID in a server-only table. It stores an order ID, creation date, total, currency, and payment status for each recent order. It discards customer names, email, addresses, notes, items, and the rest of Wix's order response. A sync replaces the prior seven-day snapshot in one database transaction. Disconnect removes credentials and stored order facts. The app remains installed on the Wix site until its owner removes it there.

The displayed order total is not net revenue or settled deposits. This version does not read refund transactions.

References: [Wix external install flow](https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/install-your-app/about-the-external-install-flow), [Wix app-instance OAuth](https://dev.wix.com/docs/build-apps/develop-your-app/auth/authenticate-using-oauth), [Wix Search Orders](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/orders/search-orders), [Wix unlisted install links](https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/install-your-app/share-an-app-install-link).
