
export const THEMES = [
    { key: "notebook", name: "Sổ tay", desc: "Sáng, gọn, kiểu sách giáo khoa" },
    { key: "science", name: "Khoa học", desc: "Bản vẽ kỹ thuật, nền tối" },
    { key: "chalk", name: "Bảng phấn", desc: "Như viết trên bảng lớp" },
    { key: "midnight", name: "Đêm xanh", desc: "Nền tối, làm nổi ý đang đọc" },
];

export const LAYOUTS = {
    title: { name: "Trang bìa", icon: "🎬", fields: ["title", "subtitle", "icon"] },
    bullets: { name: "Danh sách ý", icon: "📝", fields: ["title", "subtitle", "icon", "items"] },
    compare: { name: "So sánh", icon: "⚖️", fields: ["title", "left_heading", "left_items", "right_heading", "right_items"] },
    table: { name: "Bảng", icon: "🧾", fields: ["title", "table_headers", "table_rows"] },
    timeline: { name: "Dòng thời gian", icon: "🕰️", fields: ["title", "items"] },
    steps: { name: "Các bước", icon: "🪜", fields: ["title", "subtitle", "items"] },
    big_number: { name: "Con số ấn tượng", icon: "🔢", fields: ["title", "value", "unit", "label", "illustrative"] },
    chart: { name: "Biểu đồ cột", icon: "📊", fields: ["title", "unit", "bars", "illustrative"] },
    quote: { name: "Trích dẫn / Định nghĩa", icon: "💬", fields: ["title", "quote_text", "quote_author"] },
    formula: { name: "Công thức", icon: "🧮", fields: ["title", "latex", "explain"] },
    quiz: { name: "Câu hỏi trắc nghiệm", icon: "❓", fields: ["title", "question", "options", "answer_index", "explain"] },
    cycle: { name: "Chu trình", icon: "🔄", fields: ["title", "label", "items"] },
    image: { name: "Hình ảnh", icon: "🖼️", fields: ["title", "caption", "image_url", "image_prompt", "items"] },
    ending: { name: "Kết thúc & nguồn", icon: "🙏", fields: ["title", "subtitle"] },
    custom: { name: "Hoạt hình AI tự thiết kế", icon: "✨", fields: ["title", "custom_prompt"] },
    sim: { name: "Thí nghiệm mô phỏng", icon: "🧪", fields: ["title", "custom_prompt"] },
    video: { name: "Video", icon: "🎞️", fields: ["title", "video_url", "caption"] },
};

// ---------- toán ----------
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, p) => a + (b - a) * p;
const easeOut = (p) => 1 - Math.pow(1 - p, 4);
const easeInOut = (p) => (p < 0.5 ? 8 * p ** 4 : 1 - Math.pow(-2 * p + 2, 4) / 2);
// Lò xo tắt dần dạng nghiệm đóng, chuẩn hoá 0 → 1, vọt lố nhẹ.
function spring(t, period = 0.55, zeta = 0.72) {
    if (t <= 0) return 0;
    const w0 = (2 * Math.PI) / period;
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const x = 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
    return t > 3 ? 1 : x;
}
const prog = (lt, at, d) => clamp((lt - at) / d);

// ---------- tiện ích DOM ----------
function h(tag, cls, html) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html != null) el.innerHTML = html;
    return el;
}
function esc(s) {
    return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
// Văn bản đã thoát ký tự, tô đậm **bold** và làm nổi chỗ trống [Gợi ý: …].
export function rich(s) {
    return esc(s)
        .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
        .replace(/\[(Gợi ý[^\]]*)\]/g, '<span class="mh-hint">$1</span>');
}
function words(el, text) {
    el.innerHTML = "";
    const spans = [];
    const tmp = h("span", "", rich(text));
    // Chỉ tách thành từ các nút văn bản cấp trên cùng; giữ nguyên thẻ nội dòng.
    for (const node of [...tmp.childNodes]) {
        if (node.nodeType === 3) {
            for (const part of node.textContent.split(/(\s+)/)) {
                if (!part) continue;
                if (/^\s+$/.test(part)) { el.appendChild(document.createTextNode(" ")); continue; }
                const w = h("span", "mh-w"); const i = h("span", "mh-wi"); i.textContent = part; w.appendChild(i); el.appendChild(w); spans.push(i);
            }
        } else {
            const w = h("span", "mh-w"); const i = h("span", "mh-wi"); i.appendChild(node); w.appendChild(i); el.appendChild(w); spans.push(i);
        }
    }
    return spans;
}
// Hiện dần từng từ. Chuỗi hiệu ứng kéo dài tối đa `span` giây bất kể độ dài
// văn bản, nên văn bản dài đã hiện xong trước điểm dừng kế tiếp.
function animWords(spans, lt, at, stagger = 0.055, span = 0.35) {
    const step = Math.min(stagger, span / Math.max(1, spans.length - 1));
    spans.forEach((s, i) => {
        const p = spring(lt - at - i * step, 0.6, 0.8);
        s.style.transform = `translateY(${(1 - p) * 105}%)`;
        s.style.opacity = clamp(p * 1.6);
    });
}
// Hiệu ứng xuất hiện: độ mờ + trồi lên + nhoè (+ tuỳ chọn co giãn/dịch x), điều khiển bằng lò xo.
function enter(el, lt, at, o = {}) {
    const p = o.ease === "out" ? easeOut(prog(lt, at, o.d ?? 0.7)) : spring(lt - at, o.period ?? 0.6, o.zeta ?? 0.78);
    const y = (1 - p) * (o.y ?? 36), x = (1 - p) * (o.x ?? 0), sc = o.scale != null ? lerp(o.scale, 1, p) : 1;
    el.style.opacity = clamp(p * 1.4);
    el.style.transform = `translate(${x}px, ${y}px) scale(${sc})`;
    const b = (1 - clamp(p * 1.3)) * (o.blur ?? 8);
    el.style.filter = b > 0.05 ? `blur(${b}px)` : "";
    return p;
}
function fmtNumber(v, digits) {
    return Number(v).toLocaleString("vi-VN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function parseNum(v) {
    if (typeof v === "number") return { n: v, digits: Number.isInteger(v) ? 0 : String(v).split(".")[1].length };
    const s = String(v ?? "").trim();
    if (!/^-?[\d.,\s]+$/.test(s)) return null;
    // Kiểu Việt "1.234,5" hoặc kiểu thường "1234.5"
    let norm = s.replace(/\s/g, "");
    if (/,\d+$/.test(norm)) norm = norm.replace(/\./g, "").replace(",", ".");
    else if (/^\d{1,3}(\.\d{3})+$/.test(norm)) norm = norm.replace(/\./g, "");
    const n = Number(norm);
    if (!Number.isFinite(n)) return null;
    return { n, digits: norm.includes(".") ? norm.split(".")[1].length : 0 };
}

// ---------- dòng thời gian ----------
function revealCount(s) {
    switch (s.layout) {
        case "bullets": case "steps": case "timeline": case "cycle": return (s.items || []).length;
        case "image": return 1 + (s.items || []).length;
        case "compare": return (s.left_items || []).length + (s.right_items || []).length;
        case "table": return (s.table_rows || []).length;
        case "chart": return (s.bars || []).length;
        case "quiz": return (s.options || []).length + 1;
        case "formula": return 2;
        case "big_number": case "ending": return 1;
        default: return 0;
    }
}
const HEAD = 1.0; // thời gian xuất hiện của tiêu đề/đầu trang

/** @param project nguồn các cảnh */
export function computeTimeline(project) {
    let t = 0;
    const scenes = project.scenes.map((s) => {
        const n = revealCount(s);
        const step = n > 6 ? 0.7 : 0.95;
        const reveals = Array.from({ length: n }, (_, i) => HEAD + i * step);
        let duration = Math.max(4, (n ? reveals[n - 1] : HEAD) + 2.6);
        // hoạt hình do AI vẽ chạy theo đồng hồ riêng và phát trọn khi trình chiếu
        const playThrough = s.layout === "custom";
        if (playThrough) duration = Math.max(duration, Number(s.seconds) || 8);
        // mô phỏng: bản xem trước tất định với độ dài này; khi trình chiếu thì chạy trực tiếp
        if (s.layout === "sim") duration = Math.max(duration, Number(s.seconds) || 10);
        // tăng dần với khoảng cách tối thiểu; không gì xuất hiện trước khi tiêu đề hiện xong
        for (let i = 0; i < reveals.length; i++) {
            const min = i ? reveals[i - 1] + 0.35 : Math.min(HEAD * 0.8, duration * 0.3);
            reveals[i] = Math.min(Math.max(reveals[i], min), duration - 0.6);
        }
        const out = { start: t, duration, reveals, playThrough };
        t += duration;
        return out;
    });
    return { scenes, total: t };
}

/** Điểm dừng khi trình chiếu trực tiếp: mỗi lần bấm một điểm, tính bằng giây tuyệt đối. */
export function holdPoints(timeline) {
    const holds = [];
    timeline.scenes.forEach((s, i) => {
        if (s.playThrough) { holds.push({ scene: i, t: s.start + s.duration - 0.4 }); return; }
        const local = [s.reveals.length ? Math.max(0.05, s.reveals[0] - 0.05) : Math.min(1.8, s.duration - 0.4)];
        s.reveals.forEach((r) => local.push(Math.min(r + 0.9, s.duration - 0.36)));
        // điểm dừng đầu tiên của cảnh có mục = chỉ tiêu đề
        [...new Set(local)].forEach((lt) => holds.push({ scene: i, t: s.start + lt }));
    });
    return holds;
}

// ---------- bố cục ----------
function header(scene, opts = {}) {
    const el = h("header", "mh-head");
    const icon = scene.icon && !opts.noIcon ? h("div", "mh-icon", esc(scene.icon)) : null;
    if (icon) el.appendChild(icon);
    const title = h("h2", "mh-title");
    const tw = words(title, scene.title || "");
    el.appendChild(title);
    const sub = scene.subtitle && !opts.noSub ? h("p", "mh-subtitle", rich(scene.subtitle)) : null;
    if (sub) el.appendChild(sub);
    return {
        el,
        update(lt) {
            if (icon) enter(icon, lt, 0, { scale: 0.4, y: 0, period: 0.5, zeta: 0.55 });
            animWords(tw, lt, 0.08);
            if (sub) enter(sub, lt, 0.45, { y: 20 });
        },
    };
}

function itemRow(it, i, cls = "mh-item") {
    const el = h("div", cls);
    el.innerHTML = `<div class="mh-mark" data-n="${String(i + 1).padStart(2, "0")}">${i + 1}</div><div class="mh-itext"><div class="mh-t">${rich(it.text)}</div>${it.detail ? `<div class="mh-d">${rich(it.detail)}</div>` : ""}</div>`;
    return el;
}

/** els[i] là phần tử (hoặc mảng phần tử, vd. một hàng bảng) hiện ra tại reveals[i]. */
function focusDim(els, lt, reveals, mode) {
    // mục mới nhất được làm nổi khi vừa hiện; khi dừng hẳn thì mọi mục trở lại bình thường
    const last = reveals[reveals.length - 1] ?? 0;
    const settled = lt > last + 1.6 || mode === "rest";
    let active = -1;
    reveals.forEach((r, i) => { if (lt >= r) active = i; });
    els.forEach((group, i) => {
        const dim = !settled && active >= 0 && i < active;
        for (const el of Array.isArray(group) ? group : [group]) {
            el.classList.toggle("mh-dim", dim);
            el.classList.toggle("mh-active", !settled && i === active && els.length > 1);
        }
    });
}

const L = {};

L.title = (s, ctx) => {
    const el = h("div", "mh-body mh-cover");
    const icon = s.icon ? h("div", "mh-cover-icon", esc(s.icon)) : null;
    if (icon) el.appendChild(icon);
    const t = h("h1", "mh-cover-title"); const tw = words(t, s.title || ""); el.appendChild(t);
    const bar = h("div", "mh-cover-bar"); el.appendChild(bar);
    const sub = s.subtitle ? h("p", "mh-cover-sub", rich(s.subtitle)) : null;
    if (sub) el.appendChild(sub);
    const metaTxt = [ctx.project.subject, ctx.project.grade ? `Lớp ${ctx.project.grade}` : ""].filter(Boolean).join(" · ");
    const meta = metaTxt ? h("div", "mh-cover-meta", esc(metaTxt)) : null;
    if (meta) el.appendChild(meta);
    return {
        el, noHeader: true,
        update(lt) {
            if (icon) enter(icon, lt, 0, { scale: 0.3, y: 0, period: 0.6, zeta: 0.5 });
            animWords(tw, lt, 0.15, 0.07, 0.8);
            const p = easeInOut(prog(lt, 0.5, 0.8));
            bar.style.transform = `scaleX(${p})`;
            if (sub) enter(sub, lt, 0.75, { y: 24 });
            if (meta) enter(meta, lt, 1.0, { y: 16, blur: 0 });
        },
    };
};

L.bullets = (s) => {
    const items = s.items || [];
    const cols = s.look?.columns ?? (items.length > 5 ? 2 : 1);
    const el = h("div", `mh-body mh-list ${cols === 2 ? "mh-two" : ""}`);
    const rows = items.map((it, i) => el.appendChild(itemRow(it, i)));
    return {
        el,
        update(lt, st) {
            rows.forEach((r, i) => enter(r, lt, st.reveals[i] ?? 0, { y: 0, x: -60 }));
            focusDim(rows, lt, st.reveals, st.mode);
        },
    };
};

L.steps = (s) => {
    const items = s.items || [];
    const el = h("div", `mh-body mh-steps ${items.length > 4 ? "mh-many" : ""}`);
    const cards = [], arrows = [];
    items.forEach((it, i) => {
        if (i) arrows.push(el.appendChild(h("div", "mh-arrow", "→")));
        const c = h("div", "mh-step");
        c.innerHTML = `<div class="mh-step-n">${i + 1}</div><div class="mh-t">${rich(it.text)}</div>${it.detail ? `<div class="mh-d">${rich(it.detail)}</div>` : ""}`;
        cards.push(el.appendChild(c));
    });
    return {
        el,
        update(lt, st) {
            cards.forEach((c, i) => enter(c, lt, st.reveals[i] ?? 0, { scale: 0.85, y: 30, zeta: 0.65 }));
            arrows.forEach((a, i) => {
                const p = easeOut(prog(lt, (st.reveals[i + 1] ?? 0) - 0.3, 0.35));
                a.style.opacity = p; a.style.transform = `translateX(${(1 - p) * -20}px)`;
            });
            focusDim(cards, lt, st.reveals, st.mode);
        },
    };
};

L.timeline = (s) => {
    const items = s.items || [];
    const el = h("div", "mh-body mh-tl");
    const track = el.appendChild(h("div", "mh-tl-track"));
    const fill = track.appendChild(h("div", "mh-tl-fill"));
    const n = items.length;
    const nodes = items.map((it, i) => {
        const pos = n === 1 ? 50 : 10 + (80 * i) / (n - 1);
        const node = h("div", `mh-tl-node ${i % 2 ? "mh-below" : "mh-above"}`);
        node.style.setProperty("--pos", pos + "%");
        node.innerHTML = `<div class="mh-tl-dot"></div><div class="mh-tl-card"><div class="mh-tl-when">${rich(it.text)}</div>${it.detail ? `<div class="mh-d">${rich(it.detail)}</div>` : ""}</div>`;
        el.appendChild(node);
        return { node, pos, dot: node.firstChild, card: node.lastChild };
    });
    return {
        el,
        update(lt, st) {
            // đường nối chạm tới mỗi nút đúng lúc nút đó hiện ra
            let reach = 0;
            nodes.forEach((nd, i) => {
                const r = st.reveals[i] ?? 0;
                const prev = i ? st.reveals[i - 1] : r - 0.5;
                const p = easeInOut(prog(lt, prev, Math.max(0.2, r - prev)));
                const from = i ? nodes[i - 1].pos : 0;
                if (lt >= prev) reach = lerp(from, nd.pos, p);
                enter(nd.dot, lt, r, { scale: 0, y: 0, blur: 0, period: 0.45, zeta: 0.5 });
                enter(nd.card, lt, r + 0.05, { y: i % 2 ? -24 : 24 });
            });
            const last = st.reveals[n - 1] ?? 0;
            if (lt > last) reach = lerp(nodes[n - 1]?.pos ?? 0, 100, easeOut(prog(lt, last + 0.3, 0.8)));
            fill.style.transform = `scaleX(${reach / 100})`;
            focusDim(nodes.map((x) => x.card), lt, st.reveals, st.mode);
        },
    };
};

L.compare = (s) => {
    const el = h("div", "mh-body mh-cmp");
    const col = (head, items, cls) => {
        const c = h("div", `mh-cmp-col ${cls}`);
        const hd = c.appendChild(h("div", "mh-cmp-h", rich(head || "")));
        const rows = (items || []).map((t) => c.appendChild(h("div", "mh-cmp-i", rich(typeof t === "string" ? t : t.text))));
        return { c, hd, rows };
    };
    const A = col(s.left_heading, s.left_items, "mh-a");
    const vs = h("div", "mh-vs", "VS");
    const B = col(s.right_heading, s.right_items, "mh-b");
    el.append(A.c, vs, B.c);
    return {
        el,
        update(lt, st) {
            enter(A.c, lt, 0.35, { x: -80, y: 0 });
            enter(B.c, lt, 0.5, { x: 80, y: 0 });
            enter(vs, lt, 0.35, { scale: 0.2, y: 0, zeta: 0.65, blur: 0 });
            const rows = [...A.rows, ...B.rows];
            rows.forEach((r, i) => enter(r, lt, st.reveals[i] ?? 0, { y: 24 }));
            focusDim(rows, lt, st.reveals, st.mode);
        },
    };
};

L.table = (s) => {
    const heads = s.table_headers || [];
    const rows = s.table_rows || [];
    const cols = Math.max(1, heads.length, ...rows.map((r) => r.length));
    const el = h("div", "mh-body mh-table");
    const grid = el.appendChild(h("div", "mh-tgrid"));
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    const head = heads.length ? heads.map((x) => grid.appendChild(h("div", "mh-th", rich(x)))) : [];
    const lines = rows.map((r) => Array.from({ length: cols }, (_, c) => grid.appendChild(h("div", `mh-td ${c === 0 ? "mh-td0" : ""}`, rich(r[c] ?? "")))));
    return {
        el,
        update(lt, st) {
            head.forEach((x, i) => enter(x, lt, 0.35 + i * 0.06, { y: -16 }));
            lines.forEach((cells, i) => cells.forEach((x, c) => enter(x, lt, (st.reveals[i] ?? 0) + c * 0.07, { y: 20 })));
            focusDim(lines, lt, st.reveals, st.mode);
        },
    };
};

L.big_number = (s) => {
    const el = h("div", "mh-body mh-big");
    const num = el.appendChild(h("div", "mh-big-n"));
    const val = num.appendChild(h("span", "mh-big-v"));
    if (s.unit) num.appendChild(h("span", "mh-big-u", esc(s.unit)));
    const lab = s.label ? el.appendChild(h("div", "mh-big-l", rich(s.label))) : null;
    const parsed = parseNum(s.value);
    // chữ hoặc chỗ trống thay cho con số: tĩnh, nhỏ hơn, kiểu gợi ý
    if (!parsed) { val.innerHTML = rich(s.value ?? ""); if (String(s.value ?? "").length > 6) val.classList.add("mh-big-text"); }
    return {
        el,
        update(lt, st) {
            const r = st.reveals[0] ?? HEAD;
            enter(num, lt, r, { scale: 0.7, y: 0, zeta: 0.6 });
            if (parsed) {
                const p = easeOut(prog(lt, r, 1.4));
                val.textContent = fmtNumber(parsed.n * p, parsed.digits);
            }
            if (lab) enter(lab, lt, r + 0.5, { y: 24 });
        },
    };
};

L.chart = (s) => {
    const bars = s.bars || [];
    const el = h("div", "mh-body mh-chart");
    if (s.unit) el.appendChild(h("div", "mh-chart-unit", esc(s.unit)));
    const plot = el.appendChild(h("div", "mh-chart-plot"));
    if (!bars.length) plot.appendChild(h("div", "mh-chart-empty", rich("[Gợi ý: nhập các cột số liệu đo được]")));
    const max = Math.max(1e-9, ...bars.map((b) => Math.abs(parseNum(b.value)?.n ?? 0)));
    const cols = bars.map((b) => {
        const c = plot.appendChild(h("div", "mh-bar"));
        const v = c.appendChild(h("div", "mh-bar-v"));
        const wrap = c.appendChild(h("div", "mh-bar-wrap"));
        const fill = wrap.appendChild(h("div", "mh-bar-fill"));
        c.appendChild(h("div", "mh-bar-l", rich(b.label)));
        const pn = parseNum(b.value) || { n: 0, digits: 0 };
        return { c, v, fill, pn, frac: Math.abs(pn.n) / max };
    });
    return {
        el,
        update(lt, st) {
            cols.forEach((b, i) => {
                const r = st.reveals[i] ?? 0;
                const p = spring(lt - r, 0.8, 0.8);
                b.fill.style.transform = `scaleY(${Math.max(0, p * b.frac)})`;
                b.v.textContent = fmtNumber(b.pn.n * clamp(p), b.pn.digits);
                b.v.style.opacity = clamp((lt - r) * 3);
                b.c.style.opacity = lt >= r - 0.2 ? 1 : 0.15;
            });
        },
    };
};

L.quote = (s) => {
    const el = h("div", "mh-body mh-quote");
    const mark = el.appendChild(h("div", "mh-qmark", "“"));
    const q = el.appendChild(h("blockquote", "mh-qtext"));
    const qw = words(q, s.quote_text || "");
    const au = s.quote_author ? el.appendChild(h("div", "mh-qau", "— " + rich(s.quote_author))) : null;
    return {
        el,
        update(lt) {
            // không hiện theo từng lần bấm: cả trích dẫn hiện ngay khi vào cảnh, dù dài đến đâu
            enter(mark, lt, 0.2, { scale: 0.3, y: 0, zeta: 0.5, blur: 0 });
            animWords(qw, lt, 0.45);
            if (au) enter(au, lt, 0.75, { x: 40, y: 0 });
        },
    };
};

L.formula = (s) => {
    const el = h("div", "mh-body mh-formula");
    const card = el.appendChild(h("div", "mh-fcard"));
    const f = card.appendChild(h("div", "mh-f"));
    if (window.katex && s.latex) {
        try { window.katex.render(s.latex, f, { displayMode: true, throwOnError: false, strict: false }); } catch { f.textContent = s.latex; }
    } else f.textContent = s.latex || "";
    const ex = s.explain ? el.appendChild(h("div", "mh-fex", rich(s.explain))) : null;
    return {
        el,
        update(lt, st) {
            const r = st.reveals[0] ?? HEAD;
            enter(card, lt, r, { scale: 0.92, y: 20 });
            const p = easeInOut(prog(lt, r, 0.8));
            f.style.clipPath = `inset(-20% ${(1 - p) * 100}% -20% 0)`;
            if (ex) enter(ex, lt, st.reveals[1] ?? r + 1.2, { y: 24 });
        },
    };
};

L.quiz = (s) => {
    const el = h("div", "mh-body mh-quiz");
    const q = s.question ? el.appendChild(h("div", "mh-quiz-q", rich(s.question))) : null;
    const grid = el.appendChild(h("div", "mh-quiz-grid"));
    const opts = (s.options || []).map((o, i) => {
        const c = grid.appendChild(h("div", "mh-opt"));
        c.innerHTML = `<span class="mh-opt-k">${"ABCDEF"[i]}</span><span class="mh-opt-t">${rich(o)}</span><span class="mh-opt-ok">✓</span>`;
        return c;
    });
    const ex = s.explain ? el.appendChild(h("div", "mh-quiz-ex", rich(s.explain))) : null;
    const ans = Number(s.answer_index ?? -1);
    return {
        el,
        update(lt, st) {
            if (q) enter(q, lt, 0.4, { y: 20 });
            opts.forEach((o, i) => enter(o, lt, st.reveals[i] ?? 0, { scale: 0.9, y: 20 }));
            const ra = st.reveals[opts.length] ?? 99;
            const p = clamp((lt - ra) / 0.4);
            opts.forEach((o, i) => {
                o.classList.toggle("mh-right", p > 0 && i === ans);
                o.classList.toggle("mh-wrong", p > 0 && i !== ans);
                if (p > 0 && i === ans) o.style.transform = `scale(${1 + 0.06 * Math.sin(Math.PI * p)})`;
            });
            if (ex) enter(ex, lt, ra + 0.3, { y: 24 });
        },
    };
};

L.cycle = (s) => {
    const items = s.items || [];
    const n = items.length;
    const el = h("div", "mh-body mh-cycle");
    const W = 1500, H = 720;
    const nodeW = 360;
    const box = el.appendChild(h("div", "mh-cycle-box"));
    box.style.width = W + "px"; box.style.height = H + "px";
    box.style.setProperty("--node-w", nodeW + "px");
    box.style.setProperty("--label-w", Math.min(420, W - 2 * nodeW - 40) + "px");
    const rx = W / 2 - nodeW / 2 - 10, ry = H * 0.38, cx = W / 2, cy = H / 2;
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.classList.add("mh-cycle-svg");
    svg.innerHTML = `<defs><marker id="mh-ah-${s.id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>`;
    box.appendChild(svg);
    const ang = (i) => -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, n);
    const pt = (a) => [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
    const arcs = items.map((_, i) => {
        const a0 = ang(i) + 0.32, a1 = ang(i + 1) - 0.32;
        const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
        const p = document.createElementNS(ns, "path");
        p.setAttribute("d", `M${x0},${y0} A${rx},${ry} 0 0 1 ${x1},${y1}`);
        p.setAttribute("class", "mh-arc"); p.setAttribute("marker-end", `url(#mh-ah-${s.id})`);
        svg.appendChild(p);
        return p;
    });
    const center = s.label ? box.appendChild(h("div", "mh-cycle-c", rich(s.label))) : null;
    const nodes = items.map((it, i) => {
        const [x, y] = pt(ang(i));
        const nd = box.appendChild(h("div", "mh-cnode"));
        nd.style.left = (x / W) * 100 + "%"; nd.style.top = (y / H) * 100 + "%";
        nd.innerHTML = `<div class="mh-t">${rich(it.text)}</div>${it.detail ? `<div class="mh-d">${rich(it.detail)}</div>` : ""}`;
        return nd;
    });
    let lens = null;
    return {
        el,
        update(lt, st) {
            if (!lens) lens = arcs.map((a) => { try { return a.getTotalLength() || 600; } catch { return 600; } });
            if (center) {
                const p = spring(lt - 0.5, 0.6, 0.7);
                center.style.opacity = clamp(p * 1.4);
                center.style.transform = `translate(-50%,-50%) scale(${lerp(0.6, 1, p)})`;
            }
            nodes.forEach((nd, i) => {
                const r = st.reveals[i] ?? 0;
                const p = spring(lt - r, 0.5, 0.6);
                nd.style.opacity = clamp(p * 1.5);
                nd.style.transform = `translate(-50%,-50%) scale(${lerp(0.5, 1, p)})`;
            });
            arcs.forEach((a, i) => {
                const from = (st.reveals[i] ?? 0) + 0.25;
                const to = i + 1 < n ? (st.reveals[i + 1] ?? from + 0.6) - 0.05 : from + 0.8;
                const p = easeInOut(prog(lt, from, Math.max(0.25, to - from)));
                a.style.strokeDasharray = lens[i];
                a.style.strokeDashoffset = lens[i] * (1 - p);
                a.style.opacity = p > 0 ? 1 : 0;
            });
            focusDim(nodes, lt, st.reveals, st.mode);
        },
    };
};

L.image = (s) => {
    const look = s.look || {};
    const size = look.image_size || "medium";
    // hình vẽ hiển thị trọn vẹn; ảnh chụp lấp đầy khung trừ khi được chỉ định khác
    const fit = look.image_fit || (/\.svg$/i.test(s.image_url || "") ? "contain" : "cover");
    const el = h("div", `mh-body mh-img mh-img-${size} ${look.image_side === "right" ? "mh-img-right" : ""} ${size === "full" ? "mh-vert" : ""}`);
    const frame = el.appendChild(h("div", `mh-img-frame mh-fit-${fit}`));
    let img = null;
    if (s.image_url) {
        img = frame.appendChild(h("img"));
        img.src = s.image_url; img.alt = s.caption || s.title || "";
    } else frame.appendChild(h("div", "mh-img-empty", `<div>${esc(s.icon || "🖼️")}</div><div>Chưa có hình ảnh</div>`));
    const side = el.appendChild(h("div", "mh-img-side"));
    const cap = s.caption ? side.appendChild(h("div", "mh-img-cap", rich(s.caption))) : null;
    const rows = (s.items || []).map((it, i) => side.appendChild(itemRow(it, i, "mh-item mh-small")));
    return {
        el,
        ready: img ? img.decode().catch(() => { }) : null,
        update(lt, st) {
            enter(frame, lt, 0.3, { scale: 0.94, y: 0 });
            // chỉ phóng to chậm khi khung có thể cắt ảnh
            if (img && fit === "cover") img.style.transform = `scale(${1.04 + 0.08 * clamp(lt / Math.max(1, st.duration))})`;
            if (cap) enter(cap, lt, st.reveals[0] ?? 1, { y: 24 });
            rows.forEach((r, i) => enter(r, lt, st.reveals[i + 1] ?? 0, { x: 40, y: 0 }));
        },
    };
};

L.ending = (s, ctx) => {
    const el = h("div", "mh-body mh-end");
    const t = el.appendChild(h("h1", "mh-cover-title")); const tw = words(t, s.title || "Cảm ơn đã lắng nghe!");
    const sub = s.subtitle ? el.appendChild(h("p", "mh-cover-sub", rich(s.subtitle))) : null;
    const src = (ctx.project.sources || []).slice(0, 6);
    const box = src.length ? el.appendChild(h("div", "mh-src")) : null;
    if (box) {
        box.innerHTML = `<div class="mh-src-h">Nguồn tham khảo</div>` + src.map((x) => `<div class="mh-src-i"${x.url ? ` data-url="${esc(x.url)}"` : ""}>• ${esc(x.title || x.url)}</div>`).join("");
    }
    return {
        el, noHeader: true,
        update(lt, st) {
            animWords(tw, lt, 0.1, 0.07);
            if (sub) enter(sub, lt, 0.6, { y: 20 });
            if (box) enter(box, lt, st.reveals[0] ?? 1.2, { y: 30 });
        },
    };
};

// Hoạt hình do AI viết. Mã chạy trong iframe sandbox (không truy cập được
// ứng dụng) và phải định nghĩa window.seek(t, duration) là hàm thuần theo t.
const THEME_VARS = ["bg", "ink", "muted", "accent", "accent2", "accent3", "card", "line", "font-head", "font-body"];
// Tiện ích mọi hoạt hình AI đều dùng được (window.MH), để mã ngắn gọn và
// chuyển động nhất quán giữa các môn: easing, lò xo, ngẫu nhiên có seed,
// dựng SVG/HTML, vẽ nét, đồ thị hàm số, hiệu ứng gõ chữ và KaTeX.
const ANIM_KIT = `var MH=(function(){
  var NS="http://www.w3.org/2000/svg";
  function clamp(x,a,b){a=a==null?0:a;b=b==null?1:b;return Math.min(b,Math.max(a,x))}
  function lerp(a,b,p){return a+(b-a)*p}
  function prog(t,a,b){return clamp((t-a)/Math.max(1e-6,b-a))}
  var ease={out:function(p){return 1-Math.pow(1-p,4)},in:function(p){return p*p*p},inOut:function(p){return p<.5?8*p*p*p*p:1-Math.pow(-2*p+2,4)/2},back:function(p){var c=1.7;return 1+(c+1)*Math.pow(p-1,3)+c*Math.pow(p-1,2)}};
  function spring(t,period,zeta){period=period||.55;zeta=zeta||.72;if(t<=0)return 0;if(t>3)return 1;var w=2*Math.PI/period,wd=w*Math.sqrt(1-zeta*zeta);return 1-Math.exp(-zeta*w*t)*(Math.cos(wd*t)+zeta*w/wd*Math.sin(wd*t))}
  function rng(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;var x=Math.imul(seed^seed>>>15,1|seed);x=x+Math.imul(x^x>>>7,61|x)^x;return((x^x>>>14)>>>0)/4294967296}}
  function set(e,a){for(var k in a)if(k==="text")e.textContent=a[k];else if(k==="style"&&typeof a[k]==="object")Object.assign(e.style,a[k]);else e.setAttribute(k,a[k]);return e}
  function svg(tag,a,parent){var e=set(document.createElementNS(NS,tag),a||{});(parent||document.getElementById("stage")).appendChild(e);return e}
  function el(tag,a,parent){var e=set(document.createElement(tag),a||{});(parent||document.getElementById("stage")).appendChild(e);return e}
  function show(e,p,o){o=o||{};var y=(o.y==null?30:o.y)*(1-p),x=(o.x||0)*(1-p),s=o.scale==null?1:lerp(o.scale,1,p);e.style.opacity=clamp(p*1.3);e.style.transform="translate("+x+"px,"+y+"px) scale("+s+")";return e}
  function draw(path,p){var L=path.__len||(path.__len=path.getTotalLength());path.style.strokeDasharray=L;path.style.strokeDashoffset=L*(1-clamp(p));return path}
  function plot(fn,o){var n=o.n||240,d="";for(var i=0;i<=n;i++){var x=lerp(o.x0,o.x1,i/n),y=fn(x);if(!isFinite(y))continue;var px=o.left+(x-o.x0)/(o.x1-o.x0)*o.width,py=o.top+(o.y1-y)/(o.y1-o.y0)*o.height;d+=(d?"L":"M")+px.toFixed(1)+","+py.toFixed(1)}return d}
  function typeText(s,p){var a=Array.from(s);return a.slice(0,Math.round(a.length*clamp(p))).join("")}
  function tex(e,latex,display){if(window.katex)window.katex.render(latex,e,{displayMode:display!==false,throwOnError:false,strict:false});else e.textContent=latex;return e}
  function sim(def){var defs=def.params||[],ov=window.SIM_OVERRIDE||{},P={},st=null,t=0,DT=1/60,rand=null,playing=false,last=0;
  defs.forEach(function(d){P[d.key]=ov[d.key]!=null?ov[d.key]:d.value});
  function reset(){document.getElementById("stage").innerHTML="";t=0;rand=rng(def.seed||7);st=def.setup(P,rand);def.draw(st,P,t)}
  function run(to){if(!st||to<t-1e-9)reset();while(t+DT<=to+1e-9){def.step(st,DT,P,rand);t+=DT}def.draw(st,P,t)}
  function loop(now){if(!playing)return;var target=t+Math.min(.1,(now-last)/1000);last=now;while(t+DT<=target){def.step(st,DT,P,rand);t+=DT}def.draw(st,P,t);requestAnimationFrame(loop)}
  function play(){if(playing)return;if(!st)reset();playing=true;last=performance.now();requestAnimationFrame(loop)}
  window.seek=function(time){run(time)};
  window.__sim={params:defs,values:P,play:play,pause:function(){playing=false},reset:reset,
  live:function(on){playing=false;if(on){reset();play()}},
  set:function(k,v){P[k]=v;var d=defs.filter(function(x){return x.key===k})[0];if(d&&d.reset)reset();else if(st)def.draw(st,P,t)}};
  }
  return{clamp:clamp,lerp:lerp,prog:prog,ease:ease,spring:spring,rng:rng,set:set,svg:svg,el:el,show:show,draw:draw,plot:plot,typeText:typeText,tex:tex,sim:sim};
  })();`;

function customDoc(code, W, H, theme) {
    const fonts = globalThis.MH_FONT_CSS ? `<style>${globalThis.MH_FONT_CSS}</style>` : `<link rel="stylesheet" href="${location.origin}/engine/fonts.css">`;
    const safe = (s) => String(s).replace(/<\/script/gi, "<\\/script");
    const kx = !/MH\.tex\(/.test(code) ? "" : globalThis.MH_KATEX
        ? `<style>${globalThis.MH_KATEX.css}</style><script>${safe(globalThis.MH_KATEX.js)}</script>`
        : `<link rel="stylesheet" href="${location.origin}/vendor/katex/katex.min.css"><script src="${location.origin}/vendor/katex/katex.min.js"></script>`;
    return `<!doctype html><html><head><meta charset="utf-8">${fonts}${kx}
  <style>html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:transparent}#stage{position:relative;width:${W}px;height:${H}px;overflow:hidden}</style></head>
  <body><div id="stage"></div>
  <script>window.W=${W};window.H=${H};window.THEME=${safe(JSON.stringify(theme))};
  window.onerror=function(m,s,l){parent.postMessage({type:"err",msg:m+" (dòng "+l+")"},"*")};</script>
  <script>${ANIM_KIT}</script>
  <script>${safe(code)}</script>
  <script>
  addEventListener("message",async function(e){var m=e.data;if(!m)return;
  if(m.type==="sim"){var S=window.__sim;if(!S)return;try{if(m.act==="live")S.live(m.on);else if(m.act==="set")S.set(m.key,m.value);else if(S[m.act])S[m.act]()}catch(err){parent.postMessage({type:"err",msg:String(err&&err.stack||err)},"*")}return}
  if(m.type!=="seek")return;
  try{if(window.seek)await window.seek(m.t,m.d)}catch(err){parent.postMessage({type:"err",msg:String(err&&err.stack||err)},"*")}
  requestAnimationFrame(function(){parent.postMessage({type:"ack",n:m.n},"*")})});
  (document.fonts?document.fonts.ready:Promise.resolve()).then(function(){var S=window.__sim;
  try{parent.postMessage({type:"ready",params:S?S.params:null,values:S?S.values:null},"*")}catch(err){parent.postMessage({type:"ready"},"*")}});
  </script></body></html>`;
}

// Hoạt hình AI tự viết (custom) hoặc mô phỏng (sim): mã chạy trong iframe sandbox.
// Ở mọi nơi nó được điều khiển bằng seek(t); riêng mô phỏng trong bản trình chiếu
// (ctx.interactive) thì chạy trực tiếp, có phát/tạm dừng/đặt lại và thanh trượt tham số.
function codeScene(s, ctx, sim) {
    const el = h("div", "mh-body mh-custom");
    if (!s.code) {
        el.innerHTML = `<div class="mh-custom-empty"><div>${sim ? "🧪" : "✨"}</div><div>${esc(s.title || (sim ? "Thí nghiệm mô phỏng" : "Hoạt hình AI"))}</div><small>${sim ? "Chưa dựng mô phỏng" : "Chưa dựng hoạt hình"}</small></div>`;
        return { el, noHeader: true, update() { } };
    }
    const css = getComputedStyle(ctx.stage);
    const theme = Object.fromEntries(THEME_VARS.map((k) => [k.replace("-", "_"), css.getPropertyValue(`--${k}`).trim()]));
    const frame = el.appendChild(document.createElement("iframe"));
    frame.setAttribute("sandbox", "allow-scripts");
    frame.className = "mh-custom-frame";
    frame.width = ctx.W; frame.height = ctx.H;
    frame.srcdoc = customDoc(s.code, ctx.W, ctx.H, theme);
    // một số trình duyệt nhúng/có gắn công cụ từ chối postMessage khác nguồn; phần còn lại của bài vẫn phải chạy
    const post = (m) => { try { frame.contentWindow?.postMessage(m, "*"); return true; } catch (err) { ctx.onError?.(String(err)); return false; } };
    let seq = 0, acked = 0, waiters = [], onReady, live = false, setPlaying = () => { };
    const ready = new Promise((r) => { onReady = r; setTimeout(r, 8000); });
    const onMsg = (e) => {
        if (e.source !== frame.contentWindow || !e.data) return;
        if (e.data.type === "ready") { if (sim && e.data.params?.length) setPlaying = controls(e.data.params, e.data.values || {}); onReady(); }
        else if (e.data.type === "ack") { acked = Math.max(acked, e.data.n); waiters = waiters.filter((w) => (w.n <= acked ? (w.done(), false) : true)); }
        else if (e.data.type === "err") ctx.onError?.(e.data.msg);
    };
    window.addEventListener("message", onMsg);

    /** Phát/tạm dừng, đặt lại và một thanh trượt cho mỗi tham số; trả về hàm đặt trạng thái nút phát. */
    function controls(params, values) {
        const bar = el.appendChild(h("div", `mh-sim-ctl ${ctx.interactive ? "mh-interactive" : "mh-static"}`));
        const playBtn = bar.appendChild(h("button", "", "⏸"));
        playBtn.title = "Chạy / Dừng";
        let playing = true;
        const show = (on) => { playing = on; playBtn.textContent = on ? "⏸" : "▶"; };
        playBtn.onclick = () => { post({ type: "sim", act: playing ? "pause" : "play" }); show(!playing); };
        const resetBtn = bar.appendChild(h("button", "mh-sim-reset", "↺"));
        resetBtn.title = "Làm lại từ đầu";
        resetBtn.onclick = () => post({ type: "sim", act: "reset" });
        for (const d of params) {
            const box = bar.appendChild(h("label", "mh-sim-p"));
            const label = box.appendChild(h("span"));
            const input = box.appendChild(document.createElement("input"));
            Object.assign(input, { type: "range", min: d.min, max: d.max, step: d.step || "any", value: values[d.key] ?? d.value });
            const text = () => { label.innerHTML = `${esc(d.label || d.key)}: <b>${esc(fmtNumber(Number(input.value), String(d.step ?? "").split(".")[1]?.length || 0))}${d.unit ? ` ${esc(d.unit)}` : ""}</b>`; };
            input.oninput = () => { text(); post({ type: "sim", act: "set", key: d.key, value: Number(input.value) }); };
            text();
        }
        return show;
    }

    return {
        el, noHeader: true, ready,
        update(lt, st) {
            if (sim && ctx.interactive) {
                if (!live) { live = post({ type: "sim", act: "live", on: true }); setPlaying(true); }
                return;
            }
            if (!post({ type: "seek", t: lt, d: st.duration, n: ++seq })) acked = seq;
        },
        leave() { if (live) { live = false; post({ type: "sim", act: "live", on: false }); } },
        /** Hoàn tất khi khung đã vẽ xong lần seek mới nhất (tối đa 3 giây). */
        settled() {
            if (acked >= seq) return Promise.resolve();
            return new Promise((done) => { waiters.push({ n: seq, done }); setTimeout(done, 3000); });
        },
        dispose() { window.removeEventListener("message", onMsg); },
    };
}
L.custom = (s, ctx) => codeScene(s, ctx, false);
L.sim = (s, ctx) => codeScene(s, ctx, true);

/** Id video YouTube của link watch / share / embed / shorts, ngược lại trả về null. */
export function youtubeId(url) {
    const m = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(String(url || ""));
    return m ? m[1] : null;
}

// Bản .html ngoại tuyến mang video đã tải lên dưới dạng base64 (globalThis.MH_MEDIA);
// chúng được chuyển thành blob URL ở lần dùng đầu tiên.
const mediaUrls = new Map();
function mediaSrc(url) {
    const b64 = globalThis.MH_MEDIA?.[url];
    if (!b64) return url;
    if (!mediaUrls.has(url)) {
        const bin = atob(b64), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        mediaUrls.set(url, URL.createObjectURL(new Blob([bytes], { type: "video/mp4" })));
    }
    return mediaUrls.get(url);
}

// MP4 tải lên hoặc link YouTube. Phát được trong khung xem trước của trình soạn và khi trình chiếu;
// trang in và ảnh chụp cho AI hiển thị ảnh bìa (image_url) thay thế.
L.video = (s, ctx) => {
    const el = h("div", "mh-body mh-video");
    const frame = el.appendChild(h("div", "mh-video-frame"));
    const cap = s.caption ? el.appendChild(h("div", "mh-video-cap", rich(s.caption))) : null;
    const yt = youtubeId(s.video_url);
    let leave;
    if (!s.video_url) frame.innerHTML = `<div class="mh-img-empty"><div>🎞️</div><div>Chưa có video</div></div>`;
    else if (ctx.mode !== "preview" && !ctx.interactive) {
        frame.innerHTML = `${s.image_url ? `<img src="${esc(s.image_url)}" alt="">` : ""}<div class="mh-video-play">▶</div>${yt ? `<div class="mh-video-link">${esc(s.video_url)}</div>` : ""}`;
    } else if (yt) {
        const f = frame.appendChild(document.createElement("iframe"));
        f.className = "mh-interactive";
        f.src = `https://www.youtube-nocookie.com/embed/${yt}?rel=0&enablejsapi=1`;
        f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
        f.allowFullscreen = true;
        leave = () => { try { f.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "pauseVideo", args: "" }), "*"); } catch { /* khung đã bị gỡ */ } };
    } else {
        const v = frame.appendChild(document.createElement("video"));
        v.className = "mh-interactive";
        Object.assign(v, { src: mediaSrc(s.video_url), controls: true, playsInline: true, preload: "metadata" });
        if (s.image_url) v.poster = s.image_url;
        leave = () => v.pause();
    }
    return {
        el, leave,
        update(lt) {
            enter(frame, lt, 0.3, { scale: 0.96, y: 0, blur: 0 });
            if (cap) enter(cap, lt, 0.6, { y: 20 });
        },
    };
};

// ---------- khung cảnh ----------
function buildScene(scene, ctx, index = 0) {
    const layout = L[scene.layout] ? scene.layout : "bullets";
    const root = h("section", `mh-scene mh-L-${layout}`);
    root.dataset.k0 = { small: 0.85, large: 1.15 }[scene.look?.text_size] ?? 1;
    const body = L[layout](scene, ctx);
    const head = body.noHeader ? null : header(scene);
    const total = ctx.project.scenes.length;
    const nn = String(index + 1).padStart(2, "0");
    // đầu trang chạy và chân trang tiến độ: ẩn trừ khi giao diện cho hiện
    if (head) head.el.prepend(h("div", "mh-kicker", `<span class="mh-kicker-n">${nn}</span>${esc(ctx.project.title)}`));
    if (head) root.appendChild(head.el);
    root.appendChild(body.el);
    const meta = [ctx.project.subject, ctx.project.grade ? `Lớp ${ctx.project.grade}` : ""].filter(Boolean).join(" · ");
    root.appendChild(h("div", "mh-foot", `<span>${nn} / ${String(total).padStart(2, "0")}</span><div class="mh-foot-bar"><i style="width:${((index + 1) / total) * 100}%"></i></div><span>${esc(meta)}</span>`));
    if (scene.illustrative && (layout === "chart" || layout === "big_number")) root.appendChild(h("div", "mh-badge", "Số liệu minh hoạ"));
    return {
        root, ready: body.ready, settled: body.settled, dispose: body.dispose, leave: body.leave,
        update(lt, st) { head?.update(lt, st); body.update(lt, st); },
    };
}

// Thu nhỏ cỡ chữ của cảnh cho đến khi phần thân vừa sân khấu; công thức rộng
// tự co riêng để một phương trình dài không bao giờ tràn khỏi thẻ.
// Phần thân không cắt gì, nên phần tràn lấn vào phần đệm dưới của cảnh
// mà không làm cảnh cao thêm: phải kiểm tra cả hai.
function overflows(sceneEl) {
    const b = sceneEl.querySelector(".mh-body");
    return sceneEl.scrollHeight > sceneEl.clientHeight + 2 || (b && b.scrollHeight > b.clientHeight + 2);
}
function fit(sceneEl) {
    let k = Number(sceneEl.dataset.k0) || 1;
    sceneEl.style.setProperty("--k", k);
    for (let i = 0; i < 14 && overflows(sceneEl) && k > 0.5; i++) {
        k *= 0.93;
        sceneEl.style.setProperty("--k", k.toFixed(3));
    }
    for (const f of sceneEl.querySelectorAll(".mh-f")) {
        f.style.fontSize = "";
        const max = sceneEl.clientWidth - 2 * parseFloat(getComputedStyle(sceneEl).paddingLeft) - 160;
        if (f.scrollWidth > max) f.style.fontSize = `${(parseFloat(getComputedStyle(f).fontSize) * max) / f.scrollWidth}px`;
    }
}

/**
 * @param host phần tử chứa sân khấu được co cho vừa
 * @param opts { mode: 'preview'|'present', interactive (trình chiếu trực tiếp: mô phỏng chạy trực tiếp, media phát được), onError }
 */
export function createPlayer(host, project, timeline, opts = {}) {
    const W = 1920, H = 1080;
    const stage = h("div", `mh-stage mh-theme-${project.theme || "notebook"}`);
    stage.style.width = W + "px"; stage.style.height = H + "px";
    const bg = stage.appendChild(h("div", "mh-bg"));
    const blobs = [0, 1, 2].map((i) => bg.appendChild(h("div", `mh-blob mh-blob-${i}`)));
    const ctx = { project, mode: opts.mode, interactive: !!opts.interactive, stage, W, H, onError: opts.onError };
    let built = [];
    let tl = timeline;
    let current = -1;
    let lastT = 0;

    function build(p, t) {
        project = p; tl = t; ctx.project = p;
        built.forEach((b) => { b.dispose?.(); b.root.remove(); });
        built = p.scenes.map((s, i) => {
            const b = buildScene(s, ctx, i);
            b.root.style.visibility = "hidden";
            stage.appendChild(b.root);
            return b;
        });
        current = -1;
        relayout();
    }
    function relayout() {
        built.forEach((b) => { b.root.style.visibility = "visible"; fit(b.root); b.root.style.visibility = "hidden"; });
        current = -1;
        seek(lastT);
    }
    host.appendChild(stage);
    const ro = new ResizeObserver(() => resize());
    function resize() {
        const k = Math.min(host.clientWidth / W, host.clientHeight / H) || 1;
        stage.style.transform = `translate(-50%,-50%) scale(${k})`;
    }
    ro.observe(host);
    resize();

    function sceneAt(t) {
        const ss = tl.scenes;
        for (let i = ss.length - 1; i >= 0; i--) if (t >= ss[i].start) return i;
        return 0;
    }

    function seek(t, extra = {}) {
        lastT = t;
        if (!built.length) return;
        t = clamp(t, 0, Math.max(0, tl.total - 1e-4));
        const i = sceneAt(t);
        if (i !== current) {
            if (built[current]) { built[current].root.style.visibility = "hidden"; built[current].leave?.(); }
            built[i].root.style.visibility = "visible";
            current = i;
        }
        const st = { ...tl.scenes[i], mode: extra.rest ? "rest" : opts.mode };
        const lt = t - st.start;
        built[i].update(lt, st);
        // phát liên tục thì mờ dần cuối mỗi cảnh; trình chiếu thì không bao giờ
        const out = opts.mode === "present" || extra.rest ? 0 : prog(lt, st.duration - 0.35, 0.35);
        built[i].root.style.opacity = 1 - easeInOut(out);
        // nền chuyển động nhẹ theo thời gian toàn cục
        blobs.forEach((b, k) => {
            const a = t * (0.12 + k * 0.05) + k * 2.1;
            b.style.transform = `translate(${Math.sin(a) * 60}px, ${Math.cos(a * 0.8) * 50}px) scale(${1 + 0.06 * Math.sin(a * 1.3)})`;
        });
        return i;
    }

    build(project, timeline);

    return {
        stage,
        get timeline() { return tl; },
        get project() { return project; },
        seek,
        sceneAt,
        /** Khung nghỉ của cảnh: mọi thứ đã hiện, không mờ dần khi rời. */
        showRest(i) {
            const s = tl.scenes[i];
            return seek(s.start + Math.max(0, s.duration - 0.4), { rest: true });
        },
        update(p, t) { build(p, t); },
        relayout,
        async ready() {
            if (document.fonts?.ready) await document.fonts.ready;
            await Promise.all(built.map((b) => b.ready).filter(Boolean));
            relayout();
        },
        /** Hoàn tất khi cảnh đang hiển thị đã vẽ xong (hoạt hình AI vẽ bất đồng bộ). */
        settled() { return built[current]?.settled?.() ?? Promise.resolve(); },
        destroy() { ro.disconnect(); built.forEach((b) => b.dispose?.()); stage.remove(); },
    };
}

/** Trình chiếu bấm-để-tiếp trên một trình phát: phát giữa các điểm dừng. */
export function createPresenter(player, onChange) {
    let holds = holdPoints(player.timeline);
    let idx = 0, t = holds[0]?.t ?? 0, raf = 0;
    player.seek(t);
    function emit() { onChange?.({ idx, total: holds.length, scene: holds[idx]?.scene ?? 0, t }); }
    function playTo(target) {
        cancelAnimationFrame(raf);
        const sceneStart = player.timeline.scenes[player.sceneAt(target)].start;
        let from = t;
        const playThrough = player.timeline.scenes[player.sceneAt(target)].playThrough;
        if (from < sceneStart || (!playThrough && target - from > 1.6)) from = playThrough ? sceneStart : Math.max(sceneStart, target - 1.6);
        let last = performance.now();
        const step = (now) => {
            from = Math.min(target, from + (now - last) / 1000);
            last = now;
            t = from; player.seek(t);
            if (from < target) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
    }
    emit();
    return {
        next() { if (idx < holds.length - 1) { idx++; playTo(holds[idx].t); emit(); } },
        prev() { if (idx > 0) { cancelAnimationFrame(raf); idx--; t = holds[idx].t; player.seek(t); emit(); } },
        gotoScene(i) {
            const k = holds.findIndex((x) => x.scene === i);
            if (k >= 0) { cancelAnimationFrame(raf); idx = k; t = holds[k].t; player.seek(t); emit(); }
        },
        destroy() { cancelAnimationFrame(raf); },
    };
}
