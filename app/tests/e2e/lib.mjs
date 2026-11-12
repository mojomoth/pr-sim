// Helpers for the browser E2E run (tests/e2e/flow.mjs). Headless Chrome with a fake camera and a WAV file
// as the microphone; one profile directory shared by both launches so IndexedDB survives the mic swap.
// puppeteer-core comes from the PoC host (pocs/node_modules) so the app gets no new dependency.
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const APP_DIR = resolve(import.meta.dirname, "../..");
const REPO = resolve(APP_DIR, "..");
export const APP = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const AUDIO = process.env.E2E_AUDIO ?? join(REPO, "pocs/fixtures/audio");
export const SAMPLES = join(APP_DIR, "public/samples");
export const OUT = process.env.E2E_OUT ?? join(APP_DIR, ".verify/e2e", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
export const PROFILE = mkdtempSync(join(tmpdir(), "pr-sim-e2e-"));
mkdirSync(OUT, { recursive: true });

const require = createRequire(process.env.PUPPETEER_FROM ?? join(REPO, "pocs/scripts/browser.mjs"));
const puppeteer = require("puppeteer-core");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function log(...a) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}`;
  console.log(line);
  appendFileSync(join(OUT, "run.log"), line + "\n");
}

export const save = (name, data) => writeFileSync(join(OUT, name), typeof data === "string" ? data : JSON.stringify(data, null, 2));

const results = [];
/** Record a named assertion; the run fails at the end if any check failed. */
export function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail).slice(0, 300)}`}`);
  return !!ok;
}
export const failures = () => results.filter((r) => !r.ok);
export const allResults = () => results;

export async function launch({ wav } = {}) {
  const args = [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=AudioServiceSandbox",
  ];
  if (wav) args.push(`--use-file-for-fake-audio-capture=${wav}`);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args, userDataDir: PROFILE, protocolTimeout: 600_000 });
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const logs = [];
  const net = [];
  page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  page.on("response", (r) => {
    if (r.url().includes("/api/") || r.status() >= 400) {
      const h = r.headers();
      net.push({ t: Date.now(), url: r.url().replace(APP, ""), status: r.status(), provider: h["x-provider"], model: h["x-model"] });
    }
  });
  // Record <audio> playback (judge TTS) without changing behavior.
  await page.evaluateOnNewDocument(() => {
    window.__audio = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const rec = { at: Date.now() };
      window.__audio.push(rec);
      this.addEventListener("ended", () => (rec.ended = Date.now()), { once: true });
      return play.apply(this, arguments);
    };
  });
  return { browser, page, logs, net };
}

export async function shot(page, name, fullPage = false) {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage });
}

/** Session record(s) straight from IndexedDB "pr-sim". */
export function idbSession(page, id) {
  return page.evaluate(async (id) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("pr-sim");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const rec = await new Promise((res, rej) => {
      const store = db.transaction("sessions", "readonly").objectStore("sessions");
      const q = id ? store.get(id) : store.getAll();
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    db.close();
    return rec;
  }, id);
}

export async function clickText(page, selector, text, timeout = 15_000) {
  const h = await page.waitForFunction(
    (sel, text) => [...document.querySelectorAll(sel)].find((e) => e.textContent.replace(/\s+/g, " ").trim().includes(text) && !e.disabled && e.offsetParent !== null),
    { timeout, polling: 200 },
    selector,
    text,
  );
  const el = h.asElement();
  await el.evaluate((e) => e.scrollIntoView({ block: "center" }));
  await el.click();
}

export const waitText = (page, text, timeout = 30_000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout, polling: 300 }, text);
export const bodyText = (page) => page.evaluate(() => document.body.innerText);
