// Phông chữ cho bản PowerPoint: đúng các phông web đang dùng (public/engine/fonts.css),
// chọn mặt chữ theo độ đậm giống trình duyệt, rồi nhúng tệp TTF vào .pptx để máy
// không cài phông vẫn hiện đúng. Web dùng bản woff2 chia nhỏ của @fontsource (nhẹ cho
// trình duyệt và bản HTML offline); PowerPoint cần tệp TTF đầy đủ nên lấy từ @expo-google-fonts.
import { join } from "node:path";
import type JSZip from "jszip";
import { ROOT } from "./store";

/** Một mặt chữ PowerPoint: tên typeface (tên họ cũ trong bảng name của TTF) và tệp của nó. */
export interface Face { weight: number; typeface: string; slot: "regular" | "bold"; file: string }

const pkg = (name: string, dir: string, file: string) => join(ROOT, "node_modules/@expo-google-fonts", name, dir, file);

// Chỉ liệt kê các độ đậm mà fonts.css nạp cho web, để PowerPoint chọn mặt chữ giống hệt trình duyệt.
const FAMILIES: Record<string, Face[]> = {
  "Be Vietnam Pro": [
    { weight: 400, typeface: "Be Vietnam Pro", slot: "regular", file: pkg("be-vietnam-pro", "400Regular", "BeVietnamPro_400Regular.ttf") },
    { weight: 500, typeface: "Be Vietnam Pro Medium", slot: "regular", file: pkg("be-vietnam-pro", "500Medium", "BeVietnamPro_500Medium.ttf") },
    { weight: 600, typeface: "Be Vietnam Pro SemiBold", slot: "regular", file: pkg("be-vietnam-pro", "600SemiBold", "BeVietnamPro_600SemiBold.ttf") },
    { weight: 700, typeface: "Be Vietnam Pro", slot: "bold", file: pkg("be-vietnam-pro", "700Bold", "BeVietnamPro_700Bold.ttf") },
    { weight: 800, typeface: "Be Vietnam Pro ExtraBold", slot: "regular", file: pkg("be-vietnam-pro", "800ExtraBold", "BeVietnamPro_800ExtraBold.ttf") },
    { weight: 900, typeface: "Be Vietnam Pro Black", slot: "regular", file: pkg("be-vietnam-pro", "900Black", "BeVietnamPro_900Black.ttf") },
  ],
  Nunito: [
    { weight: 400, typeface: "Nunito", slot: "regular", file: pkg("nunito", "400Regular", "Nunito_400Regular.ttf") },
    { weight: 600, typeface: "Nunito SemiBold", slot: "regular", file: pkg("nunito", "600SemiBold", "Nunito_600SemiBold.ttf") },
    { weight: 700, typeface: "Nunito", slot: "bold", file: pkg("nunito", "700Bold", "Nunito_700Bold.ttf") },
    { weight: 800, typeface: "Nunito ExtraBold", slot: "regular", file: pkg("nunito", "800ExtraBold", "Nunito_800ExtraBold.ttf") },
    { weight: 900, typeface: "Nunito Black", slot: "regular", file: pkg("nunito", "900Black", "Nunito_900Black.ttf") },
  ],
  "Patrick Hand": [
    { weight: 400, typeface: "Patrick Hand", slot: "regular", file: pkg("patrick-hand", "400Regular", "PatrickHand_400Regular.ttf") },
  ],
  Lora: [
    { weight: 500, typeface: "Lora Medium", slot: "regular", file: pkg("lora", "500Medium", "Lora_500Medium.ttf") },
  ],
};

/**
 * Mặt chữ trình duyệt sẽ dùng cho `family` ở độ đậm `weight` (quy tắc chọn độ đậm của CSS),
 * kèm cờ bold khi trình duyệt phải tự làm đậm (xin ≥ 600 mà mặt chữ có sẵn nhẹ hơn nhiều).
 * Họ phông không có trong danh sách thì giữ tên và để PowerPoint tự in đậm.
 */
export function pickFace(family: string, weight: number): { typeface: string; bold: boolean; face?: Face } {
  const faces = FAMILIES[family];
  if (!faces) return { typeface: family, bold: weight >= 600 };
  const up = faces.filter((f) => f.weight >= weight).sort((a, b) => a.weight - b.weight);
  const down = faces.filter((f) => f.weight < weight).sort((a, b) => b.weight - a.weight);
  const within500 = faces.filter((f) => f.weight >= weight && f.weight <= 500).sort((a, b) => a.weight - b.weight);
  const face = weight >= 400 && weight <= 500 ? (within500[0] ?? down[0] ?? up[0]) : weight < 400 ? (down[0] ?? up[0]) : (up[0] ?? down[0]);
  const synthetic = weight >= 600 && face.weight < 600;
  return { typeface: face.typeface, bold: face.slot === "bold" || synthetic, face };
}

/** Bọc TTF trong tiêu đề Embedded OpenType (EOT 0x00020001, không nén) — dạng PowerPoint đọc được cho phông nhúng. */
function eot(ttf: Buffer): Buffer {
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0, n = ttf.readUInt16BE(4); i < n; i++) {
    const at = 12 + i * 16;
    tables.set(ttf.toString("latin1", at, at + 4), { offset: ttf.readUInt32BE(at + 8), length: ttf.readUInt32BE(at + 12) });
  }
  const os2 = tables.get("OS/2")!.offset, head = tables.get("head")!.offset, name = tables.get("name")!.offset;
  // chuỗi tiếng Anh (Windows, Unicode BMP, en-US) trong bảng name, đổi sang UTF-16LE
  const nameString = (id: number) => {
    const count = ttf.readUInt16BE(name + 2), strings = name + ttf.readUInt16BE(name + 4);
    for (let i = 0; i < count; i++) {
      const r = name + 6 + i * 12;
      if (ttf.readUInt16BE(r) === 3 && ttf.readUInt16BE(r + 2) === 1 && ttf.readUInt16BE(r + 4) === 0x409 && ttf.readUInt16BE(r + 6) === id) {
        const len = ttf.readUInt16BE(r + 8), off = strings + ttf.readUInt16BE(r + 10);
        return Buffer.from(ttf.subarray(off, off + len)).swap16();
      }
    }
    return Buffer.alloc(0);
  };
  const fixed = Buffer.alloc(80);
  ttf.copy(fixed, 16, os2 + 32, os2 + 42); // PANOSE
  fixed.writeUInt8(1, 26); // DEFAULT_CHARSET
  fixed.writeUInt8(ttf.readUInt16BE(os2 + 62) & 1, 27); // in nghiêng
  fixed.writeUInt32LE(ttf.readUInt16BE(os2 + 4), 28); // độ đậm
  fixed.writeUInt16LE(ttf.readUInt16BE(os2 + 8), 32); // fsType: quyền nhúng
  fixed.writeUInt16LE(0x504c, 34);
  for (let k = 0; k < 4; k++) fixed.writeUInt32LE(ttf.readUInt32BE(os2 + 42 + k * 4), 36 + k * 4); // UnicodeRange1–4
  for (let k = 0; k < 2; k++) fixed.writeUInt32LE(ttf.readUInt32BE(os2 + 78 + k * 4), 52 + k * 4); // CodePageRange1–2
  fixed.writeUInt32LE(ttf.readUInt32BE(head + 8), 60); // checkSumAdjustment
  const parts: Buffer[] = [fixed];
  for (const id of [1, 2, 5, 4]) { // họ, kiểu, phiên bản, tên đầy đủ
    const s = nameString(id), size = Buffer.alloc(4);
    size.writeUInt16LE(s.length, 2);
    parts.push(size, s);
  }
  parts.push(Buffer.alloc(4)); // Padding5 + RootStringSize = 0
  const header = Buffer.concat(parts);
  header.writeUInt32LE(header.length + ttf.length, 0);
  header.writeUInt32LE(ttf.length, 4);
  header.writeUInt32LE(0x00020001, 8);
  return Buffer.concat([header, ttf]);
}

/**
 * Nhúng các mặt chữ đã dùng vào gói .pptx đã sinh: phần ppt/fonts/*.fntdata,
 * quan hệ từ presentation.xml và danh sách <p:embeddedFontLst>.
 */
export async function embedFonts(zip: JSZip, used: Iterable<Face>) {
  const byTypeface = new Map<string, Face[]>();
  for (const f of new Set(used)) byTypeface.set(f.typeface, [...(byTypeface.get(f.typeface) ?? []), f]);
  if (!byTypeface.size) return;
  let rels = await zip.file("ppt/_rels/presentation.xml.rels")!.async("string");
  let n = 0;
  const entries: string[] = [];
  for (const [typeface, faces] of byTypeface) {
    const slots: string[] = [];
    for (const slot of ["regular", "bold"] as const) {
      const f = faces.find((x) => x.slot === slot);
      if (!f) continue;
      const id = `rIdFont${++n}`;
      zip.file(`ppt/fonts/font${n}.fntdata`, eot(Buffer.from(await Bun.file(f.file).arrayBuffer())));
      rels = rels.replace("</Relationships>", `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font${n}.fntdata"/></Relationships>`);
      slots.push(`<p:${slot} r:id="${id}"/>`);
    }
    entries.push(`<p:embeddedFont><p:font typeface="${typeface}" pitchFamily="2" charset="0"/>${slots.join("")}</p:embeddedFont>`);
  }
  zip.file("ppt/_rels/presentation.xml.rels", rels);
  const types = await zip.file("[Content_Types].xml")!.async("string");
  zip.file("[Content_Types].xml", types.replace("<Default Extension=\"xml\"", "<Default Extension=\"fntdata\" ContentType=\"application/x-fontdata\"/><Default Extension=\"xml\""));
  const pres = await zip.file("ppt/presentation.xml")!.async("string");
  zip.file("ppt/presentation.xml", pres
    .replace(/<p:presentation ([^>]*?)saveSubsetFonts="1"/, `<p:presentation $1embedTrueTypeFonts="1" saveSubsetFonts="0"`)
    .replace(/(<p:notesSz [^>]*\/>)/, `$1<p:embeddedFontLst>${entries.join("")}</p:embeddedFontLst>`));
}
