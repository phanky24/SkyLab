// Bộ công cụ UI nhỏ: escape, thông báo, hộp thoại, màn chờ, client API, trình xem trước.
import { computeTimeline, createPlayer } from "/engine/engine.js";

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function debounce(fn, ms) {
  let t = 0;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => { t = 0; fn(...a); }, ms); };
  /** Chạy ngay lời gọi đang chờ; không làm gì nếu không có. */
  d.flush = () => { if (!t) return; clearTimeout(t); t = 0; fn(); };
  return d;
}

export function toast(msg, type = "info") {
  const box = $("#toasts");
  const t = document.createElement("div");
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.classList.add("out"), type === "error" ? 6500 : 3200);
  setTimeout(() => t.remove(), type === "error" ? 7000 : 3700);
}

/** Báo người dùng những hình và mô phỏng AI chưa tạo được (im lặng nếu tất cả đều xong). */
export function warnUnfinished({ missingImages = 0, missingSims = 0 } = {}) {
  const parts = [missingImages && `${missingImages} hình minh hoạ`, missingSims && `${missingSims} thí nghiệm mô phỏng`].filter(Boolean);
  if (parts.length) toast(`Chưa làm xong ${parts.join(" và ")}. Mở cảnh đó và bấm “Vẽ lại” hoặc “Nhờ AI dựng mô phỏng” để thử lại.`, "error");
}

export function modal(html, { wide = false, onClose } = {}) {
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `<div class="modal ${wide ? "modal-wide" : ""}"><button class="modal-x" aria-label="Đóng">✕</button>${html}</div>`;
  document.body.appendChild(back);
  const close = () => { back.remove(); onClose?.(); };
  back.addEventListener("click", (e) => { if (e.target === back || e.target.closest(".modal-x")) close(); });
  return { el: back.firstElementChild, close };
}

/** Lớp phủ chờ toàn màn hình với các thông điệp tiến độ thân thiện, luân phiên. */
export function busy(messages) {
  const el = document.createElement("div");
  el.className = "busy";
  el.innerHTML = `<div class="busy-card"><div class="spinner"></div><div class="busy-msg"></div><div class="busy-sub">Thường mất 30 giây – 2 phút. Đừng đóng trang nhé!</div></div>`;
  document.body.appendChild(el);
  const msg = el.querySelector(".busy-msg");
  let i = 0;
  msg.textContent = messages[0];
  const timer = setInterval(() => { i = Math.min(i + 1, messages.length - 1); msg.textContent = messages[i]; }, 7000);
  return () => { clearInterval(timer); el.remove(); };
}

// ---------- cài đặt & API ----------
export const settings = {
  get key() { return localStorage.getItem("mh.key") || ""; },
  set key(v) { localStorage.setItem("mh.key", v.trim()); },
  get model() { return localStorage.getItem("mh.model") || ""; },
  set model(v) { localStorage.setItem("mh.model", v); },
};

export async function api(path, { method, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (settings.key) headers["x-ai-key"] = settings.key;
  if (settings.model) headers["x-ai-model"] = settings.model;
  const res = await fetch(path, { method: method || (body ? "POST" : "GET"), headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
  return data;
}

/**
 * Bắt đầu một tác vụ AI dài và chờ nó, hiển thị trạng thái trực tiếp và các khung hình
 * AI đang xem. Trả về kết quả của tác vụ.
 */
export async function runTask(path, body, title) {
  const { task } = await api(path, { body });
  const el = document.createElement("div");
  el.className = "busy";
  el.innerHTML = `<div class="busy-card task-card"><div class="spinner"></div><div class="busy-msg">${esc(title)}</div><div class="busy-sub task-msg">Đang bắt đầu…</div><div class="task-frames"></div><div class="busy-sub">AI tự chụp và soát từng khung hình, có thể mất vài phút.</div></div>`;
  document.body.appendChild(el);
  try {
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500));
      const t = await api(`/api/tasks/${task}`);
      el.querySelector(".task-msg").textContent = t.message;
      const frames = el.querySelector(".task-frames");
      if (t.frames.length && frames.dataset.n !== String(t.frames.length) + t.frames[0].length) {
        frames.dataset.n = String(t.frames.length) + t.frames[0].length;
        frames.innerHTML = t.frames.map((f) => `<img src="${f}" alt="">`).join("");
      }
      if (t.status === "done") return t.result;
      if (t.status === "error") throw new Error(t.error || "AI gặp lỗi");
    }
  } finally { el.remove(); }
}

export function readFileB64(file) {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1]);
    r.onerror = fail;
    r.readAsDataURL(file);
  });
}

/** Tải lên ảnh hoặc video MP4; trả về { url, poster? } (poster: ảnh bìa của video). */
export async function uploadFile(file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/**
 * Trình xem trước có nút phát / tua.
 * sceneIndex: chỉ xem trước cảnh đó (nhẹ, dùng khi đang soạn).
 */
export function mountPreview(box, project, { sceneIndex = null, controls = true } = {}) {
  box.innerHTML = `<div class="pv-stage mh-host"></div>${controls ? `<div class="pv-bar"><button class="pv-play" title="Phát / dừng">▶</button><input class="pv-seek" type="range" min="0" step="0.01" value="0"><span class="pv-time">0:00</span></div>` : ""}`;
  const stageHost = box.querySelector(".pv-stage");
  const view = (p) => (sceneIndex == null ? p : { ...p, scenes: [p.scenes[sceneIndex]].filter(Boolean) });
  let p = view(project);
  let tl = computeTimeline(p);
  const player = createPlayer(stageHost, p, tl, { mode: "preview" });
  let t = 0, playing = false, raf = 0, last = 0;
  const playBtn = box.querySelector(".pv-play"), seek = box.querySelector(".pv-seek"), time = box.querySelector(".pv-time");
  function bar() {
    if (seek) { seek.max = tl.total; seek.value = t; time.textContent = `${fmt(t)} / ${fmt(tl.total)}`; }
  }
  function show() { player.seek(t); bar(); }
  // Khung nghỉ của cảnh i: mọi thứ đã hiện, giống lúc trình chiếu.
  function rest(i) {
    const s = tl.scenes[i];
    if (!s) return;
    t = s.start + Math.max(0, s.duration - 0.4);
    player.showRest(i);
    bar();
  }
  function loop(now) {
    t += (now - last) / 1000; last = now;
    if (t >= tl.total) { t = tl.total; stop(); }
    show();
    if (playing) raf = requestAnimationFrame(loop);
  }
  function play() { if (t >= tl.total - 0.5) t = 0; playing = true; last = performance.now(); if (playBtn) playBtn.textContent = "⏸"; raf = requestAnimationFrame(loop); }
  function stop() { playing = false; cancelAnimationFrame(raf); if (playBtn) playBtn.textContent = "▶"; }
  playBtn?.addEventListener("click", () => (playing ? stop() : play()));
  seek?.addEventListener("input", () => { stop(); t = Number(seek.value); show(); });
  player.ready().then(() => (sceneIndex != null ? rest(0) : show()));
  return {
    play, stop,
    seekScene(i) { stop(); rest(i); },
    update(next) {
      p = view(next); tl = computeTimeline(p);
      player.update(p, tl);
      t = Math.min(t, tl.total);
      if (sceneIndex != null && !playing) rest(0); else show();
    },
    ready: () => player.ready(),
    destroy() { stop(); player.destroy(); },
  };
}
