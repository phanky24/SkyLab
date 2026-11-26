// Một tệp .html tự chứa: engine, kiểu, phông, hình ảnh và KaTeX đều nhúng sẵn, để giáo viên
// trình chiếu từ USB mà không cần Internet.
import { extname, join } from "node:path";
import { chromium } from "playwright";
import { ROOT, UPLOADS } from "./store";
import type { Project } from "./types";

const FONTS: Record<string, [string, number][]> = {
  sans: [["be-vietnam-pro", 400], ["be-vietnam-pro", 500], ["be-vietnam-pro", 600], ["be-vietnam-pro", 700], ["be-vietnam-pro", 800], ["be-vietnam-pro", 900], ["lora", 500]],
  chalk: [["patrick-hand", 400], ["nunito", 400], ["nunito", 600], ["nunito", 700], ["nunito", 800]],
};
const SUBSETS = /-(vietnamese|latin|latin-ext)-\d+-normal\.woff2/;
const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml" };

const dataUri = async (file: string, mime: string) => `data:${mime};base64,${Buffer.from(await Bun.file(file).arrayBuffer()).toString("base64")}`;

async function fontCss(theme: string) {
  const list = FONTS[theme === "chalk" ? "chalk" : "sans"];
  const out: string[] = [];
  for (const [pkg, w] of list) {
    const dir = join(ROOT, "node_modules/@fontsource", pkg);
    const css = await Bun.file(join(dir, `${w}.css`)).text();
    for (const block of css.split(/(?=\/\*)/)) {
      const m = block.match(/url\(\.\/files\/([^)]+\.woff2)\)/);
      if (!m || !SUBSETS.test(m[1])) continue;
      const uri = await dataUri(join(dir, "files", m[1]), "font/woff2");
      out.push(block.replace(/src:[^;]+;/, `src: url(${uri}) format('woff2');`));
    }
  }
  return out.join("\n");
}

async function katexAssets() {
  const dist = join(ROOT, "node_modules/katex/dist");
  let css = await Bun.file(join(dist, "katex.min.css")).text();
  const names = [...new Set([...css.matchAll(/url\(fonts\/([^)]+\.woff2)\)/g)].map((m) => m[1]))];
  for (const n of names) css = css.replaceAll(`url(fonts/${n})`, `url(${await dataUri(join(dist, "fonts", n), "font/woff2")})`);
  // bỏ các nguồn woff/ttf dự phòng, vì chúng trỏ tới tệp không được nhúng
  css = css.replace(/,url\(fonts\/[^)]+\.(woff|ttf)\) format\("(woff|truetype)"\)/g, "");
  return { css, js: await Bun.file(join(dist, "katex.min.js")).text() };
}

const stripModule = (src: string) => src.replace(/^import .*$/gm, "").replace(/^export /gm, "");
const scriptSafe = (s: string) => s.replace(/<\/script/gi, "<\\/script");

export async function exportDeck(project: Project): Promise<string> {
  const p: Project = structuredClone(project);
  // video tải lên đi kèm trong tệp dưới dạng base64 (engine đổi thành blob URL)
  const media: Record<string, string> = {};
  for (const s of p.scenes) {
    if (s.image_url?.startsWith("/uploads/")) {
      const file = join(UPLOADS, s.image_url.slice("/uploads/".length).replace(/[^\w.-]/g, ""));
      if (await Bun.file(file).exists()) s.image_url = await dataUri(file, MIME[extname(file).toLowerCase()] || "image/png");
    }
    if (s.video_url?.startsWith("/uploads/") && !media[s.video_url]) {
      const file = join(UPLOADS, s.video_url.slice("/uploads/".length).replace(/[^\w.-]/g, ""));
      if (await Bun.file(file).exists()) media[s.video_url] = Buffer.from(await Bun.file(file).arrayBuffer()).toString("base64");
    }
  }
  const pub = join(ROOT, "public/engine");
  const [engine, deck, css, fonts] = await Promise.all([
    Bun.file(join(pub, "engine.js")).text(),
    Bun.file(join(pub, "deck.js")).text(),
    Bun.file(join(pub, "engine.css")).text(),
    fontCss(p.theme),
  ]);
  const texInAnimation = p.scenes.some((s) => (s.layout === "custom" || s.layout === "sim") && s.code?.includes("MH.tex("));
  const kx = p.scenes.some((s) => s.layout === "formula") || texInAnimation ? await katexAssets() : null;
  const title = p.title.replace(/[<&]/g, "");
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style id="mh-fonts">${fonts}</style>
<style>${kx?.css ?? ""}\n${css}\nhtml,body{margin:0;background:#05070c}</style>
${kx ? `<script>${scriptSafe(kx.js)}</script>` : ""}
</head><body><div id="deck"></div>
<script type="module">
// hoạt hình AI chạy trong khung sandbox không gọi được máy chủ: đưa sẵn phông đã nhúng cho chúng
globalThis.MH_FONT_CSS = document.getElementById("mh-fonts").textContent;
${texInAnimation && kx ? `globalThis.MH_KATEX = ${scriptSafe(JSON.stringify({ css: kx.css, js: kx.js }))};` : ""}
${Object.keys(media).length ? `globalThis.MH_MEDIA = ${JSON.stringify(media)};` : ""}
${scriptSafe(stripModule(engine))}
${scriptSafe(stripModule(deck))}
const project = ${scriptSafe(JSON.stringify(p))};
mountDeck(document.getElementById("deck"), project);
</script></body></html>`;
}

/** PDF, mỗi cảnh một trang, in từ public/print.html bằng Chromium không giao diện. */
export async function exportPdf(project: Project, baseUrl: string): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`${baseUrl}/print.html?id=${project.id}`);
    await page.waitForFunction(() => window.__PRINT_READY === true, null, { timeout: 60000 });
    return await page.pdf({ preferCSSPageSize: true, printBackground: true });
  } finally {
    await browser.close();
  }
}
