import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { normalizeScene } from "./ai";
import { isObj, str, type Project } from "./types";

export const ROOT = join(import.meta.dir, "..");
const DATA = process.env.SKYLAB_DATA || join(ROOT, "data");
const PROJECTS = join(DATA, "projects");
export const UPLOADS = join(DATA, "uploads");
await Promise.all([PROJECTS, UPLOADS].map((d) => mkdir(d, { recursive: true })));

const THEMES = ["notebook", "science", "chalk", "midnight"];
const safeId = (id: string) => /^[a-z0-9-]{4,40}$/i.test(id);

export function normalizeProject(raw: unknown, id?: string): Project {
  const r = isObj(raw) ? raw : {};
  return {
    id: id || str(r.id) || crypto.randomUUID().slice(0, 8),
    title: str(r.title) || "Dự án chưa đặt tên",
    subject: str(r.subject),
    grade: str(r.grade),
    theme: THEMES.includes(str(r.theme)) ? str(r.theme) : "notebook",
    assist: r.assist === "hint" ? "hint" : "write",
    sources: Array.isArray(r.sources) ? r.sources.filter(isObj).map((s) => ({ title: str(s.title), url: str(s.url) })).filter((s) => s.title || s.url) : [],
    scenes: Array.isArray(r.scenes) ? r.scenes.map((s) => normalizeScene(s)) : [],
    sample: r.sample === true || undefined,
    createdAt: Number(r.createdAt) || Date.now(),
    updatedAt: Number(r.updatedAt) || Date.now(),
  };
}

export async function listProjects() {
  const files = (await readdir(PROJECTS)).filter((f) => f.endsWith(".json"));
  const all = await Promise.all(files.map(async (f) => {
    try { return normalizeProject(await Bun.file(join(PROJECTS, f)).json()); } catch { return null; }
  }));
  return all
    .filter((p): p is Project => !!p)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .map((p) => ({ id: p.id, title: p.title, theme: p.theme, scenes: p.scenes.length, updatedAt: p.updatedAt, icon: p.scenes[0]?.icon, sample: p.sample }));
}

export async function loadProject(id: string): Promise<Project | null> {
  if (!safeId(id)) return null;
  const f = Bun.file(join(PROJECTS, `${id}.json`));
  return (await f.exists()) ? normalizeProject(await f.json(), id) : null;
}

export async function saveProject(raw: unknown, id?: string): Promise<Project> {
  const p = normalizeProject(raw, id);
  if (!safeId(p.id)) throw new Error("Mã dự án không hợp lệ");
  // Chỉ thay đổi thật mới tính là cập nhật: mở, xuất hay lưu lại y nguyên thì giữ thời điểm cũ.
  const old = await loadProject(p.id);
  const same = old && JSON.stringify({ ...old, updatedAt: 0 }) === JSON.stringify({ ...p, updatedAt: 0 });
  if (same) return old;
  p.updatedAt = Date.now();
  await Bun.write(join(PROJECTS, `${p.id}.json`), JSON.stringify(p, null, 2));
  return p;
}

export async function deleteProject(id: string) {
  if (safeId(id)) await rm(join(PROJECTS, `${id}.json`), { force: true });
}
