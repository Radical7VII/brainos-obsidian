// Chromium exposes both Mac trackpad scroll and mouse wheels as wheel events.
// Use Chromium's precise-scroll ratio, excluding conventional 120-unit wheel
// notches first: a mouse delta of 40 otherwise matches the same ratio.
export function isMacTrackpadPan(event: Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode" | "ctrlKey"> & { wheelDeltaY?: number }, platform: string): boolean {
  if (!/Mac/i.test(platform) || event.ctrlKey || event.deltaMode !== 0) return false;
  if (event.deltaY === 0) return event.deltaX !== 0;
  if (typeof event.wheelDeltaY === "number") {
    const wheelDelta = Math.abs(event.wheelDeltaY);
    if (wheelDelta > 0 && Math.abs(wheelDelta / 120 - Math.round(wheelDelta / 120)) < 0.0001) return false;
    return Math.abs(event.wheelDeltaY + event.deltaY * 3) < 0.01;
  }
  // Without Chromium's extra field, only fractional deltas identify precise input.
  return !Number.isInteger(event.deltaY) || !Number.isInteger(event.deltaX);
}
