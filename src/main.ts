import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  CENTER_X,
  CHIP_H,
  CHIP_W,
  GROUP_PALETTE,
  GRIP_H,
  GRIP_W,
  GRIP_Y,
  HUB_Y,
  MAX_FINAL_SCALE,
  MAX_VISIBLE,
  MINIMIZE_Y,
  RUN_ERROR_MS,
  STAGGER_FRAC,
} from "./lib/constants";
import {
  chipCenter,
  dockScale,
  easeOutCubic,
  easeOutQuart,
  staggeredProgress,
} from "./lib/easing";
import {
  resolveLanguage,
  t,
  type DictKey,
  type Language,
  type StoredLanguage,
} from "./lib/i18n";
import {
  capUtf8Bytes,
  filterActions,
  isHexColor,
  isReadableOnDark,
  moveSelection,
  uniqueGroupId,
  type Action,
  type Group,
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
let mouseX = 0;
let mouseY = 0;

let savedLanguage: StoredLanguage = "system";
let langDraft: StoredLanguage | null = null;
let currentLanguage: Language = resolveLanguage(savedLanguage);
let magnifyEnabled = true;

const root = document.querySelector<HTMLElement>("#overlay")!;
const disc = document.querySelector<HTMLElement>("#disc")!;
const hub = document.querySelector<HTMLButtonElement>("#hub")!;
const minimize = document.querySelector<HTMLButtonElement>("#minimize")!;
const grip = document.querySelector<HTMLElement>("#grip")!;
const input = document.querySelector<HTMLInputElement>("#query")!;
const queryWrap = document.querySelector<HTMLElement>("#query-wrap")!;
const mirror = document.querySelector<HTMLElement>("#query-mirror")!;
const chipsHost = document.querySelector<HTMLElement>("#chips")!;
const emptyState = document.querySelector<HTMLElement>("#empty-state")!;
const runError = document.querySelector<HTMLElement>("#run-error")!;
let runErrorTimer = 0;

const settingsPanel = document.querySelector<HTMLElement>("#settings")!;
const settingsTitle = document.querySelector<HTMLElement>("#settings-title")!;
const settingsLanguageLabel = document.querySelector<HTMLElement>("#settings-language-label")!;
const settingsDockLabel = document.querySelector<HTMLElement>("#settings-dock-label")!;
const settingsMagnify = document.querySelector<HTMLInputElement>("#settings-magnify")!;
const langSelect = document.querySelector<HTMLSelectElement>("#settings-lang")!;
const settingsRows = document.querySelector<HTMLElement>("#settings-rows")!;
const settingsError = document.querySelector<HTMLElement>("#settings-error")!;
const settingsAdd = document.querySelector<HTMLButtonElement>("#settings-add")!;
const settingsSave = document.querySelector<HTMLButtonElement>("#settings-save")!;
const settingsDone = document.querySelector<HTMLButtonElement>("#settings-done")!;

let uiScale = 1;

function syncUiScale(): void {
  uiScale = Math.max(0.5, Math.min(1, window.innerWidth / 520, window.innerHeight / 580));
  root.style.setProperty("--overlay-scale", String(uiScale));
}

syncUiScale();
window.addEventListener("resize", syncUiScale);

const chips: HTMLButtonElement[] = [];
const chipLabels: HTMLElement[] = [];
const chipIcons: HTMLElement[] = [];

const KIND_ICONS: Record<Action["kind"], string> = {
  url: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  command:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
  app: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/></svg>',
};

const KIND_LABEL_KEYS: Record<Action["kind"], DictKey> = {
  url: "kindUrl",
  command: "kindCommand",
  app: "kindApp",
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
  mirror.textContent = queryText.length > 0 ? queryText : t(currentLanguage, "placeholder");
  mirror.classList.toggle("dim", queryText.length === 0);
  queryWrap.classList.toggle("active", queryText.length > 0);
  input.value = queryText;
}

/** Briefly display an execution error near the query line, then fade it. */
function showRunError(msg: string): void {
  const el = runError;
  el.textContent = t(currentLanguage, "runError", { msg });
  el.classList.add("visible");
  window.clearTimeout(runErrorTimer);
  runErrorTimer = window.setTimeout(() => el.classList.remove("visible"), RUN_ERROR_MS);
}

/** Recomputed the effective language and re-renders every UI string. */
function applyLanguage(): void {
  currentLanguage = resolveLanguage(langDraft ?? savedLanguage);
  localizeAll();
}

function localizeAll(): void {
  const L = currentLanguage;
  document.documentElement.lang = L;
  showQuery();
  if (queryText.length > 0 && filtered.length === 0) emptyState.textContent = t(L, "noMatches");
  input.setAttribute("aria-label", t(L, "searchAria"));
  chipsHost.setAttribute("aria-label", t(L, "actionsAria"));
  hub.setAttribute("aria-label", t(L, "settingsAria"));
  grip.setAttribute("aria-label", t(L, "dragAria"));
  minimize.setAttribute("aria-label", t(L, "minimize"));
  settingsTitle.textContent = t(L, "settingsTitle");
  settingsPanel.setAttribute("aria-label", t(L, "settingsTitle"));
  settingsLanguageLabel.textContent = t(L, "languageLabel");
  settingsDockLabel.textContent = t(L, "magnifyLabel");
  settingsMagnify.setAttribute("aria-label", t(L, "magnifyLabel"));
  langSelect.setAttribute("aria-label", t(L, "languageLabel"));
  langSelect.options[0].textContent = t(L, "languageSystem");
  settingsDone.textContent = t(L, "done");
  settingsDone.setAttribute("aria-label", t(L, "done"));
  settingsAdd.textContent = t(L, "addAction");
  settingsSave.textContent = t(L, "save");
  settingsError.textContent = "";
  for (const row of settingsRows.querySelectorAll<HTMLElement>(".settings-row")) {
    localizeSettingsRow(row);
  }
  localizeGroupsEditor();
}

function refilter(): void {
  filtered = filterActions(actions, queryText);
  selected = filtered.length > 0 ? 0 : -1;
  syncChips();
}

/** The group of an action by config id, or undefined when unset/unknown. */
function actionGroup(action: Action): Group | undefined {
  if (!action.group) return undefined;
  return groups.find((g) => g.id === action.group);
}

function syncChips(): void {
  emptyState.textContent =
    queryText.length > 0 && filtered.length === 0 ? t(currentLanguage, "noMatches") : "";
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
    el.tabIndex = settingsOpen ? -1 : 0;
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
    const scale = Math.min(hoverScale, MAX_FINAL_SCALE);
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
  hub.style.transform = `translate(${CENTER_X}px, ${HUB_Y}px) translateX(-50%) scale(${hubScale})`;
  hub.style.opacity = String(easeOutQuart(dp));

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

  emptyState.classList.toggle("visible", dp >= 0.85 && count === 0 && queryText.length > 0);

  const enabled = dp >= 0.05;
  const pe = enabled ? "auto" : "none";
  hub.style.pointerEvents = pe;
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
      input.focus();
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
  queryText = input.value;
  showQuery();
  refilter();
});

input.addEventListener("keydown", (e) => {
  const key = e.key;
  if (key === "Escape") {
    e.preventDefault();
    if (settingsOpen) {
      closeSettings();
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

settingsDone.addEventListener("click", () => closeSettings());

settingsRows.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (target.closest(".app-picker") || target.closest(".s-app-browse")) return;
  if (target.closest(".g-picker") || target.closest(".g-swatch")) return;
  closeAppPickers();
  closeGroupPickers();
});

settingsAdd.addEventListener("click", () => {
  const row = buildSettingsRow({ name: "", kind: "url", value: "" });
  settingsRows.appendChild(row);
  row.querySelector<HTMLInputElement>(".s-name")?.focus();
});

settingsSave.addEventListener("click", () => {
  void saveSettings();
});

langSelect.addEventListener("change", () => {
  langDraft = langSelect.value as StoredLanguage;
  applyLanguage();
});

document.addEventListener("keydown", (e) => {
  if (!settingsOpen) return;
  if (e.key === "Escape") {
    e.preventDefault();
    closeSettings();
  }
});

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

root.addEventListener("pointermove", (e) => {
  mouseX = e.clientX / uiScale;
  mouseY = e.clientY / uiScale;
  // Hover selects (Spotlight-style): the highlight follows the cursor so the
  // first chip stops being permanently highlighted once the user points
  // anywhere else. Keyboard navigation keeps working via `selected`.
  const hovered = overlay.phase === "visible" && !settingsOpen ? chipAtPointer() : -1;
  if (hovered >= 0) {
    selectionSource = "mouse";
    if (hovered !== selected) {
      selected = hovered;
      syncChips();
    } else {
      applyChipTransforms();
    }
  } else if (overlay.phase === "visible" && !settingsOpen) {
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
  const localX = e.clientX / uiScale;
  const localY = e.clientY / uiScale;
  const onGrip =
    Math.abs(localX - CENTER_X) <= GRIP_W / 2 &&
    localY >= GRIP_Y &&
    localY <= GRIP_Y + GRIP_H;
  grip.classList.toggle("hover", onGrip);
});

// Leave the window -> drop the magnification back to rest and release a
// mouse-driven highlight, so no chip stays "hovered" with the cursor gone.
root.addEventListener("pointerleave", () => {
  mouseX = -1;
  mouseY = -1;
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
  if (!settingsOpen) input.focus();
});

// ---------------------------------------------------------------- settings

let settingsOpen = false;

function openSettings(): void {
  if (settingsOpen || overlay.phase !== "visible") return;
  settingsOpen = true;
  settingsError.textContent = "";
  settingsSave.disabled = false;
  langSelect.value = langDraft ?? savedLanguage;
  settingsMagnify.checked = magnifyEnabled;
  rebuildSettingsRows();
  for (const chip of chips) chip.tabIndex = -1;
  root.classList.add("settings");
  settingsPanel.classList.add("open");
  settingsPanel.setAttribute("aria-hidden", "false");
  input.blur();
  settingsRows.querySelector<HTMLInputElement>(".s-name")?.focus();
}

function closeSettings(): void {
  if (!settingsOpen) return;
  settingsOpen = false;
  closeAppPickers();
  closeGroupPickers();
  langDraft = null;
  applyLanguage();
  settingsPanel.classList.remove("open");
  settingsPanel.setAttribute("aria-hidden", "true");
  root.classList.remove("settings");
  refilter();
  if (overlay.phase === "visible") input.focus();
}

function rebuildSettingsRows(): void {
  settingsRows.textContent = "";
  rebuildGroupsEditor();
  for (const a of actions) settingsRows.appendChild(buildSettingsRow(a));
  settingsAdd.hidden = false;
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
  const q = query.toLowerCase();
  const out: InstalledApp[] = [];
  for (const app of apps) {
    if (q.length === 0 || app.name.toLowerCase().includes(q)) out.push(app);
    if (out.length >= 200) break;
  }
  return out;
}

function renderAppList(list: HTMLElement, apps: InstalledApp[]): void {
  list.textContent = "";
  if (apps.length === 0) {
    const empty = document.createElement("div");
    empty.className = "ap-empty";
    empty.textContent = t(currentLanguage, "noAppsFound");
    list.appendChild(empty);
    return;
  }
  for (const app of apps) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "ap-item";
    item.setAttribute("role", "option");
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
  }
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

function attachAppPicker(row: HTMLElement, value: HTMLInputElement, name: HTMLInputElement): void {
  const picker = document.createElement("div");
  picker.className = "app-picker";
  picker.hidden = true;

  const search = document.createElement("input");
  search.type = "text";
  search.className = "ap-search";
  search.placeholder = t(currentLanguage, "appSearchPlaceholder");

  const list = document.createElement("div");
  list.className = "ap-list";
  list.setAttribute("role", "listbox");

  const browse = row.querySelector<HTMLButtonElement>(".s-app-browse")!;
  browse.setAttribute("aria-haspopup", "listbox");
  browse.setAttribute("aria-expanded", "false");
  browse.addEventListener("click", () => {
    if (!picker.hidden) {
      picker.hidden = true;
      browse.setAttribute("aria-expanded", "false");
      return;
    }
    closeAppPickers(picker);
    picker.hidden = false;
    browse.setAttribute("aria-expanded", "true");
    search.value = "";
    search.setAttribute("aria-label", t(currentLanguage, "appSearchPlaceholder"));
    renderAppList(list, []);
    search.focus();
    void getInstalledApps().then((apps) => renderAppList(list, filterApps(apps, "")));
  });

  search.addEventListener("input", () => {
    void getInstalledApps().then((apps) => renderAppList(list, filterApps(apps, search.value)));
  });

  list.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>(".ap-item");
    if (!item) return;
    value.value = item.dataset.value ?? "";
    if (name.value.trim() === "") name.value = item.dataset.name ?? "";
    picker.hidden = true;
    browse.setAttribute("aria-expanded", "false");
    value.focus();
  });

  picker.append(search, list);
  row.appendChild(picker);
}

// ----------------------------------------------------------- groups editor

function groupRows(): HTMLElement[] {
  return [...settingsRows.querySelectorAll<HTMLElement>(".group-row")];
}

function closeGroupPickers(except?: HTMLElement): void {
  for (const picker of settingsRows.querySelectorAll<HTMLElement>(".g-picker")) {
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
  name.placeholder = t(L, "groupNamePlaceholder");
  name.setAttribute("aria-label", t(L, "groupNamePlaceholder"));
  swatch.setAttribute("aria-label", t(L, "groupColorAria", { name: label }));
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

  const swatch = document.createElement("button");
  swatch.type = "button";
  swatch.className = "g-swatch";
  swatch.setAttribute("aria-haspopup", "true");
  swatch.setAttribute("aria-expanded", "false");
  const fill = document.createElement("span");
  fill.className = "g-swatch-fill";
  swatch.appendChild(fill);

  const picker = document.createElement("div");
  picker.className = "g-picker";
  picker.hidden = true;

  const grid = document.createElement("div");
  grid.className = "gp-grid";
  for (const c of GROUP_PALETTE) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "gp-item";
    item.dataset.color = c;
    item.setAttribute("aria-label", c);
    item.style.background = c;
    grid.appendChild(item);
  }

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
  del.textContent = "\u2715";

  row.append(nameInput, swatch, picker, del);
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
      for (const sel of settingsRows.querySelectorAll<HTMLSelectElement>(".s-group")) {
        const opt = [...sel.options].find((o) => o.value === oldId);
        if (opt) opt.value = row.dataset.id ?? "";
      }
    }
    for (const sel of settingsRows.querySelectorAll<HTMLSelectElement>(".s-group")) {
      const opt = [...sel.options].find((o) => o.value === row.dataset.id);
      if (opt) opt.textContent = nameInput.value.trim();
    }
  });

  swatch.addEventListener("click", () => {
    if (picker.hidden) {
      closeGroupPickers(picker);
      picker.hidden = false;
      swatch.setAttribute("aria-expanded", "true");
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
    picker.hidden = true;
    swatch.setAttribute("aria-expanded", "false");
    swatch.focus();
  });

  hex.addEventListener("input", () => {
    row.classList.remove("invalid");
    refreshGroupRow(row);
  });

  del.addEventListener("click", () => {
    closeGroupPickers();
    const id = row.dataset.id;
    row.remove();
    for (const sel of settingsRows.querySelectorAll<HTMLSelectElement>(".s-group")) {
      const opt = [...sel.options].find((o) => o.value === id);
      if (opt) opt.remove();
    }
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

/** Rebuild the option list of an action row's group select. */
function rebuildGroupOptions(sel: HTMLSelectElement): void {
  const prev = sel.value;
  sel.textContent = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = t(currentLanguage, "noGroup");
  sel.appendChild(none);
  for (const row of groupRows()) {
    const opt = document.createElement("option");
    opt.value = row.dataset.id ?? "";
    opt.textContent = row.querySelector<HTMLInputElement>(".g-name")!.value.trim();
    sel.appendChild(opt);
  }
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

/** The groups block at the top of the settings list (scrolls with actions). */
function rebuildGroupsEditor(): void {
  const block = document.createElement("div");
  block.className = "settings-groups";

  const header = document.createElement("div");
  header.className = "settings-groups-header";
  const title = document.createElement("span");
  title.className = "settings-groups-title";
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
  settingsRows.prepend(block);

  add.addEventListener("click", () => {
    const id = uniqueGroupId(collectGroupsFromRows(), "");
    const row = buildGroupRow(id, "", GROUP_PALETTE[0], true);
    list.appendChild(row);
    for (const sel of settingsRows.querySelectorAll<HTMLSelectElement>(".s-group")) {
      rebuildGroupOptions(sel);
    }
    row.querySelector<HTMLInputElement>(".g-name")?.focus();
  });
}

function localizeGroupsEditor(): void {
  const L = currentLanguage;
  const title = settingsRows.querySelector<HTMLElement>(".settings-groups-title");
  const add = settingsRows.querySelector<HTMLButtonElement>(".g-add");
  if (title) title.textContent = t(L, "groupsLabel");
  if (add) add.textContent = t(L, "addGroup");
  for (const row of groupRows()) localizeGroupRow(row);
}

function buildSettingsRow(a: Action): HTMLElement {
  const L = currentLanguage;
  const row = document.createElement("div");
  row.className = "settings-row";

  const top = document.createElement("div");
  top.className = "settings-row-top";

  const name = document.createElement("input");
  name.type = "text";
  name.className = "s-name";
  name.value = a.name;
  name.placeholder = t(L, "namePlaceholder");
  name.setAttribute("aria-label", t(L, "namePlaceholder"));

  const kind = document.createElement("select");
  kind.className = "s-kind";
  kind.setAttribute("aria-label", t(L, KIND_LABEL_KEYS[a.kind]));
  for (const k of ["url", "command", "app"] as const) {
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = t(L, KIND_LABEL_KEYS[k]);
    kind.appendChild(opt);
  }
  kind.value = a.kind;

  const del = document.createElement("button");
  del.type = "button";
  del.className = "s-del";
  del.setAttribute(
    "aria-label",
    t(L, "deleteAction", { name: a.name || t(L, "namePlaceholder") }),
  );
  del.textContent = "\u2715";
  del.addEventListener("click", () => row.remove());

  const value = document.createElement("input");
  value.type = "text";
  value.className = "s-value";
  value.value = a.value;
  value.setAttribute("aria-label", t(L, KIND_LABEL_KEYS[a.kind]));

  const valueWrap = document.createElement("div");
  valueWrap.className = "s-value-row";

  const groupSel = document.createElement("select");
  groupSel.className = "s-group";
  groupSel.setAttribute("aria-label", t(L, "groupSelectAria"));
  rebuildGroupOptions(groupSel);
  groupSel.value = a.group ?? "";

  const browse = document.createElement("button");
  browse.type = "button";
  browse.className = "s-app-browse";
  browse.textContent = t(L, "browseApps");

  const browser = document.createElement("input");
  browser.type = "text";
  browser.className = "s-browser";
  browser.value = a.browser ?? "";
  browser.placeholder = t(L, "browserPlaceholder");
  browser.setAttribute("aria-label", t(L, "browserPlaceholder"));

  const syncKind = () => {
    value.placeholder = kindValuePlaceholder(kind.value);
    value.setAttribute("aria-label", t(L, KIND_LABEL_KEYS[kind.value as Action["kind"]]));
    browser.hidden = true;
    browse.hidden = kind.value !== "app";
    row.classList.toggle("kind-app", kind.value === "app");
  };
  kind.addEventListener("change", syncKind);
  syncKind();
  for (const field of [name, value]) {
    field.addEventListener("input", () => row.classList.remove("invalid"));
  }

  top.append(name, kind, del);
  valueWrap.append(value, groupSel, browse);
  row.append(top, valueWrap, browser);
  attachAppPicker(row, value, name);
  return row;
}

function kindValuePlaceholder(kind: string): string {
  return t(
    currentLanguage,
    kind === "url"
      ? "valuePlaceholderUrl"
      : kind === "command"
        ? "valuePlaceholderCommand"
        : "valuePlaceholderApp",
  );
}

/** Refresh the language-dependent bits of an existing row (no rebuild, so
 * the user's edits survive a language switch). */
function localizeSettingsRow(row: HTMLElement): void {
  const L = currentLanguage;
  const name = row.querySelector<HTMLInputElement>(".s-name")!;
  const value = row.querySelector<HTMLInputElement>(".s-value")!;
  const browser = row.querySelector<HTMLInputElement>(".s-browser")!;
  const del = row.querySelector<HTMLButtonElement>(".s-del")!;
  name.placeholder = t(L, "namePlaceholder");
  name.setAttribute("aria-label", t(L, "namePlaceholder"));
  const kind = row.querySelector<HTMLSelectElement>(".s-kind");
  if (kind) {
    kind.setAttribute("aria-label", t(L, KIND_LABEL_KEYS[kind.value as Action["kind"]]));
    for (const opt of Array.from(kind.options)) {
      opt.textContent = t(L, KIND_LABEL_KEYS[opt.value as Action["kind"]]);
    }
  }
  value.placeholder = kindValuePlaceholder(kind?.value ?? "url");
  value.setAttribute(
    "aria-label",
    t(L, KIND_LABEL_KEYS[(kind?.value ?? "url") as Action["kind"]]),
  );
  const groupSel = row.querySelector<HTMLSelectElement>(".s-group");
  if (groupSel) {
    groupSel.setAttribute("aria-label", t(L, "groupSelectAria"));
    const none = groupSel.options[0];
    if (none) none.textContent = t(L, "noGroup");
  }
  browser.placeholder = t(L, "browserPlaceholder");
  browser.setAttribute("aria-label", t(L, "browserPlaceholder"));
  del.setAttribute(
    "aria-label",
    t(L, "deleteAction", { name: name.value || t(L, "namePlaceholder") }),
  );
  const browse = row.querySelector<HTMLButtonElement>(".s-app-browse");
  if (browse) browse.textContent = t(L, "browseApps");
  const apSearch = row.querySelector<HTMLInputElement>(".ap-search");
  if (apSearch) apSearch.placeholder = t(L, "appSearchPlaceholder");
}

function collectSettingsActions(): Action[] {
  const saved = collectGroupsFromRows();
  const out: Action[] = [];
  for (const row of settingsRows.querySelectorAll<HTMLElement>(".settings-row")) {
    const name = row.querySelector<HTMLInputElement>(".s-name")!.value.trim();
    const kind = row.querySelector<HTMLSelectElement>(".s-kind")!.value as Action["kind"];
    const value = row.querySelector<HTMLInputElement>(".s-value")!.value.trim();
    const browser = row.querySelector<HTMLInputElement>(".s-browser")!.value.trim();
    const group = row.querySelector<HTMLSelectElement>(".s-group")!.value;
    const a: Action = { name, kind, value };
    if (kind === "url" && browser) a.browser = browser;
    if (group && saved.some((g) => g.id === group)) a.group = group;
    out.push(a);
  }
  return out;
}

async function saveSettings(): Promise<void> {
  const language = langDraft ?? savedLanguage;
  let invalid = false;
  let groupError = false;
  for (const row of settingsRows.querySelectorAll<HTMLElement>(".settings-row")) {
    const name = row.querySelector<HTMLInputElement>(".s-name")!.value.trim();
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
  if (groupError) {
    settingsError.textContent = t(currentLanguage, "saveGroupsValidationError");
    return;
  }
  if (invalid) {
    settingsError.textContent = t(currentLanguage, "saveValidationError");
    return;
  }
  settingsError.textContent = "";
  settingsSave.disabled = true;
  try {
    await invoke("save_config", {
      actions: collectSettingsActions(),
      groups: collectGroupsFromRows(),
      language: language === "system" ? null : language,
      magnify: settingsMagnify.checked,
    });
    closeSettings();
  } catch (err) {
    settingsError.textContent = t(currentLanguage, "saveError", { msg: String(err) });
    settingsSave.disabled = false;
  }
}

// ---------------------------------------------------------------- IPC wiring

interface ConfigPayload {
  actions: Action[];
  groups: Group[];
  language: string | null;
  magnify: boolean;
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
    }),
    listen("overlay-close", () => {
      closeSettings();
      overlay.close();
      root.classList.remove("open");
      ensureLoop();
    }),
    listen<ConfigPayload>("config-reloaded", (event: { payload: ConfigPayload }) => {
      actions = event.payload.actions;
      groups = event.payload.groups ?? [];
      savedLanguage = (event.payload.language ?? "system") as StoredLanguage;
      magnifyEnabled = event.payload.magnify;
      applyLanguage();
      if (settingsOpen) rebuildSettingsRows();
      else refilter();
    }),
  ]);

  const cfg = await invoke<ConfigPayload>("get_config");
  actions = cfg.actions;
  groups = cfg.groups ?? [];
  savedLanguage = (cfg.language ?? "system") as StoredLanguage;
  magnifyEnabled = cfg.magnify;
  applyLanguage();
  refilter();
}

void init();
