// Thứ giúp mô hình nhìn thấy sản phẩm của mình: "máy chụp" không giao diện chụp các cảnh
// từ public/snap.html, cùng một bộ chạy nhỏ cho các tác vụ AI kéo dài.
import { chromium, type Browser, type Page } from "playwright";
import type { Project } from "./types";

let browser: Promise<Browser> | null = null;

/**
 * Trang snap.html đã nạp sẵn dự án, khung 16:9 rộng `width` px; `scale` là deviceScaleFactor
 * (ảnh chụp nét hơn). Luôn close() trang khi xong.
 */
export async function openSnap(baseUrl: string, project: Project, width: number, scale = 1): Promise<Page> {
  const page = await (await (browser ??= chromium.launch())).newPage({ viewport: { width, height: Math.round((width * 9) / 16) }, deviceScaleFactor: scale });
  await page.goto(`${baseUrl}/snap.html`);
  await page.waitForFunction(() => window.__SNAP_READY === true);
  await page.evaluate((p) => window.__load?.(p), project);
  return page;
}

/** Máy chụp cho các vòng AI tự soát (mặc định rộng 960 px). Luôn close(). */
export async function openCamera(baseUrl: string, project: Project, width = 960) {
  const page = await openSnap(baseUrl, project, width);
  const shot = async () => page.screenshot({ type: "jpeg", quality: 80 });
  return {
    /** Cảnh i khi đã hiện đủ mọi thứ. */
    async rest(i: number): Promise<Buffer> { await page.evaluate((k) => window.__rest?.(k), i); return shot(); },
    /** Cảnh i ở giây t tính từ đầu cảnh. */
    async at(i: number, t: number): Promise<Buffer> { await page.evaluate(([k, s]) => window.__at?.(k, s), [i, t] as const); return shot(); },
    async errors(): Promise<string[]> { return page.evaluate(() => window.__errors?.splice(0) ?? []); },
    close: () => page.close(),
  };
}

// ---------- tác vụ AI kéo dài (trình duyệt hỏi tiến độ định kỳ) ----------
export interface Task {
  id: string;
  status: "running" | "done" | "error";
  message: string;
  /** ảnh xem trước nhỏ (data URL) của các khung hình mô hình vừa xem */
  frames: string[];
  result?: unknown;
  error?: string;
}
const tasks = new Map<string, Task>();
export const getTask = (id: string) => tasks.get(id);

export function startTask(run: (t: Task) => Promise<unknown>): Task {
  const t: Task = { id: crypto.randomUUID().slice(0, 12), status: "running", message: "Đang bắt đầu…", frames: [] };
  tasks.set(t.id, t);
  run(t).then(
    (result) => { t.result = result; t.status = "done"; t.message = "Xong!"; },
    (e) => { t.status = "error"; t.error = e instanceof Error ? e.message : String(e); t.message = t.error; },
  );
  setTimeout(() => tasks.delete(t.id), 3_600_000);
  return t;
}

export const toDataUrl = (jpeg: Buffer) => `data:image/jpeg;base64,${jpeg.toString("base64")}`;
