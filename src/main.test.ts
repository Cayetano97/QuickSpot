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
vi.mock("@tauri-apps/api/event", () => ({ listen }));

const autostart = vi.hoisted(() => ({
  enable: vi.fn().mockResolvedValue(undefined),
  disable: vi.fn().mockResolvedValue(undefined),
  isEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock("@tauri-apps/plugin-autostart", () => autostart);

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

/** Stub the animation clock and the rAF loop; frames only advance on demand. */
function installGlobals(): void {
  virtualNow = 0;
  rafCb = null;
  vi.spyOn(performance, "now").mockImplementation(() => virtualNow);
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
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
      <div id="query-wrap"><span id="query-mirror"></span><span id="caret"></span></div>
      <div id="empty-state" role="status" aria-live="polite" aria-atomic="true"></div>
      <div id="run-error" role="alert" aria-live="assertive" aria-hidden="true"></div>
      <input id="query" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Search actions" />
      <button id="minimize"></button>
      <div id="grip"></div>
      <form id="settings" role="dialog" aria-modal="true" aria-hidden="true">
        <div id="settings-header">
          <span id="settings-title">Settings</span>

        </div>
        <section class="settings-section" id="settings-general" aria-labelledby="settings-general-heading">
          <h2 class="settings-section-title" id="settings-general-heading">General</h2>
          <div class="settings-general-rows">
            <div class="settings-field">
              <label for="settings-lang" id="settings-language-label">Language</label>
              <select id="settings-lang" aria-label="Language">
                <option value="system">System default</option>
                <option value="en">English</option>
                <option value="es">Español</option>
              </select>
            </div>
            <div class="settings-field">
              <label for="settings-magnify" id="settings-dock-label">Magnify on hover</label>
              <label class="switch">
                <input id="settings-magnify" type="checkbox" />
                <span class="switch-track"></span>
              </label>
            </div>
            <div class="settings-field">
              <label for="settings-autostart" id="settings-autostart-label">Launch at login</label>
              <label class="switch">
                <input id="settings-autostart" type="checkbox" />
                <span class="switch-track"></span>
              </label>
            </div>
          </div>
        </section>
        <div id="settings-footer">
          <span id="settings-error"></span>
          <button id="settings-save" type="submit">Save</button>
        </div>
      </form>
      <form id="actions" role="dialog" aria-modal="true" aria-hidden="true">
        <div id="actions-header">
          <span id="actions-title">Actions</span>

        </div>
        <div id="actions-rows"></div>
        <div id="actions-footer">
          <span id="actions-error"></span>
          <button id="actions-save" type="submit">Save</button>
        </div>
      </form>
    </main>`;
}

async function mount(config?: {
  actions?: Action[];
  groups?: Group[];
  language?: string | null;
  magnify?: boolean;
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
      });
    }
    if (cmd === "list_apps") return Promise.resolve(INSTALLED_APPS);
    return Promise.resolve(undefined);
  });
  autostart.enable.mockClear();
  autostart.disable.mockClear();
  autostart.isEnabled.mockClear();
  autostart.isEnabled.mockResolvedValue(false);
  listen.mockReset();
  listen.mockImplementation((name: string, handler: (event: { payload?: unknown }) => void) => {
    eventHandlers[name] = handler;
    return Promise.resolve(() => {});
  });
  installGlobals();
  installDom();
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

  it("clearing the query restores every action", () => {
    typeQuery("g");
    typeQuery("");
    expect(visibleChips()).toBe(4);
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
      },
    });
    expect(chipLabels()[0]).toBe("New");
    expect(visibleChips()).toBe(1);
    expect(document.documentElement.lang).toBe("es");
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
    });
    expect(document.querySelector("#settings")!.classList.contains("open")).toBe(false);
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
    const lang = document.querySelector<HTMLSelectElement>("#settings-lang")!;
    save.focus();
    key(save, "Tab");
    expect(document.activeElement).toBe(lang);
    key(lang, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(save);
    document.querySelector<HTMLButtonElement>("#hub")!.click();
    expect(hub.tabIndex).toBe(0);
    expect(minimize.tabIndex).toBe(0);
    expect(query.tabIndex).toBe(0);
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
    });
    expect(document.querySelector("#actions")!.classList.contains("open")).toBe(false);
  });

  it("shows the action count and an empty hint when there are no actions", async () => {
    await mount({ actions: [] });
    await openOverlay();
    openActions();
    expect(document.querySelector(".settings-actions-count")!.textContent).toBe("0");
    expect(
      (document.querySelector(".settings-actions-empty") as HTMLElement).hidden,
    ).toBe(false);
    document.querySelector<HTMLButtonElement>("#actions-add")!.click();
    expect(
      (document.querySelector(".settings-actions-empty") as HTMLElement).hidden,
    ).toBe(true);
    expect(document.querySelector(".settings-actions-count")!.textContent).toBe("1");
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
    const sel = document.querySelector<HTMLSelectElement>(".s-group")!;
    expect([...sel.options].map((o) => o.value)).toEqual(["", "work", "dev"]);
    expect(sel.value).toBe("work");
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
    const sel = document.querySelector<HTMLSelectElement>(".s-group")!;
    expect([...sel.options].map((o) => o.value)).toEqual(["", "dev"]);
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
      payload: { actions: [], groups: GROUPS, language: "es", magnify: true },
    });
    await flush();
    openActions();
    expect(document.querySelector(".settings-groups-title")!.textContent).toBe("Grupos");
    expect(document.querySelector<HTMLButtonElement>(".g-add")!.textContent).toBe(
      "Añadir grupo",
    );
  });
});
