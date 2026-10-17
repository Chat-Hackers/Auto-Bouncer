# WhatsApp Bouncer

**Manual Vercel hosting:** see [DEPLOY-VERCEL.md](DEPLOY-VERCEL.md). The hosted version uses Neon Postgres, server environment secrets, and a **Download Hub JSON** button. The local demo below remains available independently.

A local, report-first prototype for comparing an organiser's approved-number CSV with an uploaded group participant snapshot. It records human-reviewed exceptions and observes future Matrix membership events after Hub registration. It sends no public messages, kicks or bans. A number match is only a match to the supplied list, not proof of ownership, affiliation or eligibility.

## Start

Requires Node.js 22.16+. No dependency install or frontend build is needed.

```sh
npm start
```

Open http://127.0.0.1:5059 and enter the organiser token printed at startup. Click **Load a small demo** to see six illustrative participants: two list matches, an unmatched number, an identity with no number, an ambiguous duplicate, and an organiser-verified number change. Use **Clear demo** before real imports. Demo import protection prevents mixing real uploads into a labelled demo. No existing scheduler or moderator configuration is used.

## Real comparison workflow

1. Set the Matrix room ID and phone format, then save. Use one instance/data directory per group. Explicitly exclude known bot/service Matrix IDs if needed.
2. Upload or paste the approved list; preview and confirm replacing the current list.
3. Upload or paste a participant snapshot; preview and confirm. Phone may be blank. Supplying `matrix_user_id` lets later join/leave events update the correct imported entry.
4. Review ambiguous, unmatched or missing-number entries. Record a guest exception, verify a changed number against a unique approved reference, mark awaiting verification, or record not approved. The latter does not remove anyone.
5. Export the JSON report with timestamps, current results and review audit notes. Exports contain full numbers; handle them privately.

Approved-list format:

```csv
phone,name,reference
07700 900101,Example A,DEMO-A
+44 7700 900102,Example B,DEMO-B
```

Participant snapshot:

```csv
phone,name,matrix_user_id
00447700900101,Example A,@example_a:matrix.test
,Number unavailable,@opaque_identity:matrix.test
```

Numbers must be text with `+countrycode` or `00countrycode`; UK mode also accepts standard 11-digit local forms beginning 0. Spaces, brackets and hyphens are stripped. A leading `+44 (0)` is handled explicitly. Bare international digits, extensions and opaque identities are not guessed. This is conservative formatting normalisation, not a global phone-validity or ownership check. UK short/special numbers may require organiser review. Both files support UTF-8 BOM, quoted commas and multiline fields. Maximum 5,000 rows and 1 MB per file. Keep leading zeros when preparing CSVs in spreadsheets.

Duplicate approved numbers or references and duplicate participant numbers are ambiguous, not automatically approved. Invalid/missing approved entries remain visible in import diagnostics and cannot supply a valid match. Invalid or duplicate Matrix IDs must be fixed before applying a participant snapshot.

Guest and changed-number decisions are tied to a signature of the participant identity, phone, room, membership and approved-list version. New approved data, identity changes or expiry require fresh review. Changed-number decisions retain the original source list; they do not silently add a new number. Optional expiry is the end of the selected date in UTC. Shared-token decisions are not independently attributable to an individual organiser; put the verifier in the note when useful.

## Join-event integration

Copy `.env.example` to `.env`; set `PUBLIC_URL` to this tool's own HTTPS origin and optionally set a fixed `ADMIN_TOKEN`. Run or restart the service. Startup prints a small registration JSON and saves it to `data/whatsapp-bouncer.json`. Share it privately with the Hub operator, retaining the `?hook=` query in its URL. Module id: `whatsapp-bouncer`; event subscription: `m.room.member`. The operator must register and activate it for the configured room. Keep this separate from the scheduler (5057) and moderator (5058).

The Hub sends `{event, botUserId, displayName}`. This app authenticates a webhook secret in the registration URL because the inspected Hub does not attach a bearer header. Membership targets use `event.state_key`, not `event.sender` (which can be the inviting/removing admin). Joins and leave/ban observations update a mapped identity. Duplicate events are ignored for seven days; older timestamped observations do not override newer ones.

The app always responds with `{"success":true,"response":{}}`: it does not reveal approved-list membership to the group. It never parses numbers from display names, sender IDs, or LID-looking strings. An unmapped identity is recorded as number unavailable. Import explicit phone + Matrix-ID mappings when the operator can provide them.

An uploaded roster is a snapshot, not an authoritative live member list. The tool cannot reconstruct joins missed while it was offline. Replacing a participant snapshot replaces its observed roster too; preview detects concurrent changes before apply. Missing `matrix_user_id` entries cannot reliably be correlated with later events, which may create a separate unknown row. A direct membership-database API integration and full roster enumeration are not included.

## Verified technical limits

- The [welcome-tool](https://github.com/Chat-Hackers/welcome-tool) baseline subscribes to `m.room.member` and checks `content.membership === "join"`.
- The locally inspected [Tool Hub](https://github.com/Chat-Hackers/tool-hub) forwards activated event subscriptions. Existing `/api/room` returns a timeline, not a guaranteed full roster.
- A Matrix member event's `state_key` identifies the affected member. See the [Matrix membership specification](https://spec.matrix.org/latest/client-server-api/#mroommember).
- Phone availability, full roster retrieval, WhatsApp participant identifiers and any removal action still need tests against the actual bridge deployment. The separate discussion about kicking through the Hub is not assumed implemented here.

No real member list was fetched or group action executed during development. Demo outcomes and automated tests are documented in `TEST-CASES.md`.

## Storage and hosting handoff

Private state is saved to `data/state.json`; access token and webhook identity to `data/identity.json`. Keep and back up this directory; it is excluded from Git and the handoff ZIP. Restrict the instance to trusted organisers, use HTTPS for a public deployment, and omit query strings from access logs. Import previews and API data are authenticated. Full numbers are masked visually by default; masking is not a substitute for access control. Data persists until the operator archives/deletes it; no retention policy is automated in this prototype.

Run one always-on Node process with persistent writable DATA_DIR, or use `docker compose up -d --build` after creating `.env`. Docker keeps state in the `bouncer-data` volume. Get registration with `docker compose cp bouncer:/data/whatsapp-bouncer.json ./whatsapp-bouncer.json`. Docker hosting and a real Hub connection have not been exercised here.

## Checks and API

```sh
npm run build
npm test
```

The tests exercise normalisation, malformed CSV, duplicates, missing numbers, review expiry/staleness, target identity handling, import previews, access control, webhook deduplication, and restart persistence. They use isolated local data and send no external messages.

Organiser routes require `Authorization: Bearer <ADMIN_TOKEN>`:

| Route | Purpose |
| --- | --- |
| GET /api/state | Settings, source lists, comparison and audit |
| GET /api/report | Current report and audit for export |
| POST /api/settings | `{roomId,country,exemptUserIds}` |
| POST /api/import/preview | `{kind,csv}`; returns preview entries and version |
| POST /api/import/apply | `{kind,csv,expectedVersion}`; confirms replacement |
| POST /api/participants/:id/review | `{signature,outcome,note,linkedReference?,expiresAt?}` |
| POST /api/demo | Load labelled demo into an empty instance |
| POST /api/demo/reset | Clear only a labelled demo |

`POST /?hook=<secret>` receives membership events. `GET /health` checks readiness without authentication.
