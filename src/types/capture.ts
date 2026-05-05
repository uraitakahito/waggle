/**
 * Capture format flags exchanged with BrowserHive.
 *
 * Mirrors the boolean shape that upstream's `submitCapture` expects in
 * its `captureFormats` body field. All flags default to `false`; the
 * server requires at least one of them to be `true`.
 */
export interface CaptureFormats {
  png: boolean;
  jpeg: boolean;
  html: boolean;
  links: boolean;
  pdf: boolean;
}
