---
title: Capture options
description: How this deployment decides what BrowserHive captures — formats and signing come from the environment.
---

capture-ledger does not capture anything itself, and since the CLI was removed it does
not talk to BrowserHive either: the Windmill flow submits. What is left here is
**one decision** — which formats to ask for, and whether to require a signature —
and capture-ledger makes it from the environment, then puts it on every dispatch.

The split is the same one the crawl API draws: **the caller decides _when_,
capture-ledger decides _what_.** Formats are a property of the deployment, not of the
request, so they are deliberately not accepted from a caller.

## Formats

Set by `CAPTURE_LEDGER_CAPTURE_FORMATS`, a comma-separated list. The default is `wacz` —
this pipeline produces replayable archives and the other formats are incidental.

```sh
CAPTURE_LEDGER_CAPTURE_FORMATS=wacz   # png, webp, html, links, mhtml, wacz
CAPTURE_LEDGER_CAPTURE_SIGNING=1      # require a wacz-auth signature; needs wacz
```

| Value   | `captureFormats` key |
| ------- | -------------------- |
| `png`   | `png`                |
| `webp`  | `webp`               |
| `html`  | `html`               |
| `links` | `links`              |
| `mhtml` | `mhtml`              |
| `wacz`  | `wacz`               |

All six keys are sent explicitly on every dispatch — **unset and `false` are not
the same thing** to BrowserHive. At least one must be true, or the server
rejects the request.

## Read once, at startup

`CAPTURE_LEDGER_CAPTURE_FORMATS` is parsed when the API starts, not per crawl. A
misspelling stops the server with the bad value named. Parsed per crawl instead,
`waxz` would surface as a scheduled crawl failing at 3am with "no capture format
enabled" — a message that never mentions the setting that caused it.

## `links` is added when the crawl follows links

A crawl with `maxDepth` above 0 gets `links: true` whatever the environment says.
Without it the first level always stops, and it stops looking as though the page
had no links at all — a configuration mistake made indistinguishable from a fact
about the site.

A depth-0 crawl does not get it. Extracting links nobody will follow only costs
the other end and the bucket.

## Signing fails the capture rather than dropping the signature

`CAPTURE_LEDGER_CAPTURE_SIGNING=1` requires `wacz` in the format list, and capture-ledger refuses
to start on the combination rather than letting the server answer
`INVALID_ARGUMENT` later.

**If the server cannot obtain a signature, the capture fails.** BrowserHive
throws before it writes the zip, so an unsigned archive is never produced in
place of a signed one. That is the intended behaviour, and it has an operational
consequence worth stating plainly: turning signing on at a deployment with no
signing service configured makes **every** capture fail.

Leaving it off leaves the decision to the server's `--signing-policy`. A
deployment running `required` signs everything without capture-ledger saying anything.

The ledger records the outcome. `archives.signed` is `true` when a signature was
obtained, `null` when none was asked for — so "did this crawl produce
evidence-grade archives" is answerable without opening a single zip.

## What capture-ledger no longer decides

The old CLI mapped a flag onto every field of BrowserHive's `CaptureRequest`:
`--device-pixel-ratios`, `--operation-delay-ms`, `--behaviors`,
`--no-site-behaviors`, `--dismiss-banners`, `--accept-language`, `--session`.
**None of those exist any more.** capture-ledger sends `captureFormats` and `signing`,
and nothing else about how a page is rendered — everything unsent falls to
whatever that BrowserHive server is configured to do, which is what BrowserHive's
own documentation describes.

Changing how pages are rendered is now a BrowserHive-side or flow-side change,
not a capture-ledger one.

## What a caller can still set, per crawl

Pacing and reach, in the `POST /api/crawls` body — see
[Archive ledger](/capture-ledger/archive-ledger/#following-links):

| Field             | Default                             | Meaning                            |
| ----------------- | ----------------------------------- | ---------------------------------- |
| `scope`           | `same-origin`                       | `same-host` relaxes it to the host |
| `maxDepth`        | 2, or 0 with `fromTargets`          | How far to follow                  |
| `maxPages`        | 30, never below the number of seeds | Total pages                        |
| `perHostDelayMs`  | 2000                                | Gap between pages on one host      |
| `hostParallelism` | 4                                   | Distinct hosts touched at once     |

An unknown key is **400**, not silently dropped.
