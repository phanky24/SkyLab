/** Danh sách môn học kèm ví dụ, lấy từ /api/config khi khởi động. */
export const SUBJECTS = [];
export const subjectInfo = (name) => SUBJECTS.find((s) => s.name === name) ?? SUBJECTS[SUBJECTS.length - 1] ?? { name: "Khác", topics: [], animations: [], figure: "" };
export const GRADES = ["10", "11", "12", "6", "7", "8", "9"];

export const MODELS = [
  { id: "", name: "Mặc định — Claude Opus 5.5 (viết kỹ nhất)" },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5 — nhanh hơn, rẻ hơn" },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5 — nhanh nhất" },
];

export const QUICK_FIXES = [
  "Ngắn gọn hơn",
  "Dễ hiểu hơn cho học sinh",
  "Thêm ví dụ thực tế ở Việt Nam",
  "Chọn bố cục trực quan hơn",
];

// nhãn trường theo bố cục (các dòng mục)
export const ITEM_LABELS = {
  bullets: ["Ý chính", "Giải thích thêm (không bắt buộc)"],
  steps: ["Tên bước", "Mô tả bước"],
  timeline: ["Mốc (năm, giai đoạn)", "Sự kiện"],
  cycle: ["Khâu", "Mô tả ngắn"],
  image: ["Ý chính", "Giải thích thêm"],
};
