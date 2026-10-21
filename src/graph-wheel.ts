// Chromium exposes both Mac trackpad scroll and mouse wheels as wheel events.
// Its legacy wheelDeltaY distinguishes precise scrolling from wheel notches.
export function isMacTrackpadPan(event: Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode" | "ctrlKey"> & { wheelDeltaY?: number }, platform: string): boolean {
  if (!/Mac/i.test(platform) || event.ctrlKey || event.deltaMode !== 0) return false;
  if (event.deltaY === 0) return event.deltaX !== 0;
  if (typeof event.wheelDeltaY === "number") {
    return Math.abs(event.wheelDeltaY + event.deltaY * 3) < 0.01;
  }
  // Without Chromium's extra field, only fractional deltas identify precise input.
  return !Number.isInteger(event.deltaY) || !Number.isInteger(event.deltaX);
}
