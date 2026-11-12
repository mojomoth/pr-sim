// Contact sheet of the deck source (same HTML that is printed to presentation.pdf). node fixtures/tests/contact-sheet.mjs
import puppeteer from "puppeteer-core";
import { join } from "node:path";
import { CHROME } from "../../scripts/browser.mjs";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1344, height: 1000, deviceScaleFactor: 1.5 });
await page.goto("file://" + join(process.cwd(), "fixtures/src/deck.html"), { waitUntil: "networkidle0" });
await page.addStyleTag({ content: "body{zoom:.35;display:flex;flex-wrap:wrap;width:3840px;gap:0;background:#999} .s{outline:4px solid #999}" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: ".verify/fixtures/deck-contact.png", fullPage: true });
await browser.close();
console.log("saved .verify/fixtures/deck-contact.png");
