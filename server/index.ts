import { basename, extname, join, normalize } from "node:path";
import { youtubeId } from "../public/engine/engine.js";
import { exportDeck, exportPdf } from "./export";
import { DOC, DOCX } from "./docx";
import { exportPptx } from "./pptx";
import { addScenes, AIError, animateScene, coach, DEFAULT_MODEL, illustrate, MODELS, research, reviewProject, rewriteScene, serverToken, storyboard, type AIAuth, type Brief, type Progress, type UploadFile } from "./ai";
import { getTask, openCamera, startTask, toDataUrl, type Task } from "./harness";
import { deleteProject, listProjects, loadProject, normalizeProject, ROOT, saveProject, UPLOADS } from "./store";
import { subjectExamples } from "./subjects";
import { isObj, str, type Project, type Scene } from "./types";

const PORT = Number(process.env.PORT) || 3210;
const PUBLIC = join(ROOT, "public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
};

/** Một tệp trong `base`; hỗ trợ byte Range để tua được video (Safari bắt buộc). */
async function serveFile(base: string, rel: string, headers: Record<string, string> = {}, range: string | null = null) {
  const path = normalize(join(base, decodeURIComponent(rel)));
  if (!path.startsWith(base)) return new Response("Forbidden", { status: 403 });
  const f = Bun.file(path);
  if (!(await f.exists())) return new Response("Không tìm thấy", { status: 404 });
  const head = { "Content-Type": MIME[extname(path).toLowerCase()] || "application/octet-stream", "Accept-Ranges": "bytes", ...headers };
  const r = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
  if (!r || (!r[1] && !r[2])) return new Response(f, { headers: head });
  const size = f.size;
  const start = r[1] ? Number(r[1]) : Math.max(0, size - Number(r[2]));
  const end = r[1] && r[2] ? Math.min(Number(r[2]), size - 1) : size - 1;
  if (start > end || start >= size) return new Response(null, { status: 416, headers: { ...head, "Content-Range": `bytes */${size}` } });
  return new Response(f.slice(start, end + 1), { status: 206, headers: { ...head, "Content-Range": `bytes ${start}-${end}/${size}` } });
}

const ok = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (message: string, status = 400) => Response.json({ error: message }, { status });

function authOf(req: Request): AIAuth {
  const model = req.headers.get("x-ai-model") || "";
  return {
    token: req.headers.get("x-ai-key") || serverToken(),
    model: /^claude-[\w.-]{2,60}$/.test(model) ? model : DEFAULT_MODEL,
  };
}

async function body(req: Request): Promise<Record<string, unknown>> {
  const b: unknown = await req.json().catch(() => null);
  if (!isObj(b)) throw new AIError("Dữ liệu gửi lên không hợp lệ.", 400);
  return b;
}

function briefOf(v: unknown): Brief {
  const b = isObj(v) ? v : {};
  const topic = str(b.topic).trim();
  if (!topic) throw new AIError("Hãy nhập chủ đề.", 400);
  return {
    topic, subject: str(b.subject), grade: str(b.grade),
    notes: str(b.notes), research: b.research === true, sceneCount: Number(b.sceneCount) || undefined,
    assist: b.assist === "hint" ? "hint" : "write", audience: str(b.audience),
  };
}

function filesOf(v: unknown): UploadFile[] {
  if (!Array.isArray(v)) return [];
  const files = v.filter(isObj).map((f) => ({ name: str(f.name), mime: str(f.mime), data: str(f.data) }))
    .filter((f) => (/^(application\/pdf|image\/(png|jpeg|webp)|text\/[\w.+-]+)$/.test(f.mime) || f.mime === DOCX || f.mime === DOC) && f.data);
  if (files.reduce((n, f) => n + f.data.length, 0) > 20_000_000) throw new AIError("Tệp đính kèm quá lớn (tối đa ~15 MB).", 413);
  return files;
}

function projectFrom(v: unknown): Project {
  if (isObj(v) && Array.isArray(v.scenes)) return normalizeProject(v);
  throw new AIError("Thiếu dữ liệu dự án.", 400);
}

async function saveUpload(data: Uint8Array, mime: string) {
  const ext = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" }[mime];
  if (!ext) throw new AIError("Chỉ nhận ảnh PNG, JPG, WEBP hoặc GIF.", 415);
  const name = crypto.randomUUID().slice(0, 12) + ext;
  await Bun.write(join(UPLOADS, name), data);
  return `/uploads/${name}`;
}

/** Hình AI vẽ cho `prompt`, lưu cùng các tệp tải lên; trả về URL của hình. */
async function drawImage(auth: AIAuth, prompt: string) {
  const name = `${crypto.randomUUID().slice(0, 12)}.svg`;
  await Bun.write(join(UPLOADS, name), await illustrate(auth, prompt));
  return `/uploads/${name}`;
}

/**
 * Vẽ song song mọi cảnh hình mà AI đã mô tả nhưng chưa có hình. Vẽ hỏng thì
 * cảnh đó để trống hình (trình soạn có thể vẽ lại) thay vì làm hỏng cả kịch
 * bản; trả về số hình vẽ hỏng.
 */
async function drawMissingImages(auth: AIAuth, scenes: Scene[]): Promise<number> {
  const todo = scenes.filter((s) => s.layout === "image" && !s.image_url && s.image_prompt);
  const results = await Promise.allSettled(todo.map(async (s) => { s.image_url = await drawImage(auth, s.image_prompt!); }));
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  for (const f of failed) console.error("Không vẽ được hình:", f.reason);
  return failed.length;
}

/** Ảnh bìa cho video tải lên: một khung hình gần đầu, hoặc null khi ffmpeg không đọc được. */
async function videoPoster(file: string): Promise<string | null> {
  const out = file.replace(/\.mp4$/, ".jpg");
  for (const at of ["1", "0"]) {
    await Bun.$`ffmpeg -y -v error -ss ${at} -i ${file} -frames:v 1 -q:v 3 ${out}`.nothrow().quiet();
    if (Bun.file(out).size > 0) return `/uploads/${basename(out)}`;
  }
  return null;
}

/** Ảnh thu nhỏ của chính YouTube, lưu cùng tệp tải lên để PDF, PowerPoint và bản offline hiển thị được. */
async function youtubeCover(id: string): Promise<string | null> {
  for (const size of ["maxresdefault", "hqdefault"]) {
    try {
      const res = await fetch(`https://i.ytimg.com/vi/${id}/${size}.jpg`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      const name = `${crypto.randomUUID().slice(0, 12)}.jpg`;
      await Bun.write(join(UPLOADS, name), await res.arrayBuffer());
      return `/uploads/${name}`;
    } catch { /* offline: video vẫn phát được khi lớp học có Internet */ }
  }
  return null;
}

// Các tác vụ AI cần xem khung hình đã dựng dùng camera headless trên chính máy chủ này
const camera = (pr: Project) => openCamera(`http://127.0.0.1:${PORT}`, pr);
const report = (t: Task) => (pg: Progress) => { t.message = pg.message; if (pg.frames.length) t.frames = pg.frames.slice(-6).map(toDataUrl); };

/**
 * Hoàn thiện những gì kịch bản vừa viết còn thiếu: hình cho cảnh hình và code
 * cho cảnh mô phỏng, chạy song song. Lỗi thì để cảnh đó cho trình soạn làm lại
 * thay vì làm hỏng cả kịch bản; trả về số cảnh bị lỗi.
 */
async function finishScenes(auth: AIAuth, project: Project, t: Task) {
  const sims = project.scenes.flatMap((s, i) => (s.layout === "sim" && !s.code ? [i] : []));
  if (sims.length) t.message = `Đang dựng ${sims.length} thí nghiệm mô phỏng và vẽ hình minh hoạ…`;
  else if (project.scenes.some((s) => s.layout === "image" && !s.image_url)) t.message = "Đang vẽ hình minh hoạ…";
  const built = Promise.allSettled(sims.map(async (i) => { project.scenes[i] = await animateScene(auth, project, i, "", camera, report(t)); }));
  const [missingImages, simResults] = await Promise.all([drawMissingImages(auth, project.scenes), built]);
  const failed = simResults.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  for (const f of failed) console.error("Không dựng được mô phỏng:", f.reason);
  return { missingImages, missingSims: failed.length };
}

async function route(req: Request, url: URL): Promise<Response> {
  const { pathname: p } = url;
  const m = req.method;

  if (p === "/api/config" && m === "GET") {
    return ok({ serverKey: !!serverToken(), defaultModel: DEFAULT_MODEL, models: MODELS, subjects: subjectExamples() });
  }

  // dự án
  if (p === "/api/projects" && m === "GET") return ok(await listProjects());
  if (p === "/api/projects" && m === "POST") return ok(await saveProject(await body(req)));
  if (p === "/api/projects/sample" && m === "POST") {
    // Dùng lại bản sao đã tạo trước đó để "Mở bài mẫu" không thêm bài mới sau mỗi lần bấm.
    const sample = await Bun.file(join(ROOT, "samples/chuyen-dong-brown.json")).json();
    const old = (await listProjects()).find((x) => x.sample || x.title === sample.title);
    if (old) return ok(old.sample ? await loadProject(old.id) : await saveProject({ ...(await loadProject(old.id)), sample: true }, old.id));
    return ok(await saveProject({ ...sample, id: undefined, sample: true, createdAt: Date.now() }));
  }
  let mm = p.match(/^\/api\/projects\/([\w-]+)$/);
  if (mm) {
    if (m === "GET") { const pr = await loadProject(mm[1]); return pr ? ok(pr) : fail("Không tìm thấy dự án", 404); }
    if (m === "PUT") return ok(await saveProject(await body(req), mm[1]));
    if (m === "DELETE") { await deleteProject(mm[1]); return ok({ ok: true }); }
  }
  mm = p.match(/^\/api\/projects\/([\w-]+)\/export\.(html|pdf|pptx)$/);
  if (mm && m === "GET") {
    const pr = await loadProject(mm[1]);
    if (!pr) return fail("Không tìm thấy dự án", 404);
    const file = (pr.title || "bai-trinh-chieu").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").replace(/[^\w]+/g, "-").slice(0, 50) || "deck";
    if (mm[2] === "pptx") {
      return new Response(new Uint8Array(await exportPptx(pr, `http://127.0.0.1:${PORT}`)), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation", "Content-Disposition": `attachment; filename="${file}.pptx"` } });
    }
    if (mm[2] === "pdf") {
      return new Response(new Uint8Array(await exportPdf(pr, `http://127.0.0.1:${PORT}`)), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${file}.pdf"` } });
    }
    return new Response(await exportDeck(pr), { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="${file}.html"` } });
  }

  // tệp tải lên
  if (p === "/api/upload" && m === "POST") {
    const form = await req.formData();
    const f = form.get("file");
    if (!(f instanceof Blob)) return fail("Không có tệp");
    if (f.type === "video/mp4") {
      if (f.size > 100_000_000) return fail("Video quá lớn (tối đa 100 MB).", 413);
      const file = join(UPLOADS, `${crypto.randomUUID().slice(0, 12)}.mp4`);
      await Bun.write(file, f);
      return ok({ url: `/uploads/${basename(file)}`, poster: await videoPoster(file) });
    }
    if (f.size > 10_000_000) return fail("Ảnh quá lớn (tối đa 10 MB)", 413);
    return ok({ url: await saveUpload(new Uint8Array(await f.arrayBuffer()), f.type) });
  }
  if (p === "/api/youtube" && m === "POST") {
    const id = youtubeId(str((await body(req)).url));
    if (!id) return fail("Link YouTube không hợp lệ. Hãy dán link dạng youtube.com/watch?v=… hoặc youtu.be/…");
    return ok({ video_url: `https://www.youtube.com/watch?v=${id}`, image_url: await youtubeCover(id) });
  }

  // AI
  // viết kịch bản mất vài phút khi phải dựng mô phỏng: chạy thành tác vụ để client hỏi dần
  if (p === "/api/ai/storyboard" && m === "POST") {
    const b = await body(req);
    const auth = authOf(req);
    const brief = briefOf(b.brief);
    const files = filesOf(b.files);
    return ok({
      task: startTask(async (t) => {
        let notes: string | undefined, sources: { title: string; url: string }[] = [];
        if (brief.research) { t.message = "Đang tìm thông tin trên Internet…"; ({ notes, sources } = await research(auth, brief)); }
        t.message = "Đang viết kịch bản…";
        const story = await storyboard(auth, brief, files, notes);
        const draft = normalizeProject({ title: story.title, subject: brief.subject, grade: brief.grade, theme: str(b.theme), scenes: story.scenes });
        return { title: story.title, scenes: draft.scenes, sources, ...(await finishScenes(auth, draft, t)) };
      }).id,
    });
  }
  if (p === "/api/ai/rewrite" && m === "POST") {
    const b = await body(req);
    const auth = authOf(req), pr = projectFrom(b.project);
    const { scene, note, redraw } = await rewriteScene(auth, pr, Number(b.index), str(b.instruction) || "Viết lại hay hơn");
    if (redraw) scene.image_url = await drawImage(auth, scene.image_prompt!);
    return ok({ scene, note });
  }
  if (p === "/api/ai/add" && m === "POST") {
    const b = await body(req);
    const auth = authOf(req), pr = projectFrom(b.project), instruction = str(b.instruction);
    return ok({
      task: startTask(async (t) => {
        t.message = "Đang viết cảnh mới…";
        const draft = { ...pr, scenes: await addScenes(auth, pr, instruction) };
        return { scenes: draft.scenes, ...(await finishScenes(auth, draft, t)) };
      }).id,
    });
  }
  if (p === "/api/ai/coach" && m === "POST") {
    const b = await body(req);
    return ok(await coach(authOf(req), projectFrom(b.project)));
  }
  if (p === "/api/ai/image" && m === "POST") {
    const b = await body(req);
    const prompt = str(b.prompt).trim();
    if (!prompt) return fail("Hãy mô tả hình cần vẽ.");
    return ok({ url: await drawImage(authOf(req), prompt) });
  }

  if (p === "/api/ai/review" && m === "POST") {
    const b = await body(req);
    const pr = projectFrom(b.project), auth = authOf(req);
    return ok({
      task: startTask(async (t) => {
        const r = await reviewProject(auth, pr, camera, report(t));
        if (r.project.scenes.some((s) => s.layout === "image" && !s.image_url && s.image_prompt)) t.message = "Đang vẽ hình minh hoạ…";
        return { ...r, missingImages: await drawMissingImages(auth, r.project.scenes) };
      }).id,
    });
  }
  if (p === "/api/ai/animate" && m === "POST") {
    const b = await body(req);
    const pr = projectFrom(b.project), auth = authOf(req);
    return ok({ task: startTask((t) => animateScene(auth, pr, Number(b.index), str(b.request), camera, report(t))).id });
  }
  mm = p.match(/^\/api\/tasks\/([\w-]+)$/);
  if (mm && m === "GET") {
    const t = getTask(mm[1]);
    return t ? ok(t) : fail("Không tìm thấy tác vụ", 404);
  }

  // tệp tĩnh
  // uploads có thể chứa SVG do AI vẽ: không bao giờ cho tài liệu mở từ đây chạy script
  if (p.startsWith("/uploads/")) return serveFile(UPLOADS, p.slice(9), { "Cache-Control": "max-age=86400", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" }, req.headers.get("range"));
  // CORS: hoạt hình AI tải font và KaTeX từ một frame sandbox (origin mờ)
  if (p.startsWith("/vendor/katex/")) return serveFile(join(ROOT, "node_modules/katex/dist"), p.slice(14), { "Access-Control-Allow-Origin": "*" });
  if (p.startsWith("/vendor/fonts/")) return serveFile(join(ROOT, "node_modules/@fontsource"), p.slice(14), { "Cache-Control": "max-age=604800", "Access-Control-Allow-Origin": "*" });
  if (p.startsWith("/api/")) return fail("Không có API này", 404);
  return serveFile(PUBLIC, p === "/" ? "index.html" : p.slice(1));
}

Bun.serve({
  port: PORT,
  hostname: process.env.HOST || "127.0.0.1", // đặt HOST=0.0.0.0 để chia sẻ trong mạng LAN
  idleTimeout: 255, // lệnh gọi AI kèm tra cứu web có thể chạy khá lâu
  async fetch(req) {
    const url = new URL(req.url);
    try {
      return await route(req, url);
    } catch (e) {
      if (e instanceof AIError) return fail(e.message, e.status);
      console.error(e);
      return fail(e instanceof Error ? e.message : "Lỗi không xác định", 500);
    }
  },
});
console.log(`SkyLab đang chạy tại http://localhost:${PORT}`);
