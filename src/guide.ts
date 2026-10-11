export const GUIDE_TOPICS = [
  "overview",
  "rules",
  "fsrs",
  "workflows",
  "candidates",
  "origins",
  "session",
  "stats",
] as const;
export type GuideTopic = (typeof GUIDE_TOPICS)[number];

export function getGuideTopic(topic?: string): string {
  const t = topic?.toLowerCase().trim();

  switch (t) {
    case "rules":
      return `# Vega Card-Writing Rules (Quy Tắc Soạn Thẻ)

1. **Nguyên tử hóa (One Idea per Card):** Mỗi thẻ chỉ hỏi một đơn vị kiến thức duy nhất.
   - Sai: Hỏi toàn bộ 7 bước của vòng lặp ReAct trong 1 thẻ.
   - Đúng: Tách thành các thẻ riêng: (1) Ranh giới giữa LLM và Code, (2) Điều kiện thoát Final Answer, (3) Công thức Token tích lũy.

2. **Dùng Cloze cho thuật ngữ & định nghĩa:** Dùng [[từ khóa]] để kiểm tra chính xác vị trí nhận thức.
   - Ví dụ: "Trong vòng lặp ReAct, [[Code Python]] thực thi công cụ và kiểm tra điều kiện dừng, còn [[LLM]] đề xuất hành động."

3. **Không bắt đọc thuộc danh sách rời rạc:** Tránh hỏi liệt kê; hãy hỏi về sự phân biệt, mục đích hoặc hệ quả.
   - Sai: "Liệt kê 4 trụ cột kiến trúc của AI Agent."
   - Đúng: "Trụ cột nào chuyển đổi yêu cầu văn bản thành lời gọi hàm tất định?" -> "Action & Tool Use."

4. **Giữ mỏ neo trí nhớ (Preserve Memory Hooks):** Gắn trường hook khi bài học có hình ảnh/lộ trình Loci.
   - Front: "Vòng lặp ReAct · Trạm 7: Bếp nấu"
   - Back: "Kiểm tra ngân sách (max_steps)"
   - Hook: "Đồng hồ hẹn giờ bếp reo reng reng; nếu đếm quá 6 lần mà chưa xong thì cầu dao tự ngắt điện."

5. **Ngôn ngữ học viên (Vietnamese Learner Text):** Thẻ hướng tới người học bằng tiếng Việt chuẩn mực, giữ thuật ngữ chuyên ngành quốc tế chuẩn xác.

6. **Trung thực với nguồn (Origin Fidelity):** Tuyệt đối không bịa đặt dữ kiện ngoài tài liệu nguồn. Mọi thẻ phải mang origin trỏ tới file và vị trí cụ thể.`;

    case "fsrs":
      return `# FSRS in Plain Words (Nguyên Lý FSRS Dễ Hiểu)

1. **Tại sao FSRS vượt trội hơn lịch cố định?**
   Lịch cố định (D+1, D+3, D+7, D+16, D+35) không phân biệt thẻ khó hay dễ. FSRS mô hình hóa trạng thái trí nhớ cá nhân hóa cho từng thẻ:
   - Thẻ dễ sẽ được giãn cách nhanh, tiết kiệm thời gian.
   - Thẻ khó sẽ xuất hiện thường xuyên hơn để tránh quên.

2. **Ba đại lượng FSRS cốt lõi:**
   - **Độ ổn định (Stability - S):** Số ngày cần để xác suất nhớ giảm xuống mức mong muốn (mặc định 90%). Ôn tập thành công làm S tăng lũy tiến.
   - **Độ khó (Difficulty - D):** Thang điểm 1 (rất dễ) đến 10 (rất khó), đo độ phức tạp nội tại của thẻ đối với bạn.
   - **Khả năng truy hồi (Retrievability - R):** Xác suất bạn nhớ được thẻ tại thời điểm kiểm tra.

3. **Bốn nút đánh giá (Ratings):**
   - **1 - Again:** Quên hoàn toàn. Thẻ bị tính lapse, chuyển sang trạng thái Relearning để ôn lại ngay.
   - **2 - Hard:** Nhớ chật vật, tốn nhiều nỗ lực. FSRS tăng độ khó D và tăng chu kỳ nhẹ.
   - **3 - Good:** Nhớ đúng với nỗ lực bình thường. Đây là mức đánh giá chuẩn để tăng Stability.
   - **4 - Easy:** Nhớ tức thì, rất dễ. FSRS giảm độ khó D và nhân chu kỳ lên xa hơn.

4. **Tỉ lệ giữ lại mong muốn (Desired Retention = 0.9):**
   Hệ thống tính toán thời điểm lặp lại sao cho xác suất bạn nhớ được kiến thức tại thời điểm ôn luôn đạt 90%.

5. **Tỉ lệ nhớ thực tế (True Retention) theo chuẩn FSRS & Anki:**
   - True Retention = passed / (passed + failed) **chỉ tính trên các lượt ôn của thẻ đang ở trạng thái Review**.
   - Các bước học ban đầu (New -> Learning) và học lại (Relearning) bị loại trừ khỏi True Retention. Đánh giá Again ở bước học được theo dõi riêng ở chỉ số "Learning-step again", giúp phản ánh chính xác độ bền của trí nhớ dài hạn.`;

    case "workflows":
      return `# Vega Workflows (Quy Trình Sử Dụng)

1. **Trích xuất ứng viên (Discovery):**
   - Chạy \`vega_candidates { path: "..." }\` trên file Polaris (\`facts.json\`, \`errorlog.md\`) hoặc Aurora (\`deck.json\`).
   - Nhận danh sách thẻ đề xuất kèm nguồn gốc (origins).

2. **Biên tập & Thêm thẻ (Authoring):**
   - Agent rà soát, tinh chỉnh câu chữ theo quy tắc soạn thẻ.
   - Gọi \`vega_add { cards: [...] }\` để lưu vào bộ sưu tập. Hệ thống tự động khử trùng lặp và gán ID + trạng thái FSRS ban đầu.

3. **Phiên ôn tập hàng ngày với Aurora Deck (Daily Study):**
   - Gọi prompt \`review_today\` hoặc tool \`vega_session\` để tạo bộ slide ôn tập hàng ngày tại \`.vega/session/\`.
   - Xem trực tiếp bằng \`aurora_preview\` hoặc mở file HTML, lật thẻ và đánh giá qua phím 1-4.
   - Gọi \`vega_sync\` để tự động đồng bộ đánh giá vào FSRS.

4. **Theo dõi tiến độ & Thẻ vướng (Monitoring):**
   - Gọi \`vega_stats\` để xem số lượng thẻ theo trạng thái, tỉ lệ nhớ thực tế 30 ngày qua, và các thẻ bị quên từ 6 lần trở lên (Leeches).`;

    case "candidates":
      return `# Vega Candidate Extraction (Trích Xuất Ứng Viên)

Hỗ trợ trích xuất tự động và tất định từ các định dạng học tập:
1. **Polaris facts.json:** Trích xuất các khẳng định (claims) thành thẻ basic hoặc cloze (khi có [[...]]).
2. **Polaris errorlog.md:** Trích xuất từ Sổ lỗi các ca trắc nghiệm sai, dự đoán sai, trạm trí nhớ quên thành thẻ củng cố mental model.
3. **Aurora deck.json:**
   - **Notebook slides:** Dòng { term, def } -> 2 thẻ (basic + reverse); Dòng công thức '= ...' -> thẻ công thức; Dòng ghi nhớ '! ...' -> thẻ quy tắc; Dòng mỏ neo '@ ...' -> thẻ kèm hook.
   - **Quiz slides:** Câu hỏi và các đáp án đúng kèm giải thích.
   - **Flashcards slides:** Cặp front/back/hint nguyên bản.
   - **Palace slides:** Các trạm trí nhớ (place -> item + hook liên tưởng).
   - **Cloze & Definition slides:** Thẻ điền khuyết và định nghĩa thuật ngữ.`;

    case "origins":
      return `# Card Origin & Traceability (Truy Xuất Nguồn Gốc)

Mọi thẻ trong Vega bắt buộc phải có đối tượng \`origin\`:
\`\`\`json
{
  "kind": "aurora-notebook",
  "path": "D:/02_Learning_Knowledge/.../deck.json",
  "locator": "slide 12 (notebook: Sổ tay kiến trúc Vòng lặp Agent)"
}
\`\`\`
Các loại \`kind\`:
- \`polaris-fact\`: Dữ kiện từ Polaris \`facts.json\` (locator: \`fact F12 [p. 2]\`).
- \`polaris-errorlog\`: Lỗi từ Polaris \`errorlog.md\` (locator: \`ERR_...\` hoặc tiêu đề mục).
- \`aurora-notebook\`: Trang vở ghi chép từ Aurora slide notebook (locator: \`slide N (notebook)\`).
- \`aurora-quiz\`: Câu hỏi trắc nghiệm từ Aurora slide quiz (locator: \`slide N (quiz)\`).
- \`aurora-flashcard\`: Thẻ ghi nhớ từ Aurora slide flashcards (locator: \`slide N (flashcards)\`).
- \`aurora-palace\`: Trạm trí nhớ Loci từ Aurora slide palace (locator: \`slide N (palace), station: ...\`).
- \`manual\`: Thẻ do người học hoặc agent tự thêm thủ công.`;

    case "session":
      return `# Vega Review Sessions & Aurora Integration (Phiên Ôn Tập Hàng Ngày)

1. **Phiên ôn tập hàng ngày (\`vega_session\`):**
   - Lấy hàng đợi hôm nay theo quy tắc FSRS (quá hạn -> đến hạn -> thẻ mới có giới hạn).
   - Ghi vào DUY NHẤT một thư mục cố định \`<hub>/.vega/session/\` với file \`deck.json\`.
   - Cấu trúc bộ slide ôn tập:
     - Slide Title: Tiêu đề "Ôn tập hôm nay · <date>", thống kê số thẻ theo từng môn học.
     - Slide SRS: Mỗi thẻ là một slide loại \`srs\` gồm mặt trước (\`front\`), mặt sau (\`back\`), gợi ý (\`hint\`), mỏ neo trí nhớ (\`hook\`), và nhãn nguồn kèm đường dẫn liên kết tương đối (\`origin\`).
     - Slide Summary: Tổng kết phiên ôn tập và nhắc nhở đồng bộ kết quả.
   - Tự động biên dịch sang \`index.html\` nếu tìm thấy Aurora CLI (\`VEGA_AURORA_CLI\` hoặc đường dẫn mặc định).
   - Thư mục được ghi đè mỗi ngày, không tạo thư mục rác theo ngày để bảo vệ ổ đĩa exFAT.

2. **Slide SRS trong Aurora Slides:**
   - Phím Space / Enter: Lật thẻ xem đáp án và mỏ neo trí nhớ.
   - Phím 1 (Again), 2 (Hard), 3 (Good), 4 (Easy): Đánh giá mức độ nhớ.
   - Bấm vào nguồn gốc (\`origin\`) để mở ngay bài học gốc chứa kiến thức đó.

3. **Ghi nhận sự kiện học tập (\`progress.jsonl\`):**
   - Khi xem qua \`aurora_preview\`, các thao tác đánh giá phát sinh sự kiện loại \`card\`:
     \`{"v":1, "t":"...", "course":null, "lesson":"session", "deck":"...", "slide":N, "type":"card", "card":"c_xxx", "rating":"good", "ms":3500}\`
   - Dữ liệu được ghi vào \`.vega/session/progress.jsonl\` hoặc xuất ra file \`aurora-progress-*.jsonl\`.

4. **Đồng bộ tự động (\`vega_sync\`):**
   - Đọc \`.vega/session/progress.jsonl\` hoặc file xuất, lọc các sự kiện \`card\`.
   - Áp dụng các đánh giá theo thứ tự thời gian vào thuật toán FSRS.
   - Đảm bảo tính **Bất biến (Idempotent)**: Lưu hash các sự kiện đã xử lý vào \`.vega/sync-state.json\`, chạy lại nhiều lần không bị cộng dồn hay sai lệch.
   - Tự động bỏ qua và cảnh báo thẻ không tồn tại hoặc dòng dữ liệu lỗi.`;

    case "stats":
      return `# Vega Collection Stats & True Retention (Thống Kê Ghi Nhớ)

1. **Định nghĩa Tỉ lệ nhớ thực tế (True Retention - 30 ngày):**
   - Theo chuẩn FSRS và Anki, True Retention được tính bằng:
     $$\\text{True Retention} = \\frac{\\text{Passed (Hard, Good, Easy)}}{\\text{Passed} + \\text{Failed (Again)}}$$
   - **Chỉ áp dụng cho các lượt ôn tập của thẻ đang ở trạng thái Review** trước khi đánh giá (thẻ đã tốt nghiệp chu kỳ học ban đầu).
   - **Loại trừ hoàn toàn** các bước học (Learning) và học lại (Relearning). Khi chưa có lượt ôn nào ở trạng thái Review, hệ thống hiển thị "n/a".

2. **Chỉ số Learning-step again (Đánh giá lại trong bước học):**
   - Thẻ mới (New) hoặc thẻ đang học (Learning/Relearning) khi bấm "Again" được tính riêng là "Learning-step again today".
   - Tách biệt chỉ số này giúp tránh việc hạ thấp tỉ lệ retention một cách sai lệch (ví dụ vừa tạo thẻ mới bấm Again không bị tính là quên ký ức).

3. **Thẻ vướng (Leech Cards):**
   - Các thẻ có số lần quên từ 6 lần trở lên (\`lapses >= 6\`).
   - Cần xem xét lại câu hỏi/đáp án: có thể thẻ chưa tuân thủ quy tắc nguyên tử hóa hoặc câu từ gây nhầm lẫn.

4. **Dự báo tải ôn tập 7 ngày tới (Workload Forecast):**
   - Ước lượng số lượng thẻ đến hạn ôn tập trong 7 ngày tiếp theo để chủ động sắp xếp thời gian.`;

    case "overview":
    default:
      return `# Vega MCP - Guide Overview

Vega là động cơ ghi nhớ và lặp lại giãn cách (Adaptive Spaced Repetition) với thuật toán FSRS cho toàn bộ hệ sinh thái học tập của người học.

Ecosystem (bởi DuongNAD):
- **Polaris:** Course architect (https://github.com/DuongNAD/polaris-mcp)
- **Aurora Slides:** Lessons & presentation engine (https://github.com/DuongNAD/aurora-slides-mcp)
- **SmartDrive-OS:** SSD governance & learning search (https://github.com/DuongNAD/smart-drive-os)
- **Constellation:** MCP registration & ecosystem contracts (https://github.com/DuongNAD/constellation-mcp)
- **Vega:** Adaptive spaced repetition engine (https://github.com/DuongNAD/vega-mcp)

Available guide topics:
- \`rules\`: Card-writing rules with Vietnamese examples (Quy tắc soạn thẻ chuẩn)
- \`fsrs\`: FSRS in plain words, 4 ratings, stability & retrievability (Nguyên lý FSRS)
- \`workflows\`: End-to-end study and authoring workflows (Quy trình vận hành)
- \`candidates\`: Extraction mechanics from Polaris and Aurora files (Trích xuất ứng viên)
- \`origins\`: Origin tracking and locators (Truy xuất nguồn gốc)
- \`session\`: Daily review sessions as Aurora decks & FSRS sync (Phiên ôn tập & Đồng bộ)
- \`stats\`: Collection statistics, True Retention definition vs learning steps, and leeches (Thống kê ghi nhớ & Tỉ lệ nhớ thực tế)`;
  }
}

