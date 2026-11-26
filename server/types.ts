export interface Item { text: string; detail?: string }
export interface Bar { label: string; value: number }
export interface Source { title: string; url: string }

/** Cách hiển thị mà một cảnh có thể tự chọn; bỏ trống thì dùng mặc định của bố cục. */
export interface Look {
  text_size?: "small" | "normal" | "large";
  image_size?: "small" | "medium" | "large" | "full";
  image_fit?: "contain" | "cover";
  image_side?: "left" | "right";
  columns?: 1 | 2;
}

export interface Scene {
  id: string;
  layout: string;
  title: string;
  icon?: string;
  subtitle?: string;
  items?: Item[];
  left_heading?: string;
  left_items?: string[];
  right_heading?: string;
  right_items?: string[];
  value?: string;
  unit?: string;
  label?: string;
  bars?: Bar[];
  illustrative?: boolean;
  quote_text?: string;
  quote_author?: string;
  latex?: string;
  explain?: string;
  question?: string;
  options?: string[];
  answer_index?: number;
  table_headers?: string[];
  table_rows?: string[][];
  caption?: string;
  image_url?: string;
  image_prompt?: string;
  notes?: string;
  /** bố cục custom / sim: mã hoạt hình hoặc mô phỏng do AI viết, mô tả điều cần thể hiện, độ dài bản xem trước */
  code?: string;
  custom_prompt?: string;
  seconds?: number;
  /** bố cục video: tệp /uploads/*.mp4 đã tải lên hoặc link YouTube (ảnh bìa nằm ở image_url) */
  video_url?: string;
  look?: Look;
}

export interface Project {
  id: string;
  title: string;
  subject?: string;
  grade?: string;
  theme: string;
  assist: string;
  sources: Source[];
  scenes: Scene[];
  /** Bản sao của bài mẫu đi kèm; không tính vào thống kê ở trang tổng quan. */
  sample?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

// Các biến toàn cục mà trang chạy không giao diện để lộ ra (public/print.html, public/snap.html).
declare global {
  interface Window {
    __PRINT_READY?: boolean; __SNAP_READY?: boolean; __errors?: string[];
    __load?(project: unknown): Promise<void>; __rest?(i: number): Promise<void>; __at?(i: number, t: number, rest?: boolean): Promise<void>;
    __timing?(i: number): { duration: number; holds: number[] };
  }
}
