import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import {
  ADD_X,
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
let autostartAtOpen = false;

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
const runError = document.querySelector<HTMLElement>("#run-error")!;
let runErrorTimer = 0;

const settingsPanel = document.querySelector<HTMLElement>("#settings")!;
const settingsTitle = document.querySelector<HTMLElement>("#settings-title")!;
const settingsClose = document.querySelector<HTMLButtonElement>("#settings-close")!;
const settingsLanguageLabel = document.querySelector<HTMLElement>("#settings-language-label")!;
const settingsDockLabel = document.querySelector<HTMLElement>("#settings-dock-label")!;
const settingsMagnify = document.querySelector<HTMLInputElement>("#settings-magnify")!;
const settingsAutostart = document.querySelector<HTMLInputElement>("#settings-autostart")!;
const settingsAutostartLabel = document.querySelector<HTMLElement>("#settings-autostart-label")!;
const langSelect = document.querySelector<HTMLSelectElement>("#settings-lang")!;
const settingsError = document.querySelector<HTMLElement>("#settings-error")!;
const settingsSave = document.querySelector<HTMLButtonElement>("#settings-save")!;

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
  addBtn.setAttribute("aria-label", t(L, "addActions"));
  grip.setAttribute("aria-label", t(L, "dragAria"));
  minimize.setAttribute("aria-label", t(L, "minimize"));
  settingsTitle.textContent = t(L, "settingsTitle");
  settingsPanel.setAttribute("aria-label", t(L, "settingsTitle"));
  settingsClose.setAttribute("aria-label", t(L, "close"));
  settingsLanguageLabel.textContent = t(L, "languageLabel");
  settingsDockLabel.textContent = t(L, "magnifyLabel");
  settingsMagnify.setAttribute("aria-label", t(L, "magnifyLabel"));
  settingsAutostartLabel.textContent = t(L, "autostartLabel");
  settingsAutostart.setAttribute("aria-label", t(L, "autostartLabel"));
  langSelect.setAttribute("aria-label", t(L, "languageLabel"));
  langSelect.options[0].textContent = t(L, "languageSystem");
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
  const generalHeading = document.querySelector<HTMLElement>("#settings-general-heading");
  if (generalHeading) generalHeading.textContent = t(L, "generalLabel");
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

  emptyState.classList.toggle("visible", dp >= 0.85 && count === 0 && queryText.length > 0);

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
// app/group pickers, so only it needs the listener.
actionsRows.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (target.closest(".app-picker") || target.closest(".s-app-browse")) return;
  if (target.closest(".g-picker") || target.closest(".g-swatch")) return;
  closeAppPickers();
  closeGroupPickers();
});

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

document.addEventListener("keydown", (e) => {
  if (!settingsOpen && !actionsOpen) return;
  if (e.key === "Escape") {
    e.preventDefault();
    closePanels();
  }
});

// Focus trap: Tab cycles inside the panel instead of escaping to the
// (invisible) overlay controls or the webview chrome.
for (const panel of [settingsPanel, actionsPanel]) {
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
  if (!panelOpen()) input.focus();
});

// ---------------------------------------------------------------- panels

let settingsOpen = false;
let actionsOpen = false;

/** Whether any panel (settings or actions) is currently open. */
function panelOpen(): boolean {
  return settingsOpen || actionsOpen;
}

/** Close whichever panel is open (never both: they are mutually exclusive). */
function closePanels(): void {
  if (settingsOpen) closeSettings();
  else if (actionsOpen) closeActions();
}

function openSettings(): void {
  if (settingsOpen || overlay.phase !== "visible") return;
  if (actionsOpen) closeActions();
  settingsOpen = true;
  settingsError.textContent = "";
  settingsError.classList.remove("visible");
  settingsSave.disabled = false;
  langSelect.value = langDraft ?? savedLanguage;
  settingsMagnify.checked = magnifyEnabled;
  settingsAutostart.checked = autostartAtOpen;
  void isEnabled()
    .then((on) => {
      if (settingsOpen) {
        autostartAtOpen = on;
        settingsAutostart.checked = on;
      }
    })
    .catch(() => {});
  focusPanel(settingsPanel);
  settingsPanel.querySelector<HTMLElement>("#settings-lang")?.focus();
}

function openActions(): void {
  if (actionsOpen || overlay.phase !== "visible") return;
  if (settingsOpen) closeSettings();
  actionsOpen = true;
  actionsError.textContent = "";
  actionsStatus.textContent = "";
  actionsSave.disabled = false;
  activeActionsTab = "actions";
  rebuildActionsRows();
  focusPanel(actionsPanel);
  actionsRows.querySelector<HTMLInputElement>(".s-name")?.focus();
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
}

function closeSettings(): void {
  if (!settingsOpen) return;
  settingsOpen = false;
  langDraft = null;
  applyLanguage();
  settingsPanel.classList.remove("open");
  settingsPanel.setAttribute("aria-hidden", "true");
  releasePanel();
  refilter();
  if (overlay.phase === "visible") input.focus();
}

function closeActions(): void {
  if (!actionsOpen) return;
  actionsOpen = false;
  actionsStatus.textContent = "";
  closeAppPickers();
  closeGroupPickers();
  actionsPanel.classList.remove("open");
  actionsPanel.setAttribute("aria-hidden", "true");
  releasePanel();
  refilter();
  if (overlay.phase === "visible") input.focus();
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
  const add = document.createElement("button");
  add.type = "button";
  add.id = "actions-add";
  add.textContent = t(currentLanguage, "addAction");
  header.append(title, count, group, add);

  const help = document.createElement("p");
  help.className = "settings-actions-help";
  help.textContent = t(currentLanguage, "reorderHint");

  const list = document.createElement("div");
  list.className = "settings-actions-list";
  list.setAttribute("role", "list");
  const hint = document.createElement("div");
  hint.className = "settings-actions-empty";
  hint.hidden = true;

  block.append(header, help, list, hint);
  actionsAdd = add;

  group.addEventListener("click", () => {
    groupActionRows();
    group.focus();
  });

  add.addEventListener("click", () => {
    const row = buildSettingsRow({ name: "", kind: "url", value: "" });
    list.appendChild(row);
    afterActionsChanged();
    row.querySelector<HTMLInputElement>(".s-name")?.focus();
  });

  for (const a of actions) list.appendChild(buildSettingsRow(a));
  afterActionsChanged();
  setActionsTab("actions", false);
  localizeActionsSection();
}

/** Keep the actions list header count, empty hint and add button in sync. */
function afterActionsChanged(): void {
  const list = actionsRows.querySelector<HTMLElement>(".settings-actions-list");
  const hint = actionsRows.querySelector<HTMLElement>(".settings-actions-empty");
  if (!list) return;
  if (hint) hint.hidden = list.querySelectorAll(".settings-row").length > 0;
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
  const hint = actionsRows.querySelector<HTMLElement>(".settings-actions-empty");
  if (hint) hint.textContent = t(L, "noActions");
  const help = actionsRows.querySelector<HTMLElement>(".settings-actions-help");
  if (help) help.textContent = t(L, "reorderHint");
  const group = actionsRows.querySelector<HTMLElement>("#actions-group");
  if (group) group.textContent = t(L, "groupActions");
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
    const group = row.querySelector<HTMLSelectElement>(".s-group")!.value;
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
  const q = query.toLowerCase();
  const out: InstalledApp[] = [];
  for (const app of apps) {
    if (q.length === 0 || app.name.toLowerCase().includes(q)) out.push(app);
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
  row.appendChild(picker);
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
      for (const sel of actionsRows.querySelectorAll<HTMLSelectElement>(".s-group")) {
        const opt = [...sel.options].find((o) => o.value === oldId);
        if (opt) opt.value = row.dataset.id ?? "";
      }
    }
    for (const sel of actionsRows.querySelectorAll<HTMLSelectElement>(".s-group")) {
      const opt = [...sel.options].find((o) => o.value === row.dataset.id);
      if (opt) opt.textContent = nameInput.value.trim();
    }
  });

  swatch.addEventListener("click", () => {
    if (picker.hidden) {
      closeGroupPickers(picker);
      picker.hidden = false;
      swatch.setAttribute("aria-expanded", "true");
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
    for (const sel of actionsRows.querySelectorAll<HTMLSelectElement>(".s-group")) {
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
    for (const sel of actionsRows.querySelectorAll<HTMLSelectElement>(".s-group")) {
      rebuildGroupOptions(sel);
    }
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

function buildSettingsRow(a: Action): HTMLElement {
  const L = currentLanguage;
  const row = document.createElement("div");
  row.className = "settings-row";
  row.setAttribute("role", "listitem");
  row.setAttribute("aria-label", a.name || t(L, "namePlaceholder"));

  const top = document.createElement("div");
  top.className = "settings-row-top";

  const name = document.createElement("input");
  name.type = "text";
  name.className = "s-name";
  name.value = a.name;
  name.placeholder = t(L, "namePlaceholder");
  name.setAttribute("aria-label", t(L, "namePlaceholder"));
  const nameField = document.createElement("label");
  nameField.className = "action-field s-name-field";
  const nameLabel = document.createElement("span");
  nameLabel.className = "field-label s-name-label";
  nameLabel.textContent = t(L, "actionNameLabel");
  nameField.append(nameLabel, name);

  const kind = document.createElement("select");
  kind.className = "s-kind";
  kind.setAttribute("aria-label", t(L, "actionTypeLabel"));
  for (const k of ["url", "command", "app"] as const) {
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = t(L, KIND_LABEL_KEYS[k]);
    kind.appendChild(opt);
  }
  kind.value = a.kind;
  const kindField = document.createElement("label");
  kindField.className = "action-field s-kind-field";
  const kindLabel = document.createElement("span");
  kindLabel.className = "field-label s-kind-label";
  kindLabel.textContent = t(L, "actionTypeLabel");
  kindField.append(kindLabel, kind);

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

  const value = document.createElement("input");
  value.type = "text";
  value.className = "s-value";
  value.value = a.value;
  value.setAttribute("aria-label", t(L, "actionValueLabel"));
  const valueField = document.createElement("label");
  valueField.className = "action-field s-value-field";
  const valueLabel = document.createElement("span");
  valueLabel.className = "field-label s-value-label";
  valueLabel.textContent = t(L, "actionValueLabel");
  valueField.append(valueLabel, value);

  const valueWrap = document.createElement("div");
  valueWrap.className = "s-value-row";

  const browse = document.createElement("button");
  browse.type = "button";
  browse.className = "s-app-browse";
  browse.textContent = t(L, "browseApps");

  const groupSel = document.createElement("select");
  groupSel.className = "s-group";
  groupSel.setAttribute("aria-label", t(L, "actionGroupLabel"));
  rebuildGroupOptions(groupSel);
  groupSel.value = a.group ?? "";
  const groupField = document.createElement("label");
  groupField.className = "action-field s-group-field";
  const groupLabel = document.createElement("span");
  groupLabel.className = "field-label s-group-label";
  groupLabel.textContent = t(L, "actionGroupLabel");
  groupField.append(groupLabel, groupSel);

  // The browser executable is no longer edited in the UI, but a value set
  // in the config file must survive a save round-trip untouched.
  row.dataset.browser = a.browser ?? "";

  const syncKind = () => {
    value.placeholder = kindValuePlaceholder(kind.value);
    browse.hidden = kind.value !== "app";
    row.classList.toggle("kind-app", kind.value === "app");
  };
  kind.addEventListener("change", syncKind);
  syncKind();
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

  top.append(nameField, kindField, order, del);
  valueWrap.append(valueField, browse, groupField);
  row.append(top, valueWrap);
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
  const del = row.querySelector<HTMLButtonElement>(".s-del")!;
  const up = row.querySelector<HTMLButtonElement>(".s-move-up")!;
  const down = row.querySelector<HTMLButtonElement>(".s-move-down")!;
  row.setAttribute("aria-label", name.value.trim() || t(L, "namePlaceholder"));
  name.placeholder = t(L, "namePlaceholder");
  name.setAttribute("aria-label", t(L, "namePlaceholder"));
  row.querySelector<HTMLElement>(".s-name-label")!.textContent = t(L, "actionNameLabel");
  const kind = row.querySelector<HTMLSelectElement>(".s-kind");
  if (kind) {
    kind.setAttribute("aria-label", t(L, "actionTypeLabel"));
    for (const opt of Array.from(kind.options)) {
      opt.textContent = t(L, KIND_LABEL_KEYS[opt.value as Action["kind"]]);
    }
  }
  value.placeholder = kindValuePlaceholder(kind?.value ?? "url");
  value.setAttribute("aria-label", t(L, "actionValueLabel"));
  row.querySelector<HTMLElement>(".s-kind-label")!.textContent = t(L, "actionTypeLabel");
  row.querySelector<HTMLElement>(".s-value-label")!.textContent = t(L, "actionValueLabel");
  const groupSel = row.querySelector<HTMLSelectElement>(".s-group");
  if (groupSel) {
    groupSel.setAttribute("aria-label", t(L, "actionGroupLabel"));
    const none = groupSel.options[0];
    if (none) none.textContent = t(L, "noGroup");
  }
  row.querySelector<HTMLElement>(".s-group-label")!.textContent = t(L, "actionGroupLabel");
  del.setAttribute(
    "aria-label",
    t(L, "deleteAction", { name: name.value || t(L, "namePlaceholder") }),
  );
  const actionName = name.value.trim() || t(L, "namePlaceholder");
  up.setAttribute("aria-label", t(L, "moveActionUp", { name: actionName }));
  down.setAttribute("aria-label", t(L, "moveActionDown", { name: actionName }));
  const browse = row.querySelector<HTMLButtonElement>(".s-app-browse");
  if (browse) browse.textContent = t(L, "browseApps");
  const apSearch = row.querySelector<HTMLInputElement>(".ap-search");
  if (apSearch) apSearch.placeholder = t(L, "appSearchPlaceholder");
}

function collectSettingsActions(): Action[] {
  const saved = collectGroupsFromRows();
  const out: Action[] = [];
  for (const row of actionsRows.querySelectorAll<HTMLElement>(".settings-row")) {
    const name = row.querySelector<HTMLInputElement>(".s-name")!.value.trim();
    const kind = row.querySelector<HTMLSelectElement>(".s-kind")!.value as Action["kind"];
    const value = row.querySelector<HTMLInputElement>(".s-value")!.value.trim();
    const browser = row.dataset.browser ?? "";
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
  let groupError = false;
  actionsError.textContent = "";
  for (const row of actionsRows.querySelectorAll<HTMLElement>(".settings-row")) {
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
  if (invalid) {
    setActionsTab("actions", false);
    actionsError.textContent = t(currentLanguage, "saveValidationError");
    actionsRows.querySelector<HTMLInputElement>(".settings-row.invalid .s-name")?.focus();
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
      closePanels();
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
      if (actionsOpen) rebuildActionsRows();
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
