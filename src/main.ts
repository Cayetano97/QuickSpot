import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { open as pickPath } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  ADD_X,
  CANVAS_H,
  CANVAS_W,
  CENTER_X,
  CHIP_H,
  CHIP_W,
  GROUP_PALETTE,
  GRIP_H,
  GRIP_W,
  GRIP_Y,
  HUB_X,
  HUB_Y,
  MAX_FINAL_SCALE,
  MAX_VISIBLE,
  MINIMIZE_Y,
  RUN_ERROR_MS,
  STAGGER_FRAC,
} from "./lib/constants";
import {
  chipCenter,
  chipMaxScale,
  dockScale,
  easeOutCubic,
  easeOutQuart,
  staggeredProgress,
} from "./lib/easing";
import {
  LANGUAGES,
  resolveLanguage,
  t,
  type DictKey,
  type Language,
  type StoredLanguage,
} from "./lib/i18n";
import {
  normalizeTheme,
  resolveTheme,
  systemPrefersDark,
  themeColorFor,
  type StoredTheme,
} from "./lib/theme";
import {
  capUtf8Bytes,
  countMatches,
  filterActions,
  isHexColor,
  isReadableOnDark,
  MAX_SEQUENCE_STEPS,
  moveSelection,
  normalizeName,
  normalizeQuery,
  SEQUENCE_STEP_KINDS,
  uniqueGroupId,
  type Action,
  type Group,
  type SequenceStep,
  type SequenceStepKind,
} from "./lib/model";
import { OverlayState } from "./lib/state";

const overlay = new OverlayState(undefined, () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches,
);

let actions: Action[] = [];
let groups: Group[] = [];
let filtered: number[] = [];
let selected = 0;
/** Who owns the selection highlight: the cursor (hover) or the keyboard.
 * A mouse-owned highlight is released as soon as the cursor is no longer
 * over a chip; a keyboard-owned one survives until the cursor takes over. */
let selectionSource: "mouse" | "keyboard" | "none" = "none";
let queryText = "";
/** Cursor in canvas-logical coords; far off-canvas until the first pointermove. */
let mouseX = -10000;
let mouseY = -10000;

let savedLanguage: StoredLanguage = "system";
let langDraft: StoredLanguage | null = null;
let currentLanguage: Language = resolveLanguage(savedLanguage);
let magnifyEnabled = true;
let iconsEnabled = true;
let autostartAtOpen = false;
/** Stored appearance: `system` follows the OS (claro -> claro, oscuro ->
 * oscuro), `light`/`dark`/`deep` pin the variant (`deep` is always an
 * explicit OLED opt-in). Draft mirrors the language pattern: the select
 * edits the draft, Save persists it. */
let savedTheme: StoredTheme = "system";
let themeDraft: StoredTheme | null = null;
/** Runtime app version (tauri.conf.json), resolved asynchronously. */
let appVersion = "";

const root = document.querySelector<HTMLElement>("#overlay")!;
const disc = document.querySelector<HTMLElement>("#disc")!;
const hub = document.querySelector<HTMLButtonElement>("#hub")!;
const addBtn = document.querySelector<HTMLButtonElement>("#add")!;
const minimize = document.querySelector<HTMLButtonElement>("#minimize")!;
const grip = document.querySelector<HTMLElement>("#grip")!;
const input = document.querySelector<HTMLInputElement>("#query")!;
const queryWrap = document.querySelector<HTMLElement>("#query-wrap")!;
const mirror = document.querySelector<HTMLElement>("#query-mirror")!;
const chipsHost = document.querySelector<HTMLElement>("#chips")!;
const emptyState = document.querySelector<HTMLElement>("#empty-state")!;
const moreCount = document.querySelector<HTMLElement>("#more-count")!;
const runError = document.querySelector<HTMLElement>("#run-error")!;
let runErrorTimer = 0;

const settingsPanel = document.querySelector<HTMLElement>("#settings")!;
const settingsTitle = document.querySelector<HTMLElement>("#settings-title")!;
const settingsClose = document.querySelector<HTMLButtonElement>("#settings-close")!;
const settingsLanguageLabel = document.querySelector<HTMLElement>("#settings-language-label")!;
const settingsTranslators = document.querySelector<HTMLElement>("#settings-translators")!;
const settingsDockLabel = document.querySelector<HTMLElement>("#settings-dock-label")!;
const settingsIconsLabel = document.querySelector<HTMLElement>("#settings-icons-label")!;
const settingsMagnify = document.querySelector<HTMLInputElement>("#settings-magnify")!;
const settingsIcons = document.querySelector<HTMLInputElement>("#settings-icons")!;
const settingsAutostart = document.querySelector<HTMLInputElement>("#settings-autostart")!;
const settingsAutostartLabel = document.querySelector<HTMLElement>("#settings-autostart-label")!;
const settingsUpdateLabel = document.querySelector<HTMLElement>("#settings-update-label")!;
const settingsUpdateBtn = document.querySelector<HTMLButtonElement>("#settings-update-check")!;
const settingsVersion = document.querySelector<HTMLElement>("#settings-version")!;
const langSelect = document.querySelector<HTMLSelectElement>("#settings-lang")!;
const settingsThemeLabel = document.querySelector<HTMLElement>("#settings-theme-label")!;
const themeSelect = document.querySelector<HTMLSelectElement>("#settings-theme")!;
const settingsError = document.querySelector<HTMLElement>("#settings-error")!;
const settingsSave = document.querySelector<HTMLButtonElement>("#settings-save")!;

const updatePopup = document.querySelector<HTMLElement>("#update-popup")!;
const updatePopupTitle = document.querySelector<HTMLElement>("#update-popup-title")!;
const updatePopupDesc = document.querySelector<HTMLElement>("#update-popup-desc")!;
const updatePopupStatus = document.querySelector<HTMLElement>("#update-popup-status")!;
const updatePopupError = document.querySelector<HTMLElement>("#update-popup-error")!;
const updatePopupNow = document.querySelector<HTMLButtonElement>("#update-popup-now")!;
const updatePopupLater = document.querySelector<HTMLButtonElement>("#update-popup-later")!;
const updatePopupNext = document.querySelector<HTMLButtonElement>("#update-popup-next")!;
const updatePopupClose = document.querySelector<HTMLButtonElement>("#update-popup-close")!;
populateLanguages();
populateThemeOptions();

const actionsPanel = document.querySelector<HTMLElement>("#actions")!;
const actionsTitle = document.querySelector<HTMLElement>("#actions-title")!;
const actionsClose = document.querySelector<HTMLButtonElement>("#actions-close")!;
const actionsDescription = document.querySelector<HTMLElement>("#actions-description")!;
const actionsTabs = document.querySelector<HTMLElement>("#actions-tabs")!;
const actionsTab = document.querySelector<HTMLButtonElement>("#actions-tab")!;
const groupsTab = document.querySelector<HTMLButtonElement>("#groups-tab")!;
const actionsRows = document.querySelector<HTMLElement>("#actions-rows")!;
const actionsError = document.querySelector<HTMLElement>("#actions-error")!;
const actionsSave = document.querySelector<HTMLButtonElement>("#actions-save")!;
const actionsStatus = document.querySelector<HTMLElement>("#actions-status")!;
let actionsAdd: HTMLButtonElement | null = null;
let activeActionsTab: "actions" | "groups" = "actions";

let uiScale = 1;

// ---------------------------------------------------------------- updater
//
// Updates are only offered from the update popup and from Settings — never
// from a pill on the disc. The popup appears when a check finds a newer
// release and offers: update now, defer to the next overlay open
// (auto-installs then), or dismiss for this session ("Later").

/** Minimum time between update checks on overlay opens (ms). The first open
 * after launch always checks; afterwards the server is polled at most every
 * five minutes so the always-on-top overlay never stalls on the network. */
const UPDATE_MIN_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** localStorage key for the "install on next open" deferral (a version). */
const UPDATE_NEXT_OPEN_KEY = "quickspot.update.nextOpenVersion";

type UpdatePhase = "none" | "available" | "downloading" | "installing";

let updatePhase: UpdatePhase = "none";
let pendingUpdate: Update | null = null;
let updatePercent = 0;
let updateCheckedAt = 0;
let updatePopupOpen = false;
/** Version dismissed via "Later" this session: not shown again until a new
 * version appears, a manual check runs, or the app restarts. */
let updateDismissedVersion: string | null = null;

/** Manual "Check for updates" state inside the settings panel. */
let settingsUpdateState: "idle" | "checking" | "uptodate" = "idle";

function updateStore(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    // No storage (private mode, tests): deferral just lasts this session.
  }
  return null;
}

function getNextOpenVersion(): string | null {
  try {
    return updateStore()?.getItem(UPDATE_NEXT_OPEN_KEY) ?? null;
  } catch {
    return null;
  }
}

function setNextOpenVersion(version: string | null): void {
  try {
    const store = updateStore();
    if (!store) return;
    if (version) store.setItem(UPDATE_NEXT_OPEN_KEY, version);
    else store.removeItem(UPDATE_NEXT_OPEN_KEY);
  } catch {
    // Private mode / no storage: deferral just lasts this session.
  }
}

/** Progress/status line for an in-flight install (localized). */
function updateStatusText(): string {
  const L = currentLanguage;
  if (updatePhase === "downloading") {
    return t(L, "updateDownloading", { percent: String(updatePercent) });
  }
  if (updatePhase === "installing") return t(L, "updateInstalling");
  return "";
}

/** Reflect the update state on the settings row: label, status, disabled. */
function syncSettingsUpdateBtn(): void {
  const L = currentLanguage;
  let text = t(L, "checkNow");
  let disabled = false;
  let available = false;
  if (updatePhase === "downloading") {
    text = t(L, "updateDownloading", { percent: String(updatePercent) });
    disabled = true;
  } else if (updatePhase === "installing") {
    text = t(L, "updateInstalling");
    disabled = true;
  } else if (updatePhase === "available" && pendingUpdate) {
    text = t(L, "updateTo", { version: pendingUpdate.version });
    available = true;
  } else if (settingsUpdateState === "checking") {
    text = t(L, "checkingUpdates");
    disabled = true;
  } else if (settingsUpdateState === "uptodate") {
    text = t(L, "upToDate");
    disabled = true;
  }
  settingsUpdateBtn.textContent = text;
  settingsUpdateBtn.disabled = disabled;
  settingsUpdateBtn.classList.toggle("available", available);
  settingsUpdateBtn.setAttribute("aria-label", text);
}

/** Refresh the popup contents from the current phase (no-op when closed). */
function syncUpdatePopup(): void {
  if (!updatePopupOpen) return;
  const L = currentLanguage;
  const busy = updatePhase === "downloading" || updatePhase === "installing";
  updatePopupTitle.textContent = t(L, "updatePopupTitle");
  updatePopup.setAttribute("aria-label", t(L, "updatePopupTitle"));
  updatePopupDesc.textContent =
    updatePhase !== "none" && pendingUpdate
      ? t(L, "updatePopupDesc", { version: pendingUpdate.version })
      : "";
  updatePopupStatus.textContent = updateStatusText();
  updatePopupNow.textContent = busy ? updateStatusText() : t(L, "updateNow");
  updatePopupNow.setAttribute("aria-label", busy ? updateStatusText() : t(L, "updateNow"));
  updatePopupLater.textContent = t(L, "updateLater");
  updatePopupNext.textContent = t(L, "updateNextOpen");
  updatePopupClose.setAttribute("aria-label", t(L, "close"));
  updatePopupNow.disabled = busy;
  updatePopupLater.disabled = busy;
  updatePopupNext.disabled = busy;
  updatePopupClose.disabled = busy;
}

/** Reflect the update state everywhere it surfaces: popup + settings. */
function syncUpdateUi(): void {
  syncSettingsUpdateBtn();
  syncUpdatePopup();
}

/** Show the popup for the pending update (guarded: no panels, visible). */
function openUpdatePopup(): void {
  if (updatePopupOpen || updatePhase === "none" || !pendingUpdate) return;
  if (settingsOpen || actionsOpen) return;
  if (overlay.phase !== "visible") return;
  updatePopupOpen = true;
  updatePopupError.textContent = "";
  updatePopupError.classList.remove("visible");
  updatePopup.classList.add("open");
  updatePopup.setAttribute("aria-hidden", "false");
  syncUpdatePopup();
  updatePopupNow.focus();
}

/** Show the popup for an in-flight install, bypassing snooze/defer guards. */
function openUpdatePopupForProgress(): void {
  if (updatePopupOpen || updatePhase === "none" || !pendingUpdate) return;
  if (settingsOpen || actionsOpen) return;
  if (overlay.phase !== "visible") return;
  updatePopupOpen = true;
  updatePopup.classList.add("open");
  updatePopup.setAttribute("aria-hidden", "false");
  syncUpdatePopup();
}

/** Hide the popup without recording a choice (e.g. opening Settings). */
function closeUpdatePopup(): void {
  if (!updatePopupOpen) return;
  updatePopupOpen = false;
  updatePopup.classList.remove("open");
  updatePopup.setAttribute("aria-hidden", "true");
  if (overlay.phase === "visible" && !panelOpen()) input.focus();
}

/** "Later": hide and don't auto-show this version again this session. */
function dismissUpdatePopup(): void {
  if (pendingUpdate) updateDismissedVersion = pendingUpdate.version;
  closeUpdatePopup();
}

/** "On next open": auto-install this version on the next overlay open. */
function deferUpdateToNextOpen(): void {
  if (pendingUpdate) {
    setNextOpenVersion(pendingUpdate.version);
    updateDismissedVersion = null;
  }
  closeUpdatePopup();
}

function shouldAutoInstallOnOpen(): boolean {
  return (
    updatePhase === "available" &&
    !!pendingUpdate &&
    getNextOpenVersion() === pendingUpdate.version
  );
}

/** Auto-show the popup for a fresh update, respecting snooze + deferral. */
function maybeShowUpdatePopup(): void {
  if (updatePhase !== "available" || !pendingUpdate) return;
  if (updatePopupOpen) return;
  if (settingsOpen || actionsOpen) return;
  if (overlay.phase !== "visible") return;
  if (getNextOpenVersion() === pendingUpdate.version) return;
  if (updateDismissedVersion === pendingUpdate.version) return;
  openUpdatePopup();
}

/** Poll GitHub for a newer release; propagates failures to the caller. */
async function performCheck(): Promise<void> {
  pendingUpdate = await check();
  if (!pendingUpdate) {
    updatePhase = "none";
    // Nothing to install: a stale deferral (e.g. already installed) clears.
    setNextOpenVersion(null);
  } else {
    updatePhase = "available";
  }
  syncUpdateUi();
}

/** Poll GitHub for a newer release; non-fatal when offline. */
async function checkForUpdate(): Promise<void> {
  if (updatePhase === "downloading" || updatePhase === "installing") return;
  const now = Date.now();
  if (now - updateCheckedAt < UPDATE_MIN_CHECK_INTERVAL_MS) return;
  updateCheckedAt = now;
  try {
    await performCheck();
    if (shouldAutoInstallOnOpen()) {
      void installUpdate();
    } else {
      maybeShowUpdatePopup();
    }
  } catch {
    // Offline or no endpoint yet: keep whatever state we had.
    syncUpdateUi();
  }
}

/** Force a check from the settings panel, bypassing the interval guard. */
async function checkForUpdatesManual(): Promise<void> {
  if (settingsUpdateState === "checking") return;
  settingsUpdateState = "checking";
  settingsError.textContent = "";
  settingsError.classList.remove("visible");
  syncSettingsUpdateBtn();
  try {
    await performCheck();
    updateCheckedAt = Date.now();
    settingsUpdateState = pendingUpdate ? "idle" : "uptodate";
    // A manual find counts as fresh intent: a previous "Later" for this
    // version no longer suppresses the popup once Settings closes.
    if (pendingUpdate) updateDismissedVersion = null;
  } catch {
    settingsUpdateState = "idle";
    settingsError.textContent = t(currentLanguage, "updateCheckError");
    settingsError.classList.add("visible");
  }
  syncUpdateUi();
  maybeShowUpdatePopup();
}

/** Download + install the pending update, then relaunch into it. */
async function installUpdate(): Promise<void> {
  if (updatePhase !== "available" || !pendingUpdate) return;
  const update = pendingUpdate;
  // Installing now: the deferral and the snooze are fulfilled.
  setNextOpenVersion(null);
  updateDismissedVersion = null;
  updatePhase = "downloading";
  updatePercent = 0;
  updatePopupError.textContent = "";
  updatePopupError.classList.remove("visible");
  openUpdatePopupForProgress();
  syncUpdateUi();
  try {
    let downloaded = 0;
    let contentLength = 0;
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          contentLength = event.data.contentLength ?? 0;
          break;
        case "Progress":
          downloaded += event.data.chunkLength;
          if (contentLength > 0) {
            updatePercent = Math.min(99, Math.round((downloaded / contentLength) * 100));
            syncUpdateUi();
          }
          break;
        case "Finished":
          break;
      }
    });
    updatePhase = "installing";
    syncUpdateUi();
    await relaunch();
  } catch (err) {
    console.error("[quickspot] update failed:", err);
    updatePhase = "available";
    const msg = err instanceof Error ? err.message : String(err);
    updatePopupError.textContent = t(currentLanguage, "updateInstallError", { msg });
    updatePopupError.classList.add("visible");
    syncUpdateUi();
  }
}

updatePopupNow.addEventListener("click", () => {
  void installUpdate();
});

updatePopupLater.addEventListener("click", () => {
  if (updatePopupNow.disabled) return;
  dismissUpdatePopup();
});

updatePopupNext.addEventListener("click", () => {
  if (updatePopupNow.disabled) return;
  deferUpdateToNextOpen();
});

updatePopupClose.addEventListener("click", () => {
  if (updatePopupNow.disabled) return;
  dismissUpdatePopup();
});

// Clicking outside the card (transparent backdrop layer) snoozes like "Later".
updatePopup.addEventListener("click", (e) => {
  if (e.target === updatePopup && !updatePopupNow.disabled) dismissUpdatePopup();
});

// In settings the check is manual: a button that forces a lookup (or jumps
// straight to installing once an update is already known to be available).
settingsUpdateBtn.addEventListener("click", () => {
  if (settingsUpdateBtn.disabled) return;
  if (updatePhase === "available" && pendingUpdate) {
    void installUpdate();
    return;
  }
  void checkForUpdatesManual();
});

function syncUiScale(): void {
  // Scale against the OS window (680x740): the launcher canvas stays 520x580
  // centered inside it, so the whole overlay shrinks as one on small screens.
  uiScale = Math.max(0.5, Math.min(1, window.innerWidth / 680, window.innerHeight / 740));
  root.style.setProperty("--overlay-scale", String(uiScale));
}

syncUiScale();
window.addEventListener("resize", () => {
  syncUiScale();
  // A resize moves every anchor: repositioning could flicker, so dismiss like
  // a background scroll (same Material/Apple rule).
  if (typeof dismissFloatingPickers === "function") dismissFloatingPickers();
});

const chips: HTMLButtonElement[] = [];
const chipLabels: HTMLElement[] = [];
const chipIcons: HTMLElement[] = [];

const KIND_ICONS: Record<Action["kind"], string> = {
  url: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  command:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
  app: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>',
  sequence:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 17l9 5 9-5"/></svg>',
};

const KIND_LABEL_KEYS: Record<Action["kind"], DictKey> = {
  url: "kindUrl",
  command: "kindCommand",
  app: "kindApp",
  file: "kindFile",
  folder: "kindFolder",
  sequence: "kindSequence",
};

for (let i = 0; i < MAX_VISIBLE; i++) {
  const chip = document.createElement("button");
  chip.className = "chip";
  chip.type = "button";
  const icon = document.createElement("span");
  icon.className = "chip-icon";
  const label = document.createElement("span");
  label.className = "chip-label";
  chip.append(icon, label);
  chip.addEventListener("click", () => onChipClick(i));
  chipsHost.appendChild(chip);
  chips.push(chip);
  chipLabels.push(label);
  chipIcons.push(icon);
}

// ------------------------------------------------------------------ helpers

function showQuery(): void {
  // The input keeps the raw keystrokes (never rewritten, so the caret never
  // jumps); only the *effective* query decides the pill state. A
  // whitespace-only query normalizes to "" and shows the placeholder as if
  // empty — searching for spaces alone is not a thing.
  const effective = normalizeQuery(queryText);
  const hasQuery = effective.length > 0;
  mirror.textContent = hasQuery ? queryText : t(currentLanguage, "placeholder");
  mirror.classList.toggle("dim", !hasQuery);
  queryWrap.classList.toggle("active", hasQuery);
  if (input.value !== queryText) input.value = queryText;
  // The pill grows with the text up to its CSS cap; past it, left-align and
  // scroll to the end so the tail of the query stays visible (the head is
  // what clips), keeping the caret reachable instead of typing blind.
  const overflowing = queryWrap.scrollWidth > queryWrap.clientWidth + 1;
  queryWrap.classList.toggle("overflowing", overflowing);
  if (overflowing) queryWrap.scrollLeft = queryWrap.scrollWidth;
}

/** Briefly display an execution error near the query line, then fade it. */
function showRunError(msg: string): void {
  const el = runError;
  el.textContent = t(currentLanguage, "runError", { msg });
  el.classList.add("visible");
  window.clearTimeout(runErrorTimer);
  runErrorTimer = window.setTimeout(() => el.classList.remove("visible"), RUN_ERROR_MS);
}

/**
 * The empty-state message ("no matches" while typing, "no actions yet" on a
 * fresh config) and its visibility. Called on every filter change AND on the
 * animation frames, so the message shows, hides and re-localizes regardless
 * of whether the animation loop is still running.
 */
function syncEmptyState(): void {
  // Emptiness is judged on the normalized query: whitespace-only input
  // counts as "no query" (shows everything / "no actions yet"), never as
  // "no matches". `countMatches`/`filterActions` share the same
  // normalization, so the three can never disagree.
  const hasQuery = normalizeQuery(queryText).length > 0;
  const noResults = hasQuery && filtered.length === 0;
  const noActionsYet = !hasQuery && actions.length === 0;
  emptyState.textContent = noResults
    ? t(currentLanguage, "noMatches")
    : noActionsYet
      ? t(currentLanguage, "noActions")
      : "";
  emptyState.classList.toggle("visible", overlay.phase === "visible" && (noResults || noActionsYet));

  // "+N more": how many matches fall outside the visible ring. total counts
  // every match uncapped; filtered holds at most MAX_VISIBLE, so the delta
  // is the hidden remainder. Whisper-quiet and only while the overlay is up.
  const total = countMatches(actions, queryText);
  const hidden = total - filtered.length;
  const showMore = hidden > 0 && filtered.length > 0 && overlay.phase === "visible";
  moreCount.textContent = showMore ? t(currentLanguage, "moreResults", { count: String(hidden) }) : "";
  moreCount.classList.toggle("visible", showMore);
}

/** Recomputed the effective language and re-renders every UI string. */
function applyLanguage(): void {
  currentLanguage = resolveLanguage(langDraft ?? savedLanguage);
  localizeAll();
  applyTheme();
}

/** Fill the language select once: "System default" + one entry per locale,
 * labeled with the language's own name (from `_meta.label`). */
function populateLanguages(): void {
  langSelect.replaceChildren();
  const system = document.createElement("option");
  system.value = "system";
  langSelect.appendChild(system);
  for (const lang of LANGUAGES) {
    const option = document.createElement("option");
    option.value = lang.code;
    option.textContent = lang.label;
    langSelect.appendChild(option);
  }
}

/** Fill the theme select once: System + light/dark/deep. Labels are
 * localized on every `localizeAll` (option order is the contract). */
function populateThemeOptions(): void {
  themeSelect.replaceChildren();
  for (const value of ["system", "light", "dark", "deep"] as const) {
    const option = document.createElement("option");
    option.value = value;
    themeSelect.appendChild(option);
  }
}

/** Effective theme -> `data-theme` on <html> + matching theme-color meta. */
function applyTheme(): void {
  const effective = resolveTheme(themeDraft ?? savedTheme, systemPrefersDark());
  document.documentElement.dataset.theme = effective;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = themeColorFor(effective);
}

/** Localized labels for the appearance row. */
function localizeThemeOptions(): void {
  const L = currentLanguage;
  const labels: Record<string, string> = {
    system: t(L, "themeSystem"),
    light: t(L, "themeLight"),
    dark: t(L, "themeDark"),
    deep: t(L, "themeDeep"),
  };
  for (const option of Array.from(themeSelect.options)) {
    option.textContent = labels[option.value] ?? option.value;
  }
}

/** Credit line under the language select: the current language's translators. */
function localizeTranslators(): void {
  settingsTranslators.replaceChildren();
  const meta = LANGUAGES.find((lang) => lang.code === currentLanguage);
  if (!meta || meta.translators.length === 0) return;
  const label = t(currentLanguage, "translatedBy", {
    translators: meta.translators.map((name) => `@${name}`).join(", "),
  });
  settingsTranslators.textContent = label;
}

/** Version caption at the bottom of the settings content. Stays empty until
 * the runtime reports its version; a failed lookup never blocks startup. */
function syncVersionLine(): void {
  if (!appVersion) return;
  settingsVersion.textContent = t(currentLanguage, "versionLabel", { version: appVersion });
}

function localizeAll(): void {
  const L = currentLanguage;
  document.documentElement.lang = L;
  showQuery();
  syncEmptyState();
  input.setAttribute("aria-label", t(L, "searchAria"));
  chipsHost.setAttribute("aria-label", t(L, "actionsAria"));
  hub.setAttribute("aria-label", t(L, "settingsAria"));
  addBtn.setAttribute("aria-label", t(L, "addActions"));
  grip.setAttribute("aria-label", t(L, "dragAria"));
  minimize.setAttribute("aria-label", t(L, "minimize"));
  syncUpdateUi();
  settingsTitle.textContent = t(L, "settingsTitle");
  settingsPanel.setAttribute("aria-label", t(L, "settingsTitle"));
  settingsClose.setAttribute("aria-label", t(L, "close"));
  settingsLanguageLabel.textContent = t(L, "languageLabel");
  settingsThemeLabel.textContent = t(L, "themeLabel");
  themeSelect.setAttribute("aria-label", t(L, "themeLabel"));
  localizeThemeOptions();
  settingsDockLabel.textContent = t(L, "magnifyLabel");
  settingsMagnify.setAttribute("aria-label", t(L, "magnifyLabel"));
  settingsIconsLabel.textContent = t(L, "iconsLabel");
  settingsIcons.setAttribute("aria-label", t(L, "iconsLabel"));
  settingsAutostartLabel.textContent = t(L, "autostartLabel");
  settingsAutostart.setAttribute("aria-label", t(L, "autostartLabel"));
  settingsUpdateLabel.textContent = t(L, "checkForUpdates");
  syncVersionLine();
  langSelect.setAttribute("aria-label", t(L, "languageLabel"));
  langSelect.options[0].textContent = t(L, "languageSystem");
  localizeTranslators();
  actionsTitle.textContent = t(L, "actionsTitle");
  actionsPanel.setAttribute("aria-label", t(L, "actionsTitle"));
  actionsPanel.setAttribute("aria-describedby", "actions-description");
  actionsDescription.textContent = t(L, "actionsDescription");
  actionsTabs.setAttribute("aria-label", t(L, "tabsAria"));
  actionsTab.textContent = t(L, "actionsTab");
  groupsTab.textContent = t(L, "groupsTab");
  actionsClose.setAttribute("aria-label", t(L, "close"));
  if (actionsAdd) actionsAdd.textContent = t(L, "addAction");
  settingsSave.textContent = t(L, "save");
  settingsError.textContent = "";
  settingsError.classList.remove("visible");
  actionsSave.textContent = t(L, "save");
  actionsError.textContent = "";
  actionsRows.setAttribute("aria-label", t(L, "actionsAria"));
  const appearanceHeading = document.querySelector<HTMLElement>("#settings-appearance-heading");
  if (appearanceHeading) appearanceHeading.textContent = t(L, "appearanceSection");
  const generalHeading = document.querySelector<HTMLElement>("#settings-general-heading");
  if (generalHeading) generalHeading.textContent = t(L, "generalLabel");
  const updatesHeading = document.querySelector<HTMLElement>("#settings-updates-heading");
  if (updatesHeading) updatesHeading.textContent = t(L, "updatesSection");
  for (const row of actionsRows.querySelectorAll<HTMLElement>(".settings-row")) {
    localizeSettingsRow(row);
  }
  localizeGroupsEditor();
  localizeActionsSection();
}

function refilter(): void {
  filtered = filterActions(actions, queryText);
  selected = filtered.length > 0 ? 0 : -1;
  syncChips();
}

/** Reflect the icon preference on the launcher: `no-icons` hides the chip
 * icons via CSS and frees the pill for the label. */
function syncIcons(): void {
  root.classList.toggle("no-icons", !iconsEnabled);
}

/** The group of an action by config id, or undefined when unset/unknown. */
function actionGroup(action: Action): Group | undefined {
  if (!action.group) return undefined;
  return groups.find((g) => g.id === action.group);
}

function syncChips(): void {
  syncEmptyState();
  for (let i = 0; i < MAX_VISIBLE; i++) {
    const el = chips[i];
    const idx = filtered[i];
    if (idx === undefined) {
      el.style.opacity = "0";
      el.classList.remove("selected");
      el.setAttribute("aria-pressed", "false");
      el.tabIndex = -1;
      continue;
    }
    const action = actions[idx];
    chipLabels[i].textContent = action.name;
    chipIcons[i].innerHTML = KIND_ICONS[action.kind];
    const group = actionGroup(action);
    if (group) {
      el.dataset.group = group.id;
      el.style.setProperty("--group-color", group.color);
    } else {
      delete el.dataset.group;
      el.style.removeProperty("--group-color");
    }
    el.style.opacity = "1";
    el.classList.toggle("selected", i === selected);
    el.setAttribute("aria-label", action.name);
    el.setAttribute("aria-pressed", String(i === selected));
    el.tabIndex = panelOpen() ? -1 : 0;
  }
  applyChipTransforms();
}

/** Transforms for the settled-open state (hover + selection magnification).
 * The dock effect always runs unless the user disables it in settings;
 * `prefers-reduced-motion` is deliberately ignored here. Opacity stays under
 * `render()`'s control (CSS default is 0). */
function applyChipTransforms(): void {
  const count = filtered.length;
  for (let i = 0; i < MAX_VISIBLE; i++) {
    const el = chips[i];
    if (i >= count) continue;
    const [cx, cy] = chipCenter(i, count);
    const hoverScale = magnifyEnabled
      ? dockScale(cx, cy, mouseX, mouseY, i === selected)
      : 1;
    // The dock scale is capped so the chip never pokes out of the disc
    // circle (the 3/9 o'clock chips of a full ring are the ones that clamp).
    const scale = Math.min(hoverScale, MAX_FINAL_SCALE, chipMaxScale(cx, cy, MAX_FINAL_SCALE));
    el.style.transform = `translate(${cx - CHIP_W / 2}px, ${cy - CHIP_H / 2}px) scale(${scale})`;
  }
}

// -------------------------------------------------------------------- render

function render(): void {
  const dp = overlay.displayProgress;
  const closing = overlay.phase === "closing";

  root.classList.toggle("settled", overlay.phase === "visible");

  disc.style.opacity = String(easeOutQuart(dp));

  const hubScale = easeOutCubic(dp);
  hub.style.transform = `translate(${HUB_X}px, ${HUB_Y}px) translateX(-50%) scale(${hubScale})`;
  hub.style.opacity = String(easeOutQuart(dp));

  const addScale = easeOutCubic(dp);
  addBtn.style.transform = `translate(${ADD_X}px, ${HUB_Y}px) translateX(-50%) scale(${addScale})`;
  addBtn.style.opacity = String(easeOutQuart(dp));

  const slide = (1 - easeOutCubic(dp)) * 16;
  minimize.style.transform = `translate(${CENTER_X}px, ${MINIMIZE_Y + slide}px) translateX(-50%)`;
  minimize.style.opacity = String(easeOutCubic(dp) * 0.75);

  grip.style.opacity = String(easeOutQuart(dp));

  const count = filtered.length;
  for (let i = 0; i < MAX_VISIBLE; i++) {
    const el = chips[i];
    const idx = filtered[i];
    if (idx === undefined) {
      el.style.opacity = "0";
      continue;
    }
    const chipT = closing
      ? staggeredProgress(overlay.animProgress, count - 1 - i, count, STAGGER_FRAC)
      : staggeredProgress(overlay.animProgress, i, count, STAGGER_FRAC);
    const animScale = closing ? 1 - easeOutCubic(chipT) : easeOutCubic(chipT);
    const opacity = closing ? 1 - easeOutCubic(chipT) : easeOutQuart(chipT);
    const [cx, cy] = chipCenter(i, count);
    const scale = Math.min(animScale, MAX_FINAL_SCALE);
    el.style.transform = `translate(${cx - CHIP_W / 2}px, ${cy - CHIP_H / 2}px) scale(${scale})`;
    el.style.opacity = String(opacity);
  }

  syncEmptyState();

  const enabled = dp >= 0.05;
  const pe = enabled ? "auto" : "none";
  hub.style.pointerEvents = pe;
  addBtn.style.pointerEvents = pe;
  minimize.style.pointerEvents = pe;
  for (let i = 0; i < MAX_VISIBLE; i++) chips[i].style.pointerEvents = pe;
}

// ------------------------------------------------------------ animation loop

let rafId = 0;

function ensureLoop(): void {
  if (rafId === 0) rafId = requestAnimationFrame(frame);
}

function frame(_now: number): void {
  rafId = 0;
  const done = overlay.tick();
  render();
  if (done) {
    if (overlay.phase === "visible") {
      root.classList.add("open");
      applyChipTransforms();
      // The update check usually resolves mid-animation (while the overlay
      // is still "opening" and the popup refuses to show), so offer it now
      // that the overlay has settled — progress first, fresh prompt after.
      if (updatePhase === "downloading" || updatePhase === "installing") {
        if (pendingUpdate) openUpdatePopupForProgress();
      } else {
        maybeShowUpdatePopup();
      }
      if (!updatePopupOpen) input.focus();
    } else {
      root.classList.remove("open");
      void invoke("on_overlay_closed");
      input.blur();
    }
    return;
  }
  rafId = requestAnimationFrame(frame);
}

// ---------------------------------------------------------- event listeners

function runAction(index: number): void {
  invoke("execute", { index }).catch((err) => {
    const msg = typeof err === "string" ? err : String(err);
    showRunError(msg);
  });
}

function onChipClick(i: number): void {
  if (filtered[i] === undefined) return;
  selectionSource = "mouse";
  selected = i;
  syncChips();
  runAction(filtered[i]);
}

function moveSelectionBy(delta: number): void {
  if (filtered.length === 0) return;
  selected = moveSelection(selected, filtered.length, delta);
  syncChips();
}

input.addEventListener("input", () => {
  const capped = capUtf8Bytes(input.value);
  if (capped !== input.value) input.value = capped;
  // Keep the raw text (no trim here: rewriting the value mid-typing moves
  // the caret). `filterActions`/`syncEmptyState`/`showQuery` normalize for
  // matching, so leading/trailing/duplicate spaces and accents just work.
  queryText = input.value;
  showQuery();
  refilter();
});

input.addEventListener("keydown", (e) => {
  const key = e.key;
  if (key === "Escape") {
    e.preventDefault();
    if (updatePopupOpen) {
      dismissUpdatePopup();
      return;
    }
    if (settingsOpen || actionsOpen) {
      closePanels();
      return;
    }
    void invoke("close_overlay");
    return;
  }
  if (key === "Enter") {
    e.preventDefault();
    const idx = filtered[selected];
    if (idx !== undefined) runAction(idx);
    return;
  }
  if (key === "Tab" || key === "ArrowDown") {
    e.preventDefault();
    selectionSource = "keyboard";
    moveSelectionBy(e.shiftKey ? -1 : 1);
    return;
  }
  if (key === "ArrowUp") {
    e.preventDefault();
    selectionSource = "keyboard";
    moveSelectionBy(-1);
    return;
  }
  if (key === "ArrowLeft" || key === "ArrowRight" || key === "Home" || key === "End") {
    e.preventDefault();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && key.toLowerCase() === "r") {
    e.preventDefault();
    void invoke("reload_config");
    return;
  }
  if ((e.metaKey || e.ctrlKey) && key.toLowerCase() === "q") {
    e.preventDefault();
    void invoke("quit");
  }
});

hub.addEventListener("click", () => {
  if (settingsOpen) closeSettings();
  else openSettings();
});

addBtn.addEventListener("click", () => {
  if (actionsOpen) closeActions();
  else openActions();
});

actionsClose.addEventListener("click", closeActions);

function setActionsTab(tab: "actions" | "groups", moveFocus: boolean): void {
  activeActionsTab = tab;
  const isActions = tab === "actions";
  actionsTab.setAttribute("aria-selected", String(isActions));
  actionsTab.tabIndex = isActions ? 0 : -1;
  groupsTab.setAttribute("aria-selected", String(!isActions));
  groupsTab.tabIndex = isActions ? -1 : 0;
  const actionPanel = document.querySelector<HTMLElement>("#actions-panel");
  const groupPanel = document.querySelector<HTMLElement>("#groups-panel");
  if (actionPanel) {
    actionPanel.hidden = !isActions;
    actionPanel.setAttribute("aria-hidden", String(!isActions));
  }
  if (groupPanel) {
    groupPanel.hidden = isActions;
    groupPanel.setAttribute("aria-hidden", String(isActions));
  }
  if (moveFocus) (isActions ? actionsTab : groupsTab).focus();
}

function moveActionsTab(delta: -1 | 1): void {
  const next = delta === 1
    ? activeActionsTab === "actions" ? "groups" : "actions"
    : activeActionsTab === "groups" ? "actions" : "groups";
  setActionsTab(next, true);
}

for (const tab of [actionsTab, groupsTab]) {
  tab.addEventListener("click", () => {
    setActionsTab(tab === actionsTab ? "actions" : "groups", false);
  });
  tab.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      moveActionsTab(e.key === "ArrowRight" ? 1 : -1);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActionsTab(e.key === "Home" ? "actions" : "groups", true);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setActionsTab(tab === actionsTab ? "actions" : "groups", false);
    }
  });
}

// Clicking outside a picker dismisses it. The actions panel owns all the
// app/group/group-select/kind pickers, so only it needs the listener.
actionsRows.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (target.closest(".app-picker") || target.closest(".s-app-browse")) return;
  if (target.closest(".g-picker") || target.closest(".g-swatch")) return;
  if (target.closest(".s-group-picker") || target.closest(".s-group-trigger")) return;
  if (target.closest(".s-kind-picker")) return;
  closeAppPickers();
  closeGroupPickers();
  closeGroupSelects();
  closeKindPickers();
});

// Scrolling the editor dismisses floating pickers (Apple HIG popovers dismiss
// on outside interaction; Material M3 menus close on background scroll). The
// in-flow app picker is excluded: it expands the card instead of overlaying,
// so scrolling with it open is natural. Internal scrolled (the picker's own
// option list) must not dismiss: those scrolls target the picker itself and
// never reach this scrollport as a `scroll` on actionsRows (scroll doesn't
// bubble), while wheel/touch gestures over the open menu are let through by
// checking `closest` below.
actionsRows.addEventListener(
  "wheel",
  (e) => {
    if ((e.target as HTMLElement).closest?.(".s-kind-listbox, .s-group-picker, .g-picker")) return;
    dismissFloatingPickers();
  },
  { passive: true },
);
actionsRows.addEventListener(
  "touchmove",
  (e) => {
    if ((e.target as HTMLElement).closest?.(".s-kind-listbox, .s-group-picker, .g-picker")) return;
    dismissFloatingPickers();
  },
  { passive: true },
);
actionsRows.addEventListener(
  "scroll",
  () => {
    // The open itself scrolls programmatically (scrollIntoView + room-making
    // inside `positionActionsPopover`); that races within ms of
    // `lastPopoverOpenAt` and must not instantly dismiss.
    if (Date.now() - lastPopoverOpenAt < 150) return;
    dismissFloatingPickers();
  },
  { passive: true },
);

settingsPanel.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!settingsSave.disabled) void saveSettings();
});

settingsSave.addEventListener("click", () => {
  if (settingsSave.disabled) return;
  void saveSettings();
});

settingsClose.addEventListener("click", () => {
  if (settingsOpen) closeSettings();
});

actionsPanel.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!actionsSave.disabled) void saveActions();
});

actionsSave.addEventListener("click", () => {
  if (actionsSave.disabled) return;
  void saveActions();
});

langSelect.addEventListener("change", () => {
  langDraft = langSelect.value as StoredLanguage;
  applyLanguage();
});

themeSelect.addEventListener("change", () => {
  themeDraft = normalizeTheme(themeSelect.value);
  applyTheme();
});

// Sistema: si el SO cambia claro<->oscuro y el usuario sigue "Sistema",
// el efectivo (claro<->oscuro) cambia en vivo, como Auto en Apple HIG.
// `deep` nunca entra por sistema: es opt-in explícito.
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemTheme = (): void => {
    if ((themeDraft ?? savedTheme) === "system") applyTheme();
  };
  if (typeof darkQuery.addEventListener === "function") {
    darkQuery.addEventListener("change", onSystemTheme);
  } else {
    darkQuery.addListener?.(onSystemTheme);
  }
}

// Aplica el tema lo antes posible para evitar flash del tema contrario.
applyTheme();

document.addEventListener("keydown", (e) => {
  if (!settingsOpen && !actionsOpen && !updatePopupOpen) return;
  if (e.key === "Escape") {
    e.preventDefault();
    if (updatePopupOpen) dismissUpdatePopup();
    else closePanels();
  }
});

// Focus trap: Tab cycles inside the panel instead of escaping to the
// (invisible) overlay controls or the webview chrome.
for (const panel of [settingsPanel, actionsPanel, updatePopup]) {
  panel.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || !panel.classList.contains("open")) return;
    const focusables = [...panel.querySelectorAll<HTMLElement>(
      'button, select, input, textarea, [tabindex]:not([tabindex="-1"])',
    )].filter((el) => {
      if (el.hidden || el.closest("[hidden]")) return false;
      if (el.getAttribute("tabindex") === "-1") return false;
      if (el instanceof HTMLButtonElement && el.disabled) return false;
      return true;
    });
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || !active || !panel.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

minimize.addEventListener("click", () => {
  void invoke("hide_to_tray");
});

function onGripDown(e: PointerEvent): void {
  if (e.button !== 0) return;
  e.preventDefault();
  grip.classList.add("dragging");
  void invoke("drag_start");
}

function endGripDrag(): void {
  grip.classList.remove("dragging");
  void invoke("drag_end");
}

grip.addEventListener("pointerdown", onGripDown);
window.addEventListener("pointerup", endGripDrag);
window.addEventListener("blur", endGripDrag);

// Doble clic sobre el grip: recentra el círculo en el monitor actual.
// Termina cualquier arrastre en curso antes de centrar para que el
// watchdog de clamp no pelee con el reposicionamiento.
grip.addEventListener("dblclick", (e) => {
  e.preventDefault();
  e.stopPropagation();
  grip.classList.remove("dragging");
  grip.classList.remove("hover");
  void invoke("drag_end");
  void invoke("center_window").catch(() => {});
});

// Panel move: the grip is hidden while a panel is open, so the panel
// headers double as title bars — a drag starting on header chrome (never on
// its buttons) moves the whole OS window via the same native `drag_start`
// path as the grip, clamp watchdog included. The global pointerup/blur
// listeners above already end the drag.
const settingsHeader = document.querySelector<HTMLElement>("#settings-header")!;
const actionsHeader = document.querySelector<HTMLElement>("#actions-header")!;
function onPanelHeaderDown(e: PointerEvent): void {
  if (e.button !== 0 || e.isPrimary === false) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest?.("button, select, input, textarea, a, [role='tab'], [contenteditable]")) {
    return;
  }
  e.preventDefault();
  void invoke("drag_start");
}
settingsHeader.addEventListener("pointerdown", onPanelHeaderDown);
actionsHeader.addEventListener("pointerdown", onPanelHeaderDown);

// Native panel resize: pressing a panel edge/corner resizes the OS window
// (the panels are fluid and viewport-relative, so they track it). Where the
// backend owns the gesture (Windows/Linux `drag_resize_window`), the OS
// performs the drag with native snapping. macOS's backend (tao) has no
// `drag_resize_window` — its handler discards the result, so the IPC
// *resolves* while doing nothing — and there the frontend drives
// `setSize`/`setPosition` itself, the standard frameless-window technique
// on that platform.
type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";
const RESIZE_DIRECTIONS: ReadonlySet<string> = new Set<string>([
  "East",
  "North",
  "NorthEast",
  "NorthWest",
  "South",
  "SouthEast",
  "SouthWest",
  "West",
]);

/** OS window bounds, mirrored from `overlay.rs::build_window`. JS clamps
 * with the same values so West/North anchor math stays exact (the OS would
 * clamp the size anyway, which would otherwise drift the anchored edge). */
const RESIZE_MIN_W = 480;
const RESIZE_MIN_H = 600;
const RESIZE_MAX_W = 1100;
const RESIZE_MAX_H = 900;

function clampResize(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Manual resize drag for platforms without native `startResizeDragging`.
 * Tracks the pointer and resizes (East/South edges) or resizes + moves
 * (West/North edges, keeping the opposite edge anchored) every frame. */
function beginManualResize(
  handle: HTMLElement,
  anchor: PointerEvent,
  direction: ResizeDirection,
): void {
  const win = getCurrentWindow();
  const resizeWest = direction.includes("West");
  const resizeNorth = direction.includes("North");
  const resizeEast = direction.includes("East");
  const resizeSouth = direction.includes("South");
  void (async () => {
    let scale: number;
    let startOuterX: number;
    let startOuterY: number;
    try {
      scale = await win.scaleFactor();
      const outer = await win.outerPosition();
      // Physical px -> logical px (the unit `setSize`/`setPosition` take
      // via `LogicalSize`/`LogicalPosition`, matching CSS px 1:1).
      startOuterX = outer.x / scale;
      startOuterY = outer.y / scale;
    } catch {
      return;
    }
    const anchorX = anchor.clientX;
    const anchorY = anchor.clientY;
    const startW = window.innerWidth;
    const startH = window.innerHeight;
    let rafId = 0;
    let latest: PointerEvent | null = null;
    const apply = (): void => {
      rafId = 0;
      if (!latest) return;
      const dx = latest.clientX - anchorX;
      const dy = latest.clientY - anchorY;
      let w = startW;
      let h = startH;
      if (resizeEast) w = clampResize(startW + dx, RESIZE_MIN_W, RESIZE_MAX_W);
      else if (resizeWest) w = clampResize(startW - dx, RESIZE_MIN_W, RESIZE_MAX_W);
      if (resizeSouth) h = clampResize(startH + dy, RESIZE_MIN_H, RESIZE_MAX_H);
      else if (resizeNorth) h = clampResize(startH - dy, RESIZE_MIN_H, RESIZE_MAX_H);
      void win.setSize(new LogicalSize(w, h)).catch(() => {});
      if (resizeWest || resizeNorth) {
        const x = resizeWest ? startOuterX + (startW - w) : startOuterX;
        const y = resizeNorth ? startOuterY + (startH - h) : startOuterY;
        void win.setPosition(new LogicalPosition(x, y)).catch(() => {});
      }
      latest = null;
    };
    const onMove = (e: PointerEvent): void => {
      latest = e;
      if (rafId === 0) rafId = requestAnimationFrame(apply);
    };
    const end = (): void => {
      if (rafId !== 0) cancelAnimationFrame(rafId);
      rafId = 0;
      latest = null;
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    window.addEventListener("blur", end, { once: true });
    // Keep the gesture on the handle even if the cursor outruns it; older
    // webviews without pointer capture still deliver moves while held.
    try {
      handle.setPointerCapture?.(anchor.pointerId);
    } catch {
      // Synthetic pointers (tests) or capture-less webviews: harmless.
    }
  })();
}

/** Whether the backend performs programmatic resize drags itself. tao
 * implements `drag_resize_window` on Windows/Linux but is a silent no-op
 * on macOS (the IPC resolves, the window never moves), so macOS goes
 * straight to the manual drag instead of offering a dead gesture first. */
function nativeResizeDragSupported(): boolean {
  try {
    const userAgentData = (
      navigator as Navigator & { userAgentData?: { platform?: string } }
    ).userAgentData;
    const platform = userAgentData?.platform ?? navigator.platform ?? "";
    return !/mac/i.test(platform);
  } catch {
    return true;
  }
}

for (const handle of document.querySelectorAll<HTMLElement>(".resize-handle")) {
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.isPrimary === false) return;
    const raw = handle.dataset.direction ?? "";
    if (!RESIZE_DIRECTIONS.has(raw as ResizeDirection)) return;
    e.preventDefault();
    e.stopPropagation();
    const direction = raw as ResizeDirection;
    if (!nativeResizeDragSupported()) {
      beginManualResize(handle, e, direction);
      return;
    }
    const appWindow = getCurrentWindow();
    void appWindow.startResizeDragging(direction).catch(() => {
      beginManualResize(handle, e, direction);
    });
  });
}

/** The chip the cursor is over (logical coords), or -1 when in between. */
function chipAtPointer(): number {
  for (let i = 0; i < filtered.length; i++) {
    const [cx, cy] = chipCenter(i, filtered.length);
    if (Math.abs(mouseX - cx) <= CHIP_W / 2 && Math.abs(mouseY - cy) <= CHIP_H / 2) {
      return i;
    }
  }
  return -1;
}

/**
 * Map a PointerEvent's viewport coordinates (`clientX`/`clientY`) to the
 * launcher canvas' logical coordinates (0..CANVAS_W, 0..CANVAS_H) where
 * `chipCenter()` lives.
 *
 * `clientX/Y` are viewport-relative (MDN: MouseEvent.clientX) while the
 * 520x580 `#overlay` canvas is centered inside the larger 680x740 OS window
 * and additionally scaled via `transform: scale(var(--overlay-scale))`.
 * `getBoundingClientRect()` returns the element's border box in the same
 * viewport space *including* transforms (MDN:
 * Element.getBoundingClientRect), so subtracting its origin and un-scaling
 * by `CANVAS / rect` yields the logical point under the cursor regardless
 * of centering offset or `uiScale`.
 */
function toCanvasCoords(clientX: number, clientY: number): [number, number] {
  const rect = root.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return [-10000, -10000];
  const x = (clientX - rect.left) * (CANVAS_W / rect.width);
  const y = (clientY - rect.top) * (CANVAS_H / rect.height);
  return [x, y];
}

root.addEventListener("pointermove", (e) => {
  const [lx, ly] = toCanvasCoords(e.clientX, e.clientY);
  mouseX = lx;
  mouseY = ly;
  // Hover selects (Spotlight-style): the highlight follows the cursor so the
  // first chip stops being permanently highlighted once the user points
  // anywhere else. Keyboard navigation keeps working via `selected`.
  const hovered = overlay.phase === "visible" && !panelOpen() ? chipAtPointer() : -1;
  if (hovered >= 0) {
    selectionSource = "mouse";
    if (hovered !== selected) {
      selected = hovered;
      syncChips();
    } else {
      applyChipTransforms();
    }
  } else if (overlay.phase === "visible" && !panelOpen()) {
    // The cursor is on no chip (gap or center): release a mouse-driven
    // highlight so the last hovered chip does not stay lit. A keyboard
    // selection survives until the cursor takes over.
    if (selectionSource !== "keyboard" && selected >= 0) {
      selectionSource = "none";
      selected = -1;
      syncChips();
    } else {
      applyChipTransforms();
    }
  }
  const onGrip =
    Math.abs(lx - CENTER_X) <= GRIP_W / 2 && ly >= GRIP_Y && ly <= GRIP_Y + GRIP_H;
  grip.classList.toggle("hover", onGrip);
});

// Leave the window -> drop the magnification back to rest and release a
// mouse-driven highlight, so no chip stays "hovered" with the cursor gone.
root.addEventListener("pointerleave", () => {
  mouseX = -10000;
  mouseY = -10000;
  if (overlay.phase === "visible") {
    if (selectionSource !== "keyboard" && selected >= 0) {
      selectionSource = "none";
      selected = -1;
      syncChips();
    } else {
      applyChipTransforms();
    }
  }
});

root.addEventListener("click", () => {
  if (!panelOpen()) input.focus();
});

// ---------------------------------------------------------------- panels

let settingsOpen = false;
let actionsOpen = false;

/** Whether any dialog (settings, actions or the update popup) is open. */
function panelOpen(): boolean {
  return settingsOpen || actionsOpen || updatePopupOpen;
}

/** Close whichever panel is open (never both: they are mutually exclusive). */
function closePanels(): void {
  if (settingsOpen) closeSettings();
  else if (actionsOpen) closeActions();
}

function openSettings(): void {
  if (settingsOpen || overlay.phase !== "visible") return;
  if (updatePopupOpen) closeUpdatePopup();
  if (actionsOpen) closeActions();
  settingsOpen = true;
  settingsError.textContent = "";
  settingsError.classList.remove("visible");
  settingsSave.disabled = false;
  langSelect.value = langDraft ?? savedLanguage;
  themeSelect.value = themeDraft ?? savedTheme;
  settingsMagnify.checked = magnifyEnabled;
  settingsIcons.checked = iconsEnabled;
  settingsAutostart.checked = autostartAtOpen;
  syncSettingsUpdateBtn();
  void isEnabled()
    .then((on) => {
      if (settingsOpen) {
        autostartAtOpen = on;
        settingsAutostart.checked = on;
      }
    })
    .catch(() => {});
  focusPanel(settingsPanel);
  settingsPanel.querySelector<HTMLElement>("#settings-theme")?.focus();
}

function openActions(): void {
  if (actionsOpen || overlay.phase !== "visible") return;
  if (updatePopupOpen) closeUpdatePopup();
  if (settingsOpen) closeSettings();
  actionsOpen = true;
  actionsError.textContent = "";
  actionsStatus.textContent = "";
  actionsSave.disabled = false;
  activeActionsTab = "actions";
  rebuildActionsRows();
  focusPanel(actionsPanel);
  // Open the first card pinned with the caret in its name field, so the
  // panel is immediately typeable.
  const firstRow = actionsRows.querySelector<HTMLElement>(".settings-row");
  if (firstRow) {
    firstRow.classList.add("pin");
    firstRow.querySelector<HTMLInputElement>(".s-name")?.focus();
  }
}

/** Hides the launcher controls and makes the panel the only tabbable area. */
function focusPanel(panel: HTMLElement): void {
  for (const chip of chips) chip.tabIndex = -1;
  hub.tabIndex = -1;
  addBtn.tabIndex = -1;
  minimize.tabIndex = -1;
  input.tabIndex = -1;
  root.classList.add("panel");
  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
  input.blur();
}

/** Restores the launcher controls after a panel closes. */
function releasePanel(): void {
  root.classList.remove("panel");
  hub.tabIndex = 0;
  addBtn.tabIndex = 0;
  minimize.tabIndex = 0;
  input.tabIndex = 0;
  syncSettingsUpdateBtn();
}

function closeSettings(): void {
  if (!settingsOpen) return;
  settingsOpen = false;
  langDraft = null;
  themeDraft = null;
  applyLanguage();
  settingsPanel.classList.remove("open");
  settingsPanel.setAttribute("aria-hidden", "true");
  releasePanel();
  refilter();
  if (overlay.phase === "visible") input.focus();
  maybeShowUpdatePopup();
}

function closeActions(): void {
  if (!actionsOpen) return;
  actionsOpen = false;
  actionsStatus.textContent = "";
  closeAppPickers();
  closeGroupPickers();
  closeGroupSelects();
  actionsPanel.classList.remove("open");
  actionsPanel.setAttribute("aria-hidden", "true");
  releasePanel();
  refilter();
  if (overlay.phase === "visible") input.focus();
  maybeShowUpdatePopup();
}

function rebuildActionsRows(): void {
  actionsRows.textContent = "";

  const actionsSection = document.createElement("section");
  actionsSection.className = "settings-actions";
  actionsSection.id = "actions-panel";
  actionsSection.setAttribute("role", "tabpanel");
  actionsSection.setAttribute("aria-labelledby", "actions-tab");

  const groupsSection = rebuildGroupsEditor();
  groupsSection.id = "groups-panel";
  groupsSection.setAttribute("role", "tabpanel");
  groupsSection.setAttribute("aria-labelledby", "groups-tab");
  actionsRows.append(actionsSection, groupsSection);

  const block = actionsSection;
  block.setAttribute("aria-labelledby", "settings-actions-heading");

  const header = document.createElement("div");
  header.className = "settings-actions-header";
  const title = document.createElement("h2");
  title.className = "settings-actions-title";
  title.id = "settings-actions-heading";
  const count = document.createElement("span");
  count.className = "settings-actions-count";
  const group = document.createElement("button");
  group.type = "button";
  group.id = "actions-group";
  group.textContent = t(currentLanguage, "groupActions");
  header.append(title, count, group);

  const list = document.createElement("div");
  list.className = "settings-actions-list";
  list.setAttribute("role", "list");

  const add = document.createElement("button");
  add.type = "button";
  add.id = "actions-add";
  const addIcon = document.createElement("span");
  addIcon.className = "a-add-icon";
  addIcon.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>';
  const addLabel = document.createElement("span");
  addLabel.className = "a-add-label";
  addLabel.textContent = t(currentLanguage, "addAction");
  add.append(addIcon, addLabel);

  // Toolbar (sticky): header + "Add action" on top so creating is always
  // visible without scrolling (NN/g visibility, Fitts: less travel).
  // The list scrolls underneath.
  const toolbar = document.createElement("div");
  toolbar.className = "settings-actions-toolbar";
  toolbar.append(header, add);
  block.append(toolbar, list);
  actionsAdd = add;

  group.addEventListener("click", () => {
    groupActionRows();
    group.focus();
  });

  add.addEventListener("click", () => {
    // New cards are born at the top, right under the creation toolbar that
    // spawned them — no scroll-down to find what you just created.
    const row = buildSettingsRow({ name: "", kind: "url", value: "" });
    list.prepend(row);
    afterActionsChanged();
    actionsRows.scrollTop = 0;
    row.querySelector<HTMLInputElement>(".s-name")?.focus();
  });

  for (const a of actions) list.appendChild(buildSettingsRow(a));
  afterActionsChanged();
  syncHasGroups();
  setActionsTab("actions", false);
  localizeActionsSection();
}

/** The group picker rides the value line only once groups exist. */
function syncHasGroups(): void {
  const panel = actionsRows.querySelector<HTMLElement>("#actions-panel");
  panel?.classList.toggle("has-groups", groupRows().length > 0);
}

/** Keep the actions list header count and add button in sync. */
function afterActionsChanged(): void {
  syncActionsCount();
  syncActionRowMetadata();
}

function syncActionsCount(): void {
  const list = actionsRows.querySelector<HTMLElement>(".settings-actions-list");
  const countEl = actionsRows.querySelector<HTMLElement>(".settings-actions-count");
  if (!list || !countEl) return;
  const count = list.querySelectorAll(".settings-row").length;
  countEl.textContent = String(count);
  countEl.setAttribute(
    "aria-label",
    t(currentLanguage, "actionsCount", { count: String(count) }),
  );
}

function localizeActionsSection(): void {
  const L = currentLanguage;
  const title = actionsRows.querySelector<HTMLElement>(".settings-actions-title");
  if (title) title.textContent = t(L, "actionsLabel");
  const group = actionsRows.querySelector<HTMLElement>("#actions-group");
  if (group) group.textContent = t(L, "groupActions");
  const addLabel = actionsRows.querySelector<HTMLElement>(".a-add-label");
  if (addLabel) addLabel.textContent = t(L, "addAction");
  syncActionsCount();
  syncActionRowMetadata();
}

function settingsActionRows(): HTMLElement[] {
  return [...actionsRows.querySelectorAll<HTMLElement>(".settings-row")];
}

function syncActionRowMetadata(): void {
  const rows = settingsActionRows();
  const count = rows.length;
  for (const [index, row] of rows.entries()) {
    row.setAttribute("role", "listitem");
    row.setAttribute("aria-posinset", String(index + 1));
    row.setAttribute("aria-setsize", String(count));
    const up = row.querySelector<HTMLButtonElement>(".s-move-up");
    const down = row.querySelector<HTMLButtonElement>(".s-move-down");
    if (up) up.disabled = index === 0;
    if (down) down.disabled = index === count - 1;
  }
}

function announceActionPosition(row: HTMLElement): void {
  const rows = settingsActionRows();
  const position = rows.indexOf(row) + 1;
  const name =
    row.querySelector<HTMLInputElement>(".s-name")?.value.trim() ||
    t(currentLanguage, "namePlaceholder");
  actionsStatus.textContent = t(currentLanguage, "actionMoved", {
    name,
    position: String(position),
    count: String(rows.length),
  });
}

/** Move one draft row in the DOM, which is also the order used by saveActions. */
function moveActionRow(row: HTMLElement, delta: -1 | 1): boolean {
  const list = row.parentElement;
  if (!list) return false;
  const rows = settingsActionRows();
  const index = rows.indexOf(row);
  const nextIndex = index + delta;
  if (index < 0 || nextIndex < 0 || nextIndex >= rows.length) return false;
  const target = rows[nextIndex];
  if (delta < 0) list.insertBefore(row, target);
  else list.insertBefore(row, target.nextElementSibling);
  syncActionRowMetadata();
  return true;
}

/** Reorder the draft rows so every action sharing a group is contiguous,
 * mirroring `groupActions`. The rows carry the pickers and selects, so the
 * nodes are moved instead of rebuilt. */
function groupActionRows(): void {
  const list = actionsRows.querySelector<HTMLElement>(".settings-actions-list");
  const rows = settingsActionRows();
  if (!list || rows.length < 2) return;
  const blockOf = new Map<string, number>();
  let key = 0;
  const keys: number[] = [];
  for (const row of rows) {
    const group = row.querySelector<HTMLElement>(".s-group-trigger")?.dataset.value ?? "";
    if (group) {
      let k = blockOf.get(group);
      if (k === undefined) {
        k = key++;
        blockOf.set(group, k);
      }
      keys.push(k);
    } else {
      keys.push(key++);
    }
  }
  const indexed = rows.map((row, i) => ({ row, key: keys[i] }));
  indexed.sort((a, b) => a.key - b.key);
  if (indexed.every((entry, i) => entry.row === rows[i])) return;
  for (const { row } of indexed) list.appendChild(row);
  syncActionRowMetadata();
  actionsStatus.textContent = t(currentLanguage, "actionsGrouped");
}

interface InstalledApp {
  name: string;
  value: string;
}

let appsCache: InstalledApp[] | null = null;

async function getInstalledApps(): Promise<InstalledApp[]> {
  if (appsCache) return appsCache;
  try {
    appsCache = await invoke<InstalledApp[]>("list_apps");
  } catch {
    appsCache = [];
  }
  return appsCache;
}

function filterApps(apps: InstalledApp[], query: string): InstalledApp[] {
  // Same contract as the circle search: normalized, case-/accent-insensitive
  // substring on the name; blank queries list everything (capped at 200).
  const q = normalizeQuery(query);
  const out: InstalledApp[] = [];
  for (const app of apps) {
    if (q.length === 0 || normalizeName(app.name).includes(q)) out.push(app);
    if (out.length >= 200) break;
  }
  return out;
}

function renderAppList(
  list: HTMLElement,
  apps: InstalledApp[],
  onRender?: (items: HTMLElement[]) => void,
): void {
  list.textContent = "";
  if (apps.length === 0) {
    const empty = document.createElement("div");
    empty.className = "ap-empty";
    empty.textContent = t(currentLanguage, "noAppsFound");
    list.appendChild(empty);
    onRender?.([]);
    return;
  }
  const items: HTMLElement[] = [];
  for (const app of apps) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "ap-item";
    item.setAttribute("role", "option");
    item.id = `${list.id}-opt-${items.length}`;
    item.setAttribute("aria-selected", "false");
    item.dataset.value = app.value;
    item.dataset.name = app.name;
    const label = document.createElement("span");
    label.className = "ap-name";
    label.textContent = app.name;
    const path = document.createElement("span");
    path.className = "ap-path";
    path.textContent = app.value;
    item.append(label, path);
    list.appendChild(item);
    items.push(item);
  }
  onRender?.(items);
}

function closeAppPickers(except?: HTMLElement): void {
  for (const picker of document.querySelectorAll<HTMLElement>(".app-picker")) {
    if (picker === except || picker.hidden) continue;
    picker.hidden = true;
    picker.parentElement
      ?.querySelector<HTMLButtonElement>(".s-app-browse")
      ?.setAttribute("aria-expanded", "false");
  }
}

let apPickerSeq = 0;

function attachAppPicker(row: HTMLElement, value: HTMLInputElement, name: HTMLInputElement): void {
  const picker = document.createElement("div");
  picker.className = "app-picker";
  picker.hidden = true;

  const listId = `ap-list-${++apPickerSeq}`;
  const search = document.createElement("input");
  search.type = "text";
  search.className = "ap-search";
  search.setAttribute("role", "combobox");
  search.setAttribute("aria-autocomplete", "list");
  search.setAttribute("aria-controls", listId);
  search.setAttribute("aria-expanded", "false");
  search.placeholder = t(currentLanguage, "appSearchPlaceholder");

  const list = document.createElement("div");
  list.className = "ap-list";
  list.id = listId;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", t(currentLanguage, "appSearchPlaceholder"));

  let activeIdx = -1;
  let options: HTMLElement[] = [];

  const syncActive = (idx: number, scroll: boolean): void => {
    for (let i = 0; i < options.length; i++) {
      const on = i === idx;
      options[i].classList.toggle("ap-active", on);
      options[i].setAttribute("aria-selected", String(on));
    }
    if (idx >= 0 && options[idx]) {
      search.setAttribute("aria-activedescendant", options[idx].id);
      if (scroll) options[idx].scrollIntoView?.({ block: "nearest" });
    } else {
      search.removeAttribute("aria-activedescendant");
    }
    search.setAttribute("aria-expanded", String(!picker.hidden));
  };

  const choose = (item: HTMLElement): void => {
    value.value = item.dataset.value ?? "";
    if (name.value.trim() === "") {
      name.value = item.dataset.name ?? "";
      localizeSettingsRow(row);
    }
    picker.hidden = true;
    browse.setAttribute("aria-expanded", "false");
    search.setAttribute("aria-expanded", "false");
    value.focus();
  };

  const browse = row.querySelector<HTMLButtonElement>(".s-app-browse")!;
  browse.setAttribute("aria-haspopup", "listbox");
  browse.setAttribute("aria-expanded", "false");
  browse.addEventListener("click", () => {
    if (!picker.hidden) {
      picker.hidden = true;
      browse.setAttribute("aria-expanded", "false");
      search.setAttribute("aria-expanded", "false");
      return;
    }
    closeAppPickers(picker);
    picker.hidden = false;
    browse.setAttribute("aria-expanded", "true");
    search.setAttribute("aria-expanded", "true");
    search.value = "";
    search.setAttribute("aria-label", t(currentLanguage, "appSearchPlaceholder"));
    renderAppList(list, []);
    search.focus();
    void getInstalledApps().then((apps) =>
      renderAppList(list, filterApps(apps, ""), (items) => {
        options = items;
        activeIdx = -1;
        syncActive(-1, false);
      }),
    );
  });

  search.addEventListener("input", () => {
    void getInstalledApps().then((apps) =>
      renderAppList(list, filterApps(apps, search.value), (items) => {
        options = items;
        activeIdx = -1;
        syncActive(-1, false);
      }),
    );
  });

  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      picker.hidden = true;
      browse.setAttribute("aria-expanded", "false");
      search.setAttribute("aria-expanded", "false");
      browse.focus();
      return;
    }
    if (options.length === 0) return;
    if (e.key === "Enter") {
      e.preventDefault();
      const item = options[activeIdx >= 0 ? activeIdx : 0];
      if (item) choose(item);
      return;
    }
    let next = -1;
    if (e.key === "ArrowDown") next = activeIdx + 1 < options.length ? activeIdx + 1 : 0;
    else if (e.key === "ArrowUp") next = activeIdx - 1 >= 0 ? activeIdx - 1 : options.length - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = options.length - 1;
    if (next >= 0) {
      e.preventDefault();
      activeIdx = next;
      syncActive(activeIdx, true);
    }
  });

  list.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>(".ap-item");
    if (!item) return;
    choose(item);
  });

  picker.append(search, list);
  // The picker lives inside the foldable body so it animates with the card.
  (row.querySelector<HTMLElement>(".s-body-grid") ?? row).appendChild(picker);
}

// ----------------------------------------------------------- groups editor

function groupRows(): HTMLElement[] {
  return [...actionsRows.querySelectorAll<HTMLElement>(".group-row")];
}

function closeGroupPickers(except?: HTMLElement): void {
  for (const picker of actionsRows.querySelectorAll<HTMLElement>(".g-picker")) {
    if (picker === except || picker.hidden) continue;
    picker.hidden = true;
    picker.parentElement
      ?.querySelector<HTMLButtonElement>(".g-swatch")
      ?.setAttribute("aria-expanded", "false");
  }
}

/** Live validation message for the group color ("" = valid). */
function groupRowError(row: HTMLElement): string {
  const v = row.querySelector<HTMLInputElement>(".g-hex")!.value.trim();
  if (!isHexColor(v)) return t(currentLanguage, "colorInvalid");
  if (!isReadableOnDark(v)) return t(currentLanguage, "colorTooDark");
  return "";
}

/** Paint the swatch and refresh the inline color error. */
function refreshGroupRow(row: HTMLElement): void {
  const hex = row.querySelector<HTMLInputElement>(".g-hex")!;
  const error = row.querySelector<HTMLElement>(".g-error")!;
  const fill = row.querySelector<HTMLElement>(".g-swatch-fill")!;
  error.textContent = groupRowError(row);
  if (isHexColor(hex.value.trim())) fill.style.background = hex.value.trim();
}

function localizeGroupRow(row: HTMLElement): void {
  const L = currentLanguage;
  const name = row.querySelector<HTMLInputElement>(".g-name")!;
  const hex = row.querySelector<HTMLInputElement>(".g-hex")!;
  const swatch = row.querySelector<HTMLButtonElement>(".g-swatch")!;
  const del = row.querySelector<HTMLButtonElement>(".g-del")!;
  const label = name.value.trim() || t(L, "groupNamePlaceholder");
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", label);
  name.placeholder = t(L, "groupNamePlaceholder");
  name.setAttribute("aria-label", t(L, "groupNamePlaceholder"));
  row.querySelector<HTMLElement>(".g-name-label")!.textContent = t(L, "groupNameLabel");
  row.querySelector<HTMLElement>(".g-color-label")!.textContent = t(L, "groupColorLabel");
  swatch.setAttribute("aria-label", t(L, "groupColorAria", { name: label }));
  row.querySelector<HTMLElement>(".g-picker")?.setAttribute(
    "aria-label",
    t(L, "groupColorAria", { name: label }),
  );
  row.querySelector<HTMLElement>(".gp-grid")?.setAttribute(
    "aria-label",
    t(L, "groupColorAria", { name: label }),
  );
  del.setAttribute("aria-label", t(L, "deleteGroup", { name: label }));
  hex.placeholder = t(L, "customColorPlaceholder");
  hex.setAttribute("aria-label", t(L, "customColorPlaceholder"));
}

function buildGroupRow(id: string, name: string, color: string, autoId = false): HTMLElement {
  const row = document.createElement("div");
  row.className = "group-row";
  row.dataset.id = id;
  if (autoId) row.dataset.auto = "1";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "g-name";
  nameInput.value = name;
  const nameField = document.createElement("label");
  nameField.className = "group-field group-name-field";
  const nameLabel = document.createElement("span");
  nameLabel.className = "field-label g-name-label";
  nameLabel.textContent = t(currentLanguage, "groupNameLabel");
  nameField.append(nameLabel, nameInput);

  const swatch = document.createElement("button");
  swatch.type = "button";
  swatch.className = "g-swatch";
  swatch.setAttribute("aria-haspopup", "dialog");
  swatch.setAttribute("aria-expanded", "false");
  const fill = document.createElement("span");
  fill.className = "g-swatch-fill";
  swatch.appendChild(fill);
  const colorField = document.createElement("div");
  colorField.className = "group-field group-color-field";
  const colorLabel = document.createElement("span");
  colorLabel.className = "field-label g-color-label";
  colorLabel.textContent = t(currentLanguage, "groupColorLabel");
  colorField.append(colorLabel, swatch);

  const picker = document.createElement("div");
  picker.className = "g-picker";
  picker.hidden = true;
  picker.setAttribute("role", "dialog");
  picker.setAttribute("aria-label", t(currentLanguage, "groupColorAria", { name }));

  const grid = document.createElement("div");
  grid.className = "gp-grid";
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", t(currentLanguage, "groupColorAria", { name }));
  const gpItems: HTMLButtonElement[] = [];
  for (const c of GROUP_PALETTE) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "gp-item";
    item.tabIndex = -1;
    item.dataset.color = c;
    item.setAttribute("aria-label", c);
    item.style.background = c;
    grid.appendChild(item);
    gpItems.push(item);
  }
  let gpIdx = -1;

  /** Move the selected-color check to whatever the hex input currently holds. */
  const refreshGp = (): void => {
    const current = hex.value.trim().toLowerCase();
    for (const item of gpItems) {
      const on = item.dataset.color === current;
      item.classList.toggle("gp-selected", on);
      item.setAttribute("aria-pressed", String(on));
    }
  };

  /** Roving tabindex over the palette: focus the item at `idx`. */
  const focusGp = (idx: number): void => {
    if (idx < 0 || idx >= gpItems.length) return;
    gpIdx = idx;
    for (let i = 0; i < gpItems.length; i++) gpItems[i].tabIndex = i === idx ? 0 : -1;
    gpItems[idx].focus();
  };

  grid.addEventListener("keydown", (e) => {
    const cols = 5;
    let next = -1;
    if (e.key === "ArrowRight") next = (gpIdx + 1) % gpItems.length;
    else if (e.key === "ArrowLeft") next = (gpIdx - 1 + gpItems.length) % gpItems.length;
    else if (e.key === "ArrowDown")
      next = gpIdx + cols < gpItems.length ? gpIdx + cols : gpIdx % cols;
    else if (e.key === "ArrowUp")
      next = gpIdx - cols >= 0 ? gpIdx - cols : Math.floor(gpIdx / cols) * cols;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = gpItems.length - 1;
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (gpIdx >= 0) gpItems[gpIdx].click();
      return;
    }
    if (next >= 0) {
      e.preventDefault();
      focusGp(next);
    }
  });

  picker.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    picker.hidden = true;
    swatch.setAttribute("aria-expanded", "false");
    swatch.focus();
  });

  const custom = document.createElement("div");
  custom.className = "gp-custom";
  const hex = document.createElement("input");
  hex.type = "text";
  hex.className = "g-hex";
  hex.value = color;
  const error = document.createElement("span");
  error.className = "g-error";
  error.setAttribute("role", "alert");
  custom.append(hex, error);

  picker.append(grid, custom);

  const del = document.createElement("button");
  del.type = "button";
  del.className = "g-del";
  del.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>';

  row.append(nameField, colorField, picker, del);
  localizeGroupRow(row);
  refreshGroupRow(row);

  nameInput.addEventListener("input", () => {
    row.classList.remove("invalid");
    localizeGroupRow(row);
    if (row.dataset.auto === "1") {
      // First real name: derive the id from it (stable afterwards, so
      // actions already assigned keep their reference).
      const oldId = row.dataset.id ?? "";
      const others = groupRows()
        .filter((r) => r !== row)
        .map((r) => ({ id: r.dataset.id ?? "", name: "", color: "" }));
      row.dataset.id = uniqueGroupId(others, nameInput.value.trim());
      delete row.dataset.auto;
      for (const trigger of actionsRows.querySelectorAll<HTMLElement>(".s-group-trigger")) {
        if (trigger.dataset.value === oldId) trigger.dataset.value = row.dataset.id ?? "";
      }
    }
    refreshAllGroupPickers();
  });

  swatch.addEventListener("click", () => {
    if (picker.hidden) {
      closeGroupPickers(picker);
      picker.hidden = false;
      swatch.setAttribute("aria-expanded", "true");
      lastPopoverOpenAt = Date.now();
      refreshGp();
      const match = gpItems.findIndex(
        (it) => it.dataset.color === hex.value.trim().toLowerCase(),
      );
      focusGp(match >= 0 ? match : 0);
    } else {
      picker.hidden = true;
      swatch.setAttribute("aria-expanded", "false");
    }
  });

  grid.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>(".gp-item");
    if (!item) return;
    hex.value = item.dataset.color ?? "";
    refreshGroupRow(row);
    refreshGp();
    picker.hidden = true;
    swatch.setAttribute("aria-expanded", "false");
    swatch.focus();
  });

  hex.addEventListener("input", () => {
    row.classList.remove("invalid");
    refreshGroupRow(row);
    refreshGp();
  });

  del.addEventListener("click", () => {
    closeGroupPickers();
    const id = row.dataset.id;
    row.remove();
    for (const trigger of actionsRows.querySelectorAll<HTMLElement>(".s-group-trigger")) {
      if (id && trigger.dataset.value === id) {
        trigger.dataset.value = "";
        syncGroupTrigger(trigger);
      }
    }
    refreshAllGroupPickers();
    syncHasGroups();
  });

  return row;
}

/** Current groups as typed in the editor (valid entries only). */
function collectGroupsFromRows(): Group[] {
  const out: Group[] = [];
  for (const row of groupRows()) {
    const id = row.dataset.id ?? "";
    const name = row.querySelector<HTMLInputElement>(".g-name")!.value.trim();
    const color = row.querySelector<HTMLInputElement>(".g-hex")!.value.trim();
    if (id && name && isHexColor(color) && isReadableOnDark(color)) {
      out.push({ id, name, color });
    }
  }
  return out;
}

// ------------------------------------------------------- popover placement

const ACTIONS_POPOVER_GAP = 6;

/** Last time any floating picker was opened; scrolls racing the open's own
 * programmatic scroll-into-view are ignored for ~150ms. Wheel/touch need no
 * separate guard: programmatic scrolls emit neither event. */
let lastPopoverOpenAt = 0;

/**
 * Keep an actions-editor popover inside the visible scroll viewport. A simple
 * up/down flip is not enough: a popover belonging to the first visible row
 * could still overlap the tabs when there is no room above. In that case,
 * scroll the editor in the direction that creates room, then cap the popup
 * only as a last resort for unusually small windows.
 */
function positionActionsPopover(trigger: HTMLElement, popup: HTMLElement): void {
  // Mark the open race: the scrolls below are ours, and the actionsRows
  // `scroll` listener lets through anything within ~150ms of this stamp.
  lastPopoverOpenAt = Date.now();
  // A previous open may have applied a viewport-specific max-height. Remove
  // it before measuring so a later open can grow again after the editor moves.
  popup.style.removeProperty("max-height");
  trigger.scrollIntoView?.({ block: "nearest" });

  const menuHeight = Math.max(popup.offsetHeight, popup.getBoundingClientRect().height);
  const measure = (): {
    triggerTop: number;
    triggerBottom: number;
    viewportTop: number;
    viewportBottom: number;
    above: number;
    below: number;
  } => {
    const triggerRect = trigger.getBoundingClientRect();
    const viewport = actionsRows.getBoundingClientRect();
    const above = Math.max(0, triggerRect.top - viewport.top - ACTIONS_POPOVER_GAP);
    const below = Math.max(0, viewport.bottom - triggerRect.bottom - ACTIONS_POPOVER_GAP);
    return {
      triggerTop: triggerRect.top,
      triggerBottom: triggerRect.bottom,
      viewportTop: viewport.top,
      viewportBottom: viewport.bottom,
      above,
      below,
    };
  };
  const fitsUp = (m: ReturnType<typeof measure>): boolean => m.above >= menuHeight;
  const fitsDown = (m: ReturnType<typeof measure>): boolean => m.below >= menuHeight;

  let placement = measure();
  let openUp = false;
  if (fitsDown(placement)) {
    // Prefer the natural direction whenever the complete menu fits below.
    openUp = false;
  } else if (fitsUp(placement)) {
    openUp = true;
  } else {
    // Neither side fits at the current scroll position. Prefer the side with
    // more usable room and scroll only as far as possible without hiding the
    // trigger or moving the popup into the tab/header area.
    openUp = placement.above > placement.below;
    const room = openUp ? placement.above : placement.below;
    const needed = Math.max(0, menuHeight - room);
    if (openUp) {
      const safeScroll = Math.max(0, placement.viewportBottom - placement.triggerTop + ACTIONS_POPOVER_GAP);
      actionsRows.scrollTop -= Math.min(needed, safeScroll);
    } else {
      const safeScroll = Math.max(0, placement.triggerBottom - placement.viewportTop + ACTIONS_POPOVER_GAP);
      actionsRows.scrollTop += Math.min(needed, safeScroll);
    }
    placement = measure();

    // A scroll boundary may prevent the preferred movement. Use the other
    // side when it became the only side with enough space.
    if (openUp ? !fitsUp(placement) && fitsDown(placement) : !fitsDown(placement) && fitsUp(placement)) {
      openUp = !openUp;
    }
  }

  popup.classList.toggle("open-up", openUp);

  // If the available viewport is smaller than the menu (for example on a
  // very small window), keep the popup itself visible and let its options
  // scroll instead of clipping the bottom or covering the tabs.
  const available = openUp ? placement.above : placement.below;
  if (menuHeight > available && available > 0) {
    popup.style.maxHeight = `${available}px`;
  }
}

// ------------------------------------------------------- group select

/** Close every open group-select popup (except `except`, if given). */
function closeGroupSelects(except?: HTMLElement): void {
  for (const popup of actionsRows.querySelectorAll<HTMLElement>(".s-group-picker")) {
    if (popup === except || popup.hidden) continue;
    popup.hidden = true;
    popup.parentElement
      ?.querySelector<HTMLElement>(".s-group-trigger")
      ?.setAttribute("aria-expanded", "false");
  }
}

/** Rebuild a picker's options from the current group rows. */
function refreshGroupPicker(listbox: HTMLElement): void {
  groupPickerRefresh.get(listbox)?.();
}

/** Rebuild every group-select popup (after groups are added/renamed/deleted). */
function refreshAllGroupPickers(): void {
  for (const popup of actionsRows.querySelectorAll<HTMLElement>(".s-group-picker")) {
    refreshGroupPicker(popup);
  }
}

/** Label shown on the trigger for a group id ("" = no group). */
function groupTriggerLabel(value: string): string {
  if (!value) return t(currentLanguage, "noGroup");
  const row = groupRows().find((g) => g.dataset.id === value);
  const name = row?.querySelector<HTMLInputElement>(".g-name")?.value.trim();
  return name || t(currentLanguage, "noGroup");
}

/** Color of the group the trigger points at ("" = none). */
function groupTriggerColor(value: string): string {
  if (!value) return "";
  const row = groupRows().find((g) => g.dataset.id === value);
  const color = row?.querySelector<HTMLInputElement>(".g-hex")?.value.trim() ?? "";
  return isHexColor(color) ? color : "";
}

/** Reflect the current value on the trigger: text, group dot and accessible name. */
function syncGroupTrigger(trigger: HTMLElement): void {
  const value = trigger.dataset.value ?? "";
  const label = groupTriggerLabel(value);
  trigger.querySelector<HTMLElement>(".s-group-value")!.textContent = label;
  trigger.setAttribute(
    "aria-label",
    `${t(currentLanguage, "actionGroupLabel")}: ${label}`,
  );
  const dot = trigger.querySelector<HTMLElement>(".s-group-dot");
  if (dot) dot.style.background = groupTriggerColor(value);
}

/** Per-popup refresh callbacks keyed by their listbox element. */
const groupPickerRefresh = new WeakMap<HTMLElement, () => void>();

let groupPickerSeq = 0;

/** Build the group-select picker: a trigger button plus a listbox popover
 * anchored to the trigger, floating over the content below. Returns the
 * trigger. */
function buildGroupPicker(host: HTMLElement, initial: string): HTMLElement {
  const listId = `gsel-${++groupPickerSeq}`;

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "s-group s-group-trigger";
  trigger.dataset.value = initial;
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", listId);
  const dot = document.createElement("span");
  dot.className = "s-group-dot";
  const valueSpan = document.createElement("span");
  valueSpan.className = "s-group-value";
  trigger.append(dot, valueSpan);
  host.appendChild(trigger);

  const listbox = document.createElement("div");
  listbox.className = "s-group-picker";
  listbox.id = listId;
  listbox.hidden = true;
  listbox.tabIndex = -1;
  listbox.setAttribute("role", "listbox");
  listbox.setAttribute("aria-label", t(currentLanguage, "groupSelectAria"));

  let options: HTMLElement[] = [];
  let activeIdx = 0;

  const renderOptions = (): void => {
    const value = trigger.dataset.value ?? "";
    listbox.textContent = "";
    options = [];
    activeIdx = 0;
    const addOption = (id: string, name: string, color: string): void => {
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "sg-item";
      opt.id = `${listId}-opt-${options.length}`;
      opt.tabIndex = -1;
      opt.dataset.value = id;
      opt.setAttribute("role", "option");
      opt.setAttribute("aria-selected", String(id === value));
      const dot = document.createElement("span");
      dot.className = "sg-dot";
      if (isHexColor(color)) dot.style.background = color;
      const label = document.createElement("span");
      label.className = "sg-name";
      label.textContent = name;
      opt.append(dot, label);
      listbox.appendChild(opt);
      options.push(opt);
      if (id === value) activeIdx = options.length - 1;
    };
    addOption("", t(currentLanguage, "noGroup"), "");
    for (const gRow of groupRows()) {
      const id = gRow.dataset.id ?? "";
      const name = gRow.querySelector<HTMLInputElement>(".g-name")!.value.trim();
      const color = gRow.querySelector<HTMLInputElement>(".g-hex")!.value.trim();
      addOption(id, name || t(currentLanguage, "noGroup"), color);
    }
  };

  const syncActive = (idx: number, scroll: boolean): void => {
    activeIdx = idx;
    for (let i = 0; i < options.length; i++) {
      options[i].classList.toggle("sg-active", i === idx);
    }
    if (idx >= 0 && options[idx]) {
      listbox.setAttribute("aria-activedescendant", options[idx].id);
      if (scroll) options[idx].scrollIntoView?.({ block: "nearest" });
    } else {
      listbox.removeAttribute("aria-activedescendant");
    }
  };

  const close = (focusTrigger: boolean): void => {
    if (listbox.hidden) return;
    listbox.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    listbox.removeAttribute("aria-activedescendant");
    if (focusTrigger) trigger.focus();
  };

  const open = (): void => {
    closeGroupSelects(listbox);
    renderOptions();
    listbox.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    syncActive(activeIdx, false);
    positionActionsPopover(trigger, listbox);
    listbox.focus();
  };

  const choose = (opt: HTMLElement): void => {
    trigger.dataset.value = opt.dataset.value ?? "";
    syncGroupTrigger(trigger);
    close(true);
  };

  trigger.addEventListener("click", () => {
    if (listbox.hidden) open();
    else close(true);
  });

  listbox.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === "Tab") {
      // Leave the popup and let the panel's focus trap move on naturally.
      close(false);
      return;
    }
    if (options.length === 0) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(options[activeIdx >= 0 ? activeIdx : 0]);
      return;
    }
    let next = -1;
    if (e.key === "ArrowDown") next = activeIdx + 1 < options.length ? activeIdx + 1 : 0;
    else if (e.key === "ArrowUp") next = activeIdx - 1 >= 0 ? activeIdx - 1 : options.length - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = options.length - 1;
    if (next >= 0) {
      e.preventDefault();
      syncActive(next, true);
    }
  });

  // Hover highlights; click commits (PointerEvents, so it also covers touch).
  listbox.addEventListener("pointermove", (e) => {
    const opt = (e.target as HTMLElement).closest<HTMLElement>(".sg-item");
    if (opt && options.includes(opt)) syncActive(options.indexOf(opt), false);
  });

  listbox.addEventListener("click", (e) => {
    const opt = (e.target as HTMLElement).closest<HTMLElement>(".sg-item");
    if (opt && options.includes(opt)) choose(opt);
  });

  const refresh = (): void => {
    const wasOpen = !listbox.hidden;
    renderOptions();
    syncGroupTrigger(trigger);
    if (wasOpen) syncActive(activeIdx, false);
  };
  groupPickerRefresh.set(listbox, refresh);

  refresh();
  host.appendChild(listbox);
  return trigger;
}

/** Build the groups tab content. It is appended after the actions section. */
function rebuildGroupsEditor(): HTMLElement {
  const block = document.createElement("section");
  block.className = "settings-groups";
  block.setAttribute("aria-labelledby", "settings-groups-heading");

  const header = document.createElement("div");
  header.className = "settings-groups-header";
  const title = document.createElement("h2");
  title.className = "settings-groups-title";
  title.id = "settings-groups-heading";
  title.textContent = t(currentLanguage, "groupsLabel");
  const add = document.createElement("button");
  add.type = "button";
  add.className = "g-add";
  add.textContent = t(currentLanguage, "addGroup");
  header.append(title, add);

  const list = document.createElement("div");
  list.className = "settings-groups-list";
  for (const g of groups) list.appendChild(buildGroupRow(g.id, g.name, g.color));

  block.append(header, list);

  add.addEventListener("click", () => {
    const id = uniqueGroupId(collectGroupsFromRows(), "");
    const row = buildGroupRow(id, "", GROUP_PALETTE[0], true);
    list.appendChild(row);
    refreshAllGroupPickers();
    syncHasGroups();
    row.querySelector<HTMLInputElement>(".g-name")?.focus();
  });
  return block;
}

function localizeGroupsEditor(): void {
  const L = currentLanguage;
  const title = actionsRows.querySelector<HTMLElement>(".settings-groups-title");
  const add = actionsRows.querySelector<HTMLButtonElement>(".g-add");
  if (title) title.textContent = t(L, "groupsLabel");
  if (add) add.textContent = t(L, "addGroup");
  for (const row of groupRows()) localizeGroupRow(row);
}

let kindPickerSeq = 0;

/** Close every open action-kind popup (except `except`, if given). */
function closeKindPickers(except?: HTMLElement): void {
  for (const listbox of actionsRows.querySelectorAll<HTMLElement>(".s-kind-listbox")) {
    if (listbox === except || listbox.hidden) continue;
    listbox.hidden = true;
    listbox.parentElement
      ?.querySelector<HTMLElement>(".s-kind-trigger")
      ?.setAttribute("aria-expanded", "false");
  }
}

/** Dismiss every floating picker in the actions editor, returning focus to
 * its trigger without scrolling (the user just scrolled on purpose).
 * Covers the kind listboxes (parent rows + sequence steps), the group
 * selects and the group color popovers. The in-flow app picker is excluded:
 * it expands the card rather than overlaying, so it scrolls naturally. */
function dismissFloatingPickers(): void {
  for (const listbox of actionsRows.querySelectorAll<HTMLElement>(".s-kind-listbox")) {
    if (listbox.hidden) continue;
    listbox.hidden = true;
    const trigger = listbox.parentElement?.querySelector<HTMLElement>(".s-kind-trigger");
    trigger?.setAttribute("aria-expanded", "false");
    if (trigger && listbox.contains(document.activeElement)) {
      trigger.focus({ preventScroll: true });
    }
  }
  for (const popup of actionsRows.querySelectorAll<HTMLElement>(".s-group-picker")) {
    if (popup.hidden) continue;
    popup.hidden = true;
    const trigger = popup.parentElement?.querySelector<HTMLElement>(".s-group-trigger");
    trigger?.setAttribute("aria-expanded", "false");
    if (trigger && popup.contains(document.activeElement)) {
      trigger.focus({ preventScroll: true });
    }
  }
  for (const picker of actionsRows.querySelectorAll<HTMLElement>(".g-picker")) {
    if (picker.hidden) continue;
    picker.hidden = true;
    const swatch = picker.parentElement?.querySelector<HTMLButtonElement>(".g-swatch");
    swatch?.setAttribute("aria-expanded", "false");
    if (swatch && picker.contains(document.activeElement)) {
      swatch.focus({ preventScroll: true });
    }
  }
}

/** Type picker matching the group picker: one trigger and an accessible
 * listbox popover with mouse and keyboard selection. Parent rows allow the
 * `sequence` kind; sequence steps are leaves only (no nesting). */
function buildKindPicker(
  kind: Action["kind"] | SequenceStepKind,
  opts?: { allowSequence?: boolean },
): HTMLElement {
  const allowSequence = opts?.allowSequence ?? true;
  const picker = document.createElement("div");
  picker.className = "s-kind-picker";
  const listId = `ksel-${++kindPickerSeq}`;
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "s-kind-trigger";
  trigger.dataset.value = kind;
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", listId);
  const icon = document.createElement("span");
  icon.className = "s-kind-trigger-icon";
  icon.setAttribute("aria-hidden", "true");
  trigger.appendChild(icon);
  const listbox = document.createElement("div");
  listbox.className = "s-kind-listbox";
  listbox.id = listId;
  listbox.hidden = true;
  listbox.tabIndex = -1;
  listbox.setAttribute("role", "listbox");
  listbox.setAttribute("aria-label", t(currentLanguage, "actionTypeLabel"));
  const kinds: readonly (Action["kind"] | SequenceStepKind)[] = allowSequence
    ? (["url", "command", "app", "file", "folder", "sequence"] as const)
    : (SEQUENCE_STEP_KINDS as readonly SequenceStepKind[]);
  let options: HTMLButtonElement[] = [];
  let active = 0;

  const render = (): void => {
    listbox.replaceChildren();
    options = kinds.map((k) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "s-kind-option";
      option.id = `${listId}-opt-${k}`;
      option.tabIndex = -1;
      option.dataset.value = k;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(k === trigger.dataset.value));
      const optionIcon = document.createElement("span");
      optionIcon.className = "s-kind-option-icon";
      optionIcon.innerHTML = KIND_ICONS[k];
      const label = document.createElement("span");
      label.className = "s-kind-option-label";
      label.textContent = t(currentLanguage, KIND_LABEL_KEYS[k]);
      option.append(optionIcon, label);
      listbox.appendChild(option);
      return option;
    });
    active = Math.max(0, kinds.indexOf(trigger.dataset.value as typeof kinds[number]));
    syncActive(false);
    icon.innerHTML = KIND_ICONS[trigger.dataset.value as Action["kind"]];
  };
  const syncActive = (scroll: boolean): void => {
    options.forEach((option, index) => option.classList.toggle("active", index === active));
    if (options[active]) {
      listbox.setAttribute("aria-activedescendant", options[active].id || "");
      if (scroll) options[active].scrollIntoView?.({ block: "nearest" });
    }
  };
  const close = (focus = false): void => {
    listbox.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (focus) trigger.focus();
  };
  const closeOthers = (): void => closeKindPickers(listbox);
  const open = (): void => {
    closeOthers();
    render();
    listbox.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    positionActionsPopover(trigger, listbox);
    listbox.focus();
  };
  const choose = (option: HTMLElement): void => {
    const next = option.dataset.value ?? "url";
    const prev = trigger.dataset.value ?? "url";
    // Re-selecting the active kind is a no-op: it must not wipe the value.
    if (next === prev) {
      close(true);
      return;
    }
    trigger.dataset.value = next;
    render();
    close(true);
    trigger.dispatchEvent(
      new CustomEvent("kindchange", { bubbles: true, detail: { previousKind: prev } }),
    );
  };
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (listbox.hidden) open();
    else close(true);
  });
  listbox.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (e.key === "Tab") {
      close();
      return;
    }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(options[active]); return; }
    let next = -1;
    if (e.key === "ArrowDown") next = (active + 1) % options.length;
    if (e.key === "ArrowUp") next = (active - 1 + options.length) % options.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = options.length - 1;
    if (next >= 0) { e.preventDefault(); active = next; syncActive(true); }
  });
  listbox.addEventListener("pointermove", (e) => {
    const option = (e.target as HTMLElement).closest<HTMLButtonElement>(".s-kind-option");
    if (option) { active = options.indexOf(option); syncActive(false); }
  });
  listbox.addEventListener("click", (e) => {
    const option = (e.target as HTMLElement).closest<HTMLButtonElement>(".s-kind-option");
    if (option) choose(option);
  });

  // No focusout-based dismissal here: on a real click the focus reaches the
  // button before the click event (and some engines — WebKit, Firefox —
  // report `relatedTarget: null` for that move), so closing on focus loss
  // would make the button reopen instead of toggling. Like the group picker,
  // the popup closes on: choosing an option, Escape/Tab, or an outside click
  // (the actionsRows handler).
  render();
  picker.append(trigger, listbox);
  return picker;
}

// ------------------------------------------------------- sequence steps
// A sequence fans out to 1..MAX_SEQUENCE_STEPS leaf actions (url/command/
// app/file/folder, never nested). Each step is its own mini-row reusing the
// editor's tokens: 34px kind trigger, field-fill value, 34px browse/delete.
// The parent's own value line is hidden while `kind-sequence` is active.

function sequenceStepsOf(row: HTMLElement): HTMLElement[] {
  return [...row.querySelectorAll<HTMLElement>(".s-step")];
}

function syncSequenceCount(row: HTMLElement): void {
  const list = row.querySelector<HTMLElement>(".s-steps-list");
  const countEl = row.querySelector<HTMLElement>(".s-steps-count");
  const add = row.querySelector<HTMLButtonElement>(".s-steps-add");
  if (!list || !countEl) return;
  const n = sequenceStepsOf(row).length;
  countEl.textContent = t(currentLanguage, "sequenceStepsCount", { count: String(n) });
  countEl.setAttribute(
    "aria-label",
    t(currentLanguage, "sequenceStepsCount", { count: String(n) }),
  );
  if (add) {
    add.disabled = n >= MAX_SEQUENCE_STEPS;
    add.setAttribute("aria-disabled", String(n >= MAX_SEQUENCE_STEPS));
  }
  // Number each step for screen readers (Step 1..N).
  sequenceStepsOf(row).forEach((step, i) => {
    step.dataset.index = String(i + 1);
    const value = step.querySelector<HTMLInputElement>(".s-step-value");
    if (value) {
      value.setAttribute("aria-label", t(currentLanguage, "stepValueLabel", { index: String(i + 1) }));
    }
    const del = step.querySelector<HTMLButtonElement>(".s-step-del");
    if (del) {
      const kindLabel = t(
        currentLanguage,
        KIND_LABEL_KEYS[(step.querySelector<HTMLElement>(".s-kind-trigger")?.dataset.value ?? "url") as Action["kind"]],
      );
      del.setAttribute("aria-label", t(currentLanguage, "deleteStep", { index: String(i + 1) }));
      del.title = `${kindLabel} — ${t(currentLanguage, "deleteStep", { index: String(i + 1) })}`;
    }
  });
}

function syncStepKindVisuals(step: HTMLElement): void {
  const k = (step.querySelector<HTMLElement>(".s-kind-trigger")?.dataset.value ??
    "url") as SequenceStepKind;
  const value = step.querySelector<HTMLInputElement>(".s-step-value")!;
  value.placeholder = kindValuePlaceholder(k);
  const appB = step.querySelector<HTMLButtonElement>(".s-app-browse")!;
  const fileB = step.querySelector<HTMLButtonElement>(".s-file-browse")!;
  const folderB = step.querySelector<HTMLButtonElement>(".s-folder-browse")!;
  appB.hidden = k !== "app";
  fileB.hidden = k !== "file";
  folderB.hidden = k !== "folder";
}

function buildSequenceStep(
  parentRow: HTMLElement,
  step?: SequenceStep,
): HTMLElement {
  const initialKind = (step?.kind ?? "url") as SequenceStepKind;
  const el = document.createElement("div");
  el.className = "s-step";

  const kindPicker = buildKindPicker(initialKind, { allowSequence: false });

  const valueField = document.createElement("div");
  valueField.className = "s-step-value-field";
  const value = document.createElement("input");
  value.type = "text";
  value.className = "s-step-value";
  value.value = step?.value ?? "";
  value.placeholder = kindValuePlaceholder(initialKind);
  valueField.appendChild(value);

  const appBrowse = document.createElement("button");
  appBrowse.type = "button";
  appBrowse.className = "s-app-browse";
  appBrowse.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>';
  const fileBrowse = document.createElement("button");
  fileBrowse.type = "button";
  fileBrowse.className = "s-file-browse";
  fileBrowse.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  const folderBrowse = document.createElement("button");
  folderBrowse.type = "button";
  folderBrowse.className = "s-folder-browse";
  folderBrowse.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>';

  const del = document.createElement("button");
  del.type = "button";
  del.className = "s-step-del";
  del.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>';

  // Per-step native pickers for file/folder (modal: write straight in).
  const pickInto = async (directory: boolean): Promise<void> => {
    try {
      const picked = await pickPath({
        directory,
        multiple: false,
        title: t(currentLanguage, directory ? "browseFolder" : "browseFile"),
      });
      if (typeof picked !== "string") return;
      value.value = picked;
      el.classList.remove("invalid");
      value.focus();
    } catch {
      // Cancelled: leave untouched.
    }
  };
  fileBrowse.addEventListener("click", () => void pickInto(false));
  folderBrowse.addEventListener("click", () => void pickInto(true));

  el.append(kindPicker, valueField, appBrowse, fileBrowse, folderBrowse, del);
  // Per-step app picker: reuse the shared picker, anchored to the step. A
  // detached dummy name keeps the parent action name untouched (steps are
  // nameless; only kind+value matter). Appended after `el.append` so the
  // step's own browse button exists when the picker wires itself.
  const dummyName = document.createElement("input");
  dummyName.type = "text";
  attachAppPicker(el, value, dummyName);

  del.addEventListener("click", () => {
    // Keep at least the row shell: removing the last step leaves one empty
    // step so the sequence never collapses to zero controls (validation
    // still requires a value before save).
    const siblings = sequenceStepsOf(parentRow);
    if (siblings.length <= 1) {
      value.value = "";
      const trigger = el.querySelector<HTMLElement>(".s-kind-trigger");
      if (trigger) {
        trigger.dataset.value = "url";
        const icon = trigger.querySelector<HTMLElement>(".s-kind-trigger-icon");
        if (icon) icon.innerHTML = KIND_ICONS.url;
      }
      syncStepKindVisuals(el);
      localizeSequenceStep(el, 1);
      el.classList.remove("invalid");
      value.focus();
    } else {
      el.remove();
    }
    syncSequenceCount(parentRow);
  });

  value.addEventListener("input", () => {
    el.classList.remove("invalid");
    parentRow.classList.remove("invalid");
  });

  kindPicker.addEventListener("kindchange", () => {
    // Same stale-value rule as parent rows: kinds are incompatible.
    if (value.value !== "") {
      value.value = "";
      el.classList.remove("invalid");
    }
    closeAppPickers();
    syncStepKindVisuals(el);
    syncSequenceCount(parentRow);
  });

  // Step browser dataset (per-URL override) round-trips silently like the
  // parent row: preserved on save, never edited in the UI.
  el.dataset.browser = step?.browser ?? "";
  syncStepKindVisuals(el);
  return el;
}

function localizeSequenceStep(step: HTMLElement, index: number): void {
  const L = currentLanguage;
  const value = step.querySelector<HTMLInputElement>(".s-step-value")!;
  const k = (step.querySelector<HTMLElement>(".s-kind-trigger")?.dataset.value ?? "url") as SequenceStepKind;
  value.placeholder = kindValuePlaceholder(k);
  value.setAttribute("aria-label", t(L, "stepValueLabel", { index: String(index) }));
  const del = step.querySelector<HTMLButtonElement>(".s-step-del")!;
  del.setAttribute("aria-label", t(L, "deleteStep", { index: String(index) }));
  const appB = step.querySelector<HTMLButtonElement>(".s-app-browse")!;
  appB.setAttribute("aria-label", t(L, "browseApps"));
  appB.title = t(L, "browseApps");
  const fileB = step.querySelector<HTMLButtonElement>(".s-file-browse")!;
  fileB.setAttribute("aria-label", t(L, "browseFile"));
  fileB.title = t(L, "browseFile");
  const folderB = step.querySelector<HTMLButtonElement>(".s-folder-browse")!;
  folderB.setAttribute("aria-label", t(L, "browseFolder"));
  folderB.title = t(L, "browseFolder");
  const kindListbox = step.querySelector<HTMLElement>(".s-kind-listbox");
  if (kindListbox) kindListbox.setAttribute("aria-label", t(L, "actionTypeLabel"));
}

function collectSequenceSteps(row: HTMLElement): SequenceStep[] {
  const out: SequenceStep[] = [];
  for (const step of sequenceStepsOf(row)) {
    const kind = (step.querySelector<HTMLElement>(".s-kind-trigger")?.dataset.value ??
      "url") as SequenceStepKind;
    if (!SEQUENCE_STEP_KINDS.includes(kind)) continue;
    const value = step.querySelector<HTMLInputElement>(".s-step-value")!.value.trim();
    if (!value) continue;
    const browser = step.dataset.browser ?? "";
    const s: SequenceStep = { kind, value };
    if (kind === "url" && browser) s.browser = browser;
    out.push(s);
    if (out.length >= MAX_SEQUENCE_STEPS) break;
  }
  return out;
}

function buildSettingsRow(a: Action): HTMLElement {
  const L = currentLanguage;
  const row = document.createElement("div");
  row.className = "settings-row";
  row.setAttribute("role", "listitem");
  row.setAttribute("aria-label", a.name || t(L, "namePlaceholder"));

  // Collapsed face: the action's kind icon (plus its group color when set).
  // The card unfolds on hover or keyboard focus; clicking the face expands
  // it and drops the caret straight into the name field.
  const face = document.createElement("button");
  face.type = "button";
  face.className = "s-face";
  face.setAttribute("aria-label", a.name || t(L, "namePlaceholder"));
  const faceIcon = document.createElement("span");
  faceIcon.className = "s-face-icon";
  faceIcon.setAttribute("aria-hidden", "true");
  faceIcon.innerHTML = KIND_ICONS[a.kind];
  const faceDot = document.createElement("span");
  faceDot.className = "s-face-dot";
  faceDot.setAttribute("aria-hidden", "true");
  if (a.group) faceDot.style.background = groupTriggerColor(a.group);
  else faceDot.hidden = true;
  face.append(faceIcon, faceDot);
  // Clicking the face pins the card open (hover alone can't be relied on:
  // touch has none, and the freshly focused field must be visible to take
  // the caret) and drops focus straight into the name field.
  face.addEventListener("click", () => {
    row.classList.add("pin");
    name.focus();
  });

  // The unfolding editor body: everything the card shows today, wrapped in
  // the disclosure container that CSS animates (grid-template-rows 0fr ->
  // 1fr). Fields stay visibility:hidden while collapsed so they never
  // enter the tab order.
  const body = document.createElement("div");
  body.className = "s-body";
  const bodyClip = document.createElement("div");
  bodyClip.className = "s-body-clip";
  const bodyGrid = document.createElement("div");
  bodyGrid.className = "s-body-grid";
  body.append(bodyClip);
  bodyClip.append(bodyGrid);

  const top = document.createElement("div");
  top.className = "settings-row-top";

  const name = document.createElement("input");
  name.type = "text";
  name.className = "s-name";
  name.value = a.name;
  name.placeholder = t(L, "namePlaceholder");
  name.setAttribute("aria-label", t(L, "namePlaceholder"));
  const nameField = document.createElement("div");
  nameField.className = "s-name-field";
  nameField.appendChild(name);

  const kindPicker = buildKindPicker(a.kind, { allowSequence: true });
  const parentKindTrigger = (): HTMLElement | null =>
    top.querySelector<HTMLElement>(".s-kind-trigger");

  // Right rail: reorder and delete, stacked.
  const rail = document.createElement("div");
  rail.className = "s-rail";
  const order = document.createElement("div");
  order.className = "s-order-controls";
  order.setAttribute("role", "toolbar");
  order.setAttribute("aria-label", t(L, "reorderHint"));
  const up = document.createElement("button");
  up.type = "button";
  up.className = "s-move-up";
  up.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14l6-6 6 6" /></svg>';
  const down = document.createElement("button");
  down.type = "button";
  down.className = "s-move-down";
  down.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 10l6 6 6-6" /></svg>';
  const actionName = a.name || t(L, "namePlaceholder");
  up.setAttribute("aria-label", t(L, "moveActionUp", { name: actionName }));
  down.setAttribute("aria-label", t(L, "moveActionDown", { name: actionName }));
  order.append(up, down);

  const del = document.createElement("button");
  del.type = "button";
  del.className = "s-del";
  del.setAttribute(
    "aria-label",
    t(L, "deleteAction", { name: a.name || t(L, "namePlaceholder") }),
  );
  del.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>';
  del.addEventListener("click", () => {
    row.remove();
    afterActionsChanged();
  });

  rail.append(order);

  const value = document.createElement("input");
  value.type = "text";
  value.className = "s-value";
  value.value = a.value;
  value.setAttribute("aria-label", t(L, "actionValueLabel"));
  const valueField = document.createElement("div");
  valueField.className = "s-value-field";
  valueField.appendChild(value);

  const valueWrap = document.createElement("div");
  valueWrap.className = "s-value-row";

  const browse = document.createElement("button");
  browse.type = "button";
  browse.className = "s-app-browse";
  browse.setAttribute("aria-label", t(L, "browseApps"));
  browse.title = t(L, "browseApps");
  browse.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>';

  // File and folder kinds each get their own native dialog. The dialogs are
  // modal, so the picked path is written straight into the value field (and
  // the name, when still blank).
  const fileBrowse = document.createElement("button");
  fileBrowse.type = "button";
  fileBrowse.className = "s-file-browse";
  fileBrowse.setAttribute("aria-label", t(L, "browseFile"));
  fileBrowse.title = t(L, "browseFile");
  fileBrowse.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

  const folderBrowse = document.createElement("button");
  folderBrowse.type = "button";
  folderBrowse.className = "s-folder-browse";
  folderBrowse.setAttribute("aria-label", t(L, "browseFolder"));
  folderBrowse.title = t(L, "browseFolder");
  folderBrowse.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>';

  const pick = async (directory: boolean): Promise<void> => {
    try {
      const picked = await pickPath({
        directory,
        multiple: false,
        title: t(currentLanguage, directory ? "browseFolder" : "browseFile"),
      });
      if (typeof picked !== "string") return;
      value.value = picked;
      if (name.value.trim() === "") {
        name.value = picked.split(/[\\/]/).pop() ?? picked;
        localizeSettingsRow(row);
      }
      value.focus();
    } catch {
      // Dialog cancelled or unavailable: leave the row untouched.
    }
  };
  fileBrowse.addEventListener("click", () => void pick(false));
  folderBrowse.addEventListener("click", () => void pick(true));

  // The group picker rides the value line; its popover floats below the
  // trigger without pushing the rest of the card.
  const groupField = document.createElement("div");
  groupField.className = "s-group-field";
  buildGroupPicker(groupField, a.group ?? "");
  // Keep the collapsed face's group chip in step with the picker: any click
  // inside the field re-reads the trigger's committed value.
  groupField.addEventListener("click", () => {
    const gv = row.querySelector<HTMLElement>(".s-group-trigger")?.dataset.value ?? "";
    faceDot.hidden = gv === "";
    if (gv) faceDot.style.background = groupTriggerColor(gv);
  });

  // The browser executable is no longer edited in the UI, but a value set
  // in the config file must survive a save round-trip untouched.
  row.dataset.browser = a.browser ?? "";

  // Sequence steps editor: header (label + live count) + step list + dashed
  // "Add step" (same family as #actions-add, smaller). Spans the full card
  // width below the value line; hidden unless kind == sequence.
  const stepsWrap = document.createElement("div");
  stepsWrap.className = "s-steps";
  const stepsHead = document.createElement("div");
  stepsHead.className = "s-steps-head";
  const stepsTitle = document.createElement("span");
  stepsTitle.className = "s-steps-title";
  stepsTitle.textContent = t(L, "sequenceStepsLabel");
  const stepsCount = document.createElement("span");
  stepsCount.className = "s-steps-count";
  stepsHead.append(stepsTitle, stepsCount);
  const stepsList = document.createElement("div");
  stepsList.className = "s-steps-list";
  stepsList.setAttribute("role", "list");
  const stepsAdd = document.createElement("button");
  stepsAdd.type = "button";
  stepsAdd.className = "s-steps-add";
  const stepsAddIcon = document.createElement("span");
  stepsAddIcon.className = "a-add-icon";
  stepsAddIcon.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>';
  const stepsAddLabel = document.createElement("span");
  stepsAddLabel.className = "a-add-label";
  stepsAddLabel.textContent = t(L, "addStep");
  stepsAdd.append(stepsAddIcon, stepsAddLabel);
  stepsAdd.setAttribute("aria-label", t(L, "addStep"));
  stepsWrap.append(stepsHead, stepsList, stepsAdd);

  const addStep = (step?: SequenceStep, focusValue = false): void => {
    if (sequenceStepsOf(row).length >= MAX_SEQUENCE_STEPS) return;
    const el = buildSequenceStep(row, step);
    el.setAttribute("role", "listitem");
    stepsList.appendChild(el);
    // Localize the new step with its 1-based position.
    localizeSequenceStep(el, sequenceStepsOf(row).length);
    syncSequenceCount(row);
    if (focusValue) el.querySelector<HTMLInputElement>(".s-step-value")?.focus();
  };

  stepsAdd.addEventListener("click", () => {
    addStep(undefined, true);
    // The add button disables itself at 5; keep focus reachable.
    if (stepsAdd.disabled) stepsList.lastElementChild?.querySelector<HTMLInputElement>(".s-step-value")?.focus();
  });

  const syncKind = () => {
    const k = (parentKindTrigger()?.dataset.value ?? "url") as Action["kind"];
    faceIcon.innerHTML = KIND_ICONS[k];
    const isSeq = k === "sequence";
    row.classList.toggle("kind-sequence", isSeq);
    if (!isSeq) {
      value.placeholder = kindValuePlaceholder(k);
      browse.hidden = k !== "app";
      fileBrowse.hidden = k !== "file";
      folderBrowse.hidden = k !== "folder";
    } else {
      // Sequence runs on steps: the single value + its pickers retire.
      browse.hidden = true;
      fileBrowse.hidden = true;
      folderBrowse.hidden = true;
      // Guarantee at least one editable step when entering sequence mode.
      if (sequenceStepsOf(row).length === 0) addStep(undefined, false);
      syncSequenceCount(row);
    }
    row.classList.toggle("kind-app", k === "app");
    row.classList.toggle("kind-file", k === "file");
    row.classList.toggle("kind-folder", k === "folder");
  };

  // A real kind change invalidates the value: a URL, a shell command and an
  // app/file/folder path are incompatible, so keeping the old text would
  // offer stale data that fails or — worse — runs something unintended. The
  // name is the user's own label and is kept, as is the group assignment
  // (orthogonal categorization). The legacy per-URL browser is tied to the
  // old value, so it is dropped too. Entering `sequence` starts from one
  // empty step; leaving it keeps the steps in the DOM (hidden) so toggling
  // back restores them.
  kindPicker.addEventListener("kindchange", (e) => {
    const prev = (e as CustomEvent<{ previousKind: string }>).detail?.previousKind ?? "";
    const next = parentKindTrigger()?.dataset.value ?? "url";
    if (next === "sequence") {
      if (value.value !== "") {
        value.value = "";
        row.classList.remove("invalid");
      }
      row.dataset.browser = "";
      closeAppPickers();
      syncKind();
      // Focus the first step so the new mode is immediately typeable.
      stepsList.querySelector<HTMLInputElement>(".s-step-value")?.focus();
      return;
    }
    if (prev === "sequence") {
      // Leaving sequence: the single value starts empty (it was unused).
      row.dataset.browser = "";
      closeAppPickers();
      syncKind();
      return;
    }
    if (value.value !== "") {
      value.value = "";
      row.classList.remove("invalid");
    }
    row.dataset.browser = "";
    closeAppPickers();
    syncKind();
  });

  for (const field of [name, value]) {
    field.addEventListener("input", () => {
      row.classList.remove("invalid");
      if (field === name) localizeSettingsRow(row);
    });
  }

  const move = (delta: -1 | 1, control: HTMLButtonElement): void => {
    if (moveActionRow(row, delta)) {
      announceActionPosition(row);
      control.focus();
    }
  };
  up.addEventListener("click", () => move(-1, up));
  down.addEventListener("click", () => move(1, down));

  top.append(nameField, kindPicker);
  valueWrap.append(valueField, browse, fileBrowse, folderBrowse, groupField, del);
  bodyGrid.append(top, rail, valueWrap, stepsWrap);
  row.append(face, body);
  attachAppPicker(row, value, name);
  // Hydrate steps for sequences (cap + drop nesting like the backend); fresh
  // `url` rows start leaf-only.
  if (a.kind === "sequence") {
    const initial = (a.steps ?? []).slice(0, MAX_SEQUENCE_STEPS);
    if (initial.length === 0) {
      addStep(undefined, false);
    } else {
      for (const s of initial) {
        if (!SEQUENCE_STEP_KINDS.includes(s.kind as SequenceStepKind)) continue;
        addStep(s, false);
      }
      if (sequenceStepsOf(row).length === 0) addStep(undefined, false);
    }
  }
  syncKind();
  syncSequenceCount(row);
  return row;
}

function kindValuePlaceholder(kind: string): string {
  return t(
    currentLanguage,
    kind === "url"
      ? "valuePlaceholderUrl"
      : kind === "command"
        ? "valuePlaceholderCommand"
        : kind === "app"
          ? "valuePlaceholderApp"
          : kind === "file"
            ? "valuePlaceholderFile"
            : "valuePlaceholderFolder",
  );
}

/** Refresh the language-dependent bits of an existing row (no rebuild, so
 * the user's edits survive a language switch). */
function localizeSettingsRow(row: HTMLElement): void {
  const L = currentLanguage;
  const name = row.querySelector<HTMLInputElement>(".s-name")!;
  const value = row.querySelector<HTMLInputElement>(".s-value")!;
  const del = row.querySelector<HTMLButtonElement>(".s-del")!;
  const up = row.querySelector<HTMLButtonElement>(".s-move-up")!;
  const down = row.querySelector<HTMLButtonElement>(".s-move-down")!;
  row.setAttribute("aria-label", name.value.trim() || t(L, "namePlaceholder"));
  const face = row.querySelector<HTMLElement>(".s-face");
  if (face) face.setAttribute("aria-label", name.value.trim() || t(L, "namePlaceholder"));
  name.placeholder = t(L, "namePlaceholder");
  name.setAttribute("aria-label", t(L, "namePlaceholder"));
  const parentTrigger = row.querySelector<HTMLElement>(".settings-row-top .s-kind-trigger");
  const parentKind = (parentTrigger?.dataset.value ?? "url") as Action["kind"];
  for (const listbox of row.querySelectorAll<HTMLElement>(".s-kind-listbox")) {
    listbox.setAttribute("aria-label", t(L, "actionTypeLabel"));
  }
  // Refresh every kind option label (parent + steps) so a language switch
  // doesn't leave stale English behind until the next open.
  for (const option of row.querySelectorAll<HTMLElement>(".s-kind-option")) {
    const k = (option.dataset.value ?? "url") as Action["kind"];
    const label = option.querySelector<HTMLElement>(".s-kind-option-label");
    if (label && KIND_LABEL_KEYS[k]) label.textContent = t(L, KIND_LABEL_KEYS[k]);
  }
  if (parentKind !== "sequence") {
    value.placeholder = kindValuePlaceholder(parentKind);
  }
  value.setAttribute("aria-label", t(L, "actionValueLabel"));
  const groupTrigger = row.querySelector<HTMLElement>(".s-group-trigger");
  if (groupTrigger) {
    syncGroupTrigger(groupTrigger);
    row.querySelector<HTMLElement>(".s-group-picker")?.setAttribute(
      "aria-label",
      t(L, "groupSelectAria"),
    );
  }
  del.setAttribute(
    "aria-label",
    t(L, "deleteAction", { name: name.value || t(L, "namePlaceholder") }),
  );
  const actionName = name.value.trim() || t(L, "namePlaceholder");
  up.setAttribute("aria-label", t(L, "moveActionUp", { name: actionName }));
  down.setAttribute("aria-label", t(L, "moveActionDown", { name: actionName }));
  // Parent value-line browses (first match is the parent's; steps are handled below).
  const browse = row.querySelector<HTMLButtonElement>(".s-value-row .s-app-browse");
  if (browse) {
    browse.setAttribute("aria-label", t(L, "browseApps"));
    browse.title = t(L, "browseApps");
  }
  const fileBrowse = row.querySelector<HTMLButtonElement>(".s-value-row .s-file-browse");
  if (fileBrowse) {
    fileBrowse.setAttribute("aria-label", t(L, "browseFile"));
    fileBrowse.title = t(L, "browseFile");
  }
  const folderBrowse = row.querySelector<HTMLButtonElement>(".s-value-row .s-folder-browse");
  if (folderBrowse) {
    folderBrowse.setAttribute("aria-label", t(L, "browseFolder"));
    folderBrowse.title = t(L, "browseFolder");
  }
  const apSearch = row.querySelector<HTMLInputElement>(".ap-search");
  if (apSearch) apSearch.placeholder = t(L, "appSearchPlaceholder");
  // Sequence chrome + each step.
  const stepsTitle = row.querySelector<HTMLElement>(".s-steps-title");
  if (stepsTitle) stepsTitle.textContent = t(L, "sequenceStepsLabel");
  const stepsAddLabel = row.querySelector<HTMLElement>(".s-steps-add .a-add-label");
  if (stepsAddLabel) stepsAddLabel.textContent = t(L, "addStep");
  const stepsAdd = row.querySelector<HTMLButtonElement>(".s-steps-add");
  if (stepsAdd) stepsAdd.setAttribute("aria-label", t(L, "addStep"));
  sequenceStepsOf(row).forEach((step, i) => localizeSequenceStep(step, i + 1));
  syncSequenceCount(row);
}

function collectSettingsActions(): Action[] {
  const saved = collectGroupsFromRows();
  const out: Action[] = [];
  for (const row of actionsRows.querySelectorAll<HTMLElement>(".settings-row")) {
    const name = row.querySelector<HTMLInputElement>(".s-name")!.value.trim();
    const kind = (row.querySelector<HTMLElement>(".settings-row-top .s-kind-trigger")?.dataset.value ??
      row.querySelector<HTMLElement>(".s-kind-trigger")?.dataset.value ??
      "url") as Action["kind"];
    const value = row.querySelector<HTMLInputElement>(".s-value")!.value.trim();
    const browser = row.dataset.browser ?? "";
    const group = row.querySelector<HTMLElement>(".s-group-trigger")?.dataset.value ?? "";
    if (kind === "sequence") {
      const steps = collectSequenceSteps(row);
      const a: Action = { name, kind, value: "", steps };
      if (group && saved.some((g) => g.id === group)) a.group = group;
      out.push(a);
      continue;
    }
    const a: Action = { name, kind, value };
    if (kind === "url" && browser) a.browser = browser;
    if (group && saved.some((g) => g.id === group)) a.group = group;
    out.push(a);
  }
  return out;
}

async function saveSettings(): Promise<void> {
  const language = langDraft ?? savedLanguage;
  const theme = themeDraft ?? savedTheme;
  settingsError.textContent = "";
  settingsError.classList.remove("visible");
  settingsSave.disabled = true;
  try {
    if (settingsAutostart.checked !== autostartAtOpen) {
      if (settingsAutostart.checked) await enable();
      else await disable();
      autostartAtOpen = settingsAutostart.checked;
    }
    await invoke("save_config", {
      actions,
      groups,
      language: language === "system" ? null : language,
      magnify: settingsMagnify.checked,
      showIcons: settingsIcons.checked,
      theme: theme === "system" ? null : theme,
    });
    closeSettings();
  } catch (err) {
    settingsError.textContent = t(currentLanguage, "saveError", { msg: String(err) });
    settingsError.classList.add("visible");
    settingsSave.disabled = false;
  }
}

async function saveActions(): Promise<void> {
  let invalid = false;
  let sequenceInvalid = false;
  let groupError = false;
  actionsError.textContent = "";
  for (const row of actionsRows.querySelectorAll<HTMLElement>(".settings-row")) {
    const name = row.querySelector<HTMLInputElement>(".s-name")!.value.trim();
    const kind = (row.querySelector<HTMLElement>(".settings-row-top .s-kind-trigger")?.dataset.value ??
      "url") as Action["kind"];
    row.classList.remove("invalid");
    for (const st of row.querySelectorAll<HTMLElement>(".s-step")) st.classList.remove("invalid");
    if (kind === "sequence") {
      const steps = sequenceStepsOf(row);
      let runnable = 0;
      for (const st of steps) {
        const v = st.querySelector<HTMLInputElement>(".s-step-value")!.value.trim();
        if (v) runnable++;
        else st.classList.add("invalid");
      }
      const bad = name === "" || runnable === 0;
      row.classList.toggle("invalid", bad);
      if (bad) {
        sequenceInvalid = true;
        // Keep leaf `invalid` for the generic focus fallback too.
        invalid = true;
      }
      continue;
    }
    const value = row.querySelector<HTMLInputElement>(".s-value")!.value.trim();
    const bad = name === "" || value === "";
    row.classList.toggle("invalid", bad);
    if (bad) invalid = true;
  }
  for (const row of groupRows()) {
    const name = row.querySelector<HTMLInputElement>(".g-name")!.value.trim();
    const bad = name === "" || groupRowError(row) !== "";
    row.classList.toggle("invalid", bad);
    if (bad) groupError = true;
  }
  if (invalid) {
    setActionsTab("actions", false);
    // Prefer the sequence-specific hint when the only failures are sequences.
    const onlySequences = sequenceInvalid && [...actionsRows.querySelectorAll<HTMLElement>(".settings-row.invalid")].every((r) => {
      const k = (r.querySelector<HTMLElement>(".settings-row-top .s-kind-trigger")?.dataset.value ?? "url") as Action["kind"];
      return k === "sequence";
    });
    actionsError.textContent = t(
      currentLanguage,
      onlySequences ? "sequenceValidationError" : "saveValidationError",
    );
    const firstInvalid = actionsRows.querySelector<HTMLElement>(".settings-row.invalid");
    // Focus the first empty control: step value for sequences, name otherwise.
    const stepValue = firstInvalid?.querySelector<HTMLInputElement>(".s-step.invalid .s-step-value");
    if (stepValue) stepValue.focus();
    else actionsRows.querySelector<HTMLInputElement>(".settings-row.invalid .s-name")?.focus();
    return;
  }
  if (groupError) {
    setActionsTab("groups", false);
    actionsError.textContent = t(currentLanguage, "saveGroupsValidationError");
    actionsRows.querySelector<HTMLInputElement>(".group-row.invalid .g-name")?.focus();
    return;
  }
  actionsError.textContent = "";
  actionsSave.disabled = true;
  try {
    await invoke("save_config", {
      actions: collectSettingsActions(),
      groups: collectGroupsFromRows(),
      language: savedLanguage === "system" ? null : savedLanguage,
      magnify: magnifyEnabled,
      showIcons: iconsEnabled,
      theme: savedTheme === "system" ? null : savedTheme,
    });
    closeActions();
  } catch (err) {
    actionsError.textContent = t(currentLanguage, "saveError", { msg: String(err) });
    actionsSave.disabled = false;
  }
}

// ---------------------------------------------------------------- IPC wiring

interface ConfigPayload {
  actions: Action[];
  groups: Group[];
  language: string | null;
  magnify: boolean;
  showIcons: boolean;
  theme?: string | null;
}

function applyConfigPayload(cfg: ConfigPayload): void {
  actions = cfg.actions;
  groups = cfg.groups ?? [];
  savedLanguage = (cfg.language ?? "system") as StoredLanguage;
  magnifyEnabled = cfg.magnify;
  iconsEnabled = cfg.showIcons;
  savedTheme = normalizeTheme(cfg.theme ?? "system");
  themeDraft = null;
  syncIcons();
  applyLanguage();
}

async function init(): Promise<void> {
  await Promise.all([
    listen("overlay-open", () => {
      overlay.open();
      queryText = "";
      input.value = "";
      runError.classList.remove("visible");
      showQuery();
      refilter();
      root.classList.add("open");
      ensureLoop();
      input.focus();
      // A deferred "next open" install takes over the open: no prompt.
      if (shouldAutoInstallOnOpen()) {
        void installUpdate();
        return;
      }
      // An install started earlier keeps showing its progress.
      if (
        (updatePhase === "downloading" || updatePhase === "installing") &&
        pendingUpdate
      ) {
        openUpdatePopupForProgress();
        return;
      }
      void checkForUpdate();
    }),
    listen("overlay-close", () => {
      closePanels();
      closeUpdatePopup();
      overlay.close();
      root.classList.remove("open");
      ensureLoop();
    }),
    listen<ConfigPayload>("config-reloaded", (event: { payload: ConfigPayload }) => {
      applyConfigPayload(event.payload);
      if (actionsOpen) rebuildActionsRows();
      else refilter();
    }),
  ]);

  const cfg = await invoke<ConfigPayload>("get_config");
  applyConfigPayload(cfg);
  refilter();

  getVersion()
    .then((version) => {
      appVersion = version;
      syncVersionLine();
    })
    .catch(() => {});

  // Tell Rust the overlay-open listener is registered, so the first show
  // (which can now happen right after a lazy window creation) is never
  // missed. See the quickspot-webview-ready listener in lib.rs.
  await emit("quickspot-webview-ready");
}

void init();
