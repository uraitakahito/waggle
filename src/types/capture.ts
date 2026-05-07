/**
 * Capture format flags exchanged with BrowserHive.
 *
 * Mirrors the boolean shape that upstream's `submitCapture` expects in
 * its `captureFormats` body field. All six flags are required by the
 * 1.3.0 spec (`additionalProperties: false`); each defaults to `false`
 * and the server requires at least one of them to be `true`.
 */
export interface CaptureFormats {
  png: boolean;
  webp: boolean;
  html: boolean;
  links: boolean;
  pdf: boolean;
  mhtml: boolean;
}
