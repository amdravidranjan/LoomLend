/** Tiny window-event bus so any button can open the global palette or shortcut sheet. */
export const PALETTE_EVENT = "ll:palette";
export const SHORTCUTS_EVENT = "ll:shortcuts";

export function openPalette(query = "") {
  window.dispatchEvent(new CustomEvent(PALETTE_EVENT, { detail: query }));
}
export function openShortcuts() {
  window.dispatchEvent(new CustomEvent(SHORTCUTS_EVENT));
}
