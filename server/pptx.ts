// Xuất PowerPoint giống hệt bản web. Mỗi cảnh được dựng bằng chính engine trong trình duyệt
// không giao diện (public/snap.html, khung 1920×1080), rồi đo từng phần tử ở trạng thái đã hiện
// đủ: vị trí, khung, màu, phông, cỡ chữ (sau khi engine tự thu nhỏ cho vừa). Từ số đo đó dựng
// lại bằng đối tượng PowerPoint gốc, sửa được: hộp chữ, hình khối, bảng, biểu đồ. Công thức và
// nét vẽ SVG thành ảnh nền trong suốt; hoạt hình / mô phỏng AI thành đoạn video; video tải lên
// được nhúng, video YouTube thành ảnh bìa có liên kết. Phông web được nhúng vào tệp (fonts.ts).
// Hiệu ứng xuất hiện cũng lấy từ engine: phần tử hiện lúc nào, từ hướng nào, và mỗi lần bấm
// (điểm dừng khi trình chiếu) mở ra những gì. Ghi chú cảnh thành ghi chú người thuyết trình.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import type { Page } from "playwright";
import { embedFonts, pickFace, type Face } from "./fonts";
import { openCamera, openSnap } from "./harness";
import { UPLOADS } from "./store";
import type { Project, Scene } from "./types";

// ---------- số đo lấy từ trình duyệt (đơn vị px của sân khấu 1920×1080) ----------
type RGBA = [number, number, number, number];
interface Rect { x: number; y: number; w: number; h: number }
/** Cách engine cho phần tử xuất hiện: giây đầu tiên nhìn thấy và trạng thái lúc bắt đầu. */
interface Anim { t: number; dx: number; dy: number; scale: number; wipe?: "right" | "up"; stretch?: boolean; words?: boolean }
interface Run { text: string; family: string; weight: number; italic: boolean; size: number; color: RGBA; spacing: number; highlight?: RGBA }
type Paint = { color: RGBA } | { stops: { color: RGBA; pos: number }[]; angle: number };
interface Cell { runs: Run[]; fill: RGBA; pad: number[]; align: Align; lineHeight: number }
type Align = "left" | "center" | "right";
type Node = { anim?: Anim; link?: string; inVideo?: boolean } & (
  | { k: "box"; r: Rect; fill?: Paint; line?: { color: RGBA; width: number; dash: boolean }; radius: number }
  | { k: "text"; r: Rect; runs: Run[]; align: Align; lineHeight: number; lines: number }
  | { k: "img"; r: Rect; src: string; fit: string; radius: number; natural: [number, number] }
  | { k: "snap"; r: Rect; id: string }
  | { k: "table"; r: Rect; cols: number[]; rows: { h: number; cells: Cell[]; anim?: Anim }[]; line: RGBA }
  | { k: "chart"; r: Rect; gap: number; value: Run; label: Run; axis: { color: RGBA; width: number }; fill?: Paint }
  | { k: "video"; r: Rect; radius: number }
);
interface Measure { nodes: Node[]; holds: number[] }

/**
 * Chạy trong trang snap.html: đo cảnh i. question = cảnh trắc nghiệm khi chưa công bố đáp án.
 * Hàm được gửi nguyên văn vào trình duyệt nên không dùng gì ngoài phạm vi của nó.
 */
async function measure({ i, question }: { i: number; question: boolean }): Promise<Measure> {
  const { duration, holds } = window.__timing!(i);
  const stage = document.querySelector<HTMLElement>(".mh-stage")!;
  const visibleScene = () => [...stage.querySelectorAll<HTMLElement>(":scope > .mh-scene")].find((s) => s.style.visibility === "visible")!;
  /** Tích độ trong suốt từ el lên tới (không gồm) stop. */
  const opacity = (el: Element, stop: Element | null) => {
    let o = 1;
    for (let e: Element | null = el; e && e !== stop; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
    return o;
  };

  // 1. Tua cảnh theo từng nhịp 40 ms, ghi lại lúc mỗi phần tử có hiệu ứng bắt đầu hiện
  //    và trạng thái ngay trước đó (độ dời, tỉ lệ, vùng cắt) để dựng hiệu ứng tương ứng.
  await window.__at!(i, 0);
  let root = visibleScene();
  const moving = [...root.querySelectorAll<HTMLElement>("*")].filter((el) => el.style && (el.style.opacity !== "" || el.style.transform !== "" || el.style.clipPath !== ""));
  const first = new Map<Element, { t: number; from: string }>();
  const before = new Map<Element, string>();
  const shown = (el: HTMLElement) => {
    if (opacity(el, stage) < 0.02) return false;
    const b = el.getBoundingClientRect();
    const clip = /inset\(\S+ ([\d.]+)%/.exec(el.style.clipPath);
    return b.width > 0.5 && b.height > 0.5 && (!clip || Number(clip[1]) < 99);
  };
  const isCode = root.querySelector(".mh-custom-frame");
  for (let t = 0; !isCode && t <= duration; t += 0.04) {
    await window.__at!(i, t);
    for (const el of moving) {
      if (first.has(el)) continue;
      if (shown(el)) first.set(el, { t, from: before.get(el) ?? "" });
      else before.set(el, `${el.style.transform}|${el.style.clipPath}`);
    }
  }
  const animOf = (el: Element): Anim | undefined => {
    for (let e: Element | null = el; e && e !== root; e = e.parentElement) {
      const f = first.get(e);
      if (!f) continue;
      if (f.t === 0) return undefined;
      const [tf, clip] = f.from.split("|");
      const a: Anim = { t: f.t, dx: 0, dy: 0, scale: 1 };
      const he = e as HTMLElement;
      if (clip?.includes("inset")) a.wipe = "right";
      else if (/scaleX\(/.test(tf)) { if (getComputedStyle(he).transformOrigin.startsWith("0px")) a.wipe = "right"; else a.stretch = true; }
      else if (/scaleY\(/.test(tf)) a.wipe = "up";
      else {
        const tr = /translate\((-?[\d.e]+)px,\s*(-?[\d.e]+)px\)/.exec(tf), tx = /translateX\((-?[\d.e]+)px\)/.exec(tf);
        const ty = /translateY\((-?[\d.e]+)%\)/.exec(tf), sc = /scale\((-?[\d.e]+)\)/.exec(tf);
        a.dx = tr ? Number(tr[1]) : tx ? Number(tx[1]) : 0;
        a.dy = tr ? Number(tr[2]) : ty ? (Number(ty[1]) / 100) * he.getBoundingClientRect().height : 0;
        a.scale = sc ? Number(sc[1]) : 1;
      }
      return a;
    }
    return undefined;
  };

  // 2. Trạng thái để đo: đã hiện đủ; câu trắc nghiệm thì giấu phần công bố đáp án.
  await window.__rest!(i);
  for (const old of stage.querySelectorAll("[data-snap]")) old.removeAttribute("data-snap");
  root = visibleScene();
  const hiddenForQuestion: HTMLElement[] = [];
  if (question) {
    for (const o of root.querySelectorAll<HTMLElement>(".mh-opt")) { o.classList.remove("mh-right", "mh-wrong"); o.style.transform = ""; }
    for (const ex of root.querySelectorAll<HTMLElement>(".mh-quiz-ex")) { ex.style.visibility = "hidden"; hiddenForQuestion.push(ex); }
  }

  const base = stage.getBoundingClientRect();
  const k = 1920 / base.width;
  const rectOf = (b: DOMRect): Rect => ({ x: (b.left - base.left) * k, y: (b.top - base.top) * k, w: b.width * k, h: b.height * k });
  const canvas = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  const colors = new Map<string, RGBA>();
  const rgba = (css: string, alpha = 1): RGBA => {
    let c = colors.get(css);
    if (!c) {
      const m = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/.exec(css);
      if (m) c = [Number(m[1]), Number(m[2]), Number(m[3]), m[4] == null ? 1 : Number(m[4])];
      else { // color-mix(), color(srgb …): để canvas quy về một điểm ảnh
        canvas.clearRect(0, 0, 1, 1); canvas.fillStyle = css; canvas.fillRect(0, 0, 1, 1);
        const d = canvas.getImageData(0, 0, 1, 1).data;
        c = [d[0], d[1], d[2], d[3] / 255];
      }
      colors.set(css, c);
    }
    return [c[0], c[1], c[2], c[3] * alpha];
  };
  const gradient = (css: string, alpha: number): Paint | undefined => {
    const m = /^linear-gradient\((.*)\)$/.exec(css);
    if (!m) return undefined;
    const parts: string[] = [];
    let depth = 0, cur = "";
    for (const ch of m[1]) {
      if (ch === "," && !depth) { parts.push(cur.trim()); cur = ""; continue; }
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      cur += ch;
    }
    parts.push(cur.trim());
    let angle = 180;
    if (/^-?[\d.]+deg$/.test(parts[0])) angle = parseFloat(parts.shift()!);
    else if (parts[0].startsWith("to ")) angle = { "to right": 90, "to left": 270, "to top": 0 }[parts.shift()!] ?? 180;
    const stops = parts.map((p) => { const s = /^(.*?)(?:\s+(-?[\d.]+)%)?$/.exec(p)!; return { color: rgba(s[1], alpha), pos: s[2] == null ? NaN : Number(s[2]) / 100 }; });
    stops.forEach((s, j) => { if (Number.isNaN(s.pos)) s.pos = stops.length < 2 ? 0 : j / (stops.length - 1); });
    return { stops, angle };
  };
  const contentBox = (el: Element, cs: CSSStyleDeclaration): Rect => {
    const r = rectOf(el.getBoundingClientRect()), px = (v: string) => parseFloat(v) * k;
    const l = px(cs.paddingLeft) + px(cs.borderLeftWidth), t = px(cs.paddingTop) + px(cs.borderTopWidth);
    return { x: r.x + l, y: r.y + t, w: r.w - l - px(cs.paddingRight) - px(cs.borderRightWidth), h: r.h - t - px(cs.paddingBottom) - px(cs.borderBottomWidth) };
  };
  const pseudo = (el: Element, which: "::before" | "::after") => {
    const ps = getComputedStyle(el, which), c = ps.content;
    if (!c || c === "none" || c === "normal") return null;
    const attr = /^attr\(([\w-]+)\)$/.exec(c);
    return { ps, text: attr ? (el.getAttribute(attr[1]) ?? "") : c.replace(/^"([\s\S]*)"$/, "$1") };
  };
  const isInline = (cs: CSSStyleDeclaration) => cs.display === "inline" || cs.display === "inline-block";
  const align = (cs: CSSStyleDeclaration): Align => (cs.textAlign === "center" ? "center" : cs.textAlign === "right" || cs.textAlign === "end" ? "right" : "left");

  const nodes: Node[] = [];
  let snaps = 0;
  type Extra = { anim?: Anim; link?: string; inVideo?: boolean };
  const snap = (el: Element, r: Rect, extra: Extra) => {
    el.setAttribute("data-snap", String(++snaps));
    nodes.push({ k: "snap", r, id: String(snaps), ...extra });
  };
  const runStyle = (text: string, cs: CSSStyleDeclaration, alpha: number, highlight?: RGBA): Run => ({
    text: cs.textTransform === "uppercase" ? text.toUpperCase() : text,
    family: cs.fontFamily.split(",")[0].replace(/["']/g, "").trim(),
    weight: Number(cs.fontWeight) || 400, italic: cs.fontStyle !== "normal",
    size: parseFloat(cs.fontSize) * k, color: rgba(cs.color, alpha),
    spacing: cs.letterSpacing === "normal" ? 0 : parseFloat(cs.letterSpacing) * k, highlight,
  });
  /**
   * Chữ nằm trực tiếp trong khối el (bỏ qua khối con) thành các đoạn cùng kiểu, có "\n" đúng chỗ trình
   * duyệt xuống dòng (PowerPoint ngắt dòng hơi khác nên ghi cứng); khung nền của từ (vd. vệt tô sau
   * tiêu đề bìa) đưa vào under.
   */
  const runsOf = (el: Element, alpha: number, under: Node[]) => {
    const runs: Run[] = [];
    const ecs = getComputedStyle(el), lh = parseFloat(ecs.lineHeight) || parseFloat(ecs.fontSize) * 1.25;
    const range = document.createRange();
    let lastTop: number | null = null;
    // một từ sang dòng mới khi nó nằm thấp hơn từ trước quá nửa dòng
    const newLine = (top: number) => { const brk = lastTop != null && top > lastTop + lh / 2; lastTop = top; return brk; };
    const inline = (n: ChildNode, hl?: RGBA) => {
      if (n.nodeType === 3) {
        const parent = n.parentElement!;
        let text = "";
        for (const m of (n.textContent ?? "").matchAll(/\s+|\S+/g)) {
          if (/^\s/.test(m[0])) { text += " "; continue; }
          range.setStart(n, m.index!); range.setEnd(n, m.index! + m[0].length);
          const top = range.getClientRects()[0]?.top;
          if (top != null && newLine(top)) text += "\n";
          text += m[0];
        }
        if (text) runs.push(runStyle(text, getComputedStyle(parent), alpha * opacity(parent, el), hl));
        return;
      }
      if (!(n instanceof HTMLElement)) return;
      const cs = getComputedStyle(n);
      if (!isInline(cs)) return;
      if (cs.display === "inline-block" && newLine(n.getBoundingClientRect().top)) runs.push(runStyle("\n", cs, alpha));
      const g = gradient(cs.backgroundImage, alpha * opacity(n, el));
      if (g) under.push({ k: "box", r: rectOf(n.getBoundingClientRect()), fill: g, radius: 0 });
      const bg = rgba(cs.backgroundColor, alpha);
      const mark = bg[3] > 0.05 ? bg : hl;
      const b = pseudo(n, "::before"), a = pseudo(n, "::after");
      if (b?.text) runs.push(runStyle(b.text, b.ps, alpha, mark));
      n.childNodes.forEach((c) => inline(c, mark));
      if (a?.text) runs.push(runStyle(` ${a.text} `, a.ps, alpha, mark));
    };
    el.childNodes.forEach((c) => inline(c));
    // gộp khoảng trắng như CSS (bỏ cả khoảng trắng sát chỗ xuống dòng), rồi gộp các đoạn liền nhau cùng kiểu
    const out: Run[] = [];
    for (const r of runs) {
      const prev = out[out.length - 1];
      r.text = r.text.replace(/ +/g, " ");
      if (prev && /[ \n]$/.test(prev.text) && r.text.startsWith(" ")) r.text = r.text.slice(1);
      if (!r.text || r.size < 1) continue;
      if (prev && JSON.stringify({ ...prev, text: "" }) === JSON.stringify({ ...r, text: "" })) prev.text += r.text;
      else out.push(r);
    }
    for (const r of out) r.text = r.text.replace(/ *\n */g, "\n");
    for (let j = 1; j < out.length; j++) if (out[j].text.startsWith("\n")) out[j - 1].text = out[j - 1].text.replace(/ +$/, "");
    if (out.length) { out[0].text = out[0].text.replace(/^\s+/, ""); out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, ""); }
    return out.filter((r) => r.text);
  };
  /** Khung chữ: đúng vùng các dòng chữ chiếm; số dòng để biết có được ngắt dòng không. */
  const textRect = (el: Element, cs: CSSStyleDeclaration, hasPseudo: boolean) => {
    const rects: DOMRect[] = [];
    const range = document.createRange();
    el.childNodes.forEach((c) => {
      if (c.nodeType === 3) { range.selectNodeContents(c); rects.push(...range.getClientRects()); }
      else if (c instanceof HTMLElement && isInline(getComputedStyle(c))) rects.push(...c.getClientRects());
    });
    const box = contentBox(el, cs), lh = parseFloat(cs.lineHeight) * k || parseFloat(cs.fontSize) * k * 1.25;
    const rs = rects.filter((r) => r.width > 0 && r.height > 0).map(rectOf);
    if (hasPseudo || !rs.length) return { r: box, lines: Math.max(1, Math.round(box.h / lh)), lh };
    const x0 = Math.min(...rs.map((r) => r.x)), x1 = Math.max(...rs.map((r) => r.x + r.w));
    const y0 = Math.min(...rs.map((r) => r.y)), y1 = Math.max(...rs.map((r) => r.y + r.h));
    const tops: number[] = [];
    for (const r of rs) if (!tops.some((t) => Math.abs(t - (r.y + r.h / 2)) < lh / 2)) tops.push(r.y + r.h / 2);
    return { r: tops.length > 1 ? { x: box.x, y: y0, w: box.w, h: y1 - y0 } : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, lines: tops.length, lh };
  };

  const walk = (el: Element, flags: { link?: string; inVideo?: boolean }) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || el.matches(".mh-bg, .mh-sim-ctl, iframe, script, style")) return;
    const alpha = opacity(el, stage);
    if (alpha < 0.02) return;
    const r = rectOf(el.getBoundingClientRect());
    const anim = animOf(el);
    if (el instanceof HTMLElement && el.dataset.url) flags = { ...flags, link: el.dataset.url };
    const extra: Extra = { ...flags, anim };

    if (el.matches(".mh-f")) return snap(el, { x: r.x - 8, y: r.y - 8, w: r.w + 16, h: r.h + 16 }, extra);
    if (el instanceof SVGSVGElement) {
      for (const p of el.querySelectorAll("path, line, circle, rect, polyline, polygon, ellipse, text")) {
        if (p.closest("defs, marker") || opacity(p, stage) < 0.02) continue;
        // chừa chỗ cho nét dày và đầu mũi tên (marker) vượt ra ngoài đường
        const b = rectOf(p.getBoundingClientRect()), pad = 5 * (parseFloat(getComputedStyle(p).strokeWidth) || 1) * k;
        snap(p, { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad }, { ...flags, anim: animOf(p) });
      }
      return;
    }
    if (el instanceof HTMLImageElement) {
      const parent = el.offsetParent ?? el.parentElement!;
      const pr = rectOf(parent.getBoundingClientRect());
      const ir = cs.position === "absolute" ? { x: pr.x + el.offsetLeft * k, y: pr.y + el.offsetTop * k, w: el.offsetWidth * k, h: el.offsetHeight * k } : r;
      const pcs = getComputedStyle(parent);
      const radius = pcs.overflow === "hidden" ? parseFloat(pcs.borderTopLeftRadius) * k : 0;
      const src = el.getAttribute("src") || "";
      if (/^\/uploads\/[\w.-]+\.(png|jpe?g|webp|gif)$/i.test(src)) nodes.push({ k: "img", r: ir, src, fit: cs.objectFit, radius, natural: [el.naturalWidth, el.naturalHeight], ...extra });
      else snap(el, ir, extra);
      return;
    }
    if (el.matches(".mh-tgrid")) {
      const cells = [...el.children];
      const cols = Math.max(1, getComputedStyle(el).gridTemplateColumns.split(" ").length);
      const lefts = cells.slice(0, cols).map((c) => rectOf(c.getBoundingClientRect()).x);
      const widths = lefts.map((x, c) => (c + 1 < cols ? lefts[c + 1] : r.x + r.w) - (c ? x : r.x));
      const rows: { h: number; cells: Cell[]; anim?: Anim }[] = [];
      for (let j = 0; j < cells.length; j += cols) {
        const row = cells.slice(j, j + cols), top = rectOf(row[0].getBoundingClientRect()).y;
        const next = cells[j + cols] ? rectOf(cells[j + cols].getBoundingClientRect()).y : r.y + r.h;
        rows.push({
          h: next - (j ? top : r.y), anim: animOf(row[0]),
          cells: row.map((c) => {
            const ccs = getComputedStyle(c), px = (v: string) => parseFloat(v) * k;
            return { runs: runsOf(c, alpha, []), fill: rgba(ccs.backgroundColor), pad: [px(ccs.paddingTop), px(ccs.paddingRight), px(ccs.paddingBottom), px(ccs.paddingLeft)], align: align(ccs), lineHeight: parseFloat(ccs.lineHeight) * k };
          }),
        });
      }
      nodes.push({ k: "table", r, cols: widths, rows, line: rgba(cs.backgroundColor), ...flags });
      return;
    }
    const bars = [...el.querySelectorAll(":scope > .mh-bar")];
    if (el.matches(".mh-chart-plot") && bars.length) {
      const b0 = rectOf(bars[0].getBoundingClientRect()), bl = rectOf(bars[bars.length - 1].getBoundingClientRect());
      const pitch = bars.length > 1 ? (bl.x - b0.x) / (bars.length - 1) : b0.w * 1.4;
      const wrap = bars[0].querySelector(".mh-bar-wrap")!, fill = bars[0].querySelector(".mh-bar-fill")!;
      const wcs = getComputedStyle(wrap), fcs = getComputedStyle(fill);
      nodes.push({
        k: "chart", r: { x: b0.x - (pitch - b0.w) / 2, y: r.y, w: bl.x + bl.w - b0.x + (pitch - b0.w), h: r.h }, gap: ((pitch - b0.w) / b0.w) * 100,
        value: runStyle("", getComputedStyle(bars[0].querySelector(".mh-bar-v")!), alpha), label: runStyle("", getComputedStyle(bars[0].querySelector(".mh-bar-l")!), alpha),
        axis: { color: rgba(wcs.borderBottomColor), width: parseFloat(wcs.borderBottomWidth) * k },
        fill: gradient(fcs.backgroundImage, alpha) ?? { color: rgba(fcs.backgroundColor) }, ...flags, anim: animOf(fill),
      });
      return;
    }
    if (el.matches(".mh-video-frame")) {
      nodes.push({ k: "video", r, radius: parseFloat(cs.borderTopLeftRadius) * k, ...flags, anim });
      flags = { ...flags, inVideo: true };
    }

    // khung: nền (màu hoặc dải màu) và viền; viền chỉ có ở vài cạnh thì vẽ thành các vạch mỏng
    const px = (v: string) => parseFloat(v) * k;
    const sides = (["Top", "Right", "Bottom", "Left"] as const).map((s) => ({ w: px(cs.getPropertyValue(`border-${s.toLowerCase()}-width`)), color: rgba(cs.getPropertyValue(`border-${s.toLowerCase()}-color`), alpha), style: cs.getPropertyValue(`border-${s.toLowerCase()}-style`) }));
    const visibleSides = sides.filter((s) => s.w > 0 && s.color[3] > 0.02 && s.style !== "none");
    const uniform = visibleSides.length === 4 && visibleSides.every((s) => s.w === sides[0].w && s.color.join() === sides[0].color.join());
    const bg = rgba(cs.backgroundColor, alpha);
    const fill: Paint | undefined = gradient(cs.backgroundImage, alpha) ?? (bg[3] > 0.01 ? { color: bg } : undefined);
    const radius = Math.min(cs.borderTopLeftRadius.endsWith("%") ? Infinity : px(cs.borderTopLeftRadius), r.w / 2, r.h / 2);
    if (fill || uniform) {
      const inset = uniform ? sides[0].w / 2 : 0;
      nodes.push({ k: "box", r: { x: r.x + inset, y: r.y + inset, w: r.w - 2 * inset, h: r.h - 2 * inset }, fill, radius, line: uniform ? { color: sides[0].color, width: sides[0].w, dash: sides[0].style === "dashed" } : undefined, ...extra });
    }
    if (!uniform) {
      const [t, rt, b, l] = sides;
      const edges: [typeof t, Rect][] = [[t, { x: r.x, y: r.y, w: r.w, h: t.w }], [rt, { x: r.x + r.w - rt.w, y: r.y, w: rt.w, h: r.h }], [b, { x: r.x, y: r.y + r.h - b.w, w: r.w, h: b.w }], [l, { x: r.x, y: r.y, w: l.w, h: r.h }]];
      for (const [s, er] of edges) if (visibleSides.includes(s)) nodes.push({ k: "box", r: er, fill: { color: s.color }, radius: 0, ...extra });
    }

    // giả phần tử ::before / ::after: chữ đặt tuyệt đối (dấu chấm đầu dòng), vạch trang trí, hoặc chữ nằm trong dòng
    let inFlowText = false;
    const before = pseudo(el, "::before"), after = pseudo(el, "::after");
    for (const p of [before, after]) {
      if (!p) continue;
      if (p.ps.position === "absolute" && p.text) {
        const size = parseFloat(p.ps.fontSize) * k;
        nodes.push({ k: "text", r: { x: r.x + px(cs.borderLeftWidth) + (parseFloat(p.ps.left) || 0) * k, y: r.y + px(cs.borderTopWidth) + (parseFloat(p.ps.top) || 0) * k, w: size * 1.4, h: size * 1.3 }, runs: [runStyle(p.text, p.ps, alpha)], align: "left", lineHeight: size * 1.3, lines: 1, ...extra });
      } else if (!p.text && rgba(p.ps.backgroundColor)[3] > 0.02 && p === before) {
        const cb = contentBox(el, cs), w = px(p.ps.width), h = px(p.ps.height);
        nodes.push({ k: "box", r: { x: cb.x, y: cb.y + (cb.h - h) / 2, w, h }, fill: { color: rgba(p.ps.backgroundColor, alpha) }, radius: px(p.ps.borderTopLeftRadius), ...extra });
      } else if (p.text) inFlowText = true;
    }

    // chữ trực tiếp của khối
    if (!isInline(cs)) {
      const under: Node[] = [];
      let runs = runsOf(el, alpha, under);
      if (inFlowText) {
        if (before?.text && before.ps.position !== "absolute") runs = [runStyle(before.text, before.ps, alpha), ...runs];
        if (after?.text && after.ps.position !== "absolute") runs = [...runs, runStyle(` ${after.text} `, after.ps, alpha)];
      }
      const plain = runs.map((x) => x.text).join("");
      if (plain.trim()) {
        const { r: tr, lh } = textRect(el, cs, inFlowText);
        // biểu tượng emoji: chụp đúng hình trình duyệt vẽ (PowerPoint mỗi máy dùng một bộ emoji khác)
        if (/^(?:\p{Extended_Pictographic}|\uFE0F|\u200D|\s)+$/u.test(plain)) return snap(el, { x: tr.x - 6, y: tr.y - 6, w: tr.w + 12, h: tr.h + 12 }, extra);
        const words = el.querySelector(".mh-wi");
        const wordAnim = words ? animOf(words) : undefined;
        const lines = plain.split("\n").length;
        nodes.push(...under.map((u) => ({ ...u, ...flags, anim: wordAnim ?? anim })));
        nodes.push({ k: "text", r: tr, runs, align: lines > 1 || inFlowText ? align(cs) : "center", lineHeight: lh, lines, ...flags, anim: wordAnim ? { ...wordAnim, words: true } : anim });
      }
    }
    for (const c of el.children) if (!isInline(getComputedStyle(c))) walk(c, flags);
  };
  walk(root, {});
  for (const ex of hiddenForQuestion) ex.style.visibility = "";
  return { nodes, holds };
}

// ---------- vẽ lại trong PowerPoint ----------
const PX = 1 / 144; // 1920 px = 13,333 in
const hex = (c: RGBA) => c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
const transparency = (c: RGBA) => Math.round((1 - Math.min(1, c[3])) * 100);
const inches = (r: Rect) => ({ x: r.x * PX, y: r.y * PX, w: Math.max(r.w, 1) * PX, h: Math.max(r.h, 1) * PX });

type Gradient = Extract<Paint, { stops: unknown }>;
/** Lúc hiện của một hình khi trình chiếu: lần bấm thứ click (0 = tự chạy khi vào trang), trễ delay giây. */
interface Cue { click: number; delay: number; anim: Anim }
/** Thứ cần sửa thẳng trong XML sau khi pptxgenjs ghi xong: hiệu ứng, dải màu, ảnh bo góc. */
interface Shape { cue?: Cue; gradient?: Gradient; radius?: number; box?: Rect }
interface SlideCtx {
  slide: PptxGenJS.Slide; shapes: Map<string, Shape>; fonts: Set<Face>; charts: (Gradient | undefined)[];
  cue(a?: Anim): Cue | undefined;
}
/** Đặt tên riêng cho hình để tìm lại trong XML. */
function name(ctx: SlideCtx, { anim, ...rest }: Omit<Shape, "cue"> & { anim?: Anim }) {
  const n = `mh${ctx.shapes.size + 1}`;
  ctx.shapes.set(n, { ...rest, cue: ctx.cue(anim) });
  return n;
}

/** Đoạn chữ của PowerPoint; chỗ "\n" (trình duyệt xuống dòng) thành ngắt dòng mềm trong cùng đoạn văn. */
function textRuns(runs: Run[], ctx: SlideCtx): PptxGenJS.TextProps[] {
  return runs.flatMap((r) => {
    const f = pickFace(r.family, r.weight);
    if (f.face) ctx.fonts.add(f.face);
    const options = {
      fontFace: f.typeface, bold: f.bold, italic: r.italic, fontSize: Math.round(r.size * 50) / 100,
      color: hex(r.color), transparency: transparency(r.color) || undefined, charSpacing: r.spacing ? Math.round(r.spacing * 50) / 100 : undefined,
      highlight: r.highlight ? hex(r.highlight) : undefined,
    };
    return r.text.split("\n").map((text, j) => ({ text, options: { ...options, softBreakBefore: j > 0 } }));
  });
}

const firstColor = (p: Paint) => ("color" in p ? p.color : p.stops[0].color);

/** Dải màu có chặn trong suốt (vd. vệt bút nhớ dưới chữ) = các mảng màu đặc; dải màu thật thì trả về null. */
function solidBands(p: Gradient, r: Rect): { r: Rect; color: RGBA }[] | null {
  if (!p.stops.some((s) => s.color[3] < 0.01) || p.angle % 90 !== 0) return null;
  const across = p.angle === 90 || p.angle === 270;
  const out: { r: Rect; color: RGBA }[] = [];
  for (let j = 0; j + 1 < p.stops.length; j++) {
    const a = p.stops[j], b = p.stops[j + 1];
    if (a.color[3] < 0.01 || b.pos <= a.pos) continue;
    out.push({ color: a.color, r: across ? { x: r.x + r.w * a.pos, y: r.y, w: r.w * (b.pos - a.pos), h: r.h } : { x: r.x, y: r.y + r.h * a.pos, w: r.w, h: r.h * (b.pos - a.pos) } });
  }
  return out;
}

interface Assets { tmp: string; youtube?: string; videoFile?: string; cover?: string }

async function drawNode(n: Node, ctx: SlideCtx, page: Page, assets: Assets) {
  const { slide } = ctx;
  if (n.inVideo && assets.videoFile) return; // video tải lên: cả khung được thay bằng đoạn video nhúng
  const link = n.link ?? (n.inVideo ? assets.youtube : undefined);
  const hyperlink = link ? { url: link } : undefined;
  switch (n.k) {
    case "box": {
      const bands = n.fill && "stops" in n.fill ? solidBands(n.fill, n.r) : null;
      if (bands) {
        for (const b of bands) slide.addShape("rect", { ...inches(b.r), fill: { color: hex(b.color), transparency: transparency(b.color) }, objectName: name(ctx, { anim: n.anim }) });
        return;
      }
      const circle = n.radius >= Math.min(n.r.w, n.r.h) / 2 - 0.5 && Math.abs(n.r.w - n.r.h) < 1;
      const shape = circle ? "ellipse" : n.radius > 0.5 ? "roundRect" : "rect";
      slide.addShape(shape, {
        ...inches(n.r), rectRadius: shape === "roundRect" ? n.radius * PX : undefined, hyperlink,
        fill: n.fill ? { color: hex(firstColor(n.fill)), transparency: transparency(firstColor(n.fill)) } : { type: "none" },
        line: n.line ? { color: hex(n.line.color), transparency: transparency(n.line.color), width: n.line.width / 2, dashType: n.line.dash ? "dash" : "solid" } : undefined,
        objectName: name(ctx, { anim: n.anim, gradient: n.fill && "stops" in n.fill ? n.fill : undefined }),
      });
      return;
    }
    case "text": {
      // cùng phông, cùng cỡ, xuống dòng đúng chỗ như web nên tắt tự ngắt dòng; dòng đơn canh giữa vùng chữ
      const slack = n.lines > 1 ? 0 : n.r.w * 0.08 + 6;
      const r = { x: n.align === "right" ? n.r.x - slack : n.align === "center" ? n.r.x - slack / 2 : n.r.x, y: n.r.y, w: n.r.w + slack, h: n.r.h };
      slide.addText(textRuns(n.runs, ctx), {
        ...inches(r), margin: 0, align: n.align, valign: "middle", wrap: false, fit: "none",
        lineSpacing: n.lines > 1 ? Math.round(n.lineHeight * 50) / 100 : undefined, objectName: name(ctx, { anim: n.anim }),
      });
      // liên kết đặt trên một khung trong suốt phủ lên chữ, để chữ giữ đúng màu, không bị gạch chân
      if (hyperlink) slide.addShape("rect", { ...inches(r), fill: { color: "FFFFFF", transparency: 100 }, hyperlink, objectName: name(ctx, { anim: n.anim }) });
      return;
    }
    case "img": {
      const file = join(UPLOADS, n.src.slice("/uploads/".length));
      if (!(await Bun.file(file).exists())) return;
      const [nw, nh] = n.natural;
      if (n.fit === "contain" || !nw || !nh) {
        // vừa khung, giữ tỉ lệ
        const k = nw && nh ? Math.min(n.r.w / nw, n.r.h / nh) : 1;
        const r = nw && nh ? { x: n.r.x + (n.r.w - nw * k) / 2, y: n.r.y + (n.r.h - nh * k) / 2, w: nw * k, h: nh * k } : n.r;
        slide.addImage({ path: file, ...inches(r), hyperlink, objectName: name(ctx, { anim: n.anim }) });
      } else {
        // lấp khung, cắt bớt mép như object-fit: cover; pptxgenjs lấy tỉ lệ ảnh gốc từ w/h
        slide.addImage({ path: file, x: n.r.x * PX, y: n.r.y * PX, w: nw * PX, h: nh * PX, sizing: { type: "cover", w: n.r.w * PX, h: n.r.h * PX }, hyperlink, objectName: name(ctx, { anim: n.anim, radius: n.radius, box: n.r }) });
      }
      return;
    }
    case "snap": {
      const png = join(assets.tmp, `${crypto.randomUUID()}.png`);
      await page.evaluate((id) => { document.documentElement.dataset.snap = ""; document.querySelector(`[data-snap="${id}"]`)?.setAttribute("data-snap-on", ""); }, n.id);
      await Bun.write(png, await page.screenshot({ clip: { x: n.r.x, y: n.r.y, width: n.r.w, height: n.r.h }, omitBackground: true }));
      await page.evaluate(() => { delete document.documentElement.dataset.snap; document.querySelector("[data-snap-on]")?.removeAttribute("data-snap-on"); });
      slide.addImage({ path: png, ...inches(n.r), hyperlink, objectName: name(ctx, { anim: n.anim }) });
      return;
    }
    case "table": {
      // mỗi hàng là một bảng riêng xếp sát nhau, để từng hàng hiện theo lần bấm như trên web
      let y = n.r.y;
      for (const row of n.rows) {
        const cells = row.cells.map((c) => ({
          text: textRuns(c.runs, ctx),
          options: { fill: { color: hex(c.fill) }, align: c.align, valign: "top" as const, margin: c.pad.map((v) => v / 2) as [number, number, number, number], lineSpacing: Math.round(c.lineHeight * 50) / 100 },
        }));
        slide.addTable([cells], { ...inches({ x: n.r.x, y, w: n.r.w, h: row.h }), colW: n.cols.map((w) => w * PX), rowH: row.h * PX, border: { type: "solid", color: hex(n.line), pt: 1 }, autoPage: false, objectName: name(ctx, { anim: row.anim }) });
        y += row.h;
      }
      return;
    }
    case "video":
      if (assets.videoFile) slide.addMedia({ type: "video", path: assets.videoFile, cover: assets.cover, ...inches(n.r), objectName: name(ctx, { radius: n.radius, box: n.r }) });
      return;
    case "chart":
      return; // vẽ ở drawChart vì cần số liệu của cảnh
  }
}

/** Biểu đồ cột gốc (sửa được số liệu) đặt đúng chỗ, đúng phông, đúng khoảng cách cột như trên web. */
function drawChart(n: Extract<Node, { k: "chart" }>, s: Scene, ctx: SlideCtx) {
  const bars = s.bars || [];
  const v = pickFace(n.value.family, n.value.weight), l = pickFace(n.label.family, n.label.weight);
  for (const f of [v.face, l.face]) if (f) ctx.fonts.add(f);
  const digits = Math.max(0, ...bars.map((b) => (String(b.value).split(".")[1] ?? "").length));
  const gradient = n.fill && "stops" in n.fill ? n.fill : undefined;
  ctx.charts.push(gradient);
  ctx.slide.addChart("bar", [{ name: s.unit || s.title, labels: bars.map((b) => b.label), values: bars.map((b) => b.value) }], {
    ...inches(n.r), barDir: "col", barGapWidthPct: Math.round(n.gap), chartColors: [hex(n.fill ? firstColor(n.fill) : n.value.color)],
    showValue: true, dataLabelPosition: "outEnd", dataLabelColor: hex(n.value.color), dataLabelFontFace: v.typeface, dataLabelFontBold: v.bold,
    dataLabelFontSize: Math.round(n.value.size * 50) / 100, dataLabelFormatCode: digits ? `#,##0.${"0".repeat(digits)}` : "#,##0",
    catAxisLabelColor: hex(n.label.color), catAxisLabelFontFace: l.typeface, catAxisLabelFontBold: l.bold, catAxisLabelFontSize: Math.round(n.label.size * 50) / 100,
    catAxisLineShow: true, catAxisLineColor: hex(n.axis.color), catAxisLineSize: n.axis.width / 2, catAxisMajorTickMark: "none",
    valAxisHidden: true, valAxisMinVal: Math.min(0, ...bars.map((b) => b.value)), valAxisMaxVal: Math.max(1e-9, ...bars.map((b) => b.value)), valGridLine: { style: "none" },
    showLegend: false, showTitle: false, objectName: name(ctx, { anim: n.anim }),
  });
}

/** Hoạt hình / mô phỏng AI thành đoạn video phủ cả trang, bấm để chạy; ảnh bìa là khung hình cuối. */
async function drawCodeScene(s: Scene, project: Project, baseUrl: string, tmp: string, ctx: SlideCtx) {
  const cam = await openCamera(baseUrl, { ...project, scenes: [s] }, 1280);
  const fps = 24, seconds = s.seconds || 8;
  const dir = await mkdtemp(join(tmp, "anim-"));
  try {
    for (let f = 0; f < Math.ceil(seconds * fps); f++) await Bun.write(join(dir, `${String(f).padStart(5, "0")}.jpg`), await cam.at(0, f / fps));
    await Bun.write(join(dir, "cover.jpg"), await cam.at(0, seconds - 0.05));
  } finally { await cam.close(); }
  const mp4 = join(dir, "clip.mp4");
  await Bun.$`ffmpeg -y -v error -framerate ${fps} -i ${join(dir, "%05d.jpg")} -c:v libx264 -pix_fmt yuv420p -crf 20 ${mp4}`.quiet();
  const cover = `data:image/jpeg;base64,${Buffer.from(await Bun.file(join(dir, "cover.jpg")).arrayBuffer()).toString("base64")}`;
  ctx.slide.addMedia({ type: "video", path: mp4, cover, x: 0, y: 0, w: 1920 * PX, h: 1080 * PX, objectName: name(ctx, {}) });
}

/** Tệp video tải lên (nhúng thẳng) hoặc link YouTube (ảnh bìa và chữ trong khung trỏ tới video). */
async function videoAssets(s: Scene): Promise<Omit<Assets, "tmp">> {
  if (s.layout !== "video" || !s.video_url) return {};
  if (!s.video_url.startsWith("/uploads/")) return { youtube: s.video_url };
  const file = join(UPLOADS, s.video_url.slice("/uploads/".length).replace(/[^\w.-]/g, ""));
  if (!(await Bun.file(file).exists())) return {};
  const coverFile = s.image_url?.startsWith("/uploads/") ? join(UPLOADS, s.image_url.slice("/uploads/".length).replace(/[^\w.-]/g, "")) : "";
  const cover = coverFile && extname(coverFile) !== ".svg" && (await Bun.file(coverFile).exists())
    ? `data:image/jpeg;base64,${Buffer.from(await Bun.file(coverFile).arrayBuffer()).toString("base64")}` : undefined;
  return { videoFile: file, cover };
}

/**
 * Giây xuất hiện → lần bấm và độ trễ, đúng như engine trình chiếu: lần bấm j chạy từ điểm dừng j-1
 * tới điểm dừng j (tối đa 1,6 giây cuối); thứ hiện trước điểm dừng đầu tự chạy khi vào trang.
 */
function cueAt(a: Anim, holds: number[]): Cue {
  if (!holds.length || a.t <= holds[0] + 1e-6) return { click: 0, delay: a.t, anim: a };
  let j = holds.findIndex((h) => h >= a.t - 1e-6);
  if (j < 0) j = holds.length - 1;
  return { click: j, delay: Math.max(0, a.t - Math.max(holds[j - 1], holds[j] - 1.6)), anim: a };
}

// chế độ chụp: chỉ một phần tử hiện, nền trong suốt; chế độ nền: giấu mọi cảnh
const SNAP_CSS = `html[data-snap], html[data-snap] body, html[data-snap] .mh-host, html[data-snap] .mh-stage { background: transparent !important; }
html[data-snap] .mh-stage * { visibility: hidden !important; }
html[data-snap] [data-snap-on], html[data-snap] [data-snap-on] *, html[data-snap] .mh-stage marker, html[data-snap] .mh-stage marker * { visibility: visible !important; }
html[data-snap] [data-snap-on] { background: transparent !important; border-color: transparent !important; box-shadow: none !important; }
html[data-bg] .mh-scene { visibility: hidden !important; }`;

export async function exportPptx(project: Project, baseUrl: string): Promise<Buffer> {
  const pres = new PptxGenJS();
  pres.defineLayout({ name: "MH", width: 1920 * PX, height: 1080 * PX });
  pres.layout = "MH";
  pres.title = project.title;
  pres.author = "SkyLab";
  const tmp = await mkdtemp(join(tmpdir(), "mh-pptx-"));
  const page = await openSnap(baseUrl, project, 1920, 2);
  const fonts = new Set<Face>();
  const charts: (Gradient | undefined)[] = [];
  const slides: Map<string, Shape>[] = [];
  try {
    await page.addStyleTag({ content: SNAP_CSS });
    // nền riêng của giao diện (hoa văn, quầng sáng, hạt giấy) chụp từ engine, không kèm nội dung
    const background = join(tmp, "background.jpg");
    if (project.scenes.length) await page.evaluate(() => window.__at?.(0, 0));
    await page.evaluate(() => { document.documentElement.dataset.bg = ""; });
    await Bun.write(background, await page.screenshot({ type: "jpeg", quality: 90, scale: "css" }));
    await page.evaluate(() => { delete document.documentElement.dataset.bg; });

    /** question: trắc nghiệm chưa công bố đáp án; answer: trang đáp án, hiện sẵn mọi thứ. */
    const addSlide = async (s: Scene, i: number, question: boolean, answer: boolean) => {
      const slide = pres.addSlide();
      slide.background = { path: background };
      let holds: number[] = [];
      const ctx: SlideCtx = { slide, shapes: new Map(), fonts, charts, cue: (a) => (a && !answer ? cueAt(a, holds) : undefined) };
      slides.push(ctx.shapes);
      const notes = answer ? s.explain : s.notes;
      if (notes) slide.addNotes(notes);
      if ((s.layout === "custom" || s.layout === "sim") && s.code) return drawCodeScene(s, project, baseUrl, tmp, ctx);
      const m = await page.evaluate(measure, { i, question });
      // câu hỏi dừng trước lúc công bố đáp án
      holds = question ? m.holds.slice(0, -1) : m.holds;
      const assets = { tmp, ...(await videoAssets(s)) };
      for (const n of m.nodes) {
        if (n.k === "chart") drawChart(n, s, ctx);
        else await drawNode(n, ctx, page, assets);
      }
    };

    for (const [i, s] of project.scenes.entries()) {
      await addSlide(s, i, s.layout === "quiz", false);
      // trang đáp án riêng để giáo viên hỏi lớp trước khi công bố
      if (s.layout === "quiz") await addSlide(s, i, false, true);
    }
    const zip = await JSZip.loadAsync(await pres.write({ outputType: "nodebuffer" }) as Buffer);
    await finishXml(zip, slides, charts);
    await embedFonts(zip, fonts);
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } finally {
    await page.close();
    await rm(tmp, { recursive: true, force: true });
  }
}

// ---------- sửa XML: hiệu ứng, dải màu, ảnh bo góc ----------
let ctn = 0;
/** Một hiệu ứng xuất hiện cho hình `spid`, chậm dần ở cuối như lò xo của engine. */
function effect(spid: string, a: Anim, node: string, delayMs: number) {
  const id = ++ctn;
  const dur = a.words ? 500 : a.wipe || a.stretch ? 700 : 600;
  const tgt = `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>`;
  const show = `<p:set><p:cBhvr><p:cTn id="${++ctn}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>${tgt}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>`;
  const filter = a.wipe ? `wipe(${a.wipe})` : a.stretch ? "" : "fade";
  const filters = filter ? `<p:animEffect transition="in" filter="${filter}"><p:cBhvr><p:cTn id="${++ctn}" dur="${dur}"/>${tgt}</p:cBhvr></p:animEffect>` : "";
  const from: [string, string][] = [];
  if (a.stretch) from.push(["ppt_w", "0"]);
  if (a.dx) from.push(["ppt_x", `#ppt_x${a.dx > 0 ? "+" : "-"}${(Math.abs(a.dx) / 1920).toFixed(4)}`]);
  if (a.dy) from.push(["ppt_y", `#ppt_y${a.dy > 0 ? "+" : "-"}${(Math.abs(a.dy) / 1080).toFixed(4)}`]);
  if (a.scale < 0.97) from.push(["ppt_w", `#ppt_w*${a.scale.toFixed(2)}`], ["ppt_h", `#ppt_h*${a.scale.toFixed(2)}`]);
  const moves = from.map(([attr, val]) =>
    `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="${++ctn}" dur="${dur}" decel="100000" fill="hold"/>${tgt}<p:attrNameLst><p:attrName>${attr}</p:attrName></p:attrNameLst></p:cBhvr>` +
    `<p:tavLst><p:tav tm="0"><p:val><p:strVal val="${val}"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="#${attr}"/></p:val></p:tav></p:tavLst></p:anim>`).join("");
  // mã hiệu ứng chỉ để đặt tên trong ngăn Animation; PowerPoint chạy theo các hành vi ở trên
  const [preset, sub] = a.wipe === "up" ? [22, 1] : a.wipe ? [22, 8] : a.stretch ? [17, 10] : a.scale < 0.97 ? [53, 16] : a.dx ? [2, a.dx < 0 ? 8 : 2] : a.dy ? [42, 0] : [10, 0];
  const words = a.words ? `<p:iterate type="wd"><p:tmPct val="10000"/></p:iterate>` : "";
  return `<p:par><p:cTn id="${id}" presetID="${preset}" presetClass="entr" presetSubtype="${sub}" fill="hold" grpId="0" nodeType="${node}"><p:stCondLst><p:cond delay="${Math.round(delayMs)}"/></p:stCondLst>${words}<p:childTnLst>${show}${filters}${moves}</p:childTnLst></p:cTn></p:par>`;
}

/** Một bước của chuỗi chính: các hình cùng chạy, mỗi hình theo độ trễ riêng. */
function step(items: { spid: string; cue: Cue }[], onClick: boolean) {
  const outer = ++ctn, inner = ++ctn;
  const effects = items.sort((a, b) => a.cue.delay - b.cue.delay)
    .map((it, j) => effect(it.spid, it.cue.anim, j ? "withEffect" : onClick ? "clickEffect" : "afterEffect", it.cue.delay * 1000)).join("");
  const start = onClick ? `<p:cond delay="indefinite"/>` : `<p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>`;
  return `<p:par><p:cTn id="${outer}" fill="hold"><p:stCondLst>${start}</p:stCondLst><p:childTnLst><p:par><p:cTn id="${inner}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${effects}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`;
}

/** Cây hiệu ứng của trang: phần tự chạy khi vào trang, rồi mỗi lần bấm một bước. */
function timing(xml: string, shapes: Map<string, Shape>) {
  const steps = new Map<number, { spid: string; cue: Cue }[]>(), builds: string[] = [];
  for (const m of xml.matchAll(/<p:nv(Sp|Pic|GraphicFrame|CxnSp)Pr><p:cNvPr id="(\d+)" name="(mh\d+)"/g)) {
    const cue = shapes.get(m[3])?.cue;
    if (!cue) continue;
    steps.set(cue.click, [...(steps.get(cue.click) ?? []), { spid: m[2], cue }]);
    // hộp chữ hiện theo từng từ thì hiệu ứng áp lên chữ, không lên cả khung
    if (m[1] === "Sp") builds.push(`<p:bldP spid="${m[2]}" grpId="0"${cue.anim.words ? "" : ` animBg="1"`}/>`);
    else if (m[1] === "GraphicFrame") builds.push(`<p:bldGraphic spid="${m[2]}" grpId="0"><p:bldAsOne/></p:bldGraphic>`);
  }
  if (!steps.size) return "";
  ctn = 2;
  const seq = [...steps.keys()].sort((a, b) => a - b).map((j) => step(steps.get(j)!, j > 0)).join("");
  return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>` +
    `<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${seq}</p:childTnLst></p:cTn>` +
    `<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>` +
    `</p:childTnLst></p:cTn></p:par></p:tnLst>${builds.length ? `<p:bldLst>${builds.join("")}</p:bldLst>` : ""}</p:timing>`;
}

/** Dải màu CSS (linear-gradient) thành <a:gradFill>; góc CSS 90deg = trái → phải = góc 0 của DrawingML. */
const gradFill = (g: Gradient) =>
  `<a:gradFill rotWithShape="1"><a:gsLst>${g.stops.map((s) => `<a:gs pos="${Math.round(s.pos * 100000)}"><a:srgbClr val="${hex(s.color)}">${s.color[3] < 1 ? `<a:alpha val="${Math.round(s.color[3] * 100000)}"/>` : ""}</a:srgbClr></a:gs>`).join("")}</a:gsLst><a:lin ang="${((((g.angle - 90) % 360) + 360) % 360) * 60000}" scaled="0"/></a:gradFill>`;

/** Thay đoạn XML từ `open` tới hết `close` đầu tiên sau vị trí `at` (nếu nằm trước `limit`). */
function replaceAfter(xml: string, at: number, open: string, close: string, limit: string, by: string) {
  const s = xml.indexOf(open, at), end = xml.indexOf(limit, at);
  if (s < 0 || s > end) return xml;
  return xml.slice(0, s) + by + xml.slice(xml.indexOf(close, s) + close.length);
}

/** Sửa XML từng trang và biểu đồ: dải màu, ảnh bo góc, chuyển trang mờ dần và hiệu ứng xuất hiện. */
async function finishXml(zip: JSZip, slides: Map<string, Shape>[], charts: (Gradient | undefined)[]) {
  for (const [i, shapes] of slides.entries()) {
    const file = `ppt/slides/slide${i + 1}.xml`;
    let xml = await zip.file(file)!.async("string");
    for (const [n, sh] of shapes) {
      const at = xml.indexOf(`name="${n}"`);
      if (at < 0) continue;
      if (sh.gradient) xml = replaceAfter(xml, at, "<a:solidFill>", "</a:solidFill>", "</p:spPr>", gradFill(sh.gradient));
      if (sh.radius && sh.box) {
        const adj = Math.round(Math.min(50000, (sh.radius / Math.min(sh.box.w, sh.box.h)) * 100000));
        xml = replaceAfter(xml, at, `<a:prstGeom prst="rect">`, "</a:prstGeom>", "</p:spPr>", `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${adj}"/></a:avLst></a:prstGeom>`);
      }
    }
    zip.file(file, xml.replace("</p:clrMapOvr></p:sld>", `</p:clrMapOvr><p:transition spd="med"><p:fade/></p:transition>${timing(xml, shapes)}</p:sld>`));
  }
  // cột biểu đồ tô dải màu như trên web (pptxgenjs đánh số biểu đồ theo thứ tự tạo)
  for (const [j, g] of charts.entries()) {
    const f = zip.file(`ppt/charts/chart${j + 1}.xml`);
    if (!g || !f) continue;
    zip.file(f.name, (await f.async("string")).replace(/(<c:ser>[\s\S]*?<c:spPr>)<a:solidFill>[\s\S]*?<\/a:solidFill>/, `$1${gradFill(g)}`));
  }
}
