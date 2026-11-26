# SkyLab - Nền tảng tạo bài giảng với AI

<div align="center">
  <h3>📚 Biến ý tưởng bài học thành bài giảng trực quan</h3>
  <p>Hỗ trợ giáo viên xây dựng kịch bản, chỉnh sửa slide, xem trước và xuất bài giảng với sự hỗ trợ của AI.</p>
</div>

---

## 📋 Mục đích dự án

SkyLab là nguyên mẫu website hỗ trợ giáo viên chuẩn bị bài giảng số. Ứng dụng hướng đến việc:

- Tạo bản nháp bài giảng từ chủ đề, môn học, khối lớp và tài liệu tham khảo.
- Giúp giáo viên chỉnh sửa nội dung, thiết kế và luyện tập trước khi giảng dạy.
- Minh họa bài học bằng hình ảnh, hoạt hình hoặc thí nghiệm mô phỏng.
- Xuất bài giảng để trình chiếu hoặc chia sẻ.

---

## 🔄 Luồng hoạt động

### 1. Ý tưởng

```text
Chọn môn và lớp → Nhập chủ đề → Thêm yêu cầu hoặc tài liệu
→ Chọn cách AI hỗ trợ → Tạo bản nháp
```

Người dùng có thể yêu cầu AI viết bản nháp hoặc chỉ đưa gợi ý để tự hoàn thiện nội dung. Tùy chọn nghiên cứu cho phép AI tìm thông tin và nguồn tham khảo.

### 2. Kịch bản

```text
Xem danh sách slide → Chỉnh nội dung và bố cục → Lưu bài giảng
```

Người dùng có thể thêm, xóa hoặc sửa slide; yêu cầu AI viết lại nội dung, thêm cảnh và tạo hình minh họa hoặc mô phỏng.

### 3. Thiết kế và luyện tập

```text
Chọn giao diện → Xem trước → Xem nguồn tham khảo
→ Nhận góp ý từ trợ lý AI
```

### 4. Xuất bản

```text
Kiểm tra bài giảng → Trình chiếu hoặc xuất HTML, PDF, PowerPoint
```

Sau khi xuất, nên kiểm tra lại phông chữ, bố cục và hiệu ứng trong tệp kết quả.

---

## 📁 Cấu trúc dự án

```text
SkyLab/
├── data/
│   ├── projects/             # Bài giảng lưu dưới dạng JSON
│   └── uploads/              # Hình ảnh, video và tệp do ứng dụng tạo
├── docs/
│   └── README.md             # Hướng dẫn tổng quan
├── public/
│   ├── app/                  # Giao diện và trình chỉnh sửa
│   ├── engine/               # Hiển thị, trình chiếu và mô phỏng slide
│   ├── index.html            # Trang ứng dụng
│   ├── print.html            # Trang phục vụ xuất PDF
│   └── snap.html             # Trang phục vụ chụp slide
├── samples/
│   └── chuyen-dong-brown.json # Bài mẫu đi kèm
├── server/
│   ├── index.ts              # Máy chủ và các API
│   ├── ai.ts                 # Tích hợp Claude
│   ├── store.ts              # Lưu và đọc bài giảng
│   ├── export.ts             # Xuất HTML và PDF
│   ├── pptx.ts               # Xuất PowerPoint
│   ├── harness.ts            # Chromium và tác vụ chạy nền
│   ├── docx.ts               # Đọc nội dung tài liệu Word
│   └── fonts.ts, subjects.ts, types.ts
├── package.json              # Thư viện và lệnh chạy
├── bun.lock                  # Thông tin khóa thư viện
└── tsconfig.json             # Cấu hình TypeScript
```

---

## 🚀 Hướng dẫn cài đặt và chạy dự án

### Yêu cầu

- **Bun 1.4 trở lên**.
- **Khóa API Claude** để sử dụng các chức năng AI.
- **FFmpeg** cho các chức năng xử lý video.

### 1. Cài đặt Bun

**macOS** (Terminal):

```bash
curl -fsSL https://bun.com/install | bash
```

Sau khi cài, mở lại Terminal và chạy `bun --version` để kiểm tra.

### 2. Tải và mở dự án

Tải và giải nén dự án, sau đó mở Terminal tại thư mục SkyLab:

```bash
cd /duong-dan/toi/SkyLab
```

Thay đường dẫn bằng vị trí thực tế trên máy của bạn.

### 3. Cài thư viện và Chromium

```bash
bun run setup
```

Lệnh này cài thư viện và Chromium cần cho chức năng xuất bài giảng.

### 4. Chạy ứng dụng

```bash
bun run start
```

Mở **http://localhost:3210** trong trình duyệt. Nhấn `Ctrl + C` trong Terminal để dừng.

### 5. Cấu hình khóa AI

Để sử dụng các chức năng AI:

1. Tạo khóa API tại [Anthropic Console](https://console.anthropic.com/).
2. Mở SkyLab và chọn **Cài đặt AI**.
3. Nhập khóa Claude và chọn mô hình, sau đó bấm **Lưu**.

---

## 🧪 Bài mẫu và dữ liệu

Bài mẫu **Chuyển động Brown** gồm 10 slide, nằm trong `samples/chuyen-dong-brown.json`. Trang chủ có nút **Mở bài mẫu** để xem và chỉnh sửa.

Ứng dụng lưu dự án trong `data/projects/` và tệp tải lên trong `data/uploads/`. Có thể đổi vị trí lưu bằng biến môi trường `SKYLAB_DATA`. Khi mở bài mẫu, ứng dụng dùng bản mẫu đã có trong kho hoặc tạo lại từ tệp mẫu đi kèm.

---

## 🛠️ Công nghệ sử dụng

| Công nghệ | Vai trò |
|---|---|
| Bun | Chạy máy chủ TypeScript và quản lý thư viện |
| HTML, CSS, JavaScript | Xây dựng giao diện và trình chiếu |
| Claude API | Hỗ trợ tạo, sửa và góp ý bài giảng |
| Playwright và Chromium | Chụp, kiểm tra và xuất nội dung slide |
| PptxGenJS và JSZip | Tạo tệp PowerPoint và xử lý tệp ZIP |
| KaTeX | Hiển thị công thức toán học |
| FFmpeg | Xử lý video cho các chức năng liên quan |

---

## 🤖 Tích hợp AI

SkyLab sử dụng Claude cho các chức năng như tạo kịch bản, viết lại hoặc thêm slide, góp ý bài giảng, tạo hình minh họa và hỗ trợ dựng hoạt hình, mô phỏng. Một số tác vụ chạy trong nền và giao diện sẽ hỏi tiến độ trong khi chờ.

---

## 📝 Các API chính

### Bài giảng

- `GET /api/projects`: lấy danh sách bài giảng.
- `POST /api/projects`: tạo bài giảng.
- `POST /api/projects/sample`: mở hoặc tạo bài mẫu.
- `GET /api/projects/:id`: lấy nội dung bài giảng.
- `PUT /api/projects/:id`: cập nhật bài giảng.
- `DELETE /api/projects/:id`: xóa bài giảng.
- `GET /api/projects/:id/export.html`, `.pdf` hoặc `.pptx`: xuất bài giảng.

### AI và tệp

- `POST /api/upload`: tải hình ảnh hoặc video lên.
- `POST /api/ai/storyboard`: tạo kịch bản.
- `POST /api/ai/rewrite`, `/api/ai/add`: viết lại hoặc thêm nội dung.
- `POST /api/ai/coach`, `/api/ai/review`: góp ý hoặc soát bài giảng.
- `POST /api/ai/image`, `/api/ai/animate`: tạo hình hoặc hoạt hình, mô phỏng.
- `GET /api/tasks/:id`: kiểm tra tiến độ tác vụ chạy nền.

---

## 🐛 Một số lỗi thường gặp

### Không sử dụng được AI

- Kiểm tra khóa Claude trong **Cài đặt AI** hoặc biến môi trường trên máy chạy ứng dụng.
- Kiểm tra kết nối Internet và quyền sử dụng mô hình của khóa.

### Cổng 3210 đã được sử dụng

Chạy ứng dụng trên cổng khác:

```bash
PORT=3211 bun run dev
```

### Không xuất được PDF hoặc PowerPoint

- Kiểm tra Chromium đã được cài qua Playwright và các thư viện hệ thống cần thiết đã có trên máy.
- Với nội dung video, kiểm tra FFmpeg đã được cài.
- Xem thông báo lỗi của ứng dụng và nhật ký máy chủ để xác định nguyên nhân.

## 📚 Tài liệu thêm

- [Tài liệu Bun](https://bun.com/docs)
- [Tài liệu Playwright](https://playwright.dev/docs/intro)
- [Tài liệu PptxGenJS](https://gitbrent.github.io/PptxGenJS/)
- [Tài liệu KaTeX](https://katex.org/docs/)
