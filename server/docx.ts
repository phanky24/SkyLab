// Tệp Word đính kèm cho mô hình: .docx được đọc trực tiếp (chữ, tiêu đề,
// bảng, chữ của phương trình và hình nhúng); .doc đời cũ chỉ đọc được khi
// có textutil của macOS để chuyển đổi.
import JSZip from "jszip";
import { AIError } from "./ai";

export const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const DOC = "application/msword";

type Block = { type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const MAX_TEXT = 60_000, MAX_IMAGES = 8, MAX_IMAGE_BYTES = 3_500_000;

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

// Phương trình Word (OMML) thành chữ toán thường: luỹ thừa, chỉ số, phân số và căn
const MATH: [RegExp, string][] = [
  [/<m:sup>/g, "^("], [/<\/m:sup>/g, ")"], [/<m:sub>/g, "_("], [/<\/m:sub>/g, ")"],
  [/<m:num>/g, "("], [/<\/m:num>/g, ")/"], [/<m:den>/g, "("], [/<\/m:den>/g, ")"],
  [/<m:rad>/g, "√("], [/<\/m:rad>/g, ")"],
];

/** Chữ của một đoạn: các run, run phương trình, tab và ngắt dòng. */
function paraText(xml: string): string {
  for (const [re, t] of MATH) xml = xml.replace(re, `<m:t>${t}</m:t>`);
  let out = "";
  for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<m:t(?:\s[^>]*)?>([^<]*)<\/m:t>|<w:tab\/>|<w:br[^>]*\/>/g)) {
    if (m[1] != null || m[2] != null) out += unescape(m[1] ?? m[2]);
    else out += m[0].startsWith("<w:tab") ? "\t" : "\n";
  }
  // tiêu đề giữ cấp để mô hình thấy được dàn ý của tài liệu
  const style = xml.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? "";
  const level = style === "Title" ? 1 : Number(style.match(/^heading\s?(\d)$/i)?.[1]) || 0;
  return level && out.trim() ? `${"#".repeat(level)} ${out.trim()}` : out;
}

function tableText(xml: string): string {
  return [...xml.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)]
    .map((row) => [...row[0].matchAll(/<w:tc[ >][\s\S]*?<\/w:tc>/g)]
      .map((cell) => [...cell[0].matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) => paraText(p[0]).trim()).filter(Boolean).join(" "))
      .join(" | "))
    .map((r) => `| ${r} |`).join("\n");
}

async function docxBlocks(name: string, data: Buffer): Promise<Block[]> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(data); } catch { throw new AIError(`Không đọc được tệp Word “${name}”. Hãy mở bằng Word và lưu lại dạng .docx.`, 415); }
  const doc = await zip.file("word/document.xml")?.async("string");
  if (!doc) throw new AIError(`Tệp “${name}” không phải tệp Word hợp lệ.`, 415);
  const body = doc.slice(doc.indexOf("<w:body"));
  const parts: string[] = [];
  for (const m of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g)) {
    parts.push(m[0].startsWith("<w:tbl") ? tableText(m[0]) : paraText(m[0]));
  }
  const text = parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const blocks: Block[] = [{ type: "text", text: `<file name="${name}">\n${text.slice(0, MAX_TEXT)}${text.length > MAX_TEXT ? "\n[…phần sau bị lược bớt vì tài liệu quá dài]" : ""}\n</file>` }];
  // hình theo thứ tự Word lưu; hình vẽ dạng khác (EMF/WMF) bị bỏ qua
  const media = Object.keys(zip.files).filter((f) => /^word\/media\//.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  let added = 0;
  for (const f of media) {
    const type = IMAGE_TYPES[f.split(".").pop()!.toLowerCase()];
    if (!type || added >= MAX_IMAGES) continue;
    const bytes = await zip.file(f)!.async("nodebuffer");
    if (bytes.length > MAX_IMAGE_BYTES) continue;
    blocks.push({ type: "image", source: { type: "base64", media_type: type, data: bytes.toString("base64") } });
    added++;
  }
  if (added) blocks.splice(1, 0, { type: "text", text: `Các hình dưới đây nằm trong tệp “${name}”, theo thứ tự xuất hiện:` });
  return blocks;
}

/** Tệp .doc nhị phân đời cũ: macOS có sẵn textutil; nơi khác thì yêu cầu .docx. */
async function docBlocks(name: string, data: Buffer): Promise<Block[]> {
  const dir = await Bun.$`mktemp -d`.text().catch(() => "");
  const tmp = dir.trim();
  try {
    if (!tmp || !Bun.which("textutil")) throw new Error();
    const src = `${tmp}/in.doc`;
    await Bun.write(src, data);
    const text = (await Bun.$`textutil -convert txt -stdout ${src}`.quiet().text()).trim();
    if (!text) throw new Error();
    return [{ type: "text", text: `<file name="${name}">\n${text.slice(0, MAX_TEXT)}\n</file>` }];
  } catch {
    throw new AIError(`Chưa đọc được tệp Word đời cũ “${name}” (.doc). Hãy mở bằng Word, chọn Lưu thành… dạng .docx rồi đính kèm lại.`, 415);
  } finally {
    if (tmp) await Bun.$`rm -rf ${tmp}`.quiet().nothrow();
  }
}

export function wordBlocks(name: string, mime: string, base64: string): Promise<Block[]> {
  const data = Buffer.from(base64, "base64");
  return mime === DOC ? docBlocks(name, data) : docxBlocks(name, data);
}
