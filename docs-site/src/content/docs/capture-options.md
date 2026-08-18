---
title: Capture options
description: Which waggle flag maps to which BrowserHive request field.
---

waggle does not capture anything itself, so this page is a **mapping**, not an
explanation. Each flag sets one field on the `POST /v1/captures` body; what the
field _does_ is BrowserHive's to define, and its documentation is the only place
that stays correct when the behaviour changes.

Flags are per run, not per URL: the command line states the intent once and
every row in the run inherits it.

## Formats

At least one must be true, or BrowserHive rejects the request.

| Flag      | `captureFormats` key |
| --------- | -------------------- |
| `--png`   | `png`                |
| `--webp`  | `webp`               |
| `--html`  | `html`               |
| `--links` | `links`              |
| `--mhtml` | `mhtml`              |
| `--wacz`  | `wacz`               |

## Capture behaviour

| Flag                                      | `CaptureRequest` field    | What it means                                                                                           |
| ----------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `--device-scale-factor <n>`               | `deviceScaleFactor`       | BrowserHive: Behaviors                         |
| `--archive-mode <single-pass\|multipass>` | `archiveMode`             | BrowserHive: Behaviors                         |
| `--operation-delay-ms <ms>`               | `operationDelayMs`        | BrowserHive: Environment variables |
| `--behaviors <ids>`                       | `behaviors.builtins`      | BrowserHive: Behaviors                         |
| `--no-site-behaviors`                     | `behaviors.siteBehaviors` | BrowserHive: Behaviors                         |
| `--dismiss-banners`                       | `dismissBanners`          | BrowserHive: Behaviors                         |
| `--accept-language <bcp47>`               | `acceptLanguage`          | BrowserHive: Quickstart                       |

## Omitted means "server default"

A flag you do not pass is **left out of the request body entirely** — not sent as
`null`. Every one of these fields has a default on the BrowserHive side, so
omitting a flag means "whatever that server is configured to do", and waggle
never has to track what those defaults currently are.

```ts file="src/config/cli-options.ts#capture-settings"

```

## Run configuration

These are deployment settings rather than per-run intent, so they also read from
the environment.

| Flag                   | Env                       | Purpose                                                                                                     |
| ---------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `--database-url <url>` | `DATABASE_URL`            | Where the `urls` table lives. Required.                                                                     |
| `--server <url>`       | `BROWSERHIVE_SERVER`      | BrowserHive base URL. Defaults to the SDK's baked-in value (`servers[0].url` of the vendored spec).         |
| `--tls-ca-cert <path>` | `BROWSERHIVE_TLS_CA_CERT` | Logged for visibility. Node's trust store is set by `NODE_EXTRA_CA_CERTS`, which is the authoritative knob. |
| `--limit <n>`          | —                         | Read only the first _n_ enabled rows. Useful for smoke tests.                                               |

## Examples

```sh
# Retina-faithful, fully archived, slow enough to watch over chrome://inspect
npm run dev -- --wacz --limit 1 --archive-mode multipass --operation-delay-ms 250

# No behaviors at all — "" is not the same as omitting the flag
npm run dev -- --png --limit 1 --behaviors "" --no-site-behaviors
```

A rejected request reports the reason from BrowserHive's problem response:

```json
{ "msg": "Request rejected", "error": "/captureFormats must be object" }
```
