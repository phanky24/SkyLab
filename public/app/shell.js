// Các phần dùng chung cho mọi màn hình: cấu hình máy chủ, hộp thoại cài đặt, thanh các bước.
import { MODELS } from "./meta.js";
import { $, esc, modal, settings, toast } from "./ui.js";

/** Điền một lần khi khởi động từ /api/config. */
export const config = { serverKey: false, models: [] };

export const hasAI = () => config.serverKey || !!settings.key;

export function openSettings() {
  const m = modal(`
    <h2>⚙️ Cài đặt AI</h2>
    <p class="muted">${config.serverKey ? "✅ Máy chủ đã có sẵn khoá Claude — bạn <b>không cần</b> nhập gì. Chỉ nhập nếu muốn dùng khoá riêng." : "Công cụ dùng Claude của Anthropic. Dán khoá API (lấy tại <a href='https://console.anthropic.com/settings/keys' target='_blank'>console.anthropic.com</a>) hoặc token của gói Claude (<code>claude setup-token</code>)."}</p>
    <label class="field"><span>Khoá Claude</span><input id="st-key" type="password" placeholder="sk-ant-…" value="${esc(settings.key)}"></label>
    <label class="field"><span>Mô hình AI</span><select id="st-model">${MODELS.map((x) => `<option value="${x.id}" ${settings.model === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
    <p class="muted small">Khoá chỉ lưu trên trình duyệt của bạn.</p>
    <div class="row end"><button class="btn primary" id="st-save">Lưu</button></div>`);
  $("#st-save", m.el).onclick = () => {
    settings.key = $("#st-key", m.el).value;
    settings.model = $("#st-model", m.el).value;
    m.close();
    toast("Đã lưu cài đặt", "ok");
  };
}

export function stepper(active, id) {
  const steps = [["Ý tưởng", null], ["Kịch bản", "script"], ["Thiết kế & luyện tập", "design"], ["Xuất bản", "export"]];
  return `<nav class="stepper">${steps.map(([n, tab], i) => {
    const k = i + 1;
    const cls = k === active ? "on" : k < active ? "done" : "";
    const inner = `<span class="st-n">${k < active ? "✓" : k}</span>${n}`;
    return id && tab ? `<a class="st ${cls}" href="#/p/${id}/${tab}">${inner}</a>` : `<span class="st ${cls}">${inner}</span>`;
  }).join('<span class="st-sep"></span>')}</nav>`;
}
