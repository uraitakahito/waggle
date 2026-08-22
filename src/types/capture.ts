/**
 * Capture format flags exchanged with BrowserHive.
 *
 * Mirrors the boolean shape that upstream's `submitCapture` expects in
 * its `captureFormats` body field. All six flags are required by the
 * 1.6.0 spec (`additionalProperties: false`); each defaults to `false`
 * and the server requires at least one of them to be `true`.
 */
export interface CaptureFormats {
  png: boolean;
  webp: boolean;
  html: boolean;
  links: boolean;
  mhtml: boolean;
  wacz: boolean;
}

/**
 * Everything about *how* a run captures, as opposed to *what* it captures
 * (the URLs, which come from the `urls` table).
 *
 * These are per-run knobs rather than per-URL ones, matching how
 * `dismissBanners` and `acceptLanguage` already worked: the CLI states the
 * intent once and every entry in the run inherits it. Should a single run ever
 * need to vary them per URL, the setting belongs in the `urls` table instead.
 *
 * Every optional field here has a server-side default, so an unset field must
 * be **omitted from the request body**, not sent as `undefined` — that is what
 * lets `--device-pixel-ratios` and friends stay opt-in without waggle having to
 * know what BrowserHive's current defaults are.
 */
export interface CaptureSettings {
  captureFormats: CaptureFormats;
  dismissBanners: boolean;
  acceptLanguage?: string;
  /**
   * Device pixel ratios to load at, in load order. Each entry is 1–3 and no
   * value may repeat; the server rejects anything else with INVALID_ARGUMENT.
   *
   * The length is the number of loads, so capture time and WARC size grow with
   * it. Order matters: PNG/WebP are taken once after every load finishes, so
   * they come out at the **last** entry's ratio — `[2, 1]` leaves the images 1x.
   *
   * Replaced `deviceScaleFactor` and `archiveMode`, which BrowserHive removed
   * in v3.6.0 (`reserved 13, 14` in the proto — the field numbers must never be
   * reused because an old client's `archive_mode = MULTIPASS` would decode as
   * `device_pixel_ratios = [2]`).
   */
  devicePixelRatios?: number[];
  operationDelayMs?: number;
  behaviors?: {
    builtins?: string[];
    siteBehaviors?: boolean;
  };
}
