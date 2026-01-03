import {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  SendToPluginEvent
} from "@elgato/streamdeck";

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

type ToggleSettings = {
  urlA?: string;
  urlB?: string;

  /**
   * Value from the dropdown.
   * - "__default__" means: use OS default browser
   * - otherwise: a full path to the browser app/exe
   */
  browserPath?: string;

  /** 0 or 1 */
  state?: number;
};

const DEFAULT_BROWSER_VALUE = "__default__";

/** Launch URL using a specific browser path (or default if undefined). */
function openInBrowser(browserPathValue: string | undefined, url: string) {
  if (!url) return;

  const browserPath =
    !browserPathValue || browserPathValue === DEFAULT_BROWSER_VALUE
      ? undefined
      : browserPathValue;

  const platform = process.platform;

  if (platform === "darwin") {
    // macOS: open -a "<App Path or App Name>" "<URL>"
    const args = browserPath ? ["-a", browserPath, url] : [url];
    spawn("open", args, { detached: true, stdio: "ignore" }).unref();
    return;
  }

  if (platform === "win32") {
    // Windows: call the exe directly if provided; otherwise default handler
    if (browserPath) {
      spawn(browserPath, [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    }
    return;
  }

  // Linux fallback (if you ever support it)
  if (browserPath) {
    spawn(browserPath, [url], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  }
}

/**
 * Returns items in the sdpi-components datasource format:
 * [{ label, value }] or [{ label, children: [{label,value}]}]
 * :contentReference[oaicite:1]{index=1}
 */
async function getBrowserDataSourceItems() {
  const items: Array<any> = [];

  // Always include default
  items.push({ label: "Default Browser", value: DEFAULT_BROWSER_VALUE });

  if (process.platform === "darwin") {
    // “System-style” list: we’ll include common browsers if installed
    const candidates = [
      { label: "Google Chrome", app: "/Applications/Google Chrome.app" },
      { label: "Firefox", app: "/Applications/Firefox.app" },
      { label: "Microsoft Edge", app: "/Applications/Microsoft Edge.app" },
      { label: "Brave Browser", app: "/Applications/Brave Browser.app" },
      { label: "Opera", app: "/Applications/Opera.app" }
    ];

    for (const c of candidates) {
      if (fs.existsSync(c.app)) items.push({ label: c.label, value: c.app });
    }

    return items;
  }

  if (process.platform === "win32") {
    // Best-effort:
    // 1) Try registry StartMenuInternet (most “system dropdown” accurate)
    // 2) Fallback to common install paths
    const regItems = await tryGetWindowsBrowsersFromRegistry();
    for (const it of regItems) items.push(it);

    // Fallback paths (won’t hurt if duplicates; we dedupe below)
    const fallbacks = [
      { label: "Google Chrome", exe: "Google\\Chrome\\Application\\chrome.exe" },
      { label: "Microsoft Edge", exe: "Microsoft\\Edge\\Application\\msedge.exe" },
      { label: "Firefox", exe: "Mozilla Firefox\\firefox.exe" }
    ];

    const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";

    for (const f of fallbacks) {
      const p1 = path.join(programFiles, f.exe);
      const p2 = path.join(programFilesX86, f.exe);
      if (fs.existsSync(p1)) items.push({ label: f.label, value: p1 });
      else if (fs.existsSync(p2)) items.push({ label: f.label, value: p2 });
    }

    // Deduplicate by value
    const seen = new Set<string>();
    return items.filter((it) => {
      if (!it?.value) return false;
      if (seen.has(it.value)) return false;
      seen.add(it.value);
      return true;
    });
  }

  return items;
}

async function tryGetWindowsBrowsersFromRegistry(): Promise<Array<{ label: string; value: string }>> {
  try {
    // PowerShell script returns JSON array of {label,value}
    // Reads: HKLM:\SOFTWARE\Clients\StartMenuInternet\<browser>\shell\open\command
    const ps = `
$root = "HKLM:\\SOFTWARE\\Clients\\StartMenuInternet"
if (!(Test-Path $root)) { "[]"; exit }
$apps = Get-ChildItem $root -ErrorAction SilentlyContinue
$out = @()
foreach ($a in $apps) {
  $name = (Get-ItemProperty $a.PSPath -ErrorAction SilentlyContinue)."(default)"
  if (-not $name) { $name = $a.PSChildName }
  $cmdKey = Join-Path $a.PSPath "shell\\open\\command"
  if (Test-Path $cmdKey) {
    $cmd = (Get-ItemProperty $cmdKey -ErrorAction SilentlyContinue)."(default)"
    if ($cmd) {
      # extract first quoted exe or first token
      $exe = $null
      if ($cmd -match '^\\"([^\\"]+\\.exe)\\"') { $exe = $Matches[1] }
      elseif ($cmd -match '^([^\\s]+\\.exe)') { $exe = $Matches[1] }
      if ($exe -and (Test-Path $exe)) {
        $out += [PSCustomObject]@{ label = $name; value = $exe }
      }
    }
  }
}
$out | ConvertTo-Json -Compress
`;
    const json = await runCommandCapture("powershell", ["-NoProfile", "-Command", ps]);
    const parsed = JSON.parse(json || "[]");
    if (Array.isArray(parsed)) {
      return parsed
        .filter((x) => x?.label && x?.value)
        .map((x) => ({ label: String(x.label), value: String(x.value) }));
    }
    return [];
  } catch {
    return [];
  }
}

function runCommandCapture(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(err || `Command failed: ${cmd} ${args.join(" ")}`));
    });
  });
}

@action({ UUID: "com.megan-codes.led.toggle" })
export class ToggleWebsite extends SingletonAction<ToggleSettings> {
  override async onWillAppear(ev: WillAppearEvent<ToggleSettings>): Promise<void> {
    const s = ev.payload.settings;
    const state = s.state ?? 0;
    await ev.action.setState(state);
  }

  // Called when PI sends messages (including sdpi-components datasource requests)
  // :contentReference[oaicite:2]{index=2}
  override async onSendToPlugin(ev: SendToPluginEvent): Promise<void> {
    const payload = ev.payload as any;
    if (!payload?.event) return;

    if (payload.event === "getBrowsers") {
      const items = await getBrowserDataSourceItems();

      // Respond using the standardized datasource payload:
      // { event: "<requested event>", items: [...] }
      // :contentReference[oaicite:3]{index=3}
      await ev.action.sendToPropertyInspector({
        event: "getBrowsers",
        items
      });
    }
  }

  override async onKeyDown(ev: KeyDownEvent<ToggleSettings>): Promise<void> {
    const s = ev.payload.settings;

    const state = s.state ?? 0;
    const url = state === 0 ? s.urlA : s.urlB;

    if (!url) {
      await ev.action.showAlert();
      return;
    }

    openInBrowser(s.browserPath, url);

    const next = state === 0 ? 1 : 0;
    s.state = next;

    await ev.action.setSettings(s);
    await ev.action.setState(next);
  }
}
