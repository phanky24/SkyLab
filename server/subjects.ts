// Kiến thức riêng từng môn dùng để định hướng mọi prompt (kịch bản, viết lại, hoạt hình)
// và các ví dụ hiển thị trên giao diện. "Khác" là môn dự phòng cho mọi môn còn lại.

interface Subject {
  name: string;
  /** Tư liệu tốt của môn này trông thế nào: bố cục, kí hiệu, hình ảnh, lỗi hay gặp. */
  guide: string;
  topics: string[];
  animations: string[];
  figure: string;
}

const SUBJECTS: Subject[] = [
  {
    name: "Toán",
    guide: "Ưu tiên formula (LaTeX chuẩn), steps cho lời giải từng bước, chart cho số liệu thống kê, quiz có bài tập vận dụng. Mỗi công thức kèm điều kiện xác định và một ví dụ số cụ thể. Hoạt hình hợp nhất: vẽ đồ thị, biến đổi hình học, minh hoạ trực quan một định lí.",
    topics: ["Phương trình bậc hai và công thức nghiệm", "Hàm số bậc hai và đồ thị parabol", "Định lí Py-ta-go và ứng dụng", "Xác suất của biến cố"],
    animations: ["Vẽ dần đồ thị y = x² − 4x + 3, đánh dấu đỉnh và hai nghiệm trên trục hoành", "Ghép bốn tam giác vuông thành hình vuông để chứng minh định lí Py-ta-go"],
    figure: "Hình học: tam giác vuông với các cạnh a, b, c được tô màu khác nhau",
  },
  {
    name: "Vật lí",
    guide: "Đại lượng luôn kèm đơn vị SI; công thức dùng formula; thí nghiệm dùng steps; kết quả đo dùng chart hoặc table. Hoạt hình hợp nhất: chuyển động, lực và vectơ, sóng, mạch điện, quang học — vectơ vẽ đúng hướng, đúng tỉ lệ tương đối.",
    topics: ["Định luật II Newton", "Sóng cơ và sự truyền sóng", "Định luật Ôm cho toàn mạch", "Khúc xạ ánh sáng"],
    animations: ["Sóng ngang truyền trên sợi dây, đánh dấu bước sóng và biên độ", "Tia sáng đi từ không khí vào nước bị khúc xạ, hiện góc tới và góc khúc xạ"],
    figure: "Sơ đồ mạch điện gồm nguồn, điện trở và ampe kế mắc nối tiếp",
  },
  {
    name: "Hoá học",
    guide: "Công thức hoá học viết đúng chỉ số (H₂O, CO₂ trong chữ; \\mathrm{} trong latex); phương trình phải cân bằng và ghi điều kiện phản ứng; tính chất dùng table; quy trình dùng steps. Nhắc an toàn phòng thí nghiệm khi có thí nghiệm. Hoạt hình hợp nhất: phân tử va chạm, liên kết hình thành/đứt, ion di chuyển.",
    topics: ["Liên kết ion và liên kết cộng hoá trị", "Tốc độ phản ứng và các yếu tố ảnh hưởng", "Cân bằng hoá học", "Pin điện hoá"],
    animations: ["Nguyên tử Na nhường electron cho Cl tạo ion Na⁺ và Cl⁻ hút nhau", "Các phân tử chuyển động nhanh dần khi tăng nhiệt độ và va chạm hiệu quả nhiều hơn"],
    figure: "Mô hình phân tử nước với hai nguyên tử H và một nguyên tử O",
  },
  {
    name: "Sinh học",
    guide: "Quá trình sống dùng cycle hoặc steps; cấu tạo dùng image; so sánh hai quá trình dùng compare hoặc table. Thuật ngữ đúng sách giáo khoa. Hoạt hình hợp nhất: quá trình trong tế bào, dòng vật chất và năng lượng, phân bào.",
    topics: ["Quang hợp ở thực vật", "Nguyên phân và giảm phân", "Cấu trúc ADN", "Hệ tuần hoàn ở người"],
    animations: ["Các kì của nguyên phân: nhiễm sắc thể xếp hàng, tách đôi về hai cực", "Dòng máu đi qua tim: tâm nhĩ, tâm thất, động mạch, tĩnh mạch"],
    figure: "Tế bào thực vật cắt ngang với nhân, lục lạp, không bào",
  },
  {
    name: "Ngữ văn",
    guide: "Trích dẫn thơ văn phải chính xác từng chữ — chỉ trích khi có trong tài liệu hoặc chắc chắn, nếu không thì diễn ý. Dùng quote cho câu thơ / ý kiến hay, compare cho đối chiếu nhân vật / hình ảnh, timeline cho cuộc đời tác giả, bullets cho luận điểm. Hoạt hình hợp nhất: câu thơ hiện từng chữ, sơ đồ tư duy luận điểm, hình ảnh biểu tượng.",
    topics: ["Phân tích bài thơ Tây Tiến", "Nhân vật Mị trong Vợ chồng A Phủ", "Nghị luận về lối sống xanh của giới trẻ", "Truyện Kiều — đoạn Trao duyên"],
    animations: ["Câu thơ hiện dần từng chữ, các từ ngữ quan trọng sáng lên và kèm chú thích biện pháp tu từ", "Sơ đồ tư duy ba luận điểm toả ra từ luận đề ở giữa"],
    figure: "Cảnh núi rừng Tây Bắc mờ sương, đoàn quân nhỏ bé trên đèo",
  },
  {
    name: "Lịch sử",
    guide: "Mốc thời gian chính xác (ngày/tháng/năm) dùng timeline; nguyên nhân – diễn biến – kết quả – ý nghĩa dùng steps/bullets; so sánh hai giai đoạn dùng compare hoặc table. Không bịa số liệu, tên người. Hoạt hình hợp nhất: dòng thời gian, bản đồ diễn biến với mũi tên tiến quân.",
    topics: ["Chiến dịch Điện Biên Phủ 1954", "Cách mạng tháng Tám năm 1945", "Phong trào Cần Vương", "Chiến tranh thế giới thứ hai"],
    animations: ["Dòng thời gian các đợt tấn công của chiến dịch, mỗi mốc hiện kèm sự kiện", "Sơ đồ nguyên nhân dẫn đến kết quả với mũi tên nối từng bước"],
    figure: "Bản đồ đơn giản lòng chảo Điện Biên với các cứ điểm",
  },
  {
    name: "Địa lí",
    guide: "Số liệu dân số, kinh tế, khí hậu ghi rõ năm và nguồn, dùng chart hoặc table; phân bố và vùng miền dùng image/compare; quá trình tự nhiên dùng cycle. Hoạt hình hợp nhất: vòng tuần hoàn nước, gió mùa, biểu đồ thay đổi theo năm.",
    topics: ["Gió mùa ở Việt Nam", "Biến đổi khí hậu ở Đồng bằng sông Cửu Long", "Đô thị hoá ở Việt Nam", "Vòng tuần hoàn của nước"],
    animations: ["Gió mùa mùa hạ thổi từ biển vào đất liền, gió mùa mùa đông thổi ngược lại", "Vòng tuần hoàn nước: bốc hơi, ngưng tụ, mưa, dòng chảy"],
    figure: "Bản đồ Việt Nam giản lược với hướng gió mùa đông bắc",
  },
  {
    name: "Tiếng Anh",
    guide: "Nội dung tiếng Anh giữ nguyên tiếng Anh, giải thích bằng tiếng Việt; ngữ pháp dùng table (cấu trúc – ví dụ) hoặc formula đơn giản; từ vựng dùng bullets (từ – nghĩa – ví dụ); có quiz chọn đáp án.",
    topics: ["Thì hiện tại hoàn thành", "Câu bị động", "Từ vựng chủ đề môi trường", "Câu điều kiện loại 1, 2, 3"],
    animations: ["Trục thời gian cho thì hiện tại hoàn thành: hành động từ quá khứ kéo dài tới hiện tại", "Câu chủ động biến thành câu bị động, các thành phần trượt về vị trí mới"],
    figure: "Minh hoạ hoạt động bảo vệ môi trường: trồng cây, phân loại rác",
  },
  {
    name: "Tin học",
    guide: "Thuật toán dùng steps; so sánh dùng compare/table; đoạn mã nếu có thì ngắn, đặt trong explain hoặc quote với tên biến rõ nghĩa. Hoạt hình hợp nhất: mô phỏng thuật toán từng bước (sắp xếp, tìm kiếm), luồng dữ liệu trong mạng.",
    topics: ["Thuật toán sắp xếp nổi bọt", "Tìm kiếm nhị phân", "Mạng máy tính và Internet", "An toàn thông tin cá nhân"],
    animations: ["Sắp xếp nổi bọt trên 6 cột số, hai cột so sánh sáng lên rồi đổi chỗ", "Tìm kiếm nhị phân: thu hẹp một nửa dãy sau mỗi bước"],
    figure: "Sơ đồ mạng gồm máy tính, router và máy chủ",
  },
  {
    name: "Công nghệ",
    guide: "Quy trình kĩ thuật dùng steps; cấu tạo thiết bị dùng image; thông số kĩ thuật dùng table; luôn có lưu ý an toàn. Hoạt hình hợp nhất: nguyên lí hoạt động của máy, dòng năng lượng.",
    topics: ["Động cơ đốt trong 4 kì", "Quy trình trồng rau thuỷ canh", "Mạch điện trong gia đình", "Vẽ kĩ thuật hình chiếu"],
    animations: ["Bốn kì của động cơ: nạp, nén, nổ, xả với piston chuyển động", "Dòng điện chạy trong mạch gia đình qua cầu dao, ổ cắm, thiết bị"],
    figure: "Sơ đồ hệ thống thuỷ canh: bể dung dịch, máy bơm, ống trồng",
  },
  {
    name: "GD Kinh tế & Pháp luật",
    guide: "Khái niệm dùng quote (định nghĩa chuẩn sách giáo khoa); quyền và nghĩa vụ dùng compare; tình huống dùng quiz; dẫn luật ghi rõ tên văn bản. Ví dụ gần gũi đời sống học sinh.",
    topics: ["Thị trường và cơ chế thị trường", "Quyền và nghĩa vụ của công dân", "Lập kế hoạch tài chính cá nhân", "Thuế và vai trò của thuế"],
    animations: ["Đường cung và đường cầu giao nhau tạo giá cân bằng", "Dòng tiền thu nhập chia vào các hũ chi tiêu, tiết kiệm, đầu tư"],
    figure: "Minh hoạ chợ với người mua, người bán và bảng giá",
  },
  {
    name: "Hoạt động trải nghiệm",
    guide: "Hướng tới kĩ năng và hành động cụ thể: steps cho cách làm, bullets cho mẹo, quiz cho tình huống ứng xử. Giọng gần gũi, tích cực.",
    topics: ["Kĩ năng làm việc nhóm hiệu quả", "Định hướng nghề nghiệp", "Phòng chống bắt nạt học đường", "Quản lí thời gian"],
    animations: ["Ma trận Eisenhower: các việc trượt vào bốn ô quan trọng / khẩn cấp", "Các thành viên nhóm kết nối thành một mạng lưới phối hợp"],
    figure: "Nhóm học sinh cùng nhau thảo luận quanh bàn",
  },
  {
    name: "Khác",
    guide: "Chọn bố cục theo bản chất nội dung: quá trình → steps/cycle, thời gian → timeline, đối chiếu → compare/table, số liệu → chart/big_number, khái niệm → quote.",
    topics: ["Kĩ năng thuyết trình trước đám đông", "An toàn giao thông cho học sinh", "Văn hoá đọc", "Sức khoẻ tinh thần tuổi học đường"],
    animations: ["Sơ đồ các bước giải quyết vấn đề, mỗi bước bật sáng khi được nhắc tới", "Biểu đồ thay đổi trước và sau khi áp dụng giải pháp"],
    figure: "Minh hoạ chủ đề bằng các biểu tượng đơn giản, màu tươi sáng",
  },
];

const subjectOf = (name?: string): Subject => SUBJECTS.find((s) => s.name === name) ?? SUBJECTS[SUBJECTS.length - 1];

/** Khối prompt chứa các quy ước của môn học. */
export const subjectGuide = (name?: string) => `<subject name="${subjectOf(name).name}">\n${subjectOf(name).guide}\n</subject>`;

/** Ví dụ cho giao diện, bỏ phần hướng dẫn chỉ dùng trong prompt. */
export const subjectExamples = () => SUBJECTS.map(({ guide: _g, ...rest }) => rest);
