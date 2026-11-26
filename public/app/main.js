import { THEMES } from "/engine/engine.js";
import { openEditor } from "./editor.js";
import { GRADES, SUBJECTS, subjectInfo } from "./meta.js";
import { config, hasAI, openSettings, stepper } from "./shell.js";
import { $, $$, api, esc, readFileB64, runTask, toast, warnUnfinished } from "./ui.js";

const app = $("#app");
let cleanup = null;

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const HOME_ICONS = {
  slides: svg(`<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3M7 9h10M7 13h6"/>`),
  layers: svg(`<path d="m12 2 10 5-10 5L2 7l10-5Z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>`),
  clock: svg(`<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>`),
  search: svg(`<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>`),
  prev: svg(`<path d="m15 18-6-6 6-6"/>`),
  next: svg(`<path d="m9 18 6-6-6-6"/>`),
  plus: svg(`<path d="M12 5v14M5 12h14"/>`),
  sparkle: svg(`<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z"/>`),
};
const fmtDate = (t) => new Date(t).toLocaleDateString("vi-VN");

async function route() {
  cleanup?.();
  cleanup = null;
  window.scrollTo(0, 0);
  const [, view, a, b] = location.hash.replace(/^#/, "").split("/");
  document.body.dataset.view = view || "home";
  const navKey = view === "new" ? "new" : view ? "" : "home";
  $$(".side-nav a").forEach((l) => {
    const on = l.dataset.nav === navKey;
    l.classList.toggle("on", on);
    if (on) l.setAttribute("aria-current", "page"); else l.removeAttribute("aria-current");
  });
  try {
    if (view === "sample") return openSample();
    if (view === "new") return wizard();
    if (view === "p" && a) { cleanup = await openEditor(app, a, b || "script"); return; }
    return home();
  } catch (e) {
    app.innerHTML = `<div class="page"><div class="empty">😕 ${esc(e.message)}<br><a class="btn" href="#/">Về trang chủ</a></div></div>`;
  }
}

// ---------- trang chủ ----------
async function openSample() {
  const p = await api("/api/projects/sample", { method: "POST" });
  location.replace(`#/p/${p.id}/design`);
}

function calendar(list) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const touched = new Set(list.map((p) => new Date(p.updatedAt)).filter((d) => d.getFullYear() === y && d.getMonth() === m).map((d) => d.getDate()));
  const lead = (new Date(y, m, 1).getDay() + 6) % 7; // lịch bắt đầu từ thứ Hai
  const days = new Date(y, m + 1, 0).getDate();
  const cells = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((d) => `<span class="wd">${d}</span>`);
  for (let i = 0; i < lead; i++) cells.push("<span></span>");
  for (let d = 1; d <= days; d++) {
    const cls = d === now.getDate() ? "today" : touched.has(d) ? "has" : "";
    cells.push(`<span class="${cls}"${touched.has(d) ? ` title="Có bài giảng được cập nhật"` : ""}>${d}</span>`);
  }
  return `<section class="panel" aria-label="Lịch"><div class="cal-h"><h2>Tháng ${m + 1}, ${y}</h2></div><div class="cal">${cells.join("")}</div>
    <p class="muted small" style="margin:12px 0 0">Ô cam: ngày có bài giảng được cập nhật.</p></section>`;
}

async function home() {
  document.title = "SkyLab";
  const list = await api("/api/projects");
  const own = list.filter((p) => !p.sample); // bài mẫu không phải bài của người dùng
  const scenes = own.reduce((n, p) => n + (p.scenes || 0), 0);
  const last = own.reduce((t, p) => Math.max(t, p.updatedAt || 0), 0);
  const course = (p) => `<article class="course tint-violet" data-id="${p.id}" data-title="${esc(p.title.toLowerCase())}">
      <a class="course-link" href="#/p/${p.id}/script"><span class="course-thumb">${HOME_ICONS.slides}</span>
      <span class="course-body"><b class="course-t">${esc(p.title)}</b>
      <span class="course-meta">${p.scenes} slide · cập nhật ${fmtDate(p.updatedAt)}</span></span></a>
      <button class="icon-btn del" type="button" title="Xoá dự án" aria-label="Xoá ${esc(p.title)}">×</button></article>`;
  app.innerHTML = `
  <div class="dash">
    <div class="dash-main">
      <header class="dash-head">
        <div><h1>Chào thầy cô!</h1><p>Hôm nay mình cùng soạn bài dễ hơn nhé.</p></div>
        <label class="dash-search">${HOME_ICONS.search}<span hidden>Tìm bài giảng</span><input id="q" type="search" placeholder="Tìm bài giảng…" aria-label="Tìm bài giảng"></label>
      </header>
      <section class="dash-hero">
        <div class="dash-hero-copy"><small>Không gian giáo viên</small>
          <h2>Biến một chủ đề thành bộ slide sinh động chỉ trong vài phút</h2>
          <div class="dash-hero-actions"><a class="hero-pri" href="#/new">${HOME_ICONS.plus} Tạo slide mới</a><button class="hero-sec" id="sample" type="button">Mở bài mẫu</button></div></div>
        <div class="dash-hero-art" aria-hidden="true"><i></i><i></i><i></i></div>
      </section>
      <section class="dash-stats" aria-label="Thống kê">
        <div class="stat tint-violet"><span class="stat-ic">${HOME_ICONS.slides}</span><div><b>${own.length}</b><span>Bộ slide</span></div></div>
        <div class="stat tint-orange"><span class="stat-ic">${HOME_ICONS.layers}</span><div><b>${scenes}</b><span>Tổng số slide</span></div></div>
        <div class="stat tint-green"><span class="stat-ic">${HOME_ICONS.clock}</span><div><b>${last ? fmtDate(last) : "—"}</b><span>Cập nhật gần nhất</span></div></div>
      </section>
      <section>
        <div class="dash-sec-h"><h2>Tiếp tục bài đang làm</h2><label class="dash-link">Nhập tệp dự án<input type="file" accept=".json,application/json" id="import" hidden></label></div>
        ${list.length ? `<div class="courses" id="courses">${list.map(course).join("")}</div><p class="dash-empty" id="no-match" hidden><b>Không tìm thấy bài nào.</b></p>` : `<div class="dash-empty"><b>Chưa có bộ slide nào.</b><span>Tạo bộ đầu tiên từ một chủ đề, hoặc mở bài mẫu để xem cách hoạt động.</span></div>`}
      </section>
    </div>
    <aside class="dash-aside">
      ${calendar(list)}
      <section class="panel"><h2>Làm bài trong 4 bước</h2><ol class="steps">
        <li class="tint-violet"><div><b>Nhập ý tưởng</b><span>Chủ đề, môn học và tài liệu.</span></div></li>
        <li class="tint-orange"><div><b>Sửa kịch bản</b><span>Điều chỉnh từng cảnh theo ý mình.</span></div></li>
        <li class="tint-green"><div><b>Xem và luyện tập</b><span>Đổi giao diện, xem trước, nhờ AI soát.</span></div></li>
        <li class="tint-blue"><div><b>Xuất bản</b><span>Trình chiếu, PowerPoint, PDF hoặc HTML.</span></div></li></ol></section>
    </aside>
  </div>`;
  $("#sample").onclick = openSample;
  $("#q").oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    let shown = 0;
    $$(".course").forEach((c) => { const ok = c.dataset.title.includes(q); c.hidden = !ok; shown += ok; });
    const nm = $("#no-match"); if (nm) nm.hidden = shown > 0 || !list.length;
  };
  $("#import").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const p = await api("/api/projects", { body: { ...data, id: undefined } });
      location.hash = `#/p/${p.id}/script`;
    } catch (err) { toast("Tệp không đúng định dạng dự án: " + err.message, "error"); }
  };
  $$(".course .del").forEach((b) => (b.onclick = async () => {
    const card = b.closest(".course");
    if (!confirm(`Xoá dự án “${card.querySelector(".course-t").textContent}”? Không thể hoàn tác.`)) return;
    await api(`/api/projects/${card.dataset.id}`, { method: "DELETE" });
    card.remove();
  }));
}

// ---------- trình hướng dẫn: bước 1 ----------
function wizard() {
  document.title = "Tạo slide mới — SkyLab";
  const last = JSON.parse(localStorage.getItem("mh.lastBrief") || "{}");
  const st = { files: [] };
  app.innerHTML = `
  <div class="page narrow">
    ${stepper(1)}
    <div class="wiz-head"><span class="ic-chip tint-violet">${HOME_ICONS.slides}</span><div><h1 class="title">Tạo slide mới</h1><p class="muted">Nhập chủ đề, AI viết sẵn từng slide để bạn sửa lại. Trình chiếu bấm hiện từng ý, xuất được PowerPoint.</p></div></div>
    <div class="card form">
      <div class="grid2">
        <label class="field"><span>Môn học</span><select id="subject">${SUBJECTS.map((s) => `<option ${last.subject === s.name ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Lớp</span><select id="grade">${GRADES.map((g) => `<option ${last.grade === g ? "selected" : ""}>${g}</option>`).join("")}</select></label>
      </div>
      <label class="field"><span>Chủ đề <b class="req">*</b></span>
        <input id="topic" class="big" autofocus></label>
      <div class="field"><span>Tài liệu của bạn <i class="muted">(không bắt buộc, nhưng giúp AI viết đúng hơn)</i></span>
        <div class="doc-box">
          <textarea id="notes" rows="5" aria-label="Tài liệu của bạn" placeholder="Dán nội dung bài học, dàn ý, ghi chú… AI sẽ bám sát tài liệu này."></textarea>
          <div class="row gap wrap">
            <label class="btn small">📎 Đính kèm PDF / Word / ảnh / .txt<input type="file" id="files" multiple accept=".pdf,.doc,.docx,.txt,.md,image/png,image/jpeg,image/webp" hidden></label>
            <span id="file-list" class="muted small"></span>
          </div>
        </div></div>
      <label class="check"><input type="checkbox" id="research" ${last.research !== false ? "checked" : ""}>
        <span>Cho AI tự tìm thêm thông tin trên Internet <i class="muted">(kèm danh sách nguồn để kiểm chứng)</i></span></label>
      <div class="field"><span>AI hỗ trợ ở mức nào?</span>
        <div class="assist" id="assist">
          <button data-v="write"><b>Viết giúp bản nháp</b><small>AI viết đầy đủ, bạn đọc lại và sửa.</small></button>
          <button data-v="hint"><b>Chỉ gợi ý, tôi tự viết</b><small>AI dựng khung và câu hỏi định hướng <span class="mh-hint-demo">[Gợi ý: …]</span> để bạn tự điền.</small></button>
        </div></div>
      <div class="grid2">
        <label class="field"><span>Số slide: <b id="n-out">10</b> <i class="muted" id="n-time"></i></span><input type="range" id="n" min="4" max="18" value="10"></label>
        <label class="field"><span>Giao diện</span><select id="theme">${THEMES.map((t) => `<option value="${t.key}" ${t.key === "notebook" ? "selected" : ""}>${t.name} — ${t.desc}</option>`).join("")}</select></label>
      </div>
      <div class="row end"><button class="btn primary big" id="go">${HOME_ICONS.sparkle} Tạo kịch bản</button></div>
    </div>
  </div>`;

  const setAssist = (v) => $$("#assist button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
  setAssist(last.assist || "write");
  $("#assist").onclick = (e) => { const b = e.target.closest("button"); if (b) setAssist(b.dataset.v); };
  const setPlaceholder = () => {
    const example = subjectInfo($("#subject").value).topics?.[0];
    $("#topic").placeholder = example ? `Ví dụ: ${example}` : "Nhập chủ đề";
  };
  $("#subject").onchange = setPlaceholder;
  setPlaceholder();
  const nTime = () => {
    const n = +$("#n").value;
    $("#n-out").textContent = n;
    $("#n-time").textContent = `≈ ${n} phút trình bày`;
  };
  $("#n").oninput = nTime; nTime();
  // một số trình duyệt để tệp Word không có type; dựa vào phần mở rộng
  const WORD = { docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword" };
  const fileMime = (f) => WORD[f.name.split(".").pop().toLowerCase()] || f.type || (f.name.endsWith(".md") ? "text/markdown" : "text/plain");
  $("#files").onchange = (e) => {
    st.files = [...e.target.files].slice(0, 5);
    const big = st.files.find((f) => f.size > 12_000_000);
    if (big) { toast(`Tệp “${big.name}” quá lớn (tối đa 12 MB).`, "error"); st.files = st.files.filter((f) => f !== big); }
    $("#file-list").textContent = st.files.map((f) => f.name).join(", ");
  };

  $("#go").onclick = async () => {
    const topic = $("#topic").value.trim();
    if (!topic) { $("#topic").focus(); return toast("Hãy nhập chủ đề trước nhé!", "error"); }
    if (!hasAI()) { openSettings(); return toast("Cần khoá Claude để AI viết kịch bản.", "error"); }
    const brief = {
      topic, subject: $("#subject").value, grade: $("#grade").value,
      notes: $("#notes").value.trim(), research: $("#research").checked,
      assist: $(".assist .on").dataset.v, sceneCount: +$("#n").value,
    };
    localStorage.setItem("mh.lastBrief", JSON.stringify({ subject: brief.subject, grade: brief.grade, research: brief.research, assist: brief.assist }));
    const files = await Promise.all(st.files.map(async (f) => ({
      name: f.name,
      mime: fileMime(f),
      data: await readFileB64(f),
    })));
    try {
      const theme = $("#theme").value;
      const story = await runTask("/api/ai/storyboard", { brief, files, theme }, "✍️ AI đang viết kịch bản");
      const project = await api("/api/projects", {
        body: {
          title: story.title || topic, subject: brief.subject, grade: brief.grade,
          theme, assist: brief.assist, sources: story.sources, scenes: story.scenes,
        },
      });
      warnUnfinished(story);
      location.hash = `#/p/${project.id}/script`;
    } catch (e) {
      toast(e.message, "error");
    }
  };
}
// ---------- khởi động ----------
const themeButton = $("#btn-theme");
function setColorMode(dark) {
  document.body.classList.toggle("dark", dark);
  themeButton.setAttribute("aria-pressed", String(dark));
  themeButton.querySelector(".side-label").textContent = dark ? "Chế độ sáng" : "Chế độ tối";
  localStorage.setItem("mh.colorMode", dark ? "dark" : "light");
}
setColorMode(localStorage.getItem("mh.colorMode") === "dark");
themeButton.onclick = () => setColorMode(!document.body.classList.contains("dark"));
$("#btn-settings").onclick = openSettings;
Object.assign(config, await api("/api/config").catch(() => ({})));
SUBJECTS.push(...(config.subjects || []));
// thanh trượt range tô phần đã chọn bằng --fill (WebKit không có pseudo-element tiến độ)
const paintRange = (r) => r.style.setProperty("--fill", `${((r.value - r.min) / (r.max - r.min || 1)) * 100}%`);
document.addEventListener("input", (e) => { if (e.target.matches?.("input[type=range]")) paintRange(e.target); });
new MutationObserver(() => $$("input[type=range]").forEach(paintRange)).observe(app, { childList: true, subtree: true });
window.addEventListener("hashchange", route);
route();
