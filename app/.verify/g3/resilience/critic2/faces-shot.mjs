// Screenshot the judge cards on /setup under the outage (fresh profile).
import { APP, clickText, launch, save, shot, sleep } from "../../../../tests/e2e/lib.mjs";
const { browser, page, logs, net } = await launch();
await page.goto(APP + "/", { waitUntil: "networkidle2" });
await clickText(page, "a", "시작하기");
await page.waitForFunction(() => location.pathname === "/setup", { timeout: 20_000 });
await page.waitForFunction(() => document.body.innerText.includes("심사위원") && !document.body.innerText.includes("만드는 중"), { timeout: 120_000, polling: 500 });
await sleep(800);
const el = await page.evaluateHandle(() => [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && /얼굴 없음/.test(e.textContent)));
await el.asElement()?.evaluate((e) => e.scrollIntoView({ block: "center" }));
await sleep(600);
await shot(page, "faces-setup");
save("faces-text.json", { text: await page.evaluate(() => document.body.innerText), net, logs });
await browser.close();
