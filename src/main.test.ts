// @vitest-environment jsdom
/**
 * End-to-end-ish tests for the overlay UI (src/main.ts): the full DOM
 * wiring — rendering, live filtering, keyboard navigation, settings panel,
 * app picker — with the Tauri IPC mocked. The animation clock and the
 * requestAnimationFrame loop are stubbed so transitions can be driven
 * deterministically.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLOSE_MS, OPEN_MS } from "./lib/constants";
import type { Action, Group } from "./lib/model";

const { invoke, listen } = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen, emit: vi.fn().mockResolvedValue(undefined) }));

const appApi = vi.hoisted(() => ({ getVersion: vi.fn() }));

vi.mock("@tauri-apps/api/app", () => appApi);

const autostart = vi.hoisted(() => ({
  enable: vi.fn().mockResolvedValue(undefined),
  disable: vi.fn().mockResolvedValue(undefined),
  isEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock("@tauri-apps/plugin-autostart", () => autostart);

const updater = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => updater);

const dialog = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => dialog);

const processPlugin = vi.hoisted(() => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => processPlugin);

const windowApi = vi.hoisted(() => {
  const startResizeDragging = vi.fn();
  const setSize = vi.fn();
  const setPosition = vi.fn();
  const scaleFactor = vi.fn();
  const outerPosition = vi.fn();
  const currentWindow = {
    startResizeDragging,
    setSize,
    setPosition,
    scaleFactor,
    outerPosition,
  };
  return {
    startResizeDragging,
    setSize,
    setPosition,
    scaleFactor,
    outerPosition,
    getCurrentWindow: vi.fn(() => currentWindow),
    LogicalSize: class {
      constructor(
        public width: number,
        public height: number,
      ) {}
    },
    LogicalPosition: class {
      constructor(
        public x: number,
        public y: number,
      ) {}
    },
  };
});
vi.mock("@tauri-apps/api/window", () => windowApi);

const ACTIONS: Action[] = [
  { name: "Vercel", kind: "url", value: "https://vercel.com" },
  { name: "GitHub", kind: "url", value: "https://github.com" },
  { name: "Native SDK docs", kind: "url", value: "https://native-sdk.dev" },
  { name: "Reload (use tray)", kind: "command", value: "echo hello" },
];

const INSTALLED_APPS = [
  { name: "Safari", value: "/System/Applications/Safari.app" },
  { name: "Visual Studio Code", value: "/Applications/Visual Studio Code.app" },
];

const eventHandlers: Record<string, (event: { payload?: unknown }) => void> = {};
let virtualNow = 0;
let rafCb: ((time: number) => void) | null = null;

function flush(): Promise<void> {
  const ticks = [];
  for (let i = 0; i < 20; i++) ticks.push(Promise.resolve());
  return Promise.all(ticks).then(() => undefined);
}

/** In-memory localStorage: jsdom without an origin has none (opaque origin),
 * while the real webview does. The updater deferral ("on next open") needs it. */
function installStorage(): void {
  const store = new Map<string, string>();
  const mock: Storage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
  };
  Object.defineProperty(window, "localStorage", {
    value: mock,
    writable: true,
    configurable: true,
  });
}

/** Stub the animation clock and the rAF loop; frames only advance on demand. */
function installGlobals(prefersDark = false): void {
  virtualNow = 0;
  rafCb = null;
  vi.spyOn(performance, "now").mockImplementation(() => virtualNow);
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-color-scheme: dark") ? prefersDark : false,
    })),
  });
  window.requestAnimationFrame = ((cb: (time: number) => void) => {
    rafCb = cb;
    return 1;
  }) as unknown as typeof window.requestAnimationFrame;
}

/** The elements main.ts queries at module load, mirroring index.html. */
function installDom(): void {
  document.body.innerHTML = `
    <main id="overlay" aria-label="Quickspot quick actions">
      <div id="disc"></div>
      <div id="chips"></div>
      <button id="hub"></button>
      <button id="add"></button>
      <div id="query-wrap"><span id="query-mirror"></span><span id="caret"></span><input id="query" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Search actions" /></div>
      <span id="more-count" aria-hidden="true"></span>
      <div id="empty-state" role="status" aria-live="polite" aria-atomic="true"></div>
      <div id="run-error" role="alert" aria-live="assertive" aria-hidden="true"></div>
      <button id="minimize"></button>
      <div id="grip"></div>
      <div id="update-popup" role="dialog" aria-modal="true" aria-labelledby="update-popup-title" aria-hidden="true">
        <div id="update-popup-card">
          <div id="update-popup-header">
            <span id="update-popup-title">Update available</span>
            <button id="update-popup-close" type="button" aria-label="Close"></button>
          </div>
          <p id="update-popup-desc"></p>
          <p id="update-popup-status" role="status" aria-live="polite" aria-atomic="true"></p>
          <span id="update-popup-error" role="alert" aria-live="assertive"></span>
          <div id="update-popup-actions">
            <button id="update-popup-later" type="button">Later</button>
            <button id="update-popup-next" type="button">On next open</button>
            <button id="update-popup-now" type="button">Update now</button>
          </div>
        </div>
      </div>
      <form id="settings" role="dialog" aria-modal="true" aria-hidden="true">
        <div id="settings-header">
          <span id="settings-title">Settings</span>
          <button id="settings-close" type="button" aria-label="Close">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div id="settings-rows">
          <section class="settings-section" id="settings-appearance" aria-labelledby="settings-appearance-heading">
            <h2 class="settings-section-title" id="settings-appearance-heading">Appearance</h2>
            <div class="settings-list">
              <div class="settings-list-row">
                <label class="settings-row-label" for="settings-theme" id="settings-theme-label">Theme</label>
                <select id="settings-theme" aria-label="Theme"></select>
              </div>
              <label class="settings-list-row">
                <span class="settings-row-label" id="settings-icons-label">Show action icons</span>
                <span class="switch">
                  <input id="settings-icons" type="checkbox" />
                  <span class="switch-track"></span>
                </span>
              </label>
              <label class="settings-list-row">
                <span class="settings-row-label" id="settings-dock-label">Magnify on hover</span>
                <span class="switch">
                  <input id="settings-magnify" type="checkbox" />
                  <span class="switch-track"></span>
                </span>
              </label>
            </div>
          </section>
          <section class="settings-section" id="settings-general" aria-labelledby="settings-general-heading">
            <h2 class="settings-section-title" id="settings-general-heading">General</h2>
            <div class="settings-list">
              <div class="settings-list-row">
                <label class="settings-row-label" for="settings-lang" id="settings-language-label">Language</label>
                <select id="settings-lang" aria-label="Language"></select>
                <p class="settings-translators" id="settings-translators"></p>
              </div>
              <label class="settings-list-row">
                <span class="settings-row-label" id="settings-autostart-label">Launch at login</span>
                <span class="switch">
                  <input id="settings-autostart" type="checkbox" />
                  <span class="switch-track"></span>
                </span>
              </label>
            </div>
          </section>
          <section class="settings-section" id="settings-updates" aria-labelledby="settings-updates-heading">
            <h2 class="settings-section-title" id="settings-updates-heading">Updates</h2>
            <div class="settings-list">
              <div class="settings-list-row">
                <span class="settings-row-label" id="settings-update-label">Check for updates</span>
                <button id="settings-update-check" type="button">Check now</button>
              </div>
            </div>
          </section>
          <p class="settings-version" id="settings-version"></p>
        </div>
        <div id="settings-footer">
          <span id="settings-error"></span>
          <button id="settings-save" type="submit">Save</button>
        </div>
        <span class="resize-handle rh-n" data-direction="North" aria-hidden="true"></span>
        <span class="resize-handle rh-s" data-direction="South" aria-hidden="true"></span>
        <span class="resize-handle rh-e" data-direction="East" aria-hidden="true"></span>
        <span class="resize-handle rh-w" data-direction="West" aria-hidden="true"></span>
        <span class="resize-handle rh-ne" data-direction="NorthEast" aria-hidden="true"></span>
        <span class="resize-handle rh-nw" data-direction="NorthWest" aria-hidden="true"></span>
        <span class="resize-handle rh-se" data-direction="SouthEast" aria-hidden="true"></span>
        <span class="resize-handle rh-sw" data-direction="SouthWest" aria-hidden="true"></span>
      </form>
      <form id="actions" role="dialog" aria-modal="true" aria-hidden="true">
        <div id="actions-header">
          <span id="actions-title">Actions</span>
          <button id="actions-close" type="button"></button>
        </div>
        <p id="actions-description"></p>
        <div id="actions-tabs" role="tablist" aria-orientation="horizontal" aria-label="Action editor sections">
          <button id="actions-tab" type="button" role="tab" aria-controls="actions-panel" aria-selected="true" tabindex="0">Actions</button>
          <button id="groups-tab" type="button" role="tab" aria-controls="groups-panel" aria-selected="false" tabindex="-1">Groups</button>
        </div>
        <div id="actions-rows"></div>
        <div id="actions-footer">
          <span id="actions-error"></span>
          <button id="actions-save" type="submit">Save</button>
        </div>
        <span id="actions-status" role="status" aria-live="polite" aria-atomic="true"></span>
        <span class="resize-handle rh-n" data-direction="North" aria-hidden="true"></span>
        <span class="resize-handle rh-s" data-direction="South" aria-hidden="true"></span>
        <span class="resize-handle rh-e" data-direction="East" aria-hidden="true"></span>
        <span class="resize-handle rh-w" data-direction="West" aria-hidden="true"></span>
        <span class="resize-handle rh-ne" data-direction="NorthEast" aria-hidden="true"></span>
        <span class="resize-handle rh-nw" data-direction="NorthWest" aria-hidden="true"></span>
        <span class="resize-handle rh-se" data-direction="SouthEast" aria-hidden="true"></span>
        <span class="resize-handle rh-sw" data-direction="SouthWest" aria-hidden="true"></span>
      </form>
    </main>`;
}

async function mount(config?: {
  actions?: Action[];
  groups?: Group[];
  language?: string | null;
  magnify?: boolean;
  showIcons?: boolean;
  theme?: string | null;
  /** App version reported by the runtime; null simulates a failed lookup. */
  version?: string | null;
}, opts?: {
  /** Simulate an OS dark color scheme (jsdom defaults to light). */
  prefersDark?: boolean;
}): Promise<void> {
  vi.resetModules();
  for (const key of Object.keys(eventHandlers)) delete eventHandlers[key];
  invoke.mockReset();
  invoke.mockImplementation((cmd: string) => {
    if (cmd === "get_config") {
      return Promise.resolve({
        actions: config?.actions ?? ACTIONS,
        groups: config?.groups ?? [],
        language: config?.language ?? null,
        magnify: config?.magnify ?? true,
        showIcons: config?.showIcons ?? true,
        theme: config?.theme ?? null,
      });
    }
    if (cmd === "list_apps") return Promise.resolve(INSTALLED_APPS);
    return Promise.resolve(undefined);
  });
  autostart.enable.mockClear();
  autostart.disable.mockClear();
  autostart.isEnabled.mockClear();
  autostart.isEnabled.mockResolvedValue(false);
  updater.check.mockReset();
  updater.check.mockResolvedValue(null);
  dialog.open.mockReset();
  dialog.open.mockResolvedValue(null);
  processPlugin.relaunch.mockReset();
  processPlugin.relaunch.mockResolvedValue(undefined);
  windowApi.startResizeDragging.mockReset();
  windowApi.startResizeDragging.mockResolvedValue(undefined);
  windowApi.setSize.mockReset();
  windowApi.setSize.mockResolvedValue(undefined);
  windowApi.setPosition.mockReset();
  windowApi.setPosition.mockResolvedValue(undefined);
  windowApi.scaleFactor.mockReset();
  windowApi.scaleFactor.mockResolvedValue(2);
  windowApi.outerPosition.mockReset();
  windowApi.outerPosition.mockResolvedValue({ x: 200, y: 200 });
  appApi.getVersion.mockReset();
  if (config?.version === null) {
    appApi.getVersion.mockRejectedValue(new Error("no runtime"));
  } else {
    appApi.getVersion.mockResolvedValue(config?.version ?? "1.2.3");
  }
  listen.mockReset();
  listen.mockImplementation((name: string, handler: (event: { payload?: unknown }) => void) => {
    eventHandlers[name] = handler;
    return Promise.resolve(() => {});
  });
  installGlobals(opts?.prefersDark ?? false);
  installDom();
  installStorage();
  await import("./main");
  await flush();
}

/** Advance the stub animation loop by `ms` of virtual time. */
async function runFrames(ms: number): Promise<void> {
  const end = virtualNow + ms;
  while (virtualNow < end && rafCb) {
    virtualNow += 16;
    const cb = rafCb;
    rafCb = null;
    cb(virtualNow);
    await flush();
  }
}

/** Drive the open/close transition to completion via the overlay-open event. */
async function openOverlay(): Promise<void> {
  eventHandlers["overlay-open"]?.({ payload: undefined });
  await runFrames(OPEN_MS + 60);
}

/** Open the actions panel from a settled overlay. */
function openActions(): void {
  document.querySelector<HTMLButtonElement>("#add")!.click();
}

function typeQuery(text: string): void {
  const input = document.querySelector<HTMLInputElement>("#query")!;
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function key(target: Element, keyName: string, extra: KeyboardEventInit = {}): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true, ...extra }),
  );
}

function chipLabels(): string[] {
  return [...document.querySelectorAll<HTMLElement>(".chip-label")].map((el) => el.textContent ?? "");
}

function visibleChips(): number {
  return [...document.querySelectorAll<HTMLButtonElement>(".chip")].filter(
    (el) => el.style.opacity !== "0",
  ).length;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await mount();
});

describe("rendering", () => {
  it("renders the config actions as chips with the first one selected", () => {
    expect(chipLabels().slice(0, 4)).toEqual([
      "Vercel",
      "GitHub",
      "Native SDK docs",
      "Reload (use tray)",
    ]);
    const chips = document.querySelectorAll<HTMLButtonElement>(".chip");
    expect(chips[0].getAttribute("aria-pressed")).toBe("true");
    expect(chips[1].getAttribute("aria-pressed")).toBe("false");
    expect(chips[4].style.opacity).toBe("0");
  });

  it("shows the placeholder in the query mirror until the user types", () => {
    expect(document.querySelector("#query-mirror")!.textContent).toBe("Type to search...");
  });

  it("keeps the chip icons by default", () => {
    expect(document.querySelector("#overlay")!.classList.contains("no-icons")).toBe(false);
  });

  it("hides the chip icons when showIcons is off in the config", async () => {
    await mount({ showIcons: false });
    expect(document.querySelector("#overlay")!.classList.contains("no-icons")).toBe(true);
  });
});

describe("filtering", () => {
  it("filters chips live, case-insensitively, hiding non-matches", () => {
    typeQuery("g");
    expect(chipLabels()[0]).toBe("GitHub");
    expect(visibleChips()).toBe(1);
  });

  it("keeps config order when the query matches several actions", () => {
    typeQuery("o");
    expect(chipLabels().slice(0, 2)).toEqual(["Native SDK docs", "Reload (use tray)"]);
  });

  it("shows the localized empty state when nothing matches", () => {
    typeQuery("zzz");
    expect(document.querySelector("#empty-state")!.textContent).toBe("No matching actions");
  });

  it("makes the empty state visible after typing a no-match query once settled", async () => {
    await openOverlay();
    typeQuery("zzz");
    expect(document.querySelector("#empty-state")!.classList.contains("visible")).toBe(true);
  });

  it("hides the empty state once a query matches again", async () => {
    await openOverlay();
    typeQuery("zzz");
    typeQuery("e");
    expect(document.querySelector("#empty-state")!.classList.contains("visible")).toBe(false);
  });

  it("greets a fresh config with the no-actions message", async () => {
    await mount({ actions: [] });
    await openOverlay();
    const empty = document.querySelector("#empty-state")!;
    expect(empty.textContent).toBe('No actions yet. Use \u201cAdd action\u201d to create the first one.');
    expect(empty.classList.contains("visible")).toBe(true);
  });

  it("left-aligns and scrolls the query pill to the end when it overflows", async () => {
    const wrap = document.querySelector<HTMLElement>("#query-wrap")!;
    Object.defineProperty(wrap, "scrollWidth", {
      configurable: true,
      get: () => (document.querySelector("#query-mirror")!.textContent?.length ?? 0) * 7,
    });
    Object.defineProperty(wrap, "clientWidth", { configurable: true, get: () => 136 });
    typeQuery("x".repeat(60));
    expect(wrap.classList.contains("overflowing")).toBe(true);
    expect(wrap.scrollLeft).toBe(60 * 7);
    typeQuery("hi");
    expect(wrap.classList.contains("overflowing")).toBe(false);
  });

  it("clearing the query restores every action", () => {
    typeQuery("g");
    typeQuery("");
    expect(visibleChips()).toBe(4);
  });

  it("treats whitespace-only queries as empty: shows everything, no error", async () => {
    await openOverlay();
    typeQuery("   ");
    expect(visibleChips()).toBe(4);
    expect(document.querySelector("#empty-state")!.textContent).toBe("");
    expect(document.querySelector("#empty-state")!.classList.contains("visible")).toBe(false);
    expect(document.querySelector("#query-mirror")!.textContent).toBe("Type to search...");
    expect(document.querySelector("#query-wrap")!.classList.contains("active")).toBe(false);
  });

  it("trims and collapses spaces when matching", () => {
    typeQuery("  git  ");
    expect(chipLabels()[0]).toBe("GitHub");
    expect(visibleChips()).toBe(1);
    typeQuery("native   sdk");
    expect(chipLabels()[0]).toBe("Native SDK docs");
    expect(visibleChips()).toBe(1);
  });

  it("matches accents insensitively", async () => {
    await mount({
      actions: [{ name: "Canción", kind: "url", value: "https://example.com" }],
    });
    typeQuery("cancion");
    expect(visibleChips()).toBe(1);
    typeQuery("canción");
    expect(visibleChips()).toBe(1);
  });

  it("caps the query at 256 UTF-8 bytes without splitting a codepoint", () => {
    const input = document.querySelector<HTMLInputElement>("#query")!;
    input.value = "🪐".repeat(80); // 320 bytes
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(new TextEncoder().encode(input.value).length).toBeLessThanOrEqual(256);
  });
});

describe("keyboard navigation", () => {
  it("Tab and ArrowDown move forward and wrap around", () => {
    const input = document.querySelector<HTMLInputElement>("#query")!;
    const chips = document.querySelectorAll<HTMLButtonElement>(".chip");
    for (let i = 0; i < 3; i++) key(input, "Tab");
    expect(chips[3].classList.contains("selected")).toBe(true);
    key(input, "Tab");
    expect(chips[0].classList.contains("selected")).toBe(true);
  });

  it("ArrowUp and Shift+Tab move backward and wrap to the last", () => {
    const input = document.querySelector<HTMLInputElement>("#query")!;
    const chips = document.querySelectorAll<HTMLButtonElement>(".chip");
    key(input, "ArrowUp");
    expect(chips[3].classList.contains("selected")).toBe(true);
    key(input, "Tab", { shiftKey: true });
    expect(chips[2].classList.contains("selected")).toBe(true);
  });
});

describe("execution", () => {
  it("Enter runs the selected action via execute", () => {
    typeQuery("git");
    key(document.querySelector("#query")!, "Enter");
    expect(invoke).toHaveBeenCalledWith("execute", { index: 1 });
  });

  it("Enter with no matches does not run anything", () => {
    typeQuery("zzz");
    key(document.querySelector("#query")!, "Enter");
    expect(invoke).not.toHaveBeenCalledWith("execute", expect.anything());
  });

  it("clicking a chip runs its action", () => {
    document.querySelectorAll<HTMLButtonElement>(".chip")[2].click();
    expect(invoke).toHaveBeenCalledWith("execute", { index: 2 });
  });

  it("shows a localized run error when execution fails", async () => {
    invoke.mockRejectedValueOnce("boom");
    key(document.querySelector("#query")!, "Enter");
    await flush();
    expect(document.querySelector("#run-error")!.textContent).toBe("Couldn't run: boom");
  });
});

describe("overlay lifecycle", () => {
  it("Escape closes the overlay via close_overlay", () => {
    key(document.querySelector("#query")!, "Escape");
    expect(invoke).toHaveBeenCalledWith("close_overlay");
  });

  it("Cmd/Ctrl+R reloads the config and Cmd/Ctrl+Q quits", () => {
    const input = document.querySelector("#query")!;
    key(input, "r", { metaKey: true });
    key(input, "q", { metaKey: true });
    expect(invoke).toHaveBeenCalledWith("reload_config");
    expect(invoke).toHaveBeenCalledWith("quit");
  });

  it("overlay-open clears the query, restores the chips and focuses", () => {
    typeQuery("g");
    eventHandlers["overlay-open"]?.({ payload: undefined });
    expect(document.querySelector<HTMLInputElement>("#query")!.value).toBe("");
    expect(visibleChips()).toBe(4);
    expect(document.activeElement).toBe(document.querySelector("#query"));
  });

  it("after the close animation finishes, the webview notifies on_overlay_closed", async () => {
    await openOverlay();
    eventHandlers["overlay-close"]?.({ payload: undefined });
    await runFrames(CLOSE_MS + 60);
    expect(invoke).toHaveBeenCalledWith("on_overlay_closed");
    expect(document.querySelector("#overlay")!.classList.contains("open")).toBe(false);
  });

  it("config-reloaded re-renders actions and applies the language", () => {
    eventHandlers["config-reloaded"]?.({
      payload: {
        actions: [{ name: "New", kind: "url", value: "https://new.dev" }],
        language: "es",
        magnify: false,
        showIcons: false,
      },
    });
    expect(chipLabels()[0]).toBe("New");
    expect(visibleChips()).toBe(1);
    expect(document.documentElement.lang).toBe("es");
    expect(document.querySelector("#overlay")!.classList.contains("no-icons")).toBe(true);
  });
});

describe("settings panel", () => {
  it("opening settings shows the panel and hides the chips from tab order", async () => {
    await openOverlay();
    document.querySelector<HTMLButtonElement>("#hub")!.click();
    expect(document.querySelector("#settings")!.classList.contains("open")).toBe(true);
    expect(document.querySelector("#settings")!.getAttribute("aria-hidden")).toBe("false");
    expect(document.querySelectorAll<HTMLButtonElement>(".chip")[0].tabIndex).toBe(-1);
  });

  it("settings holds the general options and no action rows", async () => {
    await openOverlay();
    document.querySelector<HTMLButtonElement>("#hub")!.click();
    expect(document.querySelector("#settings")!.querySelector(".settings-row")).toBeNull();
    expect(document.querySelector<HTMLInputElement>("#settings-magnify")).not.toBeNull();
  });

  it("Save sends the loaded actions and groups unchanged and closes the panel", async () => {
    await openOverlay();
    document.querySelector<HTMLButtonElement>("#hub")!.click();
    document.querySelector<HTMLInputElement>("#settings-magnify")!.checked = false;
    document.querySelector<HTMLButtonElement>("#settings-save")!.click();
    await flush();
    expect(invoke).toHaveBeenCalledWith("save_config", {
      actions: ACTIONS,
      groups: [],
      language: null,
      magnify: false,
      showIcons: true,
      theme: null,
    });
    expect(document.querySelector("#settings")!.classList.contains("open")).toBe(false);
  });

  it("turning off Show action icons saves showIcons false", async () => {
    await openOverlay();
    document.querySelector<HTMLButtonElement>("#hub")!.click();
    document.querySelector<HTMLInputElement>("#settings-icons")!.checked = false;
    document.querySelector<HTMLButtonElement>("#settings-save")!.click();
    await flush();
    expect(invoke).toHaveBeenCalledWith(
      "save_config",
      expect.objectContaining({ showIcons: false }),
    );
  });

  it("Save enables autostart when the toggle is on and the OS state is off", async () => {
    await openOverlay();
    document.querySelector<HTMLButtonElement>("#hub")!.click();
    await flush();
    const toggle = document.querySelector<HTMLInputElement>("#settings-autostart")!;
    expect(toggle.checked).toBe(false);
    toggle.checked = true;
    document.querySelector<HTMLButtonElement>("#settings-save")!.click();
    await flush();
    expect(autostart.enable).toHaveBeenCalledTimes(1);
    expect(autostart.disable).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("save_config", expect.anything());
  });

  it("Save disables autostart when the toggle is off and the OS state is on", async () => {
    autostart.isEnabled.mockResolvedValue(true);
    await openOverlay();
    document.querySelector<HTMLButtonElement>("#hub")!.click();
    await flush();
    const toggle = document.querySelector<HTMLInputElement>("#settings-autostart")!;
    expect(toggle.checked).toBe(true);
    toggle.checked = false;
    document.querySelector<HTMLButtonElement>("#settings-save")!.click();
    await flush();
    expect(autostart.disable).toHaveBeenCalledTimes(1);
    expect(autostart.enable).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("save_config", expect.anything());
  });

  it("Save without touching the autostart toggle does not call enable or disable", async () => {
    autostart.isEnabled.mockResolvedValue(true);
    await openOverlay();
    document.querySelector<HTMLButtonElement>("#hub")!.click();
    await flush();
    document.querySelector<HTMLButtonElement>("#settings-save")!.click();
    await flush();
    expect(autostart.enable).not.toHaveBeenCalled();
    expect(autostart.disable).not.toHaveBeenCalled();
  });

  it("switching the language re-localizes the UI and saves the override", async () => {
    await openOverlay();
    document.querySelector<HTMLButtonElement>("#hub")!.click();
    const select = document.querySelector<HTMLSelectElement>("#settings-lang")!;
    select.value = "es";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(document.querySelector("#settings-title")!.textContent).toBe("Ajustes");
    expect(document.documentElement.lang).toBe("es");
    document.querySelector<HTMLButtonElement>("#settings-save")!.click();
    await flush();
    expect(invoke).toHaveBeenCalledWith("save_config", expect.objectContaining({ language: "es" }));
  });

  it("lists every registered language with its native label", async () => {
    await openOverlay();
    document.querySelector<HTMLButtonElement>("#hub")!.click();
    const options = document.querySelectorAll<HTMLOptionElement>("#settings-lang option");
    const labels = Array.from(options, (o) => o.textContent);
    expect(labels).toContain("English");
    expect(labels).toContain("Español");
    expect(document.querySelector<HTMLOptionElement>("#settings-lang option[value='system']")).not.toBeNull();
  });

  it("shows no translator credit for the owner-maintained languages", async () => {
    await openOverlay();
    document.querySelector<HTMLButtonElement>("#hub")!.click();
    const credit = document.querySelector<HTMLElement>("#settings-translators")!;
    expect(credit.textContent).toBe("");
    const select = document.querySelector<HTMLSelectElement>("#settings-lang")!;
    select.value = "es";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(credit.textContent).toBe("");
  });

  it("shows the runtime app version at the bottom of the settings panel, localized", async () => {
    await openOverlay();
    document.querySelector<HTMLButtonElement>("#hub")!.click();
    const version = document.querySelector<HTMLElement>("#settings-version")!;
    expect(appApi.getVersion).toHaveBeenCalledTimes(1);
    expect(version.textContent).toBe("Version 1.2.3");
    const select = document.querySelector<HTMLSelectElement>("#settings-lang")!;
    select.value = "es";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(version.textContent).toBe("Versión 1.2.3");
  });

  it("leaves the version caption empty when the runtime lookup fails", async () => {
    await mount({ version: null });
    await openOverlay();
    document.querySelector<HTMLButtonElement>("#hub")!.click();
    const version = document.querySelector<HTMLElement>("#settings-version")!;
    expect(version.textContent).toBe("");
  });

  it("traps focus while open: outside controls leave the tab order and Tab wraps inside the panel", async () => {
    await openOverlay();
    const hub = document.querySelector<HTMLButtonElement>("#hub")!;
    const minimize = document.querySelector<HTMLButtonElement>("#minimize")!;
    const query = document.querySelector<HTMLInputElement>("#query")!;
    hub.click();
    expect(hub.tabIndex).toBe(-1);
    expect(minimize.tabIndex).toBe(-1);
    expect(query.tabIndex).toBe(-1);
    const save = document.querySelector<HTMLButtonElement>("#settings-save")!;
    const close = document.querySelector<HTMLButtonElement>("#settings-close")!;
    save.focus();
    key(save, "Tab");
    expect(document.activeElement).toBe(close);
    key(close, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(save);
    document.querySelector<HTMLButtonElement>("#hub")!.click();
    expect(hub.tabIndex).toBe(0);
    expect(minimize.tabIndex).toBe(0);
    expect(query.tabIndex).toBe(0);
  });

  it("closes the settings panel with the visible close button", async () => {
    await openOverlay();
    document.querySelector<HTMLButtonElement>("#hub")!.click();
    expect(document.querySelector("#settings")!.classList.contains("open")).toBe(true);
    document.querySelector<HTMLButtonElement>("#settings-close")!.click();
    expect(document.querySelector("#settings")!.classList.contains("open")).toBe(false);
  });

  it("submitting the settings form saves and closes", async () => {
    await openOverlay();
    document.querySelector<HTMLButtonElement>("#hub")!.click();
    document
      .querySelector("#settings")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(invoke).toHaveBeenCalledWith("save_config", expect.anything());
    expect(document.querySelector("#settings")!.classList.contains("open")).toBe(false);
  });

  it("applies the deep theme from the config as data-theme", async () => {
    await mount({ theme: "deep" });
    expect(document.documentElement.dataset.theme).toBe("deep");
  });

  it("applies the light theme from the config as data-theme", async () => {
    await mount({ theme: "light" });
    expect(document.documentElement.dataset.theme).toBe("light");
    await openOverlay();
    document.querySelector<HTMLButtonElement>("#hub")!.click();
    expect(document.querySelector<HTMLSelectElement>("#settings-theme")!.value).toBe("light");
  });

  it("system follows the OS: light in jsdom, dark with a dark OS", async () => {
    await mount();
    expect(document.documentElement.dataset.theme).toBe("light");
    await mount({}, { prefersDark: true });
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("switching the appearance to deep black updates data-theme live and saves the pin", async () => {
    await openOverlay();
    document.querySelector<HTMLButtonElement>("#hub")!.click();
    const select = document.querySelector<HTMLSelectElement>("#settings-theme")!;
    expect(select.value).toBe("system");
    select.value = "deep";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(document.documentElement.dataset.theme).toBe("deep");
    document.querySelector<HTMLButtonElement>("#settings-save")!.click();
    await flush();
    expect(invoke).toHaveBeenCalledWith("save_config", expect.objectContaining({ theme: "deep" }));
  });

  it("localizes the appearance options", async () => {
    await openOverlay();
    document.querySelector<HTMLButtonElement>("#hub")!.click();
    const labels = Array.from(
      document.querySelectorAll<HTMLOptionElement>("#settings-theme option"),
      (o) => o.textContent,
    );
    expect(labels).toEqual(["System", "Light", "Dark", "Deep black"]);
    const lang = document.querySelector<HTMLSelectElement>("#settings-lang")!;
    lang.value = "es";
    lang.dispatchEvent(new Event("change", { bubbles: true }));
    const esLabels = Array.from(
      document.querySelectorAll<HTMLOptionElement>("#settings-theme option"),
      (o) => o.textContent,
    );
    expect(esLabels).toEqual(["Sistema", "Claro", "Oscuro", "Negro profundo"]);
    expect(document.querySelector("#settings-theme-label")!.textContent).toBe("Tema");
    expect(document.querySelector("#settings-appearance-heading")!.textContent).toBe("Apariencia");
    expect(document.querySelector("#settings-updates-heading")!.textContent).toBe("Actualizaciones");
    expect(document.querySelector("#settings-general-heading")!.textContent).toBe("General");
  });
});

describe("actions panel", () => {
  it("the add button opens the actions panel with the action rows", async () => {
    await openOverlay();
    openActions();
    expect(document.querySelector("#actions")!.classList.contains("open")).toBe(true);
    expect(document.querySelector("#actions")!.getAttribute("aria-hidden")).toBe("false");
    expect(document.querySelector("#actions")!.querySelectorAll(".settings-row").length).toBe(4);
    expect(document.querySelector("#actions-title")!.textContent).toBe("Actions");
  });

  it("opens on Actions and exposes the two editor tabs with one panel at a time", async () => {
    await openOverlay();
    openActions();
    const actionsTab = document.querySelector<HTMLButtonElement>("#actions-tab")!;
    const groupsTab = document.querySelector<HTMLButtonElement>("#groups-tab")!;
    expect(actionsTab.getAttribute("aria-selected")).toBe("true");
    expect(groupsTab.getAttribute("aria-selected")).toBe("false");
    expect((document.querySelector("#actions-panel") as HTMLElement).hidden).toBe(false);
    expect((document.querySelector("#groups-panel") as HTMLElement).hidden).toBe(true);
    expect(document.querySelector("#actions-panel")!.getAttribute("aria-hidden")).toBe("false");
    expect(document.querySelector("#groups-panel")!.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelector("#actions-rows")!.firstElementChild?.id).toBe("actions-panel");

    groupsTab.click();
    expect(actionsTab.getAttribute("aria-selected")).toBe("false");
    expect(groupsTab.getAttribute("aria-selected")).toBe("true");
    expect((document.querySelector("#actions-panel") as HTMLElement).hidden).toBe(true);
    expect((document.querySelector("#groups-panel") as HTMLElement).hidden).toBe(false);
    expect(document.querySelector("#actions-panel")!.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelector("#groups-panel")!.getAttribute("aria-hidden")).toBe("false");
    key(groupsTab, "ArrowLeft");
    expect(document.activeElement).toBe(actionsTab);
    expect(actionsTab.getAttribute("aria-selected")).toBe("true");
  });

  it("settings and actions are mutually exclusive", async () => {
    await openOverlay();
    document.querySelector<HTMLButtonElement>("#hub")!.click();
    expect(document.querySelector("#settings")!.classList.contains("open")).toBe(true);
    openActions();
    expect(document.querySelector("#settings")!.classList.contains("open")).toBe(false);
    expect(document.querySelector("#actions")!.classList.contains("open")).toBe(true);
    document.querySelector<HTMLButtonElement>("#hub")!.click();
    expect(document.querySelector("#actions")!.classList.contains("open")).toBe(false);
    expect(document.querySelector("#settings")!.classList.contains("open")).toBe(true);
  });

  it("blocks saving incomplete rows with a localized validation error", async () => {
    await openOverlay();
    openActions();
    document.querySelector<HTMLButtonElement>("#actions-add")!.click();
    document.querySelector<HTMLButtonElement>("#actions-save")!.click();
    await flush();
    expect(document.querySelector("#actions-error")!.textContent).toBe(
      "Fill in a name and a value for every action",
    );
    expect(invoke).not.toHaveBeenCalledWith("save_config", expect.anything());
  });

  it("moves validation focus to the tab containing the first invalid section", async () => {
    await openOverlay();
    openActions();
    document.querySelector<HTMLButtonElement>("#actions-add")!.click();
    document.querySelector<HTMLButtonElement>("#actions-save")!.click();
    expect(document.querySelector<HTMLButtonElement>("#actions-tab")!.getAttribute("aria-selected")).toBe(
      "true",
    );

    // The freshly added (empty, invalid) row is prepended at the top.
    const deletes = document.querySelectorAll<HTMLButtonElement>(".s-del");
    deletes[0].click();
    document.querySelector<HTMLButtonElement>(".g-add")!.click();
    document.querySelector<HTMLButtonElement>("#actions-save")!.click();
    expect(document.querySelector<HTMLButtonElement>("#groups-tab")!.getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("Save sends the edited actions and groups and closes the panel", async () => {
    await openOverlay();
    openActions();
    const name = document.querySelector<HTMLInputElement>(".s-name")!;
    name.value = "Vercel Docs";
    document.querySelector<HTMLButtonElement>("#actions-save")!.click();
    await flush();
    expect(invoke).toHaveBeenCalledWith("save_config", {
      actions: [
        { name: "Vercel Docs", kind: "url", value: "https://vercel.com" },
        { name: "GitHub", kind: "url", value: "https://github.com" },
        { name: "Native SDK docs", kind: "url", value: "https://native-sdk.dev" },
        { name: "Reload (use tray)", kind: "command", value: "echo hello" },
      ],
      groups: [],
      language: null,
      magnify: true,
      showIcons: true,
      theme: null,
    });
    expect(document.querySelector("#actions")!.classList.contains("open")).toBe(false);
  });

  it("reorders rows with explicit buttons and persists the DOM order", async () => {
    await openOverlay();
    openActions();
    const rows = [...document.querySelectorAll<HTMLElement>(".settings-row")];
    const up = rows[2].querySelector<HTMLButtonElement>(".s-move-up")!;
    up.focus();
    up.click();
    expect(
      [...document.querySelectorAll<HTMLInputElement>(".settings-row .s-name")].map(
        (input) => input.value,
      ),
    ).toEqual(["Vercel", "Native SDK docs", "GitHub", "Reload (use tray)"]);
    expect(document.querySelector("#actions-status")!.textContent).toBe(
      "Native SDK docs moved to position 2 of 4",
    );
    document.querySelector<HTMLButtonElement>("#actions-save")!.click();
    await flush();
    expect(invoke).toHaveBeenCalledWith(
      "save_config",
      expect.objectContaining({
        actions: [
          ACTIONS[0],
          ACTIONS[2],
          ACTIONS[1],
          ACTIONS[3],
        ],
      }),
    );
  });

  it("disables movement buttons at the list boundaries and keeps focusable controls labeled", async () => {
    await openOverlay();
    openActions();
    const rows = [...document.querySelectorAll<HTMLElement>(".settings-row")];
    const firstUp = rows[0].querySelector<HTMLButtonElement>(".s-move-up")!;
    const lastDown = rows[3].querySelector<HTMLButtonElement>(".s-move-down")!;
    expect(firstUp.disabled).toBe(true);
    expect(lastDown.disabled).toBe(true);
    expect(firstUp.getAttribute("aria-label")).toBe("Move Vercel up");
    expect(lastDown.getAttribute("aria-label")).toBe("Move Reload (use tray) down");
    rows[0].querySelector<HTMLButtonElement>(".s-move-down")!.click();
    expect(
      [...document.querySelectorAll<HTMLInputElement>(".settings-row .s-name")].map(
        (input) => input.value,
      ),
    ).toEqual(["GitHub", "Vercel", "Native SDK docs", "Reload (use tray)"]);
  });

  it("closes the actions panel with the visible close button", async () => {
    await openOverlay();
    openActions();
    document.querySelector<HTMLButtonElement>("#actions-close")!.click();
    expect(document.querySelector("#actions")!.classList.contains("open")).toBe(false);
  });

  it("shows the action count and an add row when there are no actions", async () => {
    await mount({ actions: [] });
    await openOverlay();
    openActions();
    expect(document.querySelector(".settings-actions-count")!.textContent).toBe("0");
    expect(document.querySelector<HTMLButtonElement>("#actions-add")).not.toBeNull();
    document.querySelector<HTMLButtonElement>("#actions-add")!.click();
    expect(document.querySelector(".settings-actions-count")!.textContent).toBe("1");
  });

  it("prepends a new empty action at the top of the list", async () => {
    await mount({ actions: [{ name: "Code", kind: "app", value: "/Applications/Code.app" }] });
    await openOverlay();
    openActions();
    document.querySelector<HTMLButtonElement>("#actions-add")!.click();
    const names = [...document.querySelectorAll<HTMLInputElement>(".settings-row .s-name")].map(
      (el) => el.value,
    );
    expect(names).toEqual(["", "Code"]);
    expect(document.activeElement).toBe(
      document.querySelector(".settings-row .s-name"),
    );
  });

  it("keeps the browser field out of URL rows and orders value, browse, group", async () => {
    await mount({
      actions: [
        { name: "Code", kind: "app", value: "" },
        { name: "Google", kind: "url", value: "https://google.com" },
        { name: "Echo", kind: "command", value: "echo hi" },
        { name: "Notes", kind: "file", value: "/tmp/notes.txt" },
        { name: "Projects", kind: "folder", value: "/tmp/Projects" },
      ],
    });
    await openOverlay();
    openActions();
    const rows = [...document.querySelectorAll<HTMLElement>(".settings-row")];
    expect(rows[1].querySelector(".s-browser")).toBeNull();
    expect(rows[2].querySelector(".s-browser")).toBeNull();
    const rowOrder = (row: HTMLElement) =>
      [...row.querySelectorAll<HTMLElement>(".s-value-row > *")].map((el) => ({
        cls: el.className,
        hidden: (el as HTMLElement).hidden,
      }));
    // URL and command rows: no browse visible.
    expect(rowOrder(rows[1])).toEqual([
      { cls: "s-value-field", hidden: false },
      { cls: "s-app-browse", hidden: true },
      { cls: "s-file-browse", hidden: true },
      { cls: "s-folder-browse", hidden: true },
      { cls: "s-group-field", hidden: false },
      { cls: "s-del", hidden: false },
    ]);
    expect(rowOrder(rows[2])).toEqual([
      { cls: "s-value-field", hidden: false },
      { cls: "s-app-browse", hidden: true },
      { cls: "s-file-browse", hidden: true },
      { cls: "s-folder-browse", hidden: true },
      { cls: "s-group-field", hidden: false },
      { cls: "s-del", hidden: false },
    ]);
    // App row: the app picker only.
    expect(rowOrder(rows[0])).toEqual([
      { cls: "s-value-field", hidden: false },
      { cls: "s-app-browse", hidden: false },
      { cls: "s-file-browse", hidden: true },
      { cls: "s-folder-browse", hidden: true },
      { cls: "s-group-field", hidden: false },
      { cls: "s-del", hidden: false },
    ]);
    // File row: the native file dialog only.
    expect(rowOrder(rows[3])).toEqual([
      { cls: "s-value-field", hidden: false },
      { cls: "s-app-browse", hidden: true },
      { cls: "s-file-browse", hidden: false },
      { cls: "s-folder-browse", hidden: true },
      { cls: "s-group-field", hidden: false },
      { cls: "s-del", hidden: false },
    ]);
    // Folder row: the native folder dialog only.
    expect(rowOrder(rows[4])).toEqual([
      { cls: "s-value-field", hidden: false },
      { cls: "s-app-browse", hidden: true },
      { cls: "s-file-browse", hidden: true },
      { cls: "s-folder-browse", hidden: false },
      { cls: "s-group-field", hidden: false },
      { cls: "s-del", hidden: false },
    ]);
    for (const row of rows) {
      // The group field rides the value line, with the anchored listbox as
      // its last child (below the trigger).
      expect(
        row
          .querySelector<HTMLElement>(".s-group-field")!
          .lastElementChild!.classList.contains("s-group-picker"),
      ).toBe(true);
    }
  });

  it("switching the kind to url hides the browse button and keeps the group rightmost", async () => {
    await mount({
      actions: [{ name: "Code", kind: "app", value: "/Applications/Code.app" }],
    });
    await openOverlay();
    openActions();
    const url = document.querySelector<HTMLButtonElement>('.s-kind-option[data-value="url"]')!;
    const browse = document.querySelector<HTMLButtonElement>(".s-app-browse")!;
    expect(browse.hidden).toBe(false);
    url.click();
    expect(browse.hidden).toBe(true);
    expect(
      document
        .querySelector<HTMLElement>(".s-group-field")!
        .lastElementChild!.classList.contains("s-group-picker"),
    ).toBe(true);
  });

  it("opens the action kind list upward when there is not enough room below", async () => {
    await openOverlay();
    openActions();
    const trigger = document.querySelector<HTMLButtonElement>(".s-kind-trigger")!;
    const listbox = document.querySelector<HTMLElement>(".s-kind-listbox")!;
    const rows = document.querySelector<HTMLElement>("#actions-rows")!;
    const triggerRect = vi
      .spyOn(trigger, "getBoundingClientRect")
      .mockReturnValue({ top: 420, bottom: 460 } as DOMRect);
    vi.spyOn(rows, "getBoundingClientRect").mockReturnValue({ top: 100, bottom: 500 } as DOMRect);
    Object.defineProperty(listbox, "offsetHeight", { configurable: true, value: 160 });

    trigger.click();
    expect(listbox.classList.contains("open-up")).toBe(true);

    trigger.click();
    triggerRect.mockReturnValue({ top: 160, bottom: 200 } as DOMRect);
    trigger.click();
    expect(listbox.classList.contains("open-up")).toBe(false);
  });

  it("toggles the action kind list closed when its button is clicked again", async () => {
    await openOverlay();
    openActions();
    const trigger = document.querySelector<HTMLButtonElement>(".s-kind-trigger")!;
    const listbox = document.querySelector<HTMLElement>(".s-kind-listbox")!;

    trigger.click();
    expect(listbox.hidden).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    trigger.click();
    expect(listbox.hidden).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("a real click on the open kind button closes the list instead of reopening it", async () => {
    await openOverlay();
    openActions();
    const trigger = document.querySelector<HTMLButtonElement>(".s-kind-trigger")!;
    const listbox = document.querySelector<HTMLElement>(".s-kind-listbox")!;

    trigger.click();
    expect(listbox.hidden).toBe(false);

    // In a real browser, mousedown moves focus from the listbox to the
    // button, firing `focusout` on the listbox *before* the click event.
    // WebKit and Firefox report `relatedTarget: null` for that move, so a
    // focusout-based dismissal would close the listbox and the following
    // click would reopen it — the button could then never close the list.
    listbox.focus();
    listbox.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    trigger.click();
    expect(listbox.hidden).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("scrolls the actions editor when neither side initially has enough room", async () => {
    await openOverlay();
    openActions();
    const trigger = document.querySelector<HTMLButtonElement>(".s-kind-trigger")!;
    const listbox = document.querySelector<HTMLElement>(".s-kind-listbox")!;
    const rows = document.querySelector<HTMLElement>("#actions-rows")!;
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({ top: 120, bottom: 160 } as DOMRect);
    vi.spyOn(rows, "getBoundingClientRect").mockReturnValue({ top: 100, bottom: 240 } as DOMRect);
    Object.defineProperty(listbox, "offsetHeight", { configurable: true, value: 160 });

    trigger.click();
    expect(rows.scrollTop).toBeGreaterThan(0);
    expect(listbox.classList.contains("open-up")).toBe(false);
  });

  it("a file-kind action shows only the file picker", async () => {
    await mount({ actions: [{ name: "Notes", kind: "file", value: "/tmp/notes.txt" }] });
    await openOverlay();
    openActions();
    const browse = document.querySelector<HTMLButtonElement>(".s-app-browse")!;
    const fileBrowse = document.querySelector<HTMLButtonElement>(".s-file-browse")!;
    const folderBrowse = document.querySelector<HTMLButtonElement>(".s-folder-browse")!;
    expect(browse.hidden).toBe(true);
    expect(fileBrowse.hidden).toBe(false);
    expect(folderBrowse.hidden).toBe(true);
    expect(fileBrowse.getAttribute("aria-label")).toBe("Browse files\u2026");
    expect(folderBrowse.getAttribute("aria-label")).toBe("Browse folders\u2026");
    expect(document.querySelector<HTMLInputElement>(".s-value")!.placeholder).toBe(
      "file path",
    );
  });

  it("a folder-kind action shows only the folder picker", async () => {
    await mount({ actions: [{ name: "Projects", kind: "folder", value: "" }] });
    await openOverlay();
    openActions();
    expect(document.querySelector<HTMLButtonElement>(".s-file-browse")!.hidden).toBe(true);
    expect(document.querySelector<HTMLButtonElement>(".s-folder-browse")!.hidden).toBe(false);
    expect(document.querySelector<HTMLInputElement>(".s-value")!.placeholder).toBe("folder path");
  });

  it("switching a row to file reveals the file picker and hides the app picker", async () => {
    await mount({ actions: [{ name: "Code", kind: "app", value: "/Applications/Code.app" }] });
    await openOverlay();
    openActions();
    const file = document.querySelector<HTMLButtonElement>('.s-kind-option[data-value="file"]')!;
    const browse = document.querySelector<HTMLButtonElement>(".s-app-browse")!;
    const fileBrowse = document.querySelector<HTMLButtonElement>(".s-file-browse")!;
    expect(browse.hidden).toBe(false);
    expect(fileBrowse.hidden).toBe(true);
    file.click();
    expect(browse.hidden).toBe(true);
    expect(fileBrowse.hidden).toBe(false);
    expect(document.querySelector<HTMLInputElement>(".s-value")!.placeholder).toBe(
      "file path",
    );
  });

  it("switching kind clears the stale value but keeps the name", async () => {
    await mount({ actions: [{ name: "Code", kind: "app", value: "/Applications/Code.app" }] });
    await openOverlay();
    openActions();
    const file = document.querySelector<HTMLButtonElement>('.s-kind-option[data-value="file"]')!;
    file.click();
    expect(document.querySelector<HTMLInputElement>(".s-value")!.value).toBe("");
    expect(document.querySelector<HTMLInputElement>(".s-name")!.value).toBe("Code");
  });

  it("re-selecting the same kind keeps the value", async () => {
    await mount({ actions: [{ name: "Code", kind: "app", value: "/Applications/Code.app" }] });
    await openOverlay();
    openActions();
    const app = document.querySelector<HTMLButtonElement>('.s-kind-option[data-value="app"]')!;
    app.click();
    expect(document.querySelector<HTMLInputElement>(".s-value")!.value).toBe(
      "/Applications/Code.app",
    );
  });

  it("picking a file fills the value and suggests the name from the basename", async () => {
    await mount({ actions: [{ name: "", kind: "file", value: "" }] });
    await openOverlay();
    openActions();
    dialog.open.mockResolvedValue("/Users/me/Downloads/notes.txt");
    document.querySelector<HTMLButtonElement>(".s-file-browse")!.click();
    await flush();
    expect(dialog.open).toHaveBeenCalledWith(
      expect.objectContaining({ directory: false, multiple: false }),
    );
    expect(document.querySelector<HTMLInputElement>(".s-value")!.value).toBe(
      "/Users/me/Downloads/notes.txt",
    );
    expect(document.querySelector<HTMLInputElement>(".s-name")!.value).toBe("notes.txt");
  });

  it("picking a folder fills the value and keeps a set name", async () => {
    await mount({ actions: [{ name: "Projects", kind: "folder", value: "" }] });
    await openOverlay();
    openActions();
    dialog.open.mockResolvedValue("C:\\Users\\me\\Projects");
    document.querySelector<HTMLButtonElement>(".s-folder-browse")!.click();
    await flush();
    expect(dialog.open).toHaveBeenCalledWith(expect.objectContaining({ directory: true }));
    expect(document.querySelector<HTMLInputElement>(".s-value")!.value).toBe(
      "C:\\Users\\me\\Projects",
    );
    expect(document.querySelector<HTMLInputElement>(".s-name")!.value).toBe("Projects");
  });

  it("a cancelled dialog leaves the row untouched", async () => {
    await mount({ actions: [{ name: "Notes", kind: "file", value: "" }] });
    await openOverlay();
    openActions();
    dialog.open.mockResolvedValue(null);
    document.querySelector<HTMLButtonElement>(".s-file-browse")!.click();
    await flush();
    expect(document.querySelector<HTMLInputElement>(".s-value")!.value).toBe("");
    expect(document.querySelector<HTMLInputElement>(".s-name")!.value).toBe("Notes");
  });

  it("saves a folder-kind action unchanged", async () => {
    await mount({ actions: [{ name: "Projects", kind: "folder", value: "/tmp/Projects" }] });
    await openOverlay();
    openActions();
    document.querySelector<HTMLButtonElement>("#actions-save")!.click();
    await flush();
    expect(invoke).toHaveBeenCalledWith(
      "save_config",
      expect.objectContaining({
        actions: [{ name: "Projects", kind: "folder", value: "/tmp/Projects" }],
      }),
    );
  });

  it("saves a file-kind action unchanged", async () => {
    await mount({ actions: [{ name: "Notes", kind: "file", value: "/tmp/notes.txt" }] });
    await openOverlay();
    openActions();
    document.querySelector<HTMLButtonElement>("#actions-save")!.click();
    await flush();
    expect(invoke).toHaveBeenCalledWith(
      "save_config",
      expect.objectContaining({
        actions: [{ name: "Notes", kind: "file", value: "/tmp/notes.txt" }],
      }),
    );
  });

  it("round-trips a config-set browser override without showing it", async () => {
    await mount({
      actions: [
        {
          name: "Arc",
          kind: "url",
          value: "https://arc.net",
          browser: "/Applications/Arc.app/Contents/MacOS/Arc",
        },
      ],
    });
    await openOverlay();
    openActions();
    expect(document.querySelector(".s-browser")).toBeNull();
    document.querySelector<HTMLButtonElement>("#actions-save")!.click();
    await flush();
    expect(invoke).toHaveBeenCalledWith(
      "save_config",
      expect.objectContaining({
        actions: [
          {
            name: "Arc",
            kind: "url",
            value: "https://arc.net",
            browser: "/Applications/Arc.app/Contents/MacOS/Arc",
          },
        ],
      }),
    );
  });
});

describe("app picker", () => {
  it("lists installed apps, filters them and fills the value field", async () => {
    await mount({
      actions: [{ name: "Code", kind: "app", value: "/Applications/Visual Studio Code.app" }],
    });
    await openOverlay();
    openActions();
    document.querySelector<HTMLButtonElement>(".s-app-browse")!.click();
    await flush();
    const list = document.querySelector<HTMLElement>(".ap-list")!;
    expect([...list.querySelectorAll(".ap-name")].map((el) => el.textContent)).toEqual([
      "Safari",
      "Visual Studio Code",
    ]);
    const search = document.querySelector<HTMLInputElement>(".ap-search")!;
    search.value = "saf";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect([...list.querySelectorAll(".ap-name")].map((el) => el.textContent)).toEqual([
      "Safari",
    ]);
    list.querySelector<HTMLButtonElement>(".ap-item")!.click();
    expect(document.querySelector<HTMLInputElement>(".s-value")!.value).toBe(
      "/System/Applications/Safari.app",
    );
  });

  it("navigates the app list with the keyboard and picks with Enter", async () => {
    await mount({
      actions: [{ name: "Code", kind: "app", value: "" }],
    });
    await openOverlay();
    openActions();
    document.querySelector<HTMLButtonElement>(".s-app-browse")!.click();
    await flush();
    const search = document.querySelector<HTMLInputElement>(".ap-search")!;
    key(search, "ArrowDown");
    key(search, "Enter");
    expect(document.querySelector<HTMLInputElement>(".s-value")!.value).toBe(
      "/System/Applications/Safari.app",
    );
    document.querySelector<HTMLButtonElement>(".s-app-browse")!.click();
    key(search, "ArrowDown");
    key(search, "ArrowDown");
    key(search, "Escape");
    expect((document.querySelector(".app-picker") as HTMLElement).hidden).toBe(true);
    expect(document.querySelector<HTMLButtonElement>(".s-app-browse")! === document.activeElement).toBe(
      true,
    );
  });
});

describe("groups", () => {
  const GROUPS: Group[] = [
    { id: "work", name: "Work", color: "#5e9eff" },
    { id: "dev", name: "Dev", color: "#30d158" },
  ];
  const GROUPED: Action[] = [
    { name: "Slack", kind: "url", value: "https://slack.com", group: "work" },
    { name: "GitHub", kind: "url", value: "https://github.com", group: "dev" },
    { name: "Google", kind: "url", value: "https://google.com" },
  ];

  it("colors chips by group and leaves ungrouped chips neutral", async () => {
    await mount({ actions: GROUPED, groups: GROUPS });
    await openOverlay();
    const chips = document.querySelectorAll<HTMLButtonElement>(".chip");
    expect(chips[0].dataset.group).toBe("work");
    expect(chips[0].style.getPropertyValue("--group-color")).toBe("#5e9eff");
    expect(chips[1].dataset.group).toBe("dev");
    expect(chips[1].style.getPropertyValue("--group-color")).toBe("#30d158");
    expect(chips[2].dataset.group).toBeUndefined();
    expect(chips[2].style.getPropertyValue("--group-color")).toBe("");
  });

  it("keeps an action referencing a missing group uncolored (lenient)", async () => {
    await mount({ actions: GROUPED, groups: GROUPS.slice(0, 1) });
    await openOverlay();
    const chip = document.querySelectorAll<HTMLButtonElement>(".chip")[1];
    expect(chip.dataset.group).toBeUndefined();
  });

  it("the editor lists groups and offers them per action", async () => {
    await mount({ actions: GROUPED, groups: GROUPS });
    await openOverlay();
    openActions();
    const names = [...document.querySelectorAll<HTMLInputElement>(".g-name")].map(
      (el) => el.value,
    );
    expect(names).toEqual(["Work", "Dev"]);
    expect(document.querySelector(".g-name-label")!.textContent).toBe("Name");
    expect(document.querySelector(".g-color-label")!.textContent).toBe("Color");
    expect(document.querySelector(".s-kind-listbox")!.getAttribute("aria-label")).toBe("Type");
    const trigger = document.querySelector<HTMLElement>(".s-group-trigger")!;
    expect(trigger.dataset.value).toBe("work");
    const listbox = document.querySelector<HTMLElement>(".s-group-picker")!;
    expect([...listbox.querySelectorAll<HTMLElement>(".sg-item")].map((o) => o.dataset.value)).toEqual(
      ["", "work", "dev"],
    );
  });

  it("Save sends groups and per-action group ids", async () => {
    await mount({ actions: GROUPED, groups: GROUPS });
    await openOverlay();
    openActions();
    document.querySelector<HTMLButtonElement>("#actions-save")!.click();
    await flush();
    expect(invoke).toHaveBeenCalledWith("save_config", {
      actions: [
        { name: "Slack", kind: "url", value: "https://slack.com", group: "work" },
        { name: "GitHub", kind: "url", value: "https://github.com", group: "dev" },
        { name: "Google", kind: "url", value: "https://google.com" },
      ],
      groups: GROUPS,
      language: null,
      magnify: true,
      showIcons: true,
      theme: null,
    });
  });

  it("adding a group row saves it with a unique id", async () => {
    await openOverlay();
    openActions();
    document.querySelector<HTMLButtonElement>(".g-add")!.click();
    const name = document.querySelector<HTMLInputElement>(".g-name")!;
    name.value = "Social";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLButtonElement>("#actions-save")!.click();
    await flush();
    expect(invoke).toHaveBeenCalledWith(
      "save_config",
      expect.objectContaining({
        groups: [{ id: "social", name: "Social", color: "#5e9eff" }],
      }),
    );
  });

  it("deleting a group row clears it from the action selects and the save", async () => {
    await mount({ actions: GROUPED, groups: GROUPS });
    await openOverlay();
    openActions();
    document.querySelectorAll<HTMLButtonElement>(".g-del")[0].click();
    const listbox = document.querySelector<HTMLElement>(".s-group-picker")!;
    expect([...listbox.querySelectorAll<HTMLElement>(".sg-item")].map((o) => o.dataset.value)).toEqual(
      ["", "dev"],
    );
    expect(document.querySelector<HTMLElement>(".s-group-trigger")!.dataset.value).toBe("");
    document.querySelector<HTMLButtonElement>("#actions-save")!.click();
    await flush();
    expect(invoke).toHaveBeenCalledWith(
      "save_config",
      expect.objectContaining({
        actions: [
          { name: "Slack", kind: "url", value: "https://slack.com" },
          { name: "GitHub", kind: "url", value: "https://github.com", group: "dev" },
          { name: "Google", kind: "url", value: "https://google.com" },
        ],
        groups: [GROUPS[1]],
      }),
    );
  });

  it("a too-dark custom color blocks saving with localized errors", async () => {
    await openOverlay();
    openActions();
    document.querySelector<HTMLButtonElement>(".g-add")!.click();
    const name = document.querySelector<HTMLInputElement>(".g-name")!;
    name.value = "Dark";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    const hex = document.querySelector<HTMLInputElement>(".g-hex")!;
    hex.value = "#0a0a0a";
    hex.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLButtonElement>("#actions-save")!.click();
    await flush();
    expect(document.querySelector(".g-error")!.textContent).toBe(
      "Too dark for the dark theme",
    );
    expect(document.querySelector("#actions-error")!.textContent).toBe(
      "Fill in a name and a color for every group",
    );
    expect(invoke).not.toHaveBeenCalledWith("save_config", expect.anything());
  });

  it("an invalid hex format shows the format error", async () => {
    await openOverlay();
    openActions();
    document.querySelector<HTMLButtonElement>(".g-add")!.click();
    const hex = document.querySelector<HTMLInputElement>(".g-hex")!;
    hex.value = "blue";
    hex.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector(".g-error")!.textContent).toBe(
      "Enter a 6-digit hex color",
    );
  });

  it("picks a group from the custom listbox with the keyboard and closes with Escape", async () => {
    await mount({ actions: GROUPED, groups: GROUPS });
    await openOverlay();
    openActions();
    const trigger = document.querySelector<HTMLButtonElement>(".s-group-trigger")!;
    const listbox = document.querySelector<HTMLElement>(".s-group-picker")!;
    expect(listbox.hidden).toBe(true);
    trigger.click();
    expect(listbox.hidden).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const items = [...listbox.querySelectorAll<HTMLElement>(".sg-item")];
    expect(items.map((o) => o.dataset.value)).toEqual(["", "work", "dev"]);
    expect(items[1].getAttribute("aria-selected")).toBe("true");
    expect(listbox.getAttribute("aria-activedescendant")).toBe(items[1].id);
    key(listbox, "ArrowDown");
    expect(listbox.getAttribute("aria-activedescendant")).toBe(items[2].id);
    key(listbox, "Home");
    expect(listbox.getAttribute("aria-activedescendant")).toBe(items[0].id);
    key(listbox, "Enter");
    expect(trigger.dataset.value).toBe("");
    expect(listbox.hidden).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
    trigger.click();
    key(listbox, "ArrowDown");
    key(listbox, "ArrowDown");
    key(listbox, "Enter");
    expect(trigger.dataset.value).toBe("dev");
    expect(trigger.textContent).toBe("Dev");
    trigger.click();
    key(listbox, "Escape");
    expect(listbox.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it("picks a group from the listbox with the mouse", async () => {
    await mount({ actions: GROUPED, groups: GROUPS });
    await openOverlay();
    openActions();
    const trigger = document.querySelector<HTMLButtonElement>(".s-group-trigger")!;
    const listbox = document.querySelector<HTMLElement>(".s-group-picker")!;
    trigger.click();
    const items = [...listbox.querySelectorAll<HTMLElement>(".sg-item")];
    items[2].click();
    expect(trigger.dataset.value).toBe("dev");
    expect(listbox.hidden).toBe(true);
  });

  it("renaming a group updates the picker options and selected trigger label", async () => {
    await mount({ actions: GROUPED, groups: GROUPS });
    await openOverlay();
    openActions();
    const name = document.querySelector<HTMLInputElement>(".g-name")!;
    name.value = "Engineering";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    const trigger = document.querySelector<HTMLElement>(".s-group-trigger")!;
    expect(trigger.textContent).toBe("Engineering");
    const listbox = document.querySelector<HTMLElement>(".s-group-picker")!;
    expect(
      [...listbox.querySelectorAll<HTMLElement>(".sg-item")].map((o) => o.textContent),
    ).toEqual(["No group", "Engineering", "Dev"]);
  });

  it("picks a palette color with the keyboard and closes with Escape", async () => {
    await openOverlay();
    openActions();
    document.querySelector<HTMLButtonElement>(".g-add")!.click();
    const swatch = document.querySelector<HTMLButtonElement>(".g-swatch")!;
    swatch.click();
    const grid = document.querySelector<HTMLElement>(".gp-grid")!;
    const items = grid.querySelectorAll<HTMLButtonElement>(".gp-item");
    expect(items[0].tabIndex).toBe(0);
    key(grid, "ArrowRight");
    expect(items[1].tabIndex).toBe(0);
    key(items[1], "Enter");
    expect(document.querySelector<HTMLInputElement>(".g-hex")!.value).toBe("#64d2ff");
    expect((document.querySelector(".g-picker") as HTMLElement).hidden).toBe(true);
    swatch.click();
    key(document.querySelector<HTMLInputElement>(".g-hex")!, "Escape");
    expect((document.querySelector(".g-picker") as HTMLElement).hidden).toBe(true);
    expect(swatch.getAttribute("aria-expanded")).toBe("false");
  });

  it("switching the language re-localizes the group editor", async () => {
    await mount({ groups: GROUPS });
    await openOverlay();
    document.querySelector<HTMLButtonElement>("#hub")!.click();
    const select = document.querySelector<HTMLSelectElement>("#settings-lang")!;
    select.value = "es";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector<HTMLButtonElement>("#settings-save")!.click();
    await flush();
    eventHandlers["config-reloaded"]?.({
      payload: { actions: [], groups: GROUPS, language: "es", magnify: true, showIcons: true },
    });
    await flush();
    openActions();
    expect(document.querySelector(".settings-groups-title")!.textContent).toBe("Grupos");
    expect(document.querySelector<HTMLButtonElement>(".g-add")!.textContent).toBe(
      "Añadir grupo",
    );
  });
});

describe("group actions button", () => {
  const GROUPS: Group[] = [
    { id: "work", name: "Work", color: "#5e9eff" },
    { id: "dev", name: "Dev", color: "#30d158" },
  ];
  const INTERLEAVED: Action[] = [
    { name: "Slack", kind: "url", value: "https://slack.com", group: "work" },
    { name: "GitHub", kind: "url", value: "https://github.com", group: "dev" },
    { name: "Google", kind: "url", value: "https://google.com" },
    { name: "Notion", kind: "url", value: "https://notion.com", group: "work" },
    { name: "Linear", kind: "url", value: "https://linear.app", group: "dev" },
  ];
  const rowNames = (): string[] =>
    [...document.querySelectorAll<HTMLInputElement>(".settings-row .s-name")].map(
      (input) => input.value,
    );
  const rowGroups = (): string[] =>
    [...document.querySelectorAll<HTMLElement>(".settings-row .s-group-trigger")].map(
      (el) => el.dataset.value ?? "",
    );

  it("groups together the actions of each group with one click", async () => {
    await mount({ actions: INTERLEAVED, groups: GROUPS });
    await openOverlay();
    openActions();
    expect(rowNames()).toEqual(["Slack", "GitHub", "Google", "Notion", "Linear"]);
    document.querySelector<HTMLButtonElement>("#actions-group")!.click();
    expect(rowNames()).toEqual(["Slack", "Notion", "GitHub", "Linear", "Google"]);
    expect(rowGroups()).toEqual(["work", "work", "dev", "dev", ""]);
    expect(document.querySelector("#actions-status")!.textContent).toBe(
      "Actions grouped by group",
    );
  });

  it("moves the row nodes, keeping each action's controls attached", async () => {
    await mount({ actions: INTERLEAVED, groups: GROUPS });
    await openOverlay();
    openActions();
    const [slack] = [...document.querySelectorAll<HTMLElement>(".settings-row")];
    document.querySelector<HTMLButtonElement>("#actions-group")!.click();
    expect(slack.querySelector<HTMLInputElement>(".s-name")!.value).toBe("Slack");
    expect(slack.querySelector<HTMLElement>(".s-group-trigger")!.dataset.value).toBe("work");
    expect(
      [...document.querySelectorAll<HTMLElement>(".settings-row")][0] === slack,
    ).toBe(true);
  });

  it("persists the grouped order when saving", async () => {
    await mount({ actions: INTERLEAVED, groups: GROUPS });
    await openOverlay();
    openActions();
    document.querySelector<HTMLButtonElement>("#actions-group")!.click();
    document.querySelector<HTMLButtonElement>("#actions-save")!.click();
    await flush();
    expect(invoke).toHaveBeenCalledWith(
      "save_config",
      expect.objectContaining({
        actions: [
          INTERLEAVED[0],
          INTERLEAVED[3],
          INTERLEAVED[1],
          INTERLEAVED[4],
          INTERLEAVED[2],
        ],
        groups: GROUPS,
      }),
    );
  });

  it("keeps the boundary buttons of the reordered list in sync", async () => {
    await mount({ actions: INTERLEAVED, groups: GROUPS });
    await openOverlay();
    openActions();
    document.querySelector<HTMLButtonElement>("#actions-group")!.click();
    const rows = [...document.querySelectorAll<HTMLElement>(".settings-row")];
    expect(rows[0].querySelector<HTMLButtonElement>(".s-move-up")!.disabled).toBe(true);
    expect(rows[4].querySelector<HTMLButtonElement>(".s-move-down")!.disabled).toBe(true);
    expect(rows[1].querySelector<HTMLButtonElement>(".s-move-up")!.disabled).toBe(false);
  });

  it("is a no-op on lists that are already grouped and leaves the status untouched", async () => {
    await mount({ actions: INTERLEAVED.slice(0, 3), groups: GROUPS });
    await openOverlay();
    openActions();
    document.querySelector<HTMLButtonElement>("#actions-group")!.click();
    expect(rowNames()).toEqual(["Slack", "GitHub", "Google"]);
    expect(document.querySelector("#actions-status")!.textContent).toBe("");
  });

  it("localizes the button label", async () => {
    await mount({ actions: INTERLEAVED, groups: GROUPS });
    await openOverlay();
    openActions();
    expect(document.querySelector<HTMLButtonElement>("#actions-group")!.textContent).toBe(
      "Group actions",
    );
    document.querySelector<HTMLButtonElement>("#actions-close")!.click();
    document.querySelector<HTMLButtonElement>("#hub")!.click();
    const select = document.querySelector<HTMLSelectElement>("#settings-lang")!;
    select.value = "es";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector<HTMLButtonElement>("#settings-save")!.click();
    await flush();
    eventHandlers["config-reloaded"]?.({
      payload: { actions: INTERLEAVED, groups: GROUPS, language: "es", magnify: true, showIcons: true },
    });
    await flush();
    openActions();
    expect(document.querySelector<HTMLButtonElement>("#actions-group")!.textContent).toBe(
      "Agrupar acciones",
    );
  });
});

describe("update popup", () => {
  const FAKE_UPDATE = (version = "0.2.0") => ({
    version,
    date: "2026-08-13T00:00:00Z",
    body: "",
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
  });

  const popup = (): HTMLElement => document.querySelector<HTMLElement>("#update-popup")!;
  const isOpen = (): boolean => popup().classList.contains("open");

  it("stays hidden when no update is available", async () => {
    await openOverlay();
    expect(isOpen()).toBe(false);
    expect(document.querySelector("#update")).toBeNull();
  });

  it("shows the popup with the target version when an update is found", async () => {
    await mount();
    updater.check.mockResolvedValue(FAKE_UPDATE());
    await openOverlay();
    expect(isOpen()).toBe(true);
    expect(document.querySelector("#update-popup-desc")!.textContent).toBe(
      "QuickSpot v0.2.0 is available.",
    );
    expect(document.querySelector<HTMLButtonElement>("#update-popup-now")!.textContent).toBe(
      "Update now",
    );
  });

  it("update now downloads, installs and relaunches into the new version", async () => {
    await mount();
    const update = FAKE_UPDATE();
    updater.check.mockResolvedValue(update);
    await openOverlay();
    document.querySelector<HTMLButtonElement>("#update-popup-now")!.click();
    await flush();
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(processPlugin.relaunch).toHaveBeenCalledTimes(1);
  });

  it("shows the download progress in the popup and disables its buttons", async () => {
    await mount();
    const update = FAKE_UPDATE();
    let resolveInstall!: () => void;
    const installGate = new Promise<void>((resolve) => {
      resolveInstall = resolve;
    });
    update.downloadAndInstall = vi.fn().mockImplementation(async (onEvent) => {
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 40 } });
      onEvent({ event: "Progress", data: { chunkLength: 20 } });
      await installGate;
    });
    updater.check.mockResolvedValue(update);
    await openOverlay();
    document.querySelector<HTMLButtonElement>("#update-popup-now")!.click();
    await flush();
    expect(document.querySelector("#update-popup-status")!.textContent).toBe("Downloading 60%");
    expect(document.querySelector<HTMLButtonElement>("#update-popup-now")!.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>("#update-popup-later")!.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>("#update-popup-next")!.disabled).toBe(true);
    resolveInstall();
    await flush();
    expect(document.querySelector("#update-popup-status")!.textContent).toBe("Installing…");
  });

  it("reports a failed install in the popup and re-enables its buttons", async () => {
    await mount();
    const update = FAKE_UPDATE();
    update.downloadAndInstall = vi.fn().mockRejectedValue(new Error("network"));
    updater.check.mockResolvedValue(update);
    await openOverlay();
    document.querySelector<HTMLButtonElement>("#update-popup-now")!.click();
    await flush();
    expect(isOpen()).toBe(true);
    expect(document.querySelector("#update-popup-error")!.textContent).toBe(
      "Couldn't install: network",
    );
    expect(document.querySelector<HTMLButtonElement>("#update-popup-now")!.disabled).toBe(false);
  });

  it("later snoozes this version until a manual check or a new version", async () => {
    await mount();
    updater.check.mockResolvedValue(FAKE_UPDATE());
    await openOverlay();
    expect(isOpen()).toBe(true);
    document.querySelector<HTMLButtonElement>("#update-popup-later")!.click();
    expect(isOpen()).toBe(false);
    // Next auto open is throttled/snoozed: no popup for the same version.
    await openOverlay();
    expect(isOpen()).toBe(false);
  });

  it("on next open defers and auto-installs without prompting", async () => {
    await mount();
    const update = FAKE_UPDATE();
    updater.check.mockResolvedValue(update);
    await openOverlay();
    expect(isOpen()).toBe(true);
    document.querySelector<HTMLButtonElement>("#update-popup-next")!.click();
    expect(isOpen()).toBe(false);
    expect(window.localStorage.getItem("quickspot.update.nextOpenVersion")).toBe("0.2.0");
    // Next overlay open auto-installs the deferred version.
    eventHandlers["overlay-open"]?.({ payload: undefined });
    await flush();
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(processPlugin.relaunch).toHaveBeenCalledTimes(1);
  });

  it("escape dismisses the popup like later", async () => {
    await mount();
    updater.check.mockResolvedValue(FAKE_UPDATE());
    await openOverlay();
    expect(isOpen()).toBe(true);
    document
      .querySelector<HTMLInputElement>("#query")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(isOpen()).toBe(false);
    await openOverlay();
    expect(isOpen()).toBe(false);
  });

  it("localizes the popup", async () => {
    await mount({ language: "es" });
    updater.check.mockResolvedValue(FAKE_UPDATE());
    await openOverlay();
    expect(isOpen()).toBe(true);
    expect(document.querySelector("#update-popup-desc")!.textContent).toBe(
      "QuickSpot v0.2.0 está disponible.",
    );
    expect(document.querySelector<HTMLButtonElement>("#update-popup-now")!.textContent).toBe(
      "Actualizar ahora",
    );
    expect(document.querySelector<HTMLButtonElement>("#update-popup-later")!.textContent).toBe(
      "Más tarde",
    );
    expect(document.querySelector<HTMLButtonElement>("#update-popup-next")!.textContent).toBe(
      "En la próxima apertura",
    );
  });
});

describe("settings update check", () => {
  const FAKE_UPDATE = () => ({
    version: "0.2.0",
    date: "2026-08-13T00:00:00Z",
    body: "",
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
  });

  const openSettings = (): void => {
    document.querySelector<HTMLButtonElement>("#hub")!.click();
  };

  const updateBtn = (): HTMLButtonElement =>
    document.querySelector<HTMLButtonElement>("#settings-update-check")!;

  it("forces a check on click and reports when the app is up to date", async () => {
    await openOverlay();
    openSettings();
    const btn = updateBtn();
    expect(document.querySelector("#settings-update-label")!.textContent).toBe("Check for updates");
    expect(btn.textContent).toBe("Check now");
    expect(btn.disabled).toBe(false);
    btn.click();
    await flush();
    // The manual click bypasses the 5-minute interval guard, so the server
    // is hit once by the auto-check on open and once by the manual one.
    expect(updater.check).toHaveBeenCalledTimes(2);
    expect(btn.textContent).toBe("Up to date");
    expect(btn.disabled).toBe(true);
    expect(btn.classList.contains("available")).toBe(false);
  });

  it("offers the pending update and installs it from the settings row", async () => {
    await openOverlay();
    const update = FAKE_UPDATE();
    updater.check.mockResolvedValue(update);
    openSettings();
    const btn = updateBtn();
    btn.click();
    await flush();
    expect(btn.textContent).toBe("Update to v0.2.0");
    expect(btn.disabled).toBe(false);
    expect(btn.classList.contains("available")).toBe(true);
    btn.click();
    await flush();
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(processPlugin.relaunch).toHaveBeenCalledTimes(1);
  });

  it("reports a failed check in the footer error and re-enables the button", async () => {
    await openOverlay();
    updater.check.mockRejectedValueOnce(new Error("offline"));
    openSettings();
    const btn = updateBtn();
    btn.click();
    await flush();
    expect(btn.textContent).toBe("Check now");
    expect(btn.disabled).toBe(false);
    const error = document.querySelector("#settings-error")!;
    expect(error.textContent).toBe("Couldn't check for updates");
    expect(error.classList.contains("visible")).toBe(true);
  });

  it("localizes the settings update row", async () => {
    await openOverlay();
    openSettings();
    const select = document.querySelector<HTMLSelectElement>("#settings-lang")!;
    select.value = "es";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(document.querySelector("#settings-update-label")!.textContent).toBe(
      "Buscar actualizaciones",
    );
    expect(updateBtn().textContent).toBe("Buscar ahora");
  });
});

describe("sequence actions", () => {
  it("offers Sequence in the kind picker with its own icon", async () => {
    await openOverlay();
    openActions();
    const option = document.querySelector<HTMLButtonElement>(
      '.settings-row-top .s-kind-option[data-value="sequence"]',
    );
    expect(option).not.toBeNull();
    expect(option!.textContent).toBe("Sequence");
    expect(option!.querySelector("svg")).not.toBeNull();
  });

  it("switching a row to sequence reveals the steps editor with one empty step", async () => {
    await mount({ actions: [{ name: "Code", kind: "app", value: "/Applications/Code.app" }] });
    await openOverlay();
    openActions();
    const row = document.querySelector<HTMLElement>(".settings-row")!;
    expect(row.classList.contains("kind-sequence")).toBe(false);
    document
      .querySelector<HTMLButtonElement>('.settings-row-top .s-kind-option[data-value="sequence"]')!
      .click();
    expect(row.classList.contains("kind-sequence")).toBe(true);
    expect(row.querySelectorAll(".s-step").length).toBe(1);
    expect(row.querySelector(".s-steps-count")!.textContent).toBe("1 of 5 steps");
  });

  it("adds steps up to five then disables the add button", async () => {
    await mount({ actions: [{ name: "Morning", kind: "url", value: "https://example.com" }] });
    await openOverlay();
    openActions();
    document
      .querySelector<HTMLButtonElement>('.settings-row-top .s-kind-option[data-value="sequence"]')!
      .click();
    const row = document.querySelector<HTMLElement>(".settings-row")!;
    const add = row.querySelector<HTMLButtonElement>(".s-steps-add")!;
    const fillStep = (i: number, value: string): void => {
      const input = row.querySelectorAll<HTMLInputElement>(".s-step-value")[i];
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    fillStep(0, "https://a.dev");
    for (let i = 1; i < 5; i++) {
      add.click();
      fillStep(i, `https://example.com/${i}`);
    }
    expect(row.querySelectorAll(".s-step").length).toBe(5);
    expect(row.querySelector(".s-steps-count")!.textContent).toBe("5 of 5 steps");
    expect(add.disabled).toBe(true);
    add.click();
    expect(row.querySelectorAll(".s-step").length).toBe(5);
  });

  it("blocks saving an empty sequence with the sequence hint", async () => {
    await mount({ actions: [{ name: "Morning", kind: "url", value: "https://example.com" }] });
    await openOverlay();
    openActions();
    document
      .querySelector<HTMLButtonElement>('.settings-row-top .s-kind-option[data-value="sequence"]')!
      .click();
    document.querySelector<HTMLButtonElement>("#actions-save")!.click();
    await flush();
    expect(document.querySelector("#actions-error")!.textContent).toBe(
      "Sequences need a name and at least one step with a value",
    );
    expect(invoke).not.toHaveBeenCalledWith("save_config", expect.anything());
  });

  it("saves a sequence with ordered leaf steps and no parent value", async () => {
    await mount({
      actions: [
        {
          name: "Morning",
          kind: "sequence",
          value: "",
          steps: [
            { kind: "folder", value: "/tmp/Projects" },
            { kind: "url", value: "https://example.com" },
          ],
        },
      ],
    });
    await openOverlay();
    openActions();
    expect(document.querySelectorAll(".s-step").length).toBe(2);
    document.querySelector<HTMLButtonElement>("#actions-save")!.click();
    await flush();
    expect(invoke).toHaveBeenCalledWith(
      "save_config",
      expect.objectContaining({
        actions: [
          {
            name: "Morning",
            kind: "sequence",
            value: "",
            steps: [
              { kind: "folder", value: "/tmp/Projects" },
              { kind: "url", value: "https://example.com" },
            ],
          },
        ],
      }),
    );
  });

  it("step kind pickers never offer a nested sequence", async () => {
    await mount({
      actions: [
        {
          name: "Morning",
          kind: "sequence",
          value: "",
          steps: [{ kind: "url", value: "https://example.com" }],
        },
      ],
    });
    await openOverlay();
    openActions();
    const step = document.querySelector<HTMLElement>(".s-step")!;
    expect(
      step.querySelector<HTMLButtonElement>('.s-kind-option[data-value="sequence"]'),
    ).toBeNull();
    expect(
      [...step.querySelectorAll<HTMLElement>(".s-kind-option")].map((o) => o.dataset.value),
    ).toEqual(["url", "command", "app", "file", "folder"]);
  });

  it("renders a sequence chip with the sequence icon and runs it via execute", async () => {
    await mount({
      actions: [
        {
          name: "Morning",
          kind: "sequence",
          value: "",
          steps: [
            { kind: "folder", value: "/tmp/Projects" },
            { kind: "url", value: "https://example.com" },
          ],
        },
      ],
    });
    const icon = document.querySelector<HTMLElement>(".chip-icon")!;
    expect(icon.innerHTML).toContain("M12 2l9 5-9 5-9-5 9-5z");
    document.querySelectorAll<HTMLButtonElement>(".chip")[0].click();
    expect(invoke).toHaveBeenCalledWith("execute", { index: 0 });
  });

  it("wheeling the editor dismisses an open kind picker", async () => {
    await openOverlay();
    openActions();
    const trigger = document.querySelector<HTMLButtonElement>(".s-kind-trigger")!;
    const listbox = document.querySelector<HTMLElement>(".s-kind-listbox")!;
    trigger.click();
    expect(listbox.hidden).toBe(false);
    document
      .querySelector<HTMLElement>("#actions-rows")!
      .dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    expect(listbox.hidden).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("wheeling over the open menu itself keeps it open", async () => {
    await openOverlay();
    openActions();
    const listbox = document.querySelector<HTMLElement>(".s-kind-listbox")!;
    document.querySelector<HTMLButtonElement>(".s-kind-trigger")!.click();
    expect(listbox.hidden).toBe(false);
    listbox.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    expect(listbox.hidden).toBe(false);
  });

  it("scrolling the editor after open dismisses a step kind picker", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    await mount({
      actions: [
        {
          name: "Morning",
          kind: "sequence",
          value: "",
          steps: [{ kind: "url", value: "https://example.com" }],
        },
      ],
    });
    await openOverlay();
    openActions();
    const stepTrigger = document.querySelector<HTMLElement>(".s-step .s-kind-trigger")!;
    const stepListbox = document.querySelector<HTMLElement>(".s-step .s-kind-listbox")!;
    stepTrigger.click();
    expect(stepListbox.hidden).toBe(false);
    // Move past the open-race guard, then scroll the editor like a
    // scrollbar drag (no wheel involved).
    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + 500);
    document.querySelector<HTMLElement>("#actions-rows")!.dispatchEvent(new Event("scroll"));
    expect(stepListbox.hidden).toBe(true);
    vi.spyOn(Date, "now").mockRestore?.();
  });
});

describe("panel resize", () => {
  function pressHandle(selector: string, init: PointerEventInit = {}): HTMLElement {
    const handle = document.querySelector<HTMLElement>(selector)!;
    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        isPrimary: true,
        clientX: 100,
        clientY: 100,
        pointerId: 7,
        ...init,
      }),
    );
    return handle;
  }

  it("starts a native OS resize drag from a panel handle", async () => {
    await mount();
    pressHandle("#actions .rh-se");
    await flush();
    expect(windowApi.startResizeDragging).toHaveBeenCalledTimes(1);
    expect(windowApi.startResizeDragging).toHaveBeenCalledWith("SouthEast");
    expect(windowApi.setSize).not.toHaveBeenCalled();
  });

  it("ignores non-primary and non-left presses", async () => {
    await mount();
    pressHandle("#actions .rh-se", { button: 2 });
    pressHandle("#settings .rh-n", { isPrimary: false });
    await flush();
    expect(windowApi.startResizeDragging).not.toHaveBeenCalled();
    expect(windowApi.setSize).not.toHaveBeenCalled();
  });

  it("falls back to a manual east resize when native drag is unsupported", async () => {
    await mount();
    // macOS backend (tao) rejects programmatic resize drags.
    windowApi.startResizeDragging.mockRejectedValueOnce(new Error("NotSupported"));
    const handle = pressHandle("#settings .rh-e");
    await flush();
    handle.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: 160,
        clientY: 100,
        pointerId: 7,
      }),
    );
    rafCb?.(virtualNow);
    expect(windowApi.setSize).toHaveBeenCalledTimes(1);
    const size = windowApi.setSize.mock.calls[0][0] as { width: number; height: number };
    expect(size).toBeInstanceOf(windowApi.LogicalSize);
    // jsdom viewport is 1024x768: east grows width only.
    expect(size.width).toBe(1024 + 60);
    expect(size.height).toBe(768);
    expect(windowApi.setPosition).not.toHaveBeenCalled();
    handle.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 7 }));
  });

  it("anchors the opposite edge when manually resizing west/north", async () => {
    await mount();
    windowApi.startResizeDragging.mockRejectedValueOnce(new Error("NotSupported"));
    const handle = pressHandle("#actions .rh-nw");
    await flush();
    handle.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: 60,
        clientY: 70,
        pointerId: 7,
      }),
    );
    rafCb?.(virtualNow);
    const size = windowApi.setSize.mock.calls[0][0] as { width: number; height: number };
    expect(size.width).toBe(1024 + 40);
    expect(size.height).toBe(768 + 30);
    // outer (200,200) @2x -> logical (100,100); the south-east corner stays.
    expect(windowApi.setPosition).toHaveBeenCalledTimes(1);
    const pos = windowApi.setPosition.mock.calls[0][0] as { x: number; y: number };
    expect(pos).toBeInstanceOf(windowApi.LogicalPosition);
    expect(pos.x).toBe(100 - 40);
    expect(pos.y).toBe(100 - 30);
    handle.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 7 }));
  });

  it("drives a manual resize directly on macOS (no native drag backend)", async () => {    const previous = navigator.platform;
    Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
    try {
      await mount();
      const handle = pressHandle("#settings .rh-e");
      await flush();
      // tao macOS silently no-ops programmatic drags, so the frontend must
      // not even offer the gesture: no native call, straight to setSize.
      expect(windowApi.startResizeDragging).not.toHaveBeenCalled();
      handle.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 160,
          clientY: 100,
          pointerId: 7,
        }),
      );
      rafCb?.(virtualNow);
      expect(windowApi.setSize).toHaveBeenCalledTimes(1);
      const size = windowApi.setSize.mock.calls[0][0] as { width: number; height: number };
      expect(size.width).toBe(1024 + 60);
      expect(size.height).toBe(768);
      handle.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 7 }));
    } finally {
      Object.defineProperty(navigator, "platform", { value: previous, configurable: true });
    }
  });
});

describe("panel drag", () => {
  function dragCalls(): string[] {
    return invoke.mock.calls
      .map((call) => call[0] as string)
      .filter((cmd) => cmd === "drag_start" || cmd === "drag_end");
  }

  it("starts a native move from the settings header chrome", async () => {
    await mount();
    document.querySelector<HTMLElement>("#settings-title")!.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        isPrimary: true,
        pointerId: 3,
      }),
    );
    expect(dragCalls()).toEqual(["drag_start"]);
  });

  it("starts a native move from the actions header chrome", async () => {
    await mount();
    document.querySelector<HTMLElement>("#actions-header")!.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        isPrimary: true,
        pointerId: 3,
      }),
    );
    expect(dragCalls()).toEqual(["drag_start"]);
  });

  it("never hijacks header controls (close keeps working)", async () => {
    await mount();
    document.querySelector<HTMLButtonElement>("#settings-close")!.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        isPrimary: true,
        pointerId: 3,
      }),
    );
    document.querySelector<HTMLButtonElement>("#actions-close")!.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        isPrimary: true,
        pointerId: 3,
      }),
    );
    expect(dragCalls()).toEqual([]);
  });
});
