# Deploy WhatsApp Bouncer to Vercel + Neon

This package is prepared for manual deployment. It has not been deployed to Vercel or connected to a real Neon database here. Use the **Campaign Lab** workspace when creating the project.

## 1. Import the code

Put the contents of `whatsapp-bouncer-vercel.zip` into a GitHub repository. Include `api/`, `public/`, the root `.mjs` files, `package.json`, `package-lock.json` and `vercel.json`. Do not upload `data/`, `.env*` private files, or `node_modules/`. The `.env.example` template is safe to include.

In Vercel: **Campaign Lab → Add New → Project**, import that repository, and use the Bouncer directory as the root if this is a multi-project repository. Framework is **Other**. The included configuration sets build command `npm run build`, output directory `public`, API routing and region `lhr1`. Use a supported Node.js runtime of 22 or newer. Vercel installs the pinned Neon driver automatically.

The initial deployment can serve the dashboard before configuration is complete; API calls will return a setup error until the next steps are done.

## 2. Add Neon Postgres

In the Vercel project's **Storage** tab, create/connect a **Neon Postgres** database through Marketplace. Choose an appropriate European region near the app and the plan you want. Complete the account/terms steps yourself. Keep the connection server-side.

Connect this database to the project's **Production** environment. Confirm it supplies `DATABASE_URL`; if it uses a prefixed name, add a server environment variable named `DATABASE_URL` with that connection value. No Blob, Redis or second storage provider is required for this prototype.

Open the connected database's **Neon SQL Editor**. Run the contents of `db/setup.sql` once. This creates the private state table without importing local lists. The app creates its empty instance row on first use. A schema setup is deliberate: the runtime doesn't need table-creation privileges.

## 3. Add private settings

Locally, from the Bouncer folder:

```sh
npm run setup:secrets
```

This creates the ignored `.env.vercel.local` file containing two distinct random secrets, a stable module UUID and an instance id. It does not print the values. Open it locally and copy each entry into **Vercel → Project → Settings → Environment Variables**, for **Production** only:

| Name | Value |
| --- | --- |
| `DATABASE_URL` | Server connection URL supplied by Neon |
| `ADMIN_TOKEN` | Private organiser access token, at least 24 characters |
| `MODULE_SECRET` | A different private webhook secret, at least 24 characters |
| `MODULE_UUID` | Stable registration UUID from the helper file |
| `BOUNCER_INSTANCE_ID` | `whatsapp-bouncer-production` |
| `PUBLIC_URL` | Your stable production origin, e.g. `https://your-project.vercel.app` |

Use the production domain, not a temporary deployment URL. Keep these values out of Git and group chats. The local demo's generated credentials/data are not automatically copied to production. Preserve the secrets after registration; changing MODULE_SECRET requires updating the Hub registration.

Don't give preview deployments production database access. If previews are needed, connect a separate Neon branch/database with separate secrets and instance id. Missing configuration fails closed; the app does not substitute local files or a fake database.

## 4. Redeploy and check

Redeploy after saving the environment variables. Then:

1. Open `/health` on the production domain: `{"ok":true}` confirms the database is reachable and the table exists.
2. Open the dashboard and connect with the **Production ADMIN_TOKEN**.
3. Load the labelled demo, review an entry, refresh, and verify the decision persists. Clear the demo before importing real lists.
4. Configure the actual Matrix room ID and import your lists.
5. Click **Download Hub JSON**. Send that downloaded file privately to your friend. Its URL points to `/webhook?hook=...` on the permanent Vercel origin.
6. Ask your friend to register and activate `whatsapp-bouncer` in that room. Observe a consenting test account join and verify it appears. An opaque identity without a supplied phone mapping remains “Number unavailable”.

Vercel deployment protection can require a separate Vercel login before a webhook reaches the app. Ensure the chosen production webhook URL is reachable by your Hub under your team's access policy. Don't turn off organisation security controls blindly; agree the intended production access with the Hub operator. Application webhook-secret verification remains required.

## Persistence and limits

The hosted app uses parameterised Neon HTTP queries. For this small prototype, one Postgres JSONB snapshot per `BOUNCER_INSTANCE_ID` holds the lists, observations, decisions and audit trail. Atomic revision checks prevent silent overwrites across serverless invocations. Conflicting operations are recomputed against fresh state; sustained contention returns HTTP 409. No membership actions or public messages are performed, so these retries have no external side effects.

The prototype caps stored state at 2 MB in addition to the import row limits. It is intended for small groups; export and archive before the audit history grows too large. A larger multi-group service should move records into separate tables with pagination, retention controls and individual organiser accounts.

The app has no runtime dependency on a writable filesystem in Vercel. Local `npm start` still uses the existing file-backed demo and the same business logic. Run `npm ci`, `npm run build`, and `npm test` locally to validate the package. Tests use an embedded Postgres engine for SQL and concurrency checks; live Neon connectivity, Vercel routing and bridge delivery require the deployment checks above.
