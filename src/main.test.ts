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
import type { Action } from "./lib/model";

const { invoke, listen } = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));

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
      <div id="query-wrap"><span id="query-mirror"></span><span id="caret"></span></div>
      <div id="empty-state" role="status" aria-live="polite" aria-atomic="true"></div>
      <div id="run-error" role="alert" aria-live="assertive" aria-hidden="true"></div>
      <input id="query" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Search actions" />
      <button id="minimize"></button>
      <div id="grip"></div>
      <div id="settings" aria-hidden="true">
        <div id="settings-header">
          <span id="settings-title">Settings</span>
          <button id="settings-done" type="button">Done</button>
        </div>
        <div id="settings-language">
          <span id="settings-language-label">Language</span>
          <select id="settings-lang" aria-label="Language">
            <option value="system">System default</option>
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </div>
        <div id="settings-dock">
          <span id="settings-dock-label">Magnify on hover</span>
          <label class="switch">
            <input id="settings-magnify" type="checkbox" />
            <span class="switch-track"></span>
          </label>
        </div>
        <div id="settings-rows"></div>
        <div id="settings-footer">
          <span id="settings-error"></span>
          <button id="settings-add" type="button">Add action</button>
          <button id="settings-save" type="button">Save</button>
        </div>
      </div>
    </main>`;
}

async function mount(config?: {
  actions?: Action[];
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
        language: config?.language ?? null,
        magnify: config?.magnify ?? true,
      });
    }
    if (cmd === "list_apps") return Promise.resolve(INSTALLED_APPS);
    return Promise.resolve(undefined);
  });
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

  it("blocks saving incomplete rows with a localized validation error", async () => {
    await openOverlay();
    document.querySelector<HTMLButtonElement>("#hub")!.click();
    document.querySelector<HTMLButtonElement>("#settings-add")!.click();
    document.querySelector<HTMLButtonElement>("#settings-save")!.click();
    await flush();
    expect(document.querySelector("#settings-error")!.textContent).toBe(
      "Fill in a name and a value for every action",
    );
    expect(invoke).not.toHaveBeenCalledWith("save_config", expect.anything());
  });

  it("Save sends actions, language and magnify and closes the panel", async () => {
    await openOverlay();
    document.querySelector<HTMLButtonElement>("#hub")!.click();
    const name = document.querySelector<HTMLInputElement>(".s-name")!;
    name.value = "Vercel Docs";
    document.querySelector<HTMLInputElement>("#settings-magnify")!.checked = false;
    document.querySelector<HTMLButtonElement>("#settings-save")!.click();
    await flush();
    expect(invoke).toHaveBeenCalledWith("save_config", {
      actions: [
        { name: "Vercel Docs", kind: "url", value: "https://vercel.com" },
        { name: "GitHub", kind: "url", value: "https://github.com" },
        { name: "Native SDK docs", kind: "url", value: "https://native-sdk.dev" },
        { name: "Reload (use tray)", kind: "command", value: "echo hello" },
      ],
      language: null,
      magnify: false,
    });
    expect(document.querySelector("#settings")!.classList.contains("open")).toBe(false);
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
});

describe("app picker", () => {
  it("lists installed apps, filters them and fills the value field", async () => {
    await mount({
      actions: [{ name: "Code", kind: "app", value: "/Applications/Visual Studio Code.app" }],
    });
    await openOverlay();
    document.querySelector<HTMLButtonElement>("#hub")!.click();
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
});
