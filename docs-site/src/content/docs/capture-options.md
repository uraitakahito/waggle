---
title: Capture options
description: Which waggle flag maps to which BrowserHive request field.
---

waggle does not capture anything itself, so this page is a **mapping**, not an
explanation. Each flag sets one field on the `SubmitCapture` request; what the
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

| Flag                           | `CaptureRequest` field    | What it means                      |
| ------------------------------ | ------------------------- | ---------------------------------- |
| `--device-pixel-ratios <list>` | `devicePixelRatios`       | BrowserHive: Behaviors             |
| `--operation-delay-ms <ms>`    | `operationDelayMs`        | BrowserHive: Environment variables |
| `--behaviors <ids>`            | `behaviors.builtins`      | BrowserHive: Behaviors             |
| `--no-site-behaviors`          | `behaviors.siteBehaviors` | BrowserHive: Behaviors             |
| `--dismiss-banners`            | `dismissBanners`          | BrowserHive: Behaviors             |
| `--accept-language <bcp47>`    | `acceptLanguage`          | BrowserHive: Quickstart            |
| `--session <mode>`             | `session`                 | BrowserHive: Sessions              |
| `--signing`                    | `signing`                 | BrowserHive: Signing a WACZ        |

## `--signing` fails the capture rather than dropping the signature

`--signing` requires `--wacz`, because the signature covers the WACZ archive.
waggle rejects the combination locally rather than letting the server answer
`INVALID_ARGUMENT`.

**If the server cannot obtain a signature, the capture fails.** BrowserHive
throws before it writes the zip, so an unsigned archive is never produced in
place of a signed one. That is the intended behaviour, and it has an operational
consequence worth stating plainly: passing `--signing` at a deployment with no
signing service configured makes **every** capture in the run fail.

Omitting the flag leaves the decision to the server's `--signing-policy`. A
deployment running `required` signs everything without waggle saying anything.

The ledger records the outcome. `archives.signed` is `true` when a signature was
obtained, `null` when none was asked for — so "this run produced evidence-grade
archives" is answerable without opening a single zip.

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

| Flag                        | Env                       | Purpose                                                                                                     |
| --------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `--database-url <url>`      | `DATABASE_URL`            | Where the `capture_targets` table lives. Required.                                                          |
| `--server <url>`            | `BROWSERHIVE_SERVER`      | BrowserHive base URL. Defaults to `DEFAULT_TARGET` in `src/rpc/client.ts`.                                  |
| `--tls-ca-cert <path>`      | `BROWSERHIVE_TLS_CA_CERT` | Logged for visibility. Node's trust store is set by `NODE_EXTRA_CA_CERTS`, which is the authoritative knob. |
| `--limit <n>`               | —                         | Read only the first _n_ enabled rows. Useful for smoke tests.                                               |
| `--no-collect`              | —                         | Submit and exit without waiting; `fga:reconcile` picks the results up from the bucket later.                |
| `--capture-timeout-ms <ms>` | —                         | Cap the wait for one capture, overriding the budget the server declares.                                    |

## Examples

```sh
# Loaded twice (1x then 2x), slow enough to watch over chrome://inspect.
# Order matters: PNG/WebP come out at the last ratio, so this leaves them 2x.
pnpm run capture --wacz --limit 1 --device-pixel-ratios 1,2 --operation-delay-ms 250

# No behaviors at all — "" is not the same as omitting the flag
pnpm run capture --png --limit 1 --behaviors "" --no-site-behaviors
```

A rejected request reports the reason from BrowserHive's problem response:

```json
{ "msg": "Request rejected", "error": "/captureFormats must be object" }
```
