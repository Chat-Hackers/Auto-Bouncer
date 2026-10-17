# Combined participant checks and message moderation

Auto Bouncer now incorporates the former standalone Auto Moderator. The existing Bouncer app is the canonical combined tool; no separate moderator deployment, token, database or registration is required.

## Existing deployments

This release preserves the `whatsapp-bouncer` module id, access token, webhook secret, instance id and existing Postgres state table. Existing approved lists, roster observations and organiser decisions remain intact. Moderation is added as a nested state object when loading older records, with demo mode as the default. No database migration is required.

After deployment, connect to the existing dashboard and download its updated Hub JSON. Ask the Hub operator to replace the existing registration for `whatsapp-bouncer` (preserving its secret), then reload registrations as appropriate. It now subscribes to both `m.room.member` and `m.room.message`. Do not activate a second standalone Auto Moderator for the same rules, or each tool could issue its own warning.

The webhook URL and the stable production origin remain unchanged. This release does not modify Hub registrations or enable live warnings automatically.

## Workflow

1. Save the group room ID in Group settings. That one group scopes both roster checks and language moderation.
2. Open Message rules. Add literal whole-word/phrase triggers and choose Review only or Warn + review for each. Exceptions are semicolon-separated phrases, scoped to the rule. Additional exempt sender IDs are optional; the shared service-account exclusion list also applies.
3. Use the simulator before saving. It sends no group message and does not create a review record. Try `You are an idiot.`, `An idiotic proposal.`, and `Please don’t call people an idiot.` with the starter rules.
4. Start with demo mode. Incoming matching text events enter Flagged messages but no group response is returned.
5. Review a flag and record a context note as Confirmed concern, False positive, or Dismissed. The same report export includes participant decisions, moderation flags and the audit trail.
6. Once ready, explicitly save Live mode. Warn + review rules can return a respectful warning through the Hub. A per-sender/per-room cooldown limits repeated warnings; matching messages still enter the queue. Labelled demo data cannot enable live mode or emit group warnings.

The existing Load a small demo button now also loads three clearly labelled moderation examples, including a context false positive. Clear demo removes both types of demo data. Being matched to an approved phone number never implicitly exempts someone from message rules.

## Delivery and matching limits

Whole-word matching normalises case, width variants, whitespace and certain invisible characters. It cannot infer intent or catch every obfuscation. Message edits inspect new content; quoted reply fallback is stripped. Bots and tool responses are ignored. A false-positive review note does not silently create a new exception.

Webhook room/event IDs deduplicate for seven days. Moderation state, deduplication and cooldown records use the same atomic Postgres revision checks as participant state. Concurrent update retries have no external network side effects; only the response from the successful committed operation can contain a warning. Failed delivery is not retried automatically.

“Returned to Hub” is an HTTP response outcome, not a WhatsApp delivery receipt. Kicks, bans and deletion are not enabled by this merge. The inspected arbitrary-event API does not establish a working membership-removal contract; add that separately after confirming the exact request and bridge behaviour.

## API additions

All organiser endpoints use the existing `Authorization: Bearer <ADMIN_TOKEN>`.

| Route | Input |
| --- | --- |
| POST /api/moderation/config | `{mode, warning, cooldownSeconds, exemptSenders, rules}`; room scope is taken from group settings |
| POST /api/moderation/simulate | `{text, sender, config?}` |
| POST /api/moderation/incidents/:id/review | `{status, note}` |
| GET /api/state | Adds `moderation.config`, `moderation.incidents` and capabilities |
| GET /api/report | Includes moderation records alongside the existing participant report |

Each rule has `{id, phrase, action, enabled, exceptions}`. Supported actions are `review` and `warn`. Configuration permits at most 100 rules; the shared state remains capped at 2 MB. Message contents and review notes are private organiser data; retain/export/archive them according to the group's policy.

## Validation

The combined tests cover old-state compatibility, preserving lists and decisions, one registration with both event subscriptions, demo protections, shared room and sender scope, simulator isolation, duplicate concurrent events, cooldown, review validation, database recreation and combined export. Existing Bouncer import, phone normalisation and member-sync tests remain part of the suite. Live bridge warnings and removals are not exercised by automated tests.
