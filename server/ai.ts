// Claude Messages API: tìm hiểu (web search) → kịch bản → viết lại / thêm cảnh /
// góp ý / minh hoạ SVG. Prompt viết bằng tiếng Việt, chia mục bằng thẻ XML.
import { youtubeId } from "../public/engine/engine.js";
import { DOC, DOCX, wordBlocks } from "./docx";
import { subjectGuide } from "./subjects";
import { isObj, str, type Item, type Look, type Project, type Scene, type Source } from "./types";

const API = "https://api.anthropic.com/v1/messages";
export const DEFAULT_MODEL = "claude-opus-5-5";
export const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
// Token gói Claude (OAuth) chỉ được chấp nhận khi khối system đầu tiên đúng y câu này.
const OAUTH_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

export class AIError extends Error {
  constructor(message: string, public status = 500) { super(message); }
}

/** token: API key (sk-ant-api…) hoặc token OAuth của gói Claude (sk-ant-oat…). */
export interface AIAuth { token: string; model: string }

export const serverToken = () => process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN || process.env.CLAUDE_CODE_OAUTH_TOKEN || "";

type Block =
  | { type: "text"; text: string }
  | { type: "document"; source: { type: "base64"; media_type: string; data: string }; title?: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_result"; tool_use_id: string; content: Block[] | string };
interface ToolUse { type: "tool_use"; id: string; name: string; input: unknown }
const isToolUse = (b: { type: string }): b is ToolUse => b.type === "tool_use" && "name" in b && "id" in b;
type OutBlock =
  | { type: "text"; text: string; citations?: { url?: string; title?: string }[] }
  | ToolUse
  | { type: "web_search_tool_result"; content: unknown }
  | { type: string };
interface Reply { content: OutBlock[]; stop_reason: string }
interface Message { role: "user" | "assistant"; content: Block[] | OutBlock[] }

async function call(auth: AIAuth, system: string, messages: Message[], extra: object, maxTokens: number): Promise<Reply> {
  if (!auth.token) throw new AIError("Chưa có khoá Claude. Mở ⚙️ Cài đặt AI để dán khoá.", 401);
  const oauth = auth.token.startsWith("sk-ant-oat");
  const headers: Record<string, string> = { "content-type": "application/json", "anthropic-version": "2023-06-01" };
  if (oauth) { headers.authorization = `Bearer ${auth.token}`; headers["anthropic-beta"] = "oauth-2025-04-20"; }
  else headers["x-api-key"] = auth.token;
  const body = JSON.stringify({
    model: auth.model,
    max_tokens: maxTokens,
    system: [...(oauth ? [{ type: "text", text: OAUTH_IDENTITY }] : []), { type: "text", text: system }],
    messages,
    ...extra,
  });
  let last: AIError | null = null;
  for (const delay of [0, 3000, 8000]) {
    if (delay) await Bun.sleep(delay);
    let res: Response;
    try {
      res = await fetch(API, { method: "POST", headers, body, signal: AbortSignal.timeout(240_000) });
    } catch (e) {
      if (e instanceof DOMException && e.name === "TimeoutError") throw new AIError("AI phản hồi quá lâu. Bấm thử lại nhé.", 504);
      throw new AIError("Không kết nối được tới máy chủ AI. Kiểm tra mạng Internet.", 503);
    }
    if (res.ok) return (await res.json()) as Reply;
    const text = await res.text();
    if (res.status === 401) throw new AIError("Khoá Claude không hợp lệ hoặc đã hết hạn. Kiểm tra lại trong ⚙️ Cài đặt AI.", 401);
    if (res.status === 403) throw new AIError("Khoá Claude không có quyền dùng mô hình này.", 403);
    if (res.status === 404) throw new AIError(`Không có mô hình “${auth.model}”. Chọn mô hình khác trong ⚙️ Cài đặt AI.`, 400);
    if (res.status === 429) last = new AIError("Đã hết lượt dùng AI tạm thời. Đợi khoảng 1 phút rồi thử lại.", 429);
    else if (res.status >= 500) last = new AIError("Máy chủ AI đang quá tải, thử lại sau ít phút.", 503);
    else throw new AIError(`AI báo lỗi (${res.status}): ${text.slice(0, 300)}`, 502);
  }
  throw last ?? new AIError("AI không phản hồi.", 503);
}

/**
 * Câu trả lời có cấu trúc: yêu cầu mô hình gọi đúng một công cụ có input
 * schema là dạng câu trả lời; input đó chính là kết quả.
 */
async function structured(auth: AIAuth, system: string, content: Block[], tool: { name: string; description: string; schema: object }, maxTokens: number): Promise<unknown> {
  const sys = `${system}\n\n<output>Trả kết quả bằng cách gọi công cụ \`${tool.name}\` đúng một lần. Không viết gì khác ngoài lần gọi công cụ.</output>`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await call(auth, sys, [{ role: "user", content }], {
      tools: [{ name: tool.name, description: tool.description, input_schema: tool.schema }],
      tool_choice: { type: "auto" },
    }, maxTokens);
    const use = r.content.find((b): b is ToolUse => isToolUse(b) && b.name === tool.name);
    if (use && isObj(use.input)) return use.input;
  }
  throw new AIError("AI chưa trả về đúng định dạng, bấm thử lại.", 502);
}

// ---------- dạng câu trả lời (JSON Schema) ----------
const STR = { type: "string" };
const obj = (properties: Record<string, object>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });
const arr = (items: object) => ({ type: "array", items });
// bố cục mô hình được chọn khi viết kịch bản; "custom" chỉ do animateScene tạo,
// "video" chỉ do người dùng thêm; cảnh "sim" được animateScene viết code sau
const LAYOUT_KEYS = ["title", "bullets", "compare", "table", "timeline", "steps", "big_number", "chart", "quote", "formula", "quiz", "cycle", "image", "sim", "ending"];
const ALL_LAYOUTS = [...LAYOUT_KEYS, "custom", "video"];
/** Bố cục có nội dung là code hoặc media mà mô hình không thấy hay viết được khi sửa chữ. */
const BUILT = ["custom", "sim", "video"];
const LOOK = obj({
  text_size: { type: "string", enum: ["small", "normal", "large"] },
  image_size: { type: "string", enum: ["small", "medium", "large", "full"] },
  image_fit: { type: "string", enum: ["contain", "cover"] },
  image_side: { type: "string", enum: ["left", "right"] },
  columns: { type: "integer", enum: [1, 2] },
}, []);
const sceneSchema = (layouts: string[]) => obj({
  layout: { type: "string", enum: layouts },
  icon: { type: "string", description: "Đúng 1 emoji" },
  title: STR, subtitle: STR,
  items: arr(obj({ text: STR, detail: STR }, ["text"])),
  left_heading: STR, left_items: arr(STR), right_heading: STR, right_items: arr(STR),
  value: STR, unit: STR, label: STR,
  bars: arr(obj({ label: STR, value: { type: "number" } }, ["label", "value"])),
  illustrative: { type: "boolean" },
  quote_text: STR, quote_author: STR, latex: STR, explain: STR,
  question: STR, options: arr(STR), answer_index: { type: "integer" },
  table_headers: arr(STR), table_rows: arr(arr(STR)),
  caption: STR, image_prompt: STR,
  custom_prompt: { type: "string", description: "layout sim: mô tả thí nghiệm mô phỏng cần dựng" },
  notes: { type: "string", description: "Tối đa 2 câu nhắc người thuyết trình" },
  look: LOOK,
}, ["layout", "title"]);
const SCENE = sceneSchema(LAYOUT_KEYS);
const REWRITE = obj({
  scene: sceneSchema(ALL_LAYOUTS),
  redraw_image: { type: "boolean", description: "true khi cần vẽ lại hình minh hoạ theo image_prompt mới" },
  note: { type: "string", description: "1–2 câu báo người dùng đã đổi gì về hiển thị, hoặc phần nào của yêu cầu không làm được và vì sao" },
}, ["scene"]);

// ---------- các phần của prompt ----------
const PRODUCT = "Slide thuyết trình trên lớp. Người thật đứng trình bày: chữ trên màn hình là từ khoá thật ngắn, notes gợi ý cách nói và cách tương tác với lớp.";

const ROLE = `Bạn là biên kịch kiêm nhà thiết kế bài giảng, giúp giáo viên THPT Việt Nam làm slide bài giảng cho học sinh. Bạn viết nội dung; phần đồ hoạ do một bộ bố cục dựng sẵn đảm nhận, nên việc của bạn là chọn bố cục phù hợp và điền nội dung chính xác, ngắn gọn.`;

const RULES = `<layouts>
Mỗi cảnh chọn đúng một layout và chỉ điền các trường của layout đó:
- title: trang bìa (title, subtitle, icon). Luôn là cảnh đầu.
- bullets: 2–5 ý (items: text + detail).
- steps: quy trình 2–5 bước (items). Không tự đánh số trong chữ.
- timeline: 2–6 mốc (items: text = năm/mốc, detail = sự kiện).
- compare: so sánh 2 đối tượng (left_heading, left_items, right_heading, right_items; mỗi bên 2–4 ý).
- cycle: chu trình khép kín 3–6 khâu (items), label = chữ ở tâm vòng.
- big_number: một con số ấn tượng (value chỉ gồm chữ số, unit, label giải thích ý nghĩa).
- chart: biểu đồ cột 2–6 cột (unit = tên đại lượng, bars: label + value là số).
- quote: định nghĩa hoặc trích dẫn (quote_text, quote_author = nguồn).
- formula: công thức (latex; công thức hoá học viết \\mathrm{CO_2}, chữ tiếng Việt trong \\text{…}; explain giải thích).
- quiz: câu hỏi trắc nghiệm (question, 4 options, answer_index tính từ 0, explain).
- table: bảng nhỏ (table_headers 2–4 cột, table_rows 2–5 hàng, ô ngắn) cho tính chất, số liệu nhiều chiều, cấu trúc – ví dụ.
- image: hình minh hoạ (caption, image_prompt mô tả hình cần vẽ, tối đa 3 items).
- sim: thí nghiệm mô phỏng tương tác (title; custom_prompt mô tả hiện tượng cần mô phỏng, 1–3 đại lượng giáo viên kéo thanh trượt để thay đổi, điều học sinh cần quan sát). Dùng 1–2 cảnh khi bài có hiện tượng động mà mô phỏng giúp hiểu rõ hơn hình tĩnh (vd. chuyển động Brown, dao động, sóng, va chạm, khuếch tán, dòng điện, quỹ đạo, phản ứng theo nhiệt độ); không dùng nếu bài không có hiện tượng như vậy.
- ending: cảnh kết (title, subtitle). Luôn là cảnh cuối.
Đa dạng bố cục; không dùng một layout quá 2 lần liên tiếp.
</layouts>

<style>
- Tiếng Việt có dấu, đúng chương trình GDPT 2018, hợp lứa tuổi.
- Chữ trên màn hình ngắn: title ≤ 60 ký tự, item.text ≤ 55 ký tự, item.detail ≤ 90 ký tự. Không viết đoạn văn lên màn hình.
- Không tự đánh số trong chữ ("Bước 1:", "Ý 2:") vì giao diện đã tự đánh số.
- Ký hiệu khoa học trong chữ thường dùng Unicode (CO₂, H₂O, m/s²); LaTeX chỉ nằm trong trường latex.
</style>

<honesty>
- Chỉ dùng số liệu có trong tài liệu, kết quả tra cứu, hoặc kiến thức phổ thông chắc chắn. Số liệu chỉ để minh hoạ thì đặt illustrative = true.
- Không bịa tên người, năm, trích dẫn hay kết quả thí nghiệm.
</honesty>`;

const HINT = `<assist_mode>
Chế độ "chỉ gợi ý": giáo viên muốn tự viết nội dung. Dựng đủ cấu trúc, tiêu đề và bố cục cụ thể, nhưng ở những chỗ cần tự nghiên cứu hoặc tự viết, để chỗ trống dạng "[Gợi ý: câu hỏi định hướng ngắn]" (trong item.text, item.detail, value, left_items, right_items…). Mỗi cảnh điền sẵn tối đa một ý làm mẫu.
</assist_mode>`;

export interface Brief {
  subject?: string; grade?: string; topic: string; notes?: string;
  research?: boolean; sceneCount?: number; assist?: string; audience?: string;
}
export interface UploadFile { name: string; mime: string; data: string }

export async function research(auth: AIAuth, b: Brief): Promise<{ notes: string; sources: Source[] }> {
  const system = `Bạn là trợ lý nghiên cứu cho giáo viên Việt Nam. Tra cứu trên web, ưu tiên nguồn chính thống (sách giáo khoa, cơ quan nhà nước, tạp chí khoa học, báo lớn), rồi tóm tắt chính xác bằng tiếng Việt.`;
  const user = `<task>Tra cứu và tổng hợp kiến thức để làm slide thuyết trình về chủ đề dưới đây.</task>
<topic>${b.topic}</topic>
<audience>giáo viên dạy học sinh môn ${b.subject || "?"}, lớp ${b.grade || "10–12"}</audience>
<want>Khái niệm chính; 5–10 dữ kiện quan trọng; số liệu kèm năm và nguồn; mốc lịch sử nếu có; ví dụ thực tế ở Việt Nam; hiểu lầm thường gặp. Viết gọn dạng gạch đầu dòng.</want>${b.notes ? `\n<user_notes>\n${b.notes.slice(0, 6000)}\n</user_notes>` : ""}`;
  const messages: Message[] = [{ role: "user", content: [{ type: "text", text: user }] }];
  const blocks: OutBlock[] = [];
  // máy chủ có thể tạm dừng một lượt tìm kiếm dài; gửi lại để nó làm tiếp
  for (let i = 0; i < 3; i++) {
    const r = await call(auth, system, messages, { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }] }, 6000);
    blocks.push(...r.content);
    if (r.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: r.content });
  }
  const notes = blocks.map((b) => (b.type === "text" && "text" in b ? b.text : "")).join("").trim();
  const seen = new Set<string>();
  const sources: Source[] = [];
  const add = (url: unknown, title: unknown) => {
    const u = str(url);
    if (!u || seen.has(u)) return;
    seen.add(u);
    sources.push({ title: str(title) || new URL(u).hostname, url: u });
  };
  // nguồn được trích dẫn trước, sau đó các kết quả tìm kiếm khác
  for (const b of blocks) if (b.type === "text" && "citations" in b) for (const c of b.citations || []) add(c.url, c.title);
  for (const b of blocks) if (b.type === "web_search_tool_result" && "content" in b && Array.isArray(b.content)) for (const r of b.content) if (isObj(r)) add(r.url, r.title);
  return { notes, sources: sources.slice(0, 8) };
}

export async function storyboard(auth: AIAuth, b: Brief, files: UploadFile[], researchNotes?: string): Promise<{ title: string; scenes: Scene[] }> {
  const system = `${ROLE}\n\n${RULES}\n\n${subjectGuide(b.subject)}${b.assist === "hint" ? `\n\n${HINT}` : ""}`;
  const n = b.sceneCount || 10;
  const content: Block[] = [];
  for (const f of files) {
    if (f.mime === "application/pdf") content.push({ type: "document", source: { type: "base64", media_type: f.mime, data: f.data }, title: f.name });
    else if (f.mime === DOCX || f.mime === DOC) content.push(...await wordBlocks(f.name, f.mime, f.data));
    else if (f.mime.startsWith("image/")) content.push({ type: "image", source: { type: "base64", media_type: f.mime, data: f.data } });
    else content.push({ type: "text", text: `<file name="${f.name}">\n${Buffer.from(f.data, "base64").toString("utf8").slice(0, 30000)}\n</file>` });
  }
  content.push({
    type: "text",
    text: `<brief>
<product>${PRODUCT}</product>
<user>giáo viên; môn ${b.subject || "(chưa rõ)"}; lớp ${b.grade || "(chưa rõ)"}</user>
<topic>${b.topic}</topic>
<scene_count>khoảng ${n} cảnh, tính cả trang bìa và cảnh kết</scene_count>${b.audience ? `\n<audience>${b.audience}</audience>` : ""}
</brief>${b.notes ? `\n\n<user_documents>\nBám sát nội dung này.\n${b.notes.slice(0, 30000)}\n</user_documents>` : ""}${researchNotes ? `\n\n<research>\nKết quả tra cứu web, dùng làm nguồn số liệu.\n${researchNotes}\n</research>` : ""}

Viết kịch bản (danh sách cảnh) theo đúng các quy tắc.`,
  });
  const out = await structured(auth, system, content, {
    name: "ghi_kich_ban",
    description: "Ghi kịch bản hoàn chỉnh: tên bài và danh sách cảnh theo thứ tự.",
    schema: obj({ title: STR, scenes: arr(SCENE) }, ["title", "scenes"]),
  }, 16000);
  if (!isObj(out) || !Array.isArray(out.scenes) || !out.scenes.length) throw new AIError("AI chưa viết được kịch bản, bấm thử lại.", 502);
  return { title: str(out.title), scenes: out.scenes.map((s) => normalizeScene(s)) };
}

function projectContext(p: Project) {
  return `<project>
<title>${p.title}</title>
<product>slide bài giảng; môn ${p.subject || "?"}; lớp ${p.grade || "?"}; người dùng là giáo viên</product>
<scenes>${p.scenes.map((s, i) => `${i + 1}. [${s.layout}] ${s.title}`).join("\n")}</scenes>
</project>`;
}

const DISPLAY = `<display>
Ngoài nội dung, bạn chỉnh được cách cảnh hiển thị bằng trường look (bỏ trống = mặc định):
- text_size: small | normal | large: cỡ chữ cả cảnh (chữ vẫn tự thu nhỏ nếu không vừa).
- image_size (layout image): small | medium | large | full: phần rộng dành cho hình; full = hình chiếm cả cảnh, chữ xuống dưới.
- image_fit (layout image): contain = hiện trọn hình, không cắt; cover = lấp đầy khung, có thể cắt mép.
- image_side (layout image): left | right: hình nằm bên nào.
- columns (bullets): 1 hoặc 2 cột.
Muốn hình to hơn, nhỏ hơn, không bị cắt hay đổi bên thì dùng look. Muốn đổi nội dung hình (vẽ lại, thêm chi tiết, đổi màu, sửa nhãn) thì viết lại image_prompt và đặt redraw_image = true. Muốn đổi kiểu trình bày thì đổi layout.
Màu sắc, font chữ và nền do giao diện quyết định: người dùng chọn một trong các giao diện có sẵn ở bước "Thiết kế & luyện tập", không có tuỳ chọn font hay màu riêng cho từng cảnh. Nếu yêu cầu cần thứ bạn không chỉnh được, làm phần gần nhất có thể và nói rõ trong note.
note viết cho giáo viên đọc: tiếng Việt thường ngày, không nhắc tên trường kỹ thuật (look, image_size, contain…).
</display>`;

export async function rewriteScene(auth: AIAuth, project: Project, index: number, instruction: string): Promise<{ scene: Scene; note: string; redraw: boolean }> {
  const scene = project.scenes[index];
  if (!scene) throw new AIError("Không tìm thấy cảnh cần sửa.", 400);
  // chỉ giữ chỗ trống ở những phần giáo viên chưa điền
  const hinted = project.assist === "hint" && JSON.stringify(scene).includes("[Gợi ý");
  const system = `${ROLE} Lần này bạn chỉ chỉnh sửa một cảnh theo yêu cầu, cả nội dung lẫn cách hiển thị.\n\n${RULES}\n\n${DISPLAY}\n\n${subjectGuide(project.subject)}${hinted ? `\n\n${HINT}` : ""}`;
  const out = await structured(auth, system, [{
    type: "text",
    text: `${projectContext(project)}

<scene number="${index + 1}">
${JSON.stringify(forAI(scene), null, 1)}
</scene>

<request>${instruction}</request>

Sửa cảnh số ${index + 1} theo yêu cầu, giữ nguyên những gì không được yêu cầu đổi (kể cả look).`,
  }], { name: "ghi_canh", description: "Ghi cảnh đã sửa.", schema: REWRITE }, 4000);
  const r = isObj(out) ? out : {};
  const next = normalizeScene(r.scene, scene.id);
  // video chỉ có thể do người dùng thêm
  if (next.layout === "video" && scene.layout !== "video") next.layout = scene.layout;
  // vẽ hình khi được yêu cầu, hoặc khi cảnh chuyển thành cảnh hình mà chưa có hình
  const redraw = next.layout === "image" && !!next.image_prompt && (r.redraw_image === true || !scene.image_url);
  if (scene.image_url && next.layout === "image" && !redraw) next.image_url = scene.image_url;
  // giữ những gì mô hình không thấy: video và ảnh bìa; code khi phần mô tả vẫn còn
  if (next.layout === "video") { next.video_url = scene.video_url; next.image_url = scene.image_url; }
  if (next.layout === scene.layout && (next.layout === "custom" || next.layout === "sim") && next.custom_prompt === scene.custom_prompt) {
    next.code = scene.code;
    next.seconds = scene.seconds;
  }
  return { scene: next, note: str(r.note).trim(), redraw };
}

export async function addScenes(auth: AIAuth, project: Project, instruction: string): Promise<Scene[]> {
  const system = `${ROLE} Lần này bạn viết thêm cảnh mới để chèn vào kịch bản có sẵn; không tạo cảnh title hay ending.\n\n${RULES}\n\n${subjectGuide(project.subject)}`;
  const out = await structured(auth, system, [{ type: "text", text: `${projectContext(project)}\n\n<request>${instruction}</request>\n\nViết các cảnh mới cần thêm.` }], {
    name: "ghi_canh_moi", description: "Ghi các cảnh mới theo thứ tự.", schema: obj({ scenes: arr(SCENE) }, ["scenes"]),
  }, 8000);
  return isObj(out) && Array.isArray(out.scenes) ? out.scenes.map((s) => normalizeScene(s)) : [];
}

const COACH = obj({
  overall: { type: "number", description: "Trung bình 6 tiêu chí, thang 10, 1 chữ số thập phân" },
  summary: STR,
  criteria: arr(obj({ name: STR, score: { type: "number" }, comment: STR }, ["name", "score", "comment"])),
  strengths: arr(STR),
  fixes: arr(obj({ scene: { type: "integer" }, issue: STR, suggestion: STR }, ["scene", "issue", "suggestion"])),
  questions: arr(obj({ q: STR, hint: STR }, ["q", "hint"])),
}, ["overall", "summary", "criteria", "strengths", "fixes", "questions"]);

export async function coach(auth: AIAuth, project: Project): Promise<unknown> {
  const system = `Bạn là giáo viên giàu kinh nghiệm hướng dẫn thuyết trình. Nhận xét kịch bản cụ thể, công bằng, khích lệ, bằng tiếng Việt.

<rubric>
Chấm 1–10 cho đúng 6 tiêu chí, theo thứ tự:
1. Nội dung chính xác & có nguồn
2. Cấu trúc mở – thân – kết
3. Dễ hiểu với người nghe
4. Trực quan, ít chữ
5. Thời lượng phù hợp
6. Sáng tạo
</rubric>

<fixes>Tối đa 6 việc quan trọng nhất cần sửa, ghi số thứ tự cảnh (từ 1), nêu vấn đề và cách sửa cụ thể. Chỉ ra kiến thức sai nếu có. Nhắc nếu còn chỗ "[Gợi ý: …]" chưa điền.</fixes>

<questions>5 câu hỏi kiểm tra mức độ hiểu bài để giáo viên hỏi học sinh sau khi xem, kèm đáp án ngắn.</questions>`;
  const { id: _id, scenes, ...meta } = project;
  return structured(auth, system, [{ type: "text", text: `<script>\n${JSON.stringify({ ...meta, scenes: scenes.map(forAI) }, null, 1)}\n</script>\n\nHãy nhận xét kịch bản trên.` }], {
    name: "ghi_nhan_xet", description: "Ghi bản nhận xét kịch bản.", schema: COACH,
  }, 6000);
}

// ---------- xem kết quả: duyệt hình ảnh và agent hoạt hình ----------

/** Những gì vòng lặp agent cần từ camera headless (server/harness.ts). */
interface Camera {
  rest(i: number): Promise<Buffer>;
  at(i: number, t: number): Promise<Buffer>;
  errors(): Promise<string[]>;
}
export interface Progress { message: string; frames: Buffer[] }

const jpeg = (b: Buffer): Block => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b.toString("base64") } });

const PATCH = obj({
  scene: { type: "integer", description: "Số thứ tự cảnh, từ 1" },
  problem: { type: "string", description: "Lỗi nhìn thấy trên hình, 1 câu" },
  changes: { ...SCENE, required: [] },
}, ["scene", "problem", "changes"]);

const REVIEW_CHECKLIST = `<checklist>
- Chữ bị tràn, bị cắt, chồng lên nhau, quá nhỏ (khó đọc khi thu nhỏ bằng màn hình điện thoại).
- Quá nhiều chữ trên một cảnh; câu dài nên rút thành từ khoá.
- Bố cục không hợp nội dung (vd. danh sách lẽ ra là các bước, so sánh lẽ ra là hai cột), hoặc cảnh trống trải, mất cân đối.
- Nhiều cảnh liền nhau trông giống hệt nhau.
- Sai kiến thức, sai chính tả, thiếu dấu tiếng Việt, ký hiệu khoa học viết sai.
- Biểu đồ / con số khó hiểu hoặc thiếu đơn vị.
</checklist>`;

/**
 * Chụp từng cảnh, cho mô hình xem, áp dụng các sửa đổi về chữ/bố cục,
 * rồi xem lại (tối đa hai vòng). Code hoạt hình không bao giờ bị động tới ở đây.
 */
export async function reviewProject(auth: AIAuth, project: Project, camera: (p: Project) => Promise<Camera & { close(): Promise<void> }>, progress: (p: Progress) => void) {
  let p = structuredClone(project);
  const changes: { scene: number; problem: string }[] = [];
  const system = `Bạn là biên tập viên thiết kế slide giáo dục khó tính. Bạn nhìn ảnh chụp từng cảnh đã dựng xong và chỉ ra lỗi hiển thị, rồi đưa nội dung sửa cho đúng các trường của cảnh.

${RULES}

${REVIEW_CHECKLIST}

<fix_rules>
- Chỉ sửa khi thấy lỗi thật trên ảnh; cảnh đã ổn thì không đưa vào danh sách.
- changes chỉ chứa các trường cần đổi. Không đổi layout của cảnh custom, sim, video và không đổi cảnh khác sang các layout đó. Giữ chỗ "[Gợi ý: …]" nếu có.
</fix_rules>`;
  for (let round = 1; round <= 2; round++) {
    const cam = await camera(p);
    const content: Block[] = [];
    const frames: Buffer[] = [];
    try {
      for (let i = 0; i < p.scenes.length; i++) {
        progress({ message: `Vòng ${round}: đang chụp cảnh ${i + 1}/${p.scenes.length}…`, frames });
        const img = await cam.rest(i);
        frames.push(img);
        content.push({ type: "text", text: `<scene number="${i + 1}" layout="${p.scenes[i].layout}">\n${JSON.stringify(forAI(p.scenes[i]))}\n</scene>` }, jpeg(img));
      }
    } finally { await cam.close(); }
    progress({ message: `Vòng ${round}: AI đang soát ${p.scenes.length} cảnh…`, frames });
    content.push({ type: "text", text: round === 1 ? "Soát từng ảnh theo checklist và liệt kê các cảnh cần sửa." : "Đây là ảnh sau khi sửa. Chỉ liệt kê lỗi còn sót; nếu ổn hết thì trả danh sách rỗng." });
    const out = await structured(auth, system, content, {
      name: "ghi_ban_sua", description: "Danh sách cảnh cần sửa và nội dung sửa.", schema: obj({ fixes: arr(PATCH) }, ["fixes"]),
    }, 12000);
    const fixes = isObj(out) && Array.isArray(out.fixes) ? out.fixes.filter(isObj) : [];
    let applied = 0;
    for (const f of fixes) {
      const i = Number(f.scene) - 1;
      const cur = p.scenes[i];
      if (!cur || BUILT.includes(cur.layout) || !isObj(f.changes)) continue;
      const { layout, ...rest } = f.changes;
      p.scenes[i] = normalizeScene({ ...cur, ...rest, ...(layout && !BUILT.includes(str(layout)) ? { layout } : {}) }, cur.id);
      changes.push({ scene: i + 1, problem: str(f.problem) });
      applied++;
    }
    if (!applied) break;
  }
  return { project: p, changes };
}

const ANIMATE_SYSTEM = (W: number, H: number) => `Bạn là nhà thiết kế chuyển động (motion designer) làm hoạt hình giải thích cho học sinh Việt Nam. Bạn viết mã JavaScript vẽ một cảnh hoạt hình, tự xem ảnh chụp khung hình và sửa đến khi đẹp, chuẩn.

<contract>
- Mã chạy trong một trang có sẵn <div id="stage"> kích thước ${W}×${H}px. Tạo toàn bộ DOM / SVG / canvas một lần khi chạy.
- Bắt buộc định nghĩa window.seek = function (t, d) { … } — t là giây tính từ đầu cảnh (0 → d), d là độ dài cảnh. Mọi thuộc tính hình ảnh phải được tính lại từ t trong seek: cùng t luôn ra đúng một hình.
- Cấm: setTimeout, setInterval, requestAnimationFrame, Date, performance.now, CSS transition / animation / @keyframes, Math.random (cần ngẫu nhiên thì tự viết PRNG có seed), fetch, ảnh hay font từ URL ngoài.
- Có sẵn window.THEME = { bg, ink, muted, accent, accent2, accent3, card, line, font_head, font_body } (màu và font của giao diện đang dùng) và các font "Be Vietnam Pro", "Nunito", "Patrick Hand", "Lora" (đủ dấu tiếng Việt). Tự tô nền toàn khung bằng THEME.bg hoặc gradient từ nó.
- Có sẵn bộ công cụ window.MH, nên dùng thay vì tự viết lại:
  MH.svg(tag, attrs, parent?) / MH.el(tag, attrs, parent?) tạo phần tử (attrs.text = chữ, attrs.style = object; parent mặc định #stage);
  MH.prog(t, a, b) tiến độ 0→1 giữa hai mốc; MH.ease.out / in / inOut / back; MH.spring(t) lò xo; MH.lerp; MH.clamp;
  MH.show(el, p, { y, x, scale }) hiện dần phần tử HTML/SVG; MH.draw(path, p) vẽ dần nét; MH.plot(fn, { x0, x1, y0, y1, left, top, width, height }) trả về chuỗi d của đồ thị hàm số;
  MH.typeText(chuỗi, p) gõ chữ dần; MH.tex(el, latex) hiển thị công thức bằng KaTeX; MH.rng(seed) ngẫu nhiên có seed.
</contract>

<design>
- Đúng kiến thức khoa học là trên hết. Chữ tiếng Việt đúng dấu.
- Tiêu đề cảnh hiện rõ phía trên (≥ 64px) trừ khi chính hoạt hình là tiêu đề. Mọi chữ cần đọc ≥ 40px; chừa lề an toàn 80px.
- Mỗi lúc chỉ một điểm nhấn; màu accent dùng cho đúng thứ quan trọng.
- Dùng hết khung hình: đối tượng chính chiếm khoảng 40–70% chiều rộng hoặc chiều cao, nét vẽ dày (≥ 4px), không để những mảng trống lớn; khung hình đầu tiên (t ≈ 0.3 s) đã phải có hình chứ không chỉ có tiêu đề.
- Trông như đồ hoạ sách giáo khoa / kênh khoa học chuyên nghiệp: bo góc, bóng đổ nhẹ, gradient tinh tế, nhãn rõ ràng — không phải sơ đồ phác thảo.
- Chuyển động: vào bằng ease-out (kiểu 1 − (1 − p)^4) hoặc lò xo hơi nảy, 0.6–1.0 s; lệch nhịp 0.08–0.25 s giữa các phần tử; không dùng tuyến tính cho thứ bắt đầu / dừng lại; vật đứng yên thì "thở" nhẹ.
- Diễn biến theo đúng thứ tự trong yêu cầu: mỗi phần hiện ra lần lượt, có nhịp rõ ràng. Trạng thái cuối phải giữ yên, đọc rõ ít nhất 1.5 s.
- Ưu tiên SVG cho sơ đồ, mũi tên, chu trình, phân tử; canvas cho hạt, sóng, mô phỏng.
</design>

<process>
1. Nghĩ ngắn gọn bố cục và các nhịp thời gian.
2. Gọi ve_thu với toàn bộ mã và 4–6 thời điểm trải đều, có cả thời điểm cuối.
3. Soát ảnh thật khắt khe: chữ tràn / chồng / bị cắt, khung trống, sai kiến thức, thiếu dấu, lỗi JavaScript được báo.
4. Sửa rồi gọi ve_thu lại. Khi ảnh đã đẹp và đúng, gọi hoan_tat với mã cuối cùng. Tối đa 4 lần ve_thu.
</process>`;

const SIM_SYSTEM = (W: number, H: number) => `Bạn là kỹ sư mô phỏng giáo dục, làm thí nghiệm mô phỏng tương tác cho giờ học THPT Việt Nam. Bạn viết mã JavaScript mô phỏng đúng quy luật khoa học, tự xem ảnh chụp và sửa đến khi đúng, đẹp. Khi trình chiếu, mô phỏng chạy liên tục và giáo viên kéo thanh trượt để thay đổi đại lượng cho học sinh quan sát.

<contract>
- Mã chạy trong một trang có sẵn <div id="stage"> kích thước ${W}×${H}px. Gọi đúng một lần:
  MH.sim({
    params: [{ key: "T", label: "Nhiệt độ", unit: "K", min: 100, max: 600, step: 10, value: 300 }],
    setup(p, rand) { /* tạo toàn bộ DOM / SVG / canvas trong #stage, trả về đối tượng trạng thái */ },
    step(s, dt, p, rand) { /* tiến trạng thái thêm dt giây; dt luôn bằng 1/60 */ },
    draw(s, p, t) { /* cập nhật hình theo trạng thái; t là số giây đã mô phỏng */ },
  });
- params: 1–3 đại lượng giáo viên điều chỉnh khi trình chiếu (label tiếng Việt ngắn, unit, min, max, step, value mặc định). p là object key → giá trị hiện tại. Đặt reset: true cho đại lượng mà đổi giá trị phải dựng lại từ đầu (vd. số hạt); đại lượng khác phải có tác dụng ngay trong step / draw.
- Bộ khung tự chạy vòng lặp, tự gọi lại setup khi bấm "Làm lại", và tự vẽ thanh điều khiển (nút Chạy/Dừng, Làm lại, các thanh trượt kèm giá trị) ở dải 150px dưới cùng: không vẽ gì quan trọng trong dải đó.
- Ngẫu nhiên chỉ dùng rand() được truyền vào (có seed: chạy lại ra giống hệt). Cấm: Math.random, setTimeout, setInterval, requestAnimationFrame, Date, performance.now, CSS transition / animation / @keyframes, fetch, ảnh hay font từ URL ngoài.
- step phải ổn định với dt = 1/60 và nhẹ (khoảng ≤ 1 ms mỗi bước): khi xem lại có thể phải tua nhanh hàng nghìn bước. Nhiều hạt thì vẽ bằng canvas; draw chỉ cập nhật, không tạo phần tử mới mỗi lần.
- Có sẵn window.THEME = { bg, ink, muted, accent, accent2, accent3, card, line, font_head, font_body } (màu và font của giao diện đang dùng) và các font "Be Vietnam Pro", "Nunito", "Patrick Hand", "Lora" (đủ dấu tiếng Việt). Tự tô nền toàn khung bằng THEME.bg hoặc gradient từ nó.
- Có sẵn MH.svg(tag, attrs, parent?) / MH.el(tag, attrs, parent?) tạo phần tử (attrs.text = chữ, attrs.style = object; parent mặc định #stage), MH.clamp, MH.lerp, MH.tex(el, latex) hiển thị công thức.
</contract>

<design>
- Đúng khoa học là trên hết: cơ chế, tỉ lệ, chiều tác động đúng; đổi đại lượng thì hiện tượng đổi đúng chiều (vd. nhiệt độ tăng → hạt chuyển động mạnh hơn).
- Tiêu đề phía trên (≥ 60px) và một dòng ngắn nói điều cần quan sát; mọi nhãn ≥ 32px; số đo (nếu có) cập nhật theo thời gian.
- Hiện tượng chiếm phần lớn khung và rõ ngay từ giây đầu; trông như phòng thí nghiệm ảo chuyên nghiệp, màu theo THEME.
- Khi giúp hiểu bản chất, vẽ thêm vết đường đi hoặc đồ thị nhỏ cập nhật theo thời gian.
</design>

<process>
1. Nghĩ ngắn gọn mô hình khoa học và cách vẽ.
2. Gọi ve_thu với toàn bộ mã, seconds (độ dài xem trước, 8–15) và 4–6 thời điểm; ít nhất một lần thử params ở giá trị cực trị để chắc đại lượng có tác dụng đúng.
3. Soát ảnh thật khắt khe: sai khoa học, chữ tràn / chồng / thiếu dấu, hình lấn vào dải điều khiển, lỗi JavaScript được báo.
4. Sửa rồi gọi ve_thu lại. Khi ảnh đã đúng và đẹp, gọi hoan_tat với mã cuối cùng. Tối đa 4 lần ve_thu.
</process>`;

const codeTools = (sim: boolean) => [
  {
    name: "ve_thu",
    description: `Chạy thử mã ${sim ? "mô phỏng" : "hoạt hình"} và nhận lại ảnh chụp ở các thời điểm yêu cầu, kèm lỗi JavaScript nếu có.`,
    input_schema: obj({
      code: { type: "string", description: "Toàn bộ mã JavaScript của cảnh" },
      seconds: { type: "number", description: sim ? "Độ dài bản xem trước (giây), 8–15" : "Độ dài cảnh (giây), 6–20" },
      times: arr({ type: "number" }),
      ...(sim ? { params: { type: "object", description: "Giá trị đại lượng dùng cho lần chụp này (key → số); bỏ trống = giá trị mặc định", additionalProperties: { type: "number" } } } : {}),
    }, ["code", "seconds", "times"]),
  },
  {
    name: "hoan_tat",
    description: "Nộp mã cuối cùng khi khung hình đã đẹp và đúng.",
    input_schema: obj({ code: STR, seconds: { type: "number" }, summary: { type: "string", description: `1 câu mô tả ${sim ? "mô phỏng" : "hoạt hình"}` } }, ["code", "seconds", "summary"]),
  },
];

/**
 * Vòng lặp agent cho cảnh code (layout custom = hoạt hình, sim = mô phỏng):
 * mô hình viết code, gọi ve_thu để xem các khung hình do camera dựng,
 * sửa lỗi, và kết thúc bằng hoan_tat.
 */
export async function animateScene(auth: AIAuth, project: Project, index: number, request: string, camera: (p: Project) => Promise<Camera & { close(): Promise<void> }>, progress: (p: Progress) => void): Promise<Scene> {
  const scene = project.scenes[index];
  if (!scene) throw new AIError("Không tìm thấy cảnh.", 400);
  const sim = scene.layout === "sim";
  const what = sim ? "mô phỏng" : "hoạt hình";
  const [W, H] = [1920, 1080];
  const brief = `${projectContext(project)}

<scene number="${index + 1}">
<title>${scene.title}</title>
<want>${request || scene.custom_prompt || scene.title}</want>
<length>${sim ? "xem trước 8–15 giây; khi trình chiếu mô phỏng chạy liên tục" : "tự chọn 8–12 giây"}</length>
</scene>

Dựng ${what} cho cảnh này rồi tự soát bằng ve_thu.`;
  const system = `${sim ? SIM_SYSTEM(W, H) : ANIMATE_SYSTEM(W, H)}\n\n${subjectGuide(project.subject)}`;
  const tools = codeTools(sim);
  const messages: Message[] = [{ role: "user", content: [{ type: "text", text: brief }] }];
  let last: { code: string; seconds: number } | null = null;
  const tryScene = (code: string, seconds: number): Scene => ({ ...scene, layout: sim ? "sim" : "custom", code, seconds, custom_prompt: request || scene.custom_prompt });

  for (let turn = 1, previews = 0; turn <= 8; turn++) {
    progress({ message: previews ? `AI đang sửa lại ${what} (lần ${previews + 1})…` : `AI đang viết mã ${what}…`, frames: [] });
    const r = await call(auth, system, messages, { tools, tool_choice: { type: "auto" } }, 24000);
    messages.push({ role: "assistant", content: r.content });
    const uses = r.content.filter(isToolUse);
    const done = uses.find((u) => u.name === "hoan_tat");
    if (done && isObj(done.input) && str(done.input.code)) return normalizeScene(tryScene(str(done.input.code), Number(done.input.seconds) || last?.seconds || 8), scene.id);
    if (!uses.length) {
      if (last) return normalizeScene(tryScene(last.code, last.seconds), scene.id);
      messages.push({ role: "user", content: [{ type: "text", text: `Hãy gọi công cụ ve_thu với mã ${what}.` }] });
      continue;
    }
    const results: Block[] = [];
    for (const u of uses) {
      const inp = isObj(u.input) ? u.input : {};
      if (u.name !== "ve_thu" || !str(inp.code)) { results.push({ type: "tool_result", tool_use_id: u.id, content: "Công cụ không hợp lệ." }); continue; }
      previews++;
      const seconds = Math.min(30, Math.max(3, Number(inp.seconds) || 8));
      last = { code: str(inp.code), seconds };
      const times = (Array.isArray(inp.times) ? inp.times.map(Number).filter((x) => x >= 0) : []).slice(0, 6);
      if (!times.length) times.push(0.5, seconds / 2, seconds - 0.2);
      // giá trị tham số cần thử chỉ được chèn cho lần xem trước này, không bao giờ lưu cùng code
      const override = sim && isObj(inp.params) ? Object.fromEntries(Object.entries(inp.params).filter(([, v]) => Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)])) : {};
      const previewCode = Object.keys(override).length ? `window.SIM_OVERRIDE=${JSON.stringify(override)};\n${last.code}` : last.code;
      progress({ message: `Đang chụp ${times.length} khung hình để AI tự soát (lần ${previews})…`, frames: [] });
      const cam = await camera({ ...project, scenes: [tryScene(previewCode, seconds)] });
      const shots: Buffer[] = [];
      let errors: string[] = [];
      try {
        for (const t of times) shots.push(await cam.at(0, t));
        errors = await cam.errors();
      } finally { await cam.close(); }
      progress({ message: `AI đang soát khung hình (lần ${previews})…`, frames: shots });
      const parts: Block[] = [];
      shots.forEach((img, k) => parts.push({ type: "text", text: `t = ${times[k]}s` }, jpeg(img)));
      parts.push({ type: "text", text: errors.length ? `Lỗi JavaScript:\n${[...new Set(errors)].slice(0, 5).join("\n")}` : "Không có lỗi JavaScript." });
      parts.push({ type: "text", text: sim
        ? "Tự chấm từng ảnh: hiện tượng có đúng khoa học, có đủ rõ và lớn, đại lượng có tác dụng đúng chiều, chữ có tràn / chồng / thiếu dấu, hình có lấn vào dải điều khiển dưới cùng không? Còn lỗi thì sửa và ve_thu lại; ổn hết thì hoan_tat."
        : "Tự chấm từng ảnh: đối tượng có đủ lớn, khung có bị trống, chữ có tràn / chồng / thiếu dấu, kiến thức có đúng, nhịp có rõ ràng, trạng thái cuối có rõ ràng không? Còn lỗi thì sửa và ve_thu lại; ổn hết thì hoan_tat." });
      if (previews >= 4) parts.push({ type: "text", text: "Đã hết lượt xem thử: sửa nốt nếu cần rồi gọi hoan_tat ngay." });
      results.push({ type: "tool_result", tool_use_id: u.id, content: parts });
    }
    // chỉ giữ các ảnh chụp mới nhất trong hội thoại để giới hạn kích thước
    for (const m of messages) for (const b of m.content) if (b.type === "tool_result" && "content" in b && Array.isArray(b.content)) b.content = b.content.filter((x) => x.type !== "image");
    messages.push({ role: "user", content: results });
  }
  if (last) return normalizeScene(tryScene(last.code, last.seconds), scene.id);
  throw new AIError(`AI chưa dựng xong ${what}, bấm thử lại.`, 502);
}

/** Hình minh hoạ giáo dục do mô hình vẽ bằng code SVG. */
export async function illustrate(auth: AIAuth, prompt: string): Promise<string> {
  const [w, h] = [1600, 900];
  const system = `Bạn là họa sĩ minh hoạ sách giáo khoa, vẽ bằng mã SVG.
<requirements>
- Một phần tử <svg> duy nhất, xmlns="http://www.w3.org/2000/svg", viewBox="0 0 ${w} ${h}".
- Phong cách phẳng, rõ ràng, màu hài hoà, nền đơn giản; hình đúng kiến thức khoa học.
- Chỉ dùng hình khối, đường, gradient. Nếu cần nhãn thì tối đa 6 nhãn tiếng Việt rất ngắn, cỡ chữ ≥ 36, font-family="sans-serif".
- Không dùng <script>, <foreignObject>, ảnh ngoài, liên kết hay thuộc tính sự kiện.
</requirements>`;
  const out = await structured(auth, system, [{ type: "text", text: `<subject>${prompt}</subject>\n\nVẽ hình minh hoạ cho nội dung trên.` }], {
    name: "ghi_hinh", description: "Ghi mã SVG của hình.", schema: obj({ svg: STR }, ["svg"]),
  }, 16000);
  const svg = isObj(out) ? cleanSvg(str(out.svg)) : "";
  if (!svg) throw new AIError("AI chưa vẽ được hình này, thử mô tả khác.", 502);
  return svg;
}

/** Chỉ giữ hình vẽ tĩnh: không script, handler, tài liệu nhúng hay tham chiếu ngoài. */
function cleanSvg(raw: string): string {
  const m = raw.match(/<svg[\s\S]*<\/svg>/i);
  if (!m) return "";
  return m[0]
    .replace(/<(script|foreignObject|iframe|object|embed)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|foreignObject|iframe|object|embed)[^>]*\/>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/\s(xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, "");
}

/** Cảnh gửi cho mô hình: không có id, đường dẫn ảnh/video đã tải lên, hay code. */
function forAI(s: Scene) {
  const { id: _id, image_url: _img, video_url: _video, code: _code, ...rest } = s;
  return rest;
}

const strArr = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : undefined);

const pick = <T extends string | number>(v: unknown, ok: readonly T[]) => (ok.includes(v as T) ? (v as T) : undefined);
function normalizeLook(raw: unknown): Look | undefined {
  if (!isObj(raw)) return undefined;
  const look: Look = {
    text_size: pick(raw.text_size, ["small", "normal", "large"] as const),
    image_size: pick(raw.image_size, ["small", "medium", "large", "full"] as const),
    image_fit: pick(raw.image_fit, ["contain", "cover"] as const),
    image_side: pick(raw.image_side, ["left", "right"] as const),
    columns: pick(Number(raw.columns), [1, 2] as const),
  };
  for (const k of Object.keys(look) as (keyof Look)[]) if (look[k] === undefined) delete look[k];
  return Object.keys(look).length ? look : undefined;
}

/** Kiểm tra dữ liệu cảnh từ mô hình/người dùng thành Scene; trường lạ bị bỏ. */
export function normalizeScene(raw: unknown, id?: string): Scene {
  const r = isObj(raw) ? raw : {};
  const s: Scene = {
    id: id || str(r.id) || crypto.randomUUID().slice(0, 8),
    layout: ALL_LAYOUTS.includes(str(r.layout)) ? str(r.layout) : "bullets",
    title: str(r.title).trim(),
  };
  for (const k of ["icon", "subtitle", "left_heading", "right_heading", "value", "unit", "label", "quote_text", "quote_author", "latex", "explain", "question", "caption", "image_url", "image_prompt", "notes", "custom_prompt"] as const) {
    if (r[k] != null && r[k] !== "") s[k] = str(r[k]);
  }
  if (Array.isArray(r.items)) {
    s.items = r.items.filter(isObj).filter((it) => it.text).map((it): Item => (it.detail ? { text: str(it.text), detail: str(it.detail) } : { text: str(it.text) }));
  }
  s.left_items = strArr(r.left_items);
  s.table_headers = strArr(r.table_headers)?.slice(0, 5);
  if (Array.isArray(r.table_rows)) s.table_rows = r.table_rows.filter(Array.isArray).slice(0, 8).map((row) => row.map(str).slice(0, 5));
  s.right_items = strArr(r.right_items);
  s.options = strArr(r.options)?.slice(0, 6);
  if (Array.isArray(r.bars)) s.bars = r.bars.filter(isObj).map((b) => ({ label: str(b.label), value: Number(b.value) || 0 }));
  if (typeof r.illustrative === "boolean") s.illustrative = r.illustrative;
  if (typeof r.code === "string" && r.code.length < 300_000) s.code = r.code;
  // video: tệp MP4 đã tải lên, hoặc link YouTube giữ ở dạng chuẩn
  const video = str(r.video_url).trim(), yt = youtubeId(video);
  if (/^\/uploads\/[\w-]+\.mp4$/.test(video)) s.video_url = video;
  else if (yt) s.video_url = `https://www.youtube.com/watch?v=${yt}`;
  const look = normalizeLook(r.look);
  if (look) s.look = look;
  if (Number(r.seconds) > 0) s.seconds = Math.min(60, Number(r.seconds));
  if (s.layout === "quiz") {
    const a = Number(r.answer_index);
    s.answer_index = Number.isInteger(a) && a >= 0 && a < (s.options?.length ?? 0) ? a : 0;
  }
  for (const k of Object.keys(s) as (keyof Scene)[]) if (s[k] === undefined) delete s[k];
  return s;
}
