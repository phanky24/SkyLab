// Trình soạn thảo dự án: 2 Kịch bản (danh sách cảnh + biểu mẫu + AI sửa) · 3 Thiết kế & luyện tập
// (giao diện, xem trước toàn bộ, nguồn, trợ lý AI) · 4 Xuất bản (trình chiếu, PowerPoint, PDF, HTML).
import { mountDeck } from "/engine/deck.js";
import { LAYOUTS, THEMES } from "/engine/engine.js";
import { ITEM_LABELS, QUICK_FIXES, subjectInfo } from "./meta.js";
import { ICONS } from "./icons.js";
import { hasAI, openSettings, stepper } from "./shell.js";
import { $, $$, api, busy, debounce, esc, modal, mountPreview, runTask, toast, uploadFile, warnUnfinished } from "./ui.js";

const HINT_RE = /\[Gợi ý[^\]]*\]/g;
const countHints = (s) => (JSON.stringify(s).match(HINT_RE) || []).length;

const BLANKS = {
    title: { title: "Tiêu đề bài", subtitle: "Dòng giới thiệu ngắn", icon: "✨" },
    bullets: { title: "Các ý chính", icon: "📝", items: [{ text: "Ý thứ nhất" }, { text: "Ý thứ hai" }, { text: "Ý thứ ba" }] },
    compare: { title: "So sánh", left_heading: "A", left_items: ["Đặc điểm 1"], right_heading: "B", right_items: ["Đặc điểm 1"] },
    table: { title: "Bảng tổng hợp", table_headers: ["Tiêu chí", "A", "B"], table_rows: [["Tiêu chí 1", "", ""], ["Tiêu chí 2", "", ""]] },
    timeline: { title: "Các mốc thời gian", items: [{ text: "Năm 1", detail: "Sự kiện" }, { text: "Năm 2", detail: "Sự kiện" }] },
    steps: { title: "Các bước thực hiện", items: [{ text: "Bước 1" }, { text: "Bước 2" }, { text: "Bước 3" }] },
    big_number: { title: "Con số đáng chú ý", value: "100", unit: "%", label: "Ý nghĩa của con số", illustrative: true },
    chart: { title: "Biểu đồ", unit: "Đơn vị", bars: [{ label: "A", value: 3 }, { label: "B", value: 5 }], illustrative: true },
    quote: { title: "Định nghĩa", quote_text: "Nội dung định nghĩa hoặc câu trích dẫn.", quote_author: "Nguồn" },
    formula: { title: "Công thức", latex: "E = mc^2", explain: "Giải thích các đại lượng." },
    quiz: { title: "Câu hỏi nhanh", question: "Câu hỏi?", options: ["Phương án A", "Phương án B", "Phương án C", "Phương án D"], answer_index: 0, explain: "Giải thích đáp án." },
    cycle: { title: "Chu trình", label: "Tên chu trình", items: [{ text: "Khâu 1" }, { text: "Khâu 2" }, { text: "Khâu 3" }] },
    image: { title: "Hình minh hoạ", caption: "Mô tả hình", image_prompt: "" },
    ending: { title: "Cảm ơn đã lắng nghe!", subtitle: "" },
    custom: { title: "Hoạt hình minh hoạ", custom_prompt: "" },
    sim: { title: "Thí nghiệm mô phỏng", custom_prompt: "" },
    video: { title: "Video minh hoạ" },
};

export async function openEditor(app, id, tab) {
    const project = await api(`/api/projects/${id}`);
    const ed = {
        project,
        sel: Math.min(Number(sessionStorage.getItem(`mh.sel.${id}`)) || 0, Math.max(0, project.scenes.length - 1)),
        preview: null,
        deck: null,
        undo: new Map(), // id cảnh → cảnh trước lần AI viết lại gần nhất
    };
    const disposers = [];
    document.title = `${project.title} — SkyLab`;
    const active = { script: 2, design: 3, export: 4 }[tab] || 2;

    app.innerHTML = `
  <div class="page wide">
    <div class="ed-top">
      <div class="ed-name"><span class="ic-chip tint-violet" aria-hidden="true">${ICONS.slides}</span>
        <input id="p-title" value="${esc(project.title)}" title="Tên dự án"><span id="save-st">Đã lưu</span></div>
      ${stepper(active, id)}
    </div>
    <div id="tab"></div>
  </div>`;

    const status = $("#save-st"); // giữ lại: lượt lưu đang chờ có thể xong sau khi rời trang
    const saveNow = async () => {
        status.textContent = "Đang lưu…";
        try {
            await api(`/api/projects/${id}`, { method: "PUT", body: ed.project });
            status.textContent = "Đã lưu";
        } catch (e) {
            status.textContent = "⚠️ Chưa lưu được";
            toast(e.message, "error");
        }
    };
    const save = debounce(saveNow, 700);
    disposers.push(() => save.flush());
    $("#p-title").oninput = (e) => { ed.project.title = e.target.value; save(); };

    const tabEl = $("#tab");
    if (tab === "design") disposers.push(designTab(tabEl, ed, save));
    else if (tab === "export") disposers.push(exportTab(tabEl, ed, saveNow));
    else disposers.push(scriptTab(tabEl, ed, save));
    return () => disposers.forEach((d) => d?.());
}

// =====================================================================
// 2. Kịch bản
// =====================================================================
function scriptTab(root, ed, save) {
    const p = ed.project;
    root.innerHTML = `
  <div class="ed-grid">
    <aside class="scenes card">
      <div class="scenes-h">Các cảnh <span class="muted" id="n-scenes"></span></div>
      <ol id="scene-list"></ol>
      <div class="col gap-s">
        <button class="btn small" id="add-blank">＋ Thêm cảnh</button>
        <button class="btn small ai" id="add-ai">✨ Thêm cảnh bằng AI</button>
      </div>
    </aside>
    <section class="card scene-form" id="form"></section>
    <aside class="scene-side">
      <div class="pv" id="pv"></div>
      <div class="card ai-box">
        <h3><span class="ic-chip">${ICONS.sparkle}</span>Nhờ AI sửa cảnh này</h3>
        <div class="chips" id="fixes">${QUICK_FIXES.map((f) => `<button class="chip">${esc(f)}</button>`).join("")}</div>
        <div class="row gap-s"><input id="fix-text" placeholder="Hoặc tự gõ yêu cầu, ví dụ: thêm số liệu năm 2024"><button class="btn small ai" id="fix-go">Sửa</button></div>
        <button class="btn small ghost" id="undo" hidden>↶ Hoàn tác lần sửa của AI</button>
      </div>
      <div class="card hint-box" id="hint-box" hidden></div>
    </aside>
  </div>
  <div class="row end"><a class="btn primary" href="#/p/${p.id}/design">Tiếp: Thiết kế & luyện tập ${ICONS.arrowR}</a></div>`;

    const list = $("#scene-list", root), form = $("#form", root);
    const scene = () => p.scenes[ed.sel];
    const refreshPreview = debounce(() => ed.preview?.update(p), 250);

    function changed({ structure = false } = {}) {
        save();
        if (structure) renderAll(); else { renderList(); refreshPreview(); renderHints(); }
    }

    function renderList() {
        $("#n-scenes", root).textContent = `(${p.scenes.length})`;
        list.innerHTML = p.scenes.map((s, i) => `
      <li class="scene-li ${i === ed.sel ? "on" : ""}" data-i="${i}">
        <span class="sl-ic">${LAYOUTS[s.layout]?.icon || "📝"}</span>
        <span class="sl-t">${i + 1}. ${esc(s.title || "(chưa có tiêu đề)")}</span>
        ${countHints(s) ? `<span class="sl-hint" title="Còn chỗ gợi ý cần điền">💡${countHints(s)}</span>` : ""}
        <span class="sl-act"><button data-a="up" title="Lên">↑</button><button data-a="down" title="Xuống">↓</button><button data-a="del" title="Xoá">✕</button></span>
      </li>`).join("");
    }

    function renderHints() {
        const n = countHints(p.scenes);
        const box = $("#hint-box", root);
        box.hidden = !n;
        box.innerHTML = `<b>💡 Còn ${n} chỗ gợi ý cần bạn tự điền.</b><p class="small muted">Tìm các ô có chữ <span class="mh-hint-demo">[Gợi ý: …]</span>, thay bằng nội dung của bạn. Trợ lý sẽ nhắc nếu còn sót.</p>`;
    }

    function renderForm() {
        const s = scene();
        if (!s) { form.innerHTML = `<div class="empty">Chưa có cảnh nào. Bấm “＋ Thêm cảnh”.</div>`; return; }
        const fields = LAYOUTS[s.layout]?.fields || [];
        const has = (f) => fields.includes(f);
        const input = (f, label, ph = "", cls = "") => `<label class="field ${cls}"><span>${label}</span><input data-f="${f}" value="${esc(s[f] ?? "")}" placeholder="${esc(ph)}"></label>`;
        const area = (f, label, rows = 2, ph = "") => `<label class="field"><span>${label}</span><textarea data-f="${f}" rows="${rows}" placeholder="${esc(ph)}">${esc(s[f] ?? "")}</textarea></label>`;
        const strList = (key, label, ph) => `
      <div class="field"><span>${label}</span>
        ${(s[key] || []).map((v, j) => `<div class="row-edit"><input data-list="${key}" data-j="${j}" value="${esc(v)}" placeholder="${esc(ph)}"><button class="icon-btn" data-act="del-row" data-list="${key}" data-j="${j}" title="Xoá">✕</button></div>`).join("")}
        <button class="btn tiny" data-act="add-row" data-list="${key}">＋ Thêm</button></div>`;
        const [l1, l2] = ITEM_LABELS[s.layout] || ITEM_LABELS.bullets;

        form.innerHTML = `
      <div class="form-h">
        <h2>Cảnh ${ed.sel + 1}</h2>
        <label class="layout-pick">Bố cục
          <select data-f="layout">${Object.entries(LAYOUTS).map(([k, v]) => `<option value="${k}" ${k === s.layout ? "selected" : ""}>${v.icon} ${v.name}</option>`).join("")}</select></label>
      </div>
      <div class="grid-icon">
        ${input("title", "Tiêu đề", "Tiêu đề ngắn gọn")}
        ${input("icon", "Biểu tượng", "🌿", "f-icon")}
      </div>
      ${has("subtitle") ? input("subtitle", "Dòng phụ", "Một câu giới thiệu ngắn") : ""}
      ${has("items") ? `
        <div class="field"><span>${s.layout === "timeline" ? "Các mốc" : s.layout === "steps" ? "Các bước" : s.layout === "cycle" ? "Các khâu (theo vòng tròn)" : "Các ý"}</span>
          ${(s.items || []).map((it, j) => `
            <div class="row-edit two">
              <input data-list="items" data-j="${j}" data-sub="text" value="${esc(it.text)}" placeholder="${l1}">
              <input data-list="items" data-j="${j}" data-sub="detail" value="${esc(it.detail || "")}" placeholder="${l2}">
              <button class="icon-btn" data-act="del-row" data-list="items" data-j="${j}" title="Xoá">✕</button>
            </div>`).join("")}
          <button class="btn tiny" data-act="add-row" data-list="items">＋ Thêm</button></div>` : ""}
      ${has("label") && s.layout === "cycle" ? input("label", "Chữ ở giữa vòng", "Ví dụ: Năng lượng Mặt Trời") : ""}
      ${has("left_heading") ? `<div class="grid2"><div>${input("left_heading", "Bên trái", "Đối tượng A")}${strList("left_items", "Đặc điểm bên trái", "Đặc điểm")}</div><div>${input("right_heading", "Bên phải", "Đối tượng B")}${strList("right_items", "Đặc điểm bên phải", "Đặc điểm")}</div></div>` : ""}
      ${has("value") ? `<div class="grid3">${input("value", "Con số", "50")}${input("unit", "Đơn vị", "%")}</div>${input("label", "Ý nghĩa con số", "…")}` : ""}
      ${has("bars") ? `
        ${input("unit", "Đơn vị / tên trục", "Ví dụ: Số bọt khí mỗi phút")}
        <div class="field"><span>Các cột</span>
          ${(s.bars || []).map((b, j) => `<div class="row-edit two"><input data-list="bars" data-j="${j}" data-sub="label" value="${esc(b.label)}" placeholder="Tên cột"><input type="number" step="any" data-list="bars" data-j="${j}" data-sub="value" value="${esc(b.value)}" placeholder="Giá trị"><button class="icon-btn" data-act="del-row" data-list="bars" data-j="${j}">✕</button></div>`).join("")}
          <button class="btn tiny" data-act="add-row" data-list="bars">＋ Thêm cột</button></div>` : ""}
      ${has("illustrative") ? `<label class="check"><input type="checkbox" data-f="illustrative" ${s.illustrative ? "checked" : ""}><span>Đây là <b>số liệu minh hoạ</b> (chưa có nguồn) — sẽ hiện nhãn “Số liệu minh hoạ”</span></label>` : ""}
      ${has("quote_text") ? area("quote_text", "Nội dung trích dẫn / định nghĩa", 3) + input("quote_author", "Nguồn / tác giả") : ""}
      ${has("latex") ? `${input("latex", "Công thức (LaTeX)", "Ví dụ: v = \\frac{s}{t}", "mono")}<div class="latex-help muted small">Mẹo: <code>x^2</code> mũ, <code>H_2O</code> chỉ số dưới, <code>\\frac{a}{b}</code> phân số, <code>\\sqrt{x}</code> căn, <code>\\to</code> mũi tên.</div>` : ""}
      ${has("explain") && s.layout !== "quiz" ? area("explain", "Giải thích", 2) : ""}
      ${has("question") ? `${area("question", "Câu hỏi", 2)}
        <div class="field"><span>Các phương án <i class="muted">(chọn ● đáp án đúng)</i></span>
          ${(s.options || []).map((o, j) => `<div class="row-edit"><input type="radio" name="ans" data-ans="${j}" ${Number(s.answer_index) === j ? "checked" : ""} title="Đáp án đúng"><b class="opt-k">${"ABCDEF"[j]}</b><input data-list="options" data-j="${j}" value="${esc(o)}"><button class="icon-btn" data-act="del-row" data-list="options" data-j="${j}">✕</button></div>`).join("")}
          ${(s.options || []).length < 6 ? `<button class="btn tiny" data-act="add-row" data-list="options">＋ Thêm phương án</button>` : ""}</div>
        ${area("explain", "Giải thích đáp án", 2)}` : ""}
      ${has("image_url") ? `
        ${area("caption", "Chú thích hình", 2)}
        <div class="field"><span>Hình ảnh</span>
          <div class="img-pick">
            ${s.image_url ? `<img src="${esc(s.image_url)}" alt="">` : `<div class="img-none">Chưa có hình</div>`}
            <div class="col gap-s">
              <label class="btn small">📤 Tải ảnh lên<input type="file" accept="image/*" data-act="upload" hidden></label>
              ${s.image_url ? `<button class="btn small ghost" data-act="rm-img">Bỏ hình</button>` : ""}
            </div>
          </div></div>
        <div class="field"><span>🎨 Mô tả hình cho AI vẽ</span>
          <div class="row gap-s"><input data-f="image_prompt" value="${esc(s.image_prompt || "")}" placeholder="Mô tả hình, ví dụ: ${esc(subjectInfo(p.subject).figure)}"><button class="btn small ai" data-act="draw">${s.image_url ? "Vẽ lại" : "Vẽ"}</button></div></div>` : ""}
      ${s.layout === "table" ? `
        <div class="field"><span>Bảng <i class="muted">(hàng đầu là tiêu đề cột)</i></span>
          <div class="t-edit" style="--cols:${(s.table_headers || []).length || 1}">
            ${(s.table_headers || []).map((v, j) => `<input class="t-head" data-th="${j}" value="${esc(v)}" placeholder="Cột ${j + 1}">`).join("")}
            ${(s.table_rows || []).map((row, i) => (s.table_headers || []).map((_, j) => `<input data-tr="${i}" data-tc="${j}" value="${esc(row[j] ?? "")}">`).join("")).join("")}
          </div>
          <div class="row gap-s wrap"><button class="btn tiny" data-act="add-trow">＋ Hàng</button><button class="btn tiny" data-act="del-trow">− Hàng</button><button class="btn tiny" data-act="add-tcol">＋ Cột</button><button class="btn tiny" data-act="del-tcol">− Cột</button></div></div>` : ""}
      ${s.layout === "custom" || s.layout === "sim" ? codeFields(s) : ""}
      ${s.layout === "video" ? videoFields(s) + area("caption", "Chú thích video", 2) : ""}
      ${lookFields(s)}
      <hr>
      ${area("notes", "🗒️ Ghi chú người thuyết trình (chỉ bạn thấy khi trình chiếu)", 2, "Ví dụ: hỏi lớp một câu trước khi chuyển cảnh")}`;
        $("#undo", root).hidden = !ed.undo.has(s.id);
    }

    // cảnh hoạt hình / mô phỏng: mô tả cho AI dựng và nút dựng
    function codeFields(s) {
        const sim = s.layout === "sim";
        const ideas = sim ? [] : subjectInfo(p.subject).animations;
        const done = sim
            ? "Đã có mô phỏng. Khi trình chiếu nó chạy liên tục, có nút Chạy/Dừng, Làm lại và thanh trượt để đổi đại lượng. Sửa mô tả rồi bấm dựng lại nếu muốn đổi."
            : `Đã có hoạt hình dài ${Math.round(s.seconds || 8)} giây. Mô tả thêm rồi bấm dựng lại nếu muốn đổi.`;
        return `
        <div class="field"><span>${sim ? "🧪 Thí nghiệm mô phỏng cần dựng" : "🎬 Bạn muốn AI dựng hoạt hình gì?"}</span>
          <textarea data-f="custom_prompt" rows="3" placeholder="${sim ? "Ví dụ: chuyển động Brown — hạt phấn hoa bị các phân tử nước va chạm hỗn loạn; thanh trượt nhiệt độ và kích thước hạt" : "Mô tả điều cần minh hoạ và diễn biến theo thứ tự"}">${esc(s.custom_prompt || "")}</textarea>
          ${ideas.length ? `<div class="chips">Ý tưởng cho môn ${esc(subjectInfo(p.subject).name)}: ${ideas.map((x) => `<button class="chip" data-act="idea">${esc(x)}</button>`).join("")}</div>` : ""}</div>
        <div class="row gap-s wrap"><button class="btn ai" data-act="animate">${s.code ? "🔁 Dựng lại" : sim ? "🧪 Nhờ AI dựng mô phỏng" : "🎬 Nhờ AI dựng hoạt hình"}</button>
          <span class="muted small">${s.code ? done : "AI tự viết mã, tự chụp khung hình để soát lỗi rồi sửa — mất khoảng 2–5 phút."}</span></div>`;
    }

    // cảnh video: MP4 tải lên (chạy offline) hoặc link YouTube (cần internet)
    function videoFields(s) {
        const where = !s.video_url ? "" : s.video_url.startsWith("/uploads/")
            ? "Video đã tải lên: phát được cả khi không có mạng, có trong file PowerPoint và file .html."
            : `YouTube: ${esc(s.video_url)} — cần có mạng khi trình chiếu; PowerPoint và PDF có ảnh bìa kèm đường link.`;
        return `
        <div class="field"><span>Video</span>
          <div class="img-pick">
            ${s.image_url ? `<img src="${esc(s.image_url)}" alt="">` : `<div class="img-none">${s.video_url ? "Đã có video" : "Chưa có video"}</div>`}
            <div class="col gap-s">
              <label class="btn small">📤 Tải video MP4 lên<input type="file" accept="video/mp4" data-act="upload-video" hidden></label>
              ${s.video_url ? `<button class="btn small ghost" data-act="rm-video">Bỏ video</button>` : ""}
            </div>
          </div>
          ${where ? `<span class="muted small">${where}</span>` : ""}</div>
        <div class="field"><span>▶️ Hoặc dán link YouTube</span>
          <div class="row gap-s"><input id="yt-url" placeholder="https://www.youtube.com/watch?v=…"><button class="btn small" data-act="yt">Dùng link</button></div></div>`;
    }

    // thiết lập hiển thị (scene.look): cùng các núm AI dùng khi được nhờ sửa cảnh
    function lookFields(s) {
        const lk = s.look || {};
        const sel = (key, label, opts) => `<label class="field"><span>${label}</span><select data-look="${key}">${opts.map(([v, t]) => `<option value="${v}" ${String(lk[key] ?? "") === String(v) ? "selected" : ""}>${t}</option>`).join("")}</select></label>`;
        const parts = [sel("text_size", "Cỡ chữ", [["", "Tự động"], ["small", "Nhỏ"], ["large", "Lớn"]])];
        if (s.layout === "image") parts.push(
            sel("image_size", "Cỡ hình", [["", "Vừa"], ["small", "Nhỏ"], ["large", "Lớn"], ["full", "Toàn cảnh"]]),
            sel("image_fit", "Cách đặt hình", [["", "Tự động"], ["contain", "Hiện trọn hình"], ["cover", "Lấp đầy khung (có thể cắt mép)"]]),
            sel("image_side", "Vị trí hình", [["", "Bên trái"], ["right", "Bên phải"]]));
        if (s.layout === "bullets") parts.push(sel("columns", "Số cột", [["", "Tự động"], ["1", "1 cột"], ["2", "2 cột"]]));
        return `<div class="field"><span>Hiển thị</span><div class="look-grid">${parts.join("")}</div></div>`;
    }

    function renderPreview() {
        ed.preview?.destroy();
        const box = $("#pv", root);
        ed.preview = p.scenes.length ? mountPreview(box, p, { sceneIndex: ed.sel }) : null;
        if (!ed.preview) box.innerHTML = "";
    }

    function renderAll() {
        ed.sel = Math.max(0, Math.min(ed.sel, p.scenes.length - 1));
        sessionStorage.setItem(`mh.sel.${p.id}`, ed.sel);
        renderList(); renderForm(); renderPreview(); renderHints();
    }

    // ----- sự kiện -----
    list.onclick = (e) => {
        const li = e.target.closest(".scene-li");
        if (!li) return;
        const i = +li.dataset.i;
        const a = e.target.closest("button")?.dataset.a;
        if (a === "up" && i > 0) { [p.scenes[i - 1], p.scenes[i]] = [p.scenes[i], p.scenes[i - 1]]; ed.sel = i - 1; return changed({ structure: true }); }
        if (a === "down" && i < p.scenes.length - 1) { [p.scenes[i + 1], p.scenes[i]] = [p.scenes[i], p.scenes[i + 1]]; ed.sel = i + 1; return changed({ structure: true }); }
        if (a === "del") {
            if (!confirm(`Xoá cảnh ${i + 1} “${p.scenes[i].title}”?`)) return;
            p.scenes.splice(i, 1);
            if (ed.sel >= i && ed.sel > 0) ed.sel--;
            return changed({ structure: true });
        }
        if (!a) { ed.sel = i; renderAll(); }
    };

    form.addEventListener("input", (e) => {
        const t = e.target, s = scene();
        if (t.dataset.f) {
            const f = t.dataset.f;
            if (f === "layout") return;
            s[f] = t.type === "checkbox" ? t.checked : t.value;
            if (f === "title") renderList();
            return changed();
        }
        if (t.dataset.list) {
            const arr = s[t.dataset.list], j = +t.dataset.j, sub = t.dataset.sub;
            if (sub) arr[j][sub] = sub === "value" ? Number(t.value) : t.value;
            else arr[j] = t.value;
            return changed();
        }
        if (t.dataset.ans != null) { s.answer_index = +t.dataset.ans; return changed(); }
        if (t.dataset.th != null) { s.table_headers[+t.dataset.th] = t.value; return changed(); }
        if (t.dataset.tr != null) { s.table_rows[+t.dataset.tr][+t.dataset.tc] = t.value; return changed(); }
    });
    form.addEventListener("change", async (e) => {
        const t = e.target, s = scene();
        if (t.dataset.look) {
            const look = { ...s.look };
            if (t.value) look[t.dataset.look] = t.dataset.look === "columns" ? Number(t.value) : t.value;
            else delete look[t.dataset.look];
            if (Object.keys(look).length) s.look = look; else delete s.look;
            return changed({ structure: true });
        }
        if (t.dataset.f === "layout") {
            s.layout = t.value;
            for (const [k, v] of Object.entries(BLANKS[s.layout] || {})) if (s[k] == null || (Array.isArray(v) && !s[k]?.length)) s[k] = structuredClone(v);
            changed({ structure: true });
            // cảnh chuyển thành hình ảnh sẽ được vẽ từ chính nội dung nó đang có
            if (s.layout === "image" && !s.image_url && hasAI()) await draw(s);
            return;
        }
        if (t.dataset.act === "upload" && t.files[0]) {
            try { s.image_url = (await uploadFile(t.files[0])).url; changed({ structure: true }); } catch (err) { toast(err.message, "error"); }
        }
        if (t.dataset.act === "upload-video" && t.files[0]) {
            if (t.files[0].size > 100_000_000) return toast("Video quá lớn (tối đa 100 MB). Hãy nén video hoặc dùng link YouTube.", "error");
            const done = busy(["📤 Đang tải video lên…", "🖼️ Đang lấy ảnh bìa…"]);
            try {
                const r = await uploadFile(t.files[0]);
                s.video_url = r.url;
                if (r.poster) s.image_url = r.poster; else delete s.image_url;
                changed({ structure: true });
            } catch (err) { toast(err.message, "error"); } finally { done(); }
        }
    });
    form.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-act]");
        if (!b || b.tagName === "INPUT") return;
        const s = scene(), key = b.dataset.list;
        const cols = (s.table_headers || []).length;
        if (b.dataset.act === "idea") { s.custom_prompt = b.textContent; return changed({ structure: true }); }
        if (b.dataset.act === "add-trow") { (s.table_rows ||= []).push(Array(cols).fill("")); return changed({ structure: true }); }
        if (b.dataset.act === "del-trow") { s.table_rows?.pop(); return changed({ structure: true }); }
        if (b.dataset.act === "add-tcol" && cols < 5) { (s.table_headers ||= []).push(""); (s.table_rows || []).forEach((r) => r.push("")); return changed({ structure: true }); }
        if (b.dataset.act === "del-tcol" && cols > 1) { s.table_headers.pop(); (s.table_rows || []).forEach((r) => r.splice(cols - 1)); return changed({ structure: true }); }
        if (b.dataset.act === "add-row") {
            s[key] ||= [];
            s[key].push(key === "items" ? { text: "" } : key === "bars" ? { label: "", value: 0 } : "");
            return changed({ structure: true });
        }
        if (b.dataset.act === "del-row") {
            s[key].splice(+b.dataset.j, 1);
            if (key === "options" && s.answer_index >= s.options.length) s.answer_index = 0;
            return changed({ structure: true });
        }
        if (b.dataset.act === "rm-img") { delete s.image_url; return changed({ structure: true }); }
        if (b.dataset.act === "rm-video") { delete s.video_url; delete s.image_url; return changed({ structure: true }); }
        if (b.dataset.act === "yt") {
            const url = $("#yt-url", form).value.trim();
            if (!url) return toast("Hãy dán link YouTube.", "error");
            const done = busy(["▶️ Đang lấy video YouTube…"]);
            try {
                const r = await api("/api/youtube", { body: { url } });
                s.video_url = r.video_url;
                if (r.image_url) s.image_url = r.image_url; else delete s.image_url;
                changed({ structure: true });
            } catch (err) { toast(err.message, "error"); } finally { done(); }
            return;
        }
        if (b.dataset.act === "animate") {
            if (!hasAI()) return openSettings();
            return build(s, ed.sel);
        }
        if (b.dataset.act === "draw") {
            if (!hasAI()) return openSettings();
            await draw(s);
        }
    });

    /** Nội dung cần vẽ cho cảnh s: mô tả hình nếu có, không thì chữ của chính cảnh. */
    const drawPrompt = (s) => (s.image_prompt || [s.title, s.caption !== BLANKS.image.caption && s.caption, ...(s.items || []).map((it) => it.text)].filter(Boolean).join(". ")).trim();
    async function draw(s) {
        const prompt = drawPrompt(s);
        if (!prompt) return toast("Hãy mô tả hình cần vẽ.", "error");
        const done = busy(["🎨 AI đang vẽ hình…", "🖌️ Đang tô màu…", "✅ Sắp xong…"]);
        try {
            s.image_url = (await api("/api/ai/image", { body: { prompt } })).url;
            s.image_prompt = prompt;
            changed({ structure: true });
        } catch (err) { toast(err.message, "error"); } finally { done(); }
    }

    /** AI viết mã cho cảnh hoạt hình hoặc mô phỏng (hoàn tác được, trừ khi là bước cuối của một lần AI sửa). */
    async function build(s, i, undoable = true) {
        const sim = s.layout === "sim";
        if (!(s.custom_prompt || "").trim()) return toast(sim ? "Hãy mô tả thí nghiệm mô phỏng bạn muốn." : "Hãy mô tả hoạt hình bạn muốn.", "error");
        try {
            const next = await runTask("/api/ai/animate", { project: p, index: i, request: s.custom_prompt }, sim ? "🧪 AI đang dựng thí nghiệm mô phỏng" : "🎬 AI đang dựng hoạt hình");
            if (undoable) ed.undo.set(s.id, structuredClone(s));
            p.scenes[i] = next;
            changed({ structure: true });
            toast(sim ? "Đã dựng xong mô phỏng. Bấm “Trình chiếu thử” để chạy và kéo thanh trượt." : "Đã dựng xong hoạt hình. Bấm ▶ để xem.", "ok");
        } catch (err) { toast(err.message, "error"); }
    }

    async function aiFix(instruction) {
        if (!hasAI()) return openSettings();
        const s = scene();
        if (!s) return;
        const i = ed.sel;
        const done = busy(["🤖 AI đang sửa cảnh…", "✍️ Đang viết lại…", "🎨 Nếu cần vẽ lại hình thì mất thêm chút thời gian…"]);
        let next = null;
        try {
            const r = await api("/api/ai/rewrite", { body: { project: p, index: i, instruction } });
            next = r.scene;
            ed.undo.set(s.id, structuredClone(s));
            p.scenes[i] = next;
            changed({ structure: true });
            toast(`${r.note ? `${r.note} ` : "Đã sửa xong. "}Chưa ưng thì bấm “↶ Hoàn tác”.`, "ok");
        } catch (err) { toast(err.message, "error"); } finally { done(); }
        // hoạt hình hoặc mô phỏng có mô tả đã đổi thì chưa có mã: dựng ngay
        if (next && (next.layout === "custom" || next.layout === "sim") && !next.code) await build(next, i, false);
    }
    $("#fixes", root).onclick = (e) => { const c = e.target.closest(".chip"); if (c) aiFix(c.textContent); };
    $("#fix-go", root).onclick = () => { const v = $("#fix-text", root).value.trim(); if (v) aiFix(v); };
    $("#fix-text", root).onkeydown = (e) => { if (e.key === "Enter") $("#fix-go", root).click(); };
    $("#undo", root).onclick = () => {
        const s = scene(), prev = ed.undo.get(s.id);
        if (!prev) return;
        p.scenes[ed.sel] = prev;
        ed.undo.delete(s.id);
        changed({ structure: true });
    };

    $("#add-blank", root).onclick = () => {
        const m = modal(`<h2>Chọn bố cục cho cảnh mới</h2><div class="layout-grid">${Object.entries(LAYOUTS).map(([k, v]) => `<button data-k="${k}"><span>${v.icon}</span>${v.name}</button>`).join("")}</div>`, { wide: true });
        m.el.querySelector(".layout-grid").onclick = (e) => {
            const b = e.target.closest("button"); if (!b) return;
            const sc = { id: crypto.randomUUID().slice(0, 8), layout: b.dataset.k, ...structuredClone(BLANKS[b.dataset.k]) };
            p.scenes.splice(ed.sel + 1, 0, sc);
            ed.sel = Math.min(ed.sel + 1, p.scenes.length - 1);
            m.close();
            changed({ structure: true });
        };
    };

    $("#add-ai", root).onclick = () => {
        const examples = ["Thêm 2 câu hỏi trắc nghiệm ôn tập", "Thêm một cảnh ví dụ thực tế", "Thêm cảnh so sánh hai khái niệm dễ nhầm"];
        const m = modal(`<h2>✨ Thêm cảnh bằng AI</h2>
      <label class="field"><span>Bạn muốn thêm gì?</span><textarea id="add-text" rows="3" placeholder="${esc(examples[0])}"></textarea></label>
      <div class="chips">${examples.map((x) => `<button class="chip">${esc(x)}</button>`).join("")}</div>
      <p class="muted small">Cảnh mới sẽ được chèn sau cảnh ${ed.sel + 1}.</p>
      <div class="row end"><button class="btn primary" id="add-go">Thêm</button></div>`);
        m.el.querySelector(".chips").onclick = (e) => { const c = e.target.closest(".chip"); if (c) $("#add-text", m.el).value = c.textContent; };
        $("#add-go", m.el).onclick = async () => {
            const ins = $("#add-text", m.el).value.trim();
            if (!ins) return;
            if (!hasAI()) return openSettings();
            m.close();
            try {
                const r = await runTask("/api/ai/add", { project: p, instruction: ins }, "✨ AI đang viết cảnh mới");
                p.scenes.splice(ed.sel + 1, 0, ...r.scenes);
                ed.sel += 1;
                changed({ structure: true });
                toast(`Đã thêm ${r.scenes.length} cảnh.`, "ok");
                warnUnfinished(r);
            } catch (err) { toast(err.message, "error"); }
        };
    };

    renderAll();
    return () => { ed.preview?.destroy(); ed.preview = null; };
}

// =====================================================================
// 3. Thiết kế & luyện tập
// =====================================================================
function designTab(root, ed, save) {
    const p = ed.project;
    root.innerHTML = `
  <div class="design-grid">
    <section>
      <div class="pv big" id="pv"></div>
      <div class="scene-chips" id="chips"></div>
      <div class="row gap wrap">
        <button class="btn primary" id="present">${ICONS.present} Trình chiếu thử</button>
        <span class="muted small">Khi trình chiếu: bấm → hoặc Space để hiện ý tiếp theo, N để xem ghi chú, F toàn màn hình.</span>
      </div>
    </section>
    <aside class="col gap">
      <div class="card">
        <h3><span class="ic-chip tint-violet">${ICONS.palette}</span>Giao diện</h3>
        <div class="themes" id="themes">${THEMES.map((t) => `<button data-k="${t.key}" class="theme-b mh-theme-${t.key} ${p.theme === t.key ? "on" : ""}"><span class="sw"><i style="background:var(--accent)"></i><i style="background:var(--accent2)"></i></span><b>${t.name}</b><small>${t.desc}</small></button>`).join("")}</div>
        <label class="field"><span>Môn · Lớp</span><div class="row gap-s"><input id="subject" value="${esc(p.subject || "")}"><input id="grade" value="${esc(p.grade || "")}" class="w-s"></div></label>
      </div>
      <div class="card">
        <h3><span class="ic-chip tint-orange">${ICONS.book}</span>Nguồn tham khảo <span class="muted small">(hiện ở cảnh kết)</span></h3>
        <div id="sources"></div>
        <button class="btn tiny" id="src-add">＋ Thêm nguồn</button>
      </div>
      <div class="card">
        <h3><span class="ic-chip tint-blue">${ICONS.search}</span>AI soát & làm đẹp</h3>
        <p class="muted small">AI chụp từng cảnh như người xem thấy, tìm chữ tràn, quá nhiều chữ, bố cục chưa hợp, sai chính tả… rồi tự sửa và chụp lại để kiểm tra.</p>
        <button class="btn ai" id="review-go">Soát toàn bộ</button>
        <div id="review-out"></div>
      </div>
      <div class="card coach" id="coach">
        <h3><span class="ic-chip tint-green">${ICONS.coach}</span>Trợ lý thuyết trình</h3>
        <p class="muted small">AI chấm kịch bản theo 6 tiêu chí và gợi ý câu hỏi kiểm tra hiểu bài cho học sinh.</p>
        <button class="btn ai" id="coach-go">Nhờ nhận xét kịch bản</button>
        <div id="coach-out"></div>
      </div>
    </aside>
  </div>
  <div class="row between"><a class="btn" href="#/p/${p.id}/script">${ICONS.arrowL} Kịch bản</a><a class="btn primary" href="#/p/${p.id}/export">Tiếp: Xuất bản ${ICONS.arrowR}</a></div>`;

    const remount = () => {
        ed.preview?.destroy();
        const pv = (ed.preview = mountPreview($("#pv", root), p));
        pv.ready().then(() => pv.seekScene(0));
    };
    remount();
    $("#chips", root).innerHTML = p.scenes.map((s, i) => `<button class="chip" data-i="${i}">${LAYOUTS[s.layout]?.icon || ""} ${i + 1}. ${esc(s.title.slice(0, 28))}</button>`).join("");
    $("#chips", root).onclick = (e) => { const c = e.target.closest(".chip"); if (c) ed.preview.seekScene(+c.dataset.i); };

    $("#themes", root).onclick = (e) => {
        const b = e.target.closest(".theme-b"); if (!b) return;
        p.theme = b.dataset.k;
        $$(".theme-b", root).forEach((x) => x.classList.toggle("on", x === b));
        save(); remount();
    };
    const meta = debounce(() => ed.preview.update(p), 300);
    for (const f of ["subject", "grade"]) $(`#${f}`, root).oninput = (e) => { p[f] = e.target.value; save(); meta(); };

    const renderSources = () => {
        $("#sources", root).innerHTML = (p.sources || []).map((s, j) => `
      <div class="row-edit two"><input data-j="${j}" data-k="title" value="${esc(s.title)}" placeholder="Tên nguồn"><input data-j="${j}" data-k="url" value="${esc(s.url)}" placeholder="Đường link (nếu có)">
      ${s.url ? `<a class="icon-btn" href="${esc(s.url)}" target="_blank" title="Mở nguồn">↗</a>` : ""}<button class="icon-btn" data-del="${j}">✕</button></div>`).join("") || `<p class="muted small">Chưa có nguồn nào. Hãy ghi rõ nguồn để bài đáng tin cậy hơn.</p>`;
    };
    renderSources();
    $("#sources", root).oninput = (e) => { const t = e.target; if (t.dataset.k) { p.sources[+t.dataset.j][t.dataset.k] = t.value; save(); meta(); } };
    $("#sources", root).onclick = (e) => { const d = e.target.closest("[data-del]"); if (d) { p.sources.splice(+d.dataset.del, 1); renderSources(); save(); meta(); } };
    $("#src-add", root).onclick = () => { (p.sources ||= []).push({ title: "", url: "" }); renderSources(); };

    const cacheKey = `mh.coach.${p.id}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) renderCoach(JSON.parse(cached));
    $("#coach-go", root).onclick = async () => {
        if (!hasAI()) return openSettings();
        const done = busy(["🧑‍🏫 Trợ lý đang đọc kịch bản…", "📏 Đang chấm theo tiêu chí…", "❓ Đang chuẩn bị câu hỏi kiểm tra hiểu bài…"]);
        try {
            const r = await api("/api/ai/coach", { body: { project: p } });
            sessionStorage.setItem(cacheKey, JSON.stringify(r));
            renderCoach(r);
        } catch (err) { toast(err.message, "error"); } finally { done(); }
    };
    function renderCoach(r) {
        const hints = countHints(p.scenes);
        const score = Number(r.overall) || 0;
        const color = score >= 8 ? "var(--ok)" : score >= 6.5 ? "var(--warn)" : "var(--bad)";
        $("#coach-out", root).innerHTML = `
      <div class="score-row"><div class="score" style="--c:${color};--p:${score * 10}"><span>${score.toFixed(1)}</span><small>/10</small></div><p>${esc(r.summary)}</p></div>
      ${hints ? `<div class="warn-box">💡 Còn <b>${hints}</b> chỗ gợi ý chưa điền.</div>` : ""}
      <div class="crit">${(r.criteria || []).map((c) => `<div class="crit-i"><div class="crit-h"><span>${esc(c.name)}</span><b>${c.score}</b></div><div class="crit-bar"><i style="width:${Math.max(0, Math.min(10, c.score)) * 10}%"></i></div><div class="small muted">${esc(c.comment)}</div></div>`).join("")}</div>
      ${r.strengths?.length ? `<h4>👍 Điểm mạnh</h4><ul>${r.strengths.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${r.fixes?.length ? `<h4>🛠️ Nên sửa</h4><ul class="fixes">${r.fixes.map((f) => `<li><a href="#/p/${p.id}/script" data-go="${f.scene - 1}">Cảnh ${f.scene}</a>: ${esc(f.issue)}<div class="small muted">→ ${esc(f.suggestion)}</div></li>`).join("")}</ul>` : ""}
      ${r.questions?.length ? `<h4>❓ Câu hỏi kiểm tra hiểu bài</h4>${r.questions.map((q, i) => `<details class="q"><summary>${i + 1}. ${esc(q.q)}</summary><div class="small">Đáp án: ${esc(q.hint)}</div></details>`).join("")}` : ""}`;
        $$("[data-go]", root).forEach((a) => (a.onclick = () => sessionStorage.setItem(`mh.sel.${p.id}`, a.dataset.go)));
    }

    $("#review-go", root).onclick = async () => {
        if (!hasAI()) return openSettings();
        try {
            const r = await runTask("/api/ai/review", { project: p }, "🔍 AI đang soát từng cảnh");
            p.scenes = r.project.scenes;
            save(); remount();
            $("#review-out", root).innerHTML = r.changes.length
                ? `<ul class="review-list">${r.changes.map((c) => `<li><b>Cảnh ${c.scene}:</b> ${esc(c.problem)}</li>`).join("")}</ul>`
                : `<p class="small">✅ Không thấy lỗi hiển thị nào.</p>`;
            toast(r.changes.length ? `Đã sửa ${r.changes.length} chỗ.` : "Mọi cảnh đều ổn!", "ok");
            warnUnfinished(r);
        } catch (err) { toast(err.message, "error"); }
    };
    $("#present", root).onclick = () => present(ed);
    return () => { ed.preview?.destroy(); ed.preview = null; ed.deck?.destroy(); };
}

function present(ed, startScene = 0) {
    const box = document.createElement("div");
    document.body.appendChild(box);
    // xin toàn màn hình ngay trong thao tác bấm, trước mọi await
    box.requestFullscreen?.().catch(() => { });
    const close = () => { ed.deck?.destroy(); ed.deck = null; box.remove(); if (document.fullscreenElement) document.exitFullscreen(); };
    mountDeck(box, ed.project, { onExit: close, startScene }).then((d) => { ed.deck = d; });
}

// =====================================================================
// 4. Xuất bản
// =====================================================================
function exportTab(root, ed, saveNow) {
    const p = ed.project;
    const hints = countHints(p.scenes);
    root.innerHTML = `
  ${hints ? `<div class="warn-box">💡 Kịch bản còn <b>${hints}</b> chỗ “[Gợi ý: …]” chưa điền — chúng sẽ hiện trên slide. <a href="#/p/${p.id}/script">Quay lại điền</a></div>` : ""}
  <div class="exports">
    <div class="card ex">
      <span class="ic-chip tint-violet">${ICONS.present}</span><h3>Trình chiếu ngay</h3>
      <p class="muted">Toàn màn hình, bấm để hiện từng ý như PowerPoint. Có ghi chú người nói (phím N).</p>
      <button class="btn primary" id="present">Bắt đầu trình chiếu</button>
    </div>
    <div class="card ex">
      <span class="ic-chip tint-orange">${ICONS.pptx}</span><h3>PowerPoint (.pptx)</h3>
      <p class="muted">Slide sửa được trong PowerPoint / Google Slides: chữ, hình, bảng và biểu đồ gốc; ghi chú người thuyết trình nằm trong Speaker Notes; hoạt hình AI là video.</p>
      <button class="btn" id="pptx">Tải PowerPoint</button>
    </div>
    <div class="card ex">
      <span class="ic-chip tint-pink">${ICONS.pdf}</span><h3>Tải PDF</h3>
      <p class="muted">Mỗi cảnh một trang — để in, nộp bài hoặc gửi qua Zalo.</p>
      <button class="btn" id="pdf">Tải PDF</button>
    </div>
    <div class="card ex">
      <span class="ic-chip tint-green">${ICONS.offline}</span><h3>File trình chiếu offline</h3>
      <p class="muted">Một tệp .html chạy trên mọi máy tính có trình duyệt, <b>không cần mạng</b>. Chép vào USB mang lên lớp.</p>
      <a class="btn" href="/api/projects/${p.id}/export.html">Tải file .html</a>
    </div>
    <div class="card ex">
      <span class="ic-chip tint-blue">${ICONS.backup}</span><h3>Sao lưu / chia sẻ dự án</h3>
      <p class="muted">Tệp .json để bạn cùng nhóm mở tiếp và chỉnh sửa (Trang chủ → Nhập tệp dự án).</p>
      <button class="btn" id="json">Tải tệp dự án</button>
    </div>
  </div>
  <div class="row"><a class="btn" href="#/p/${p.id}/design">${ICONS.arrowL} Thiết kế & luyện tập</a></div>`;

    $("#present", root).onclick = () => present(ed);
    $("#json", root).onclick = () => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([JSON.stringify(p, null, 2)], { type: "application/json" }));
        a.download = `${p.title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").replace(/[^\w]+/g, "-").slice(0, 40) || "du-an"}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    };
    const download = async (ext, label) => {
        const done = busy([label]);
        try {
            await saveNow();
            const res = await fetch(`/api/projects/${p.id}/export.${ext}`);
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Lỗi ${res.status}`);
            const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") || "")?.[1] || `bai.${ext}`;
            const a = document.createElement("a");
            a.href = URL.createObjectURL(await res.blob());
            a.download = name;
            a.click();
            URL.revokeObjectURL(a.href);
        } catch (err) { toast(err.message, "error"); } finally { done(); }
    };
    $("#pdf", root).onclick = () => download("pdf", "📄 Đang tạo PDF…");
    $("#pptx", root).onclick = () => download("pptx", "📊 Đang tạo PowerPoint…");
    return () => { ed.deck?.destroy(); };
}
