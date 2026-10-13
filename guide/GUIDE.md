# Vega MCP - Guide & Memory Architecture

Vega là động cơ ghi nhớ và lặp lại giãn cách thích ứng (Adaptive Spaced Repetition - FSRS) trong hệ sinh thái học tập Polaris và Aurora Slides.

---

## 1. Nguyên Lý Lặp Lại Giãn Cách FSRS (FSRS in Plain Words)

### Tại sao thay thế lịch cố định bằng FSRS?
Polaris lên lịch ôn tập theo các mốc thời gian cố định ($D+1, D+3, D+7, D+16, D+35$). Tuy nhiên, mỗi khái niệm có độ khó khác nhau và trí nhớ mỗi người phản ứng khác nhau:
- Thẻ quá dễ bị lặp lại quá nhiều lần gây lãng phí thời gian.
- Thẻ khó hoặc dễ quên lại không được lặp lại đủ sớm, dẫn đến rơi rụng kiến thức.

**FSRS (Free Spaced Repetition Scheduler)** mô hình hóa trạng thái trí nhớ của từng thẻ qua 3 biến số cốt lõi:
1. **Độ ổn định (Stability - $S$):** Số ngày cần thiết để xác suất nhớ lại (Retrievability) giảm từ 100% xuống mức mong muốn (mặc định $R = 90\%$). Càng ôn tập thành công, $S$ càng tăng theo cấp số mũ.
2. **Độ khó (Difficulty - $D$):** Thang đo từ 1 (rất dễ) đến 10 (rất khó), phản ánh độ phức tạp nội tại của khái niệm đối với người học.
3. **Khả năng truy hồi (Retrievability - $R$):** Xác suất người học nhớ được thẻ tại thời điểm hiện tại.

### 4 Mức Đánh Giá (Ratings)
- **1 - Again (Quên / Chưa nhớ):** Quên hoàn toàn hoặc trả lời sai. FSRS ghi nhận 1 lần trượt (lapse), đưa thẻ về trạng thái Relearning và rút ngắn chu kỳ tiếp theo để củng cố ngay.
- **2 - Hard (Khó / Nhớ chật vật):** Nhớ được nhưng mất nhiều nỗ lực suy nghĩ hoặc không chắc chắn. FSRS tăng độ khó $D$ và tăng nhẹ chu kỳ.
- **3 - Good (Đạt / Nhớ chuẩn):** Nhớ chính xác với nỗ lực nhận thức bình thường. Đây là mức đánh giá chuẩn nhất để hệ thống tính toán chu kỳ tối ưu.
- **4 - Easy (Dễ / Nhớ tức thì):** Nhớ ngay lập tức mà không cần suy nghĩ. FSRS giảm độ khó $D$ và nhân chu kỳ lên khoảng thời gian dài hơn.

### Tỉ Lệ Nhớ Thực Tế (True Retention) Chuẩn FSRS / Anki
FSRS và Anki định nghĩa "True Retention" (Tỉ lệ nhớ thực tế) là tỉ lệ ôn tập thành công trên các thẻ **đã ở trạng thái Review** trước khi đánh giá:
$$\text{True Retention} = \frac{\text{Passed (Hard/Good/Easy)}}{\text{Passed} + \text{Failed (Again)}}$$
- **Loại trừ các bước học ban đầu (New -> Learning):** Khi học thẻ mới, việc người học chọn "Again" ở bước đầu là điều tự nhiên để nạp kiến thức vào não, không phải là một ký ức đã hình thành bị quên lãng. Do đó các bước Learning và Relearning được loại trừ khỏi True Retention và được đếm riêng ở chỉ số **Learning-step again**.
- Khi chưa có lượt ôn nào ở trạng thái Review (ví dụ ngày đầu tiên học thẻ mới), True Retention hiển thị `n/a`.

---

## 2. Quy Tắc Soạn Thẻ (Card-Writing Rules)

Một thuật toán tốt không thể bù đắp cho những chiếc thẻ soạn kém. Khi agent đề xuất thẻ từ tài liệu, phải tuân thủ nghiêm ngặt 6 quy tắc vàng:

### Quy tắc 1: Nguyên tử hóa (One Idea per Card)
Mỗi thẻ chỉ hỏi đúng một đơn vị kiến thức nhỏ nhất.
- **Sai:** Hỏi toàn bộ 7 bước của vòng lặp ReAct trên một mặt thẻ.
- **Đúng:** Tách thành các thẻ riêng: (1) Ranh giới giữa LLM và Code, (2) Điều kiện thoát Final Answer, (3) Cách tính token tích lũy.

### Quy tắc 2: Dùng Cloze cho thuật ngữ & Định nghĩa
Khi cần ghi nhớ vị trí từ khóa chính xác, dùng cú pháp `[[từ khóa]]`.
- **Ví dụ:** `Trong vòng lặp ReAct, [[Code Python]] nắm quyền thực thi công cụ và kiểm soát điều kiện dừng, còn [[LLM]] chỉ đóng vai trò đề xuất hành động.`

### Quy tắc 3: Không bắt đọc thuộc danh sách rời rạc
Tránh các câu hỏi dạng "Hãy liệt kê 5 loại...". Thay vào đó, hãy hỏi về sự phân biệt, ứng dụng hoặc bản chất của từng phần tử.
- **Sai:** `Liệt kê 4 trụ cột kiến trúc của AI Agent.`
- **Đúng:** `Trụ cột nào của AI Agent chịu trách nhiệm chuyển đổi yêu cầu văn bản thành lời gọi hàm tất định?` -> `Action & Tool Use.`

### Quy tắc 4: Giữ mỏ neo trí nhớ (Preserve Memory Hooks)
Nếu bài học có mỏ neo hình ảnh (Memory Palace / Loci / Analogy / Mnemonic), hãy gắn trường `hook` vào thẻ để kích hoạt trí nhớ thị giác khi ôn tập.
- **Ví dụ:**
  - Front: `Vòng lặp ReAct · Trạm 7: Bếp nấu`
  - Back: `Kiểm tra ngân sách (max_steps)`
  - Hook: `Đồng hồ hẹn giờ bếp reo reng reng; nếu đếm quá 6 lần mà chưa xong thì cầu dao tự ngắt điện.`

### Quy tắc 5: Ngôn ngữ học viên (Learner Language)
Nội dung thẻ người học nhìn thấy phải viết bằng tiếng Việt chuẩn, dấu chuẩn mực, văn phong cô đọng, giữ nguyên thuật ngữ kỹ thuật quốc tế (Token, Prompt, ReAct, FSRS, LLM, Parser) khi cần thiết.

### Quy tắc 6: Trung thực với nguồn gốc (Origin Fidelity)
Không được tự sáng tác dữ kiện nằm ngoài nội dung bài học hoặc nguồn tài liệu. Mọi thẻ đều phải mang `origin` chỉ rõ file nguồn và vị trí định vị (slide, fact, errorlog entry).

### Quy tắc 7: Mặt trước cụ thể, không mơ hồ (Specific Fronts)
Mặt trước của thẻ phải nêu rõ đích danh công thức, khái niệm hoặc quy tắc được kiểm tra để người học nhận diện tức thì:
- **Tránh mơ hồ:** Tuyệt đối không sinh thẻ có mặt trước mơ hồ như "Công thức (Trang vở...)" hoặc "Công thức (Tên slide)", khiến học viên không thể biết bài học đang hỏi công thức nào.
- **Quy tắc trích xuất công thức (`= <LaTeX>`):** Biểu thức toán học luôn đặt trong `$...$` (nội dòng) hoặc `$$...$$` (khối) để Aurora hiển thị chuẩn xác bằng KaTeX. Tận dụng tuần tự tiêu đề tiểu mục (`# `) gần nhất, vế trái của biểu thức (ví dụ: $\hat{y}$, $J(w)$, $w^*$), hoặc từ ngữ ngữ cảnh xung quanh để tạo mặt trước rõ nghĩa (ví dụ: `Công thức hồi quy tuyến tính $\hat{\mathbf{y}}$`, `Viết công thức cho $J(w)$`).
- **Nguyên tử hóa công thức:** Khi một dòng ghi chép chứa nhiều công thức phân tách bởi `\quad`, `\qquad` hoặc `;` (mỗi biểu thức có dấu quan hệ riêng), tách thành từng thẻ riêng biệt kèm mặt sau `$$<formula>$$`.
- **Ngữ cảnh quy tắc & mỏ neo:** Dòng quy tắc (`! `) và mỏ neo (`@ `) khi có tiểu mục dùng dạng "Quy tắc cốt lõi · <tiểu mục>" / "Mỏ neo trí nhớ · <tiểu mục>" ngắn gọn mà không lặp lại tiêu đề slide.
- **Tính đơn nhất mặt trước:** Trong cùng một bài học (deck), không bao giờ có 2 thẻ mang mặt trước giống hệt nhau (tự động phân biệt bằng tiểu mục hoặc chỉ số thứ tự `(2)`, `(3)`).


---

## 3. Quy Trình Vận Hành (Workflows)

```
Polaris facts.json / errorlog.md
Aurora deck.json (notebook/quiz/palace)
          │
          ▼
   [vega_candidates]   (Trích xuất ứng viên tất định)
          │
          ▼
   [Agent Rewrite]     (Soạn lại theo quy tắc 6 chuẩn)
          │
          ▼
      [vega_add]       (Khử trùng lặp, gán ID, khởi tạo FSRS)
          │
          ▼
      [vega_due]       (Hàng đợi hôm nay: Quá hạn -> Đến hạn -> Thẻ mới)
          │
          ▼
    [vega_review]      (Đánh giá: Again / Hard / Good / Easy)
          │
          ▼
     [vega_stats]      (Theo dõi tỉ lệ giữ lại, thẻ vướng - leeches)
```

1. **Khám phá ứng viên (Discovery):** Gọi `vega_candidates` với đường dẫn file `facts.json`, `errorlog.md` hoặc `deck.json`.
2. **Biên tập & Nạp thẻ (Authoring):** Agent rà soát, tinh chỉnh câu chữ theo quy tắc soạn thẻ, sau đó gọi `vega_add` để thêm vào bộ sưu tập.
3. **Nhận thẻ từ các công cụ khác (Inbox):** Polaris (Sổ lỗi, câu tự kiểm tra), Orion (lỗi lặp lại), Mira (điểm dừng dự đoán sai) và Rigel (câu hỏi có nguồn dẫn từ tài liệu bài học, nguồn `rigel-ref`) thả tệp `.jsonl` vào `.vega/inbox/`. Gọi `vega_inbox { action: "list" }` để xem trước, `vega_inbox { action: "ingest" }` để nạp (hoặc để `vega_sync` nạp). Xem mục 6.
4. **Phiên học hàng ngày với Aurora Deck (Daily Review):** Gọi `vega_session` (hoặc prompt `review_today`) để xuất bộ slide ôn tập vào `.vega/session/deck.json`. Người học mở bài ôn tập qua `aurora_preview`, lật thẻ và đánh giá qua các phím số 1-4.
5. **Tự động đồng bộ kết quả (Sync to FSRS):** Gọi `vega_sync` để nạp hộp thư thẻ, rồi nạp toàn bộ đánh giá từ `progress.jsonl` vào thuật toán FSRS một cách bất biến (idempotent).
6. **Giám sát & Tối ưu (Monitoring):** Định kỳ gọi `vega_stats` để theo dõi tải học tập 7 ngày tới và phát hiện các thẻ bị quên từ 6 lần trở lên (`lapses >= 6`) để tái cấu trúc.

---

## 4. Tích Hợp Aurora Slides & Phiên Ôn Tập Hàng Ngày (Sessions & Sync)

### Cơ chế một thư mục cố định (`.vega/session/`)
Để tối ưu hóa không gian lưu trữ và tránh phân mảnh trên ổ đĩa exFAT (cluster 512 KB), Vega không tạo thư mục riêng cho từng ngày mà sử dụng duy nhất một thư mục:
```
<hub>/.vega/
├── cards.json         # Bộ thẻ đang hoạt động và trạng thái FSRS
├── reviews.jsonl      # Nhật ký ôn tập lũy tiến (append-only)
├── sync-state.json    # Bảng băm các sự kiện đã đồng bộ (Idempotency)
├── inbox/             # Nơi các công cụ khác thả ứng viên thẻ (*.jsonl)
│   ├── done/          # Tệp đã nạp xong
│   └── rejected/      # Dòng không hợp lệ, kèm trường _error
└── session/           # Thư mục bài ôn tập cố định
    ├── deck.json      # Bộ slide ôn tập hôm nay
    ├── index.html     # Giao diện chạy độc lập do Aurora biên dịch
    └── progress.jsonl # Sự kiện đánh giá thẻ từ giao diện
```

### Cấu trúc bài ôn tập Aurora SRS
- **Title Slide:** Tiêu đề "Ôn tập hôm nay · `<date>`", phân bổ số lượng thẻ theo từng chủ đề.
- **SRS Slide (`type: "srs"`):** Mặt trước câu hỏi (`front`), mặt sau đáp án (`back`), gợi ý (`hint`), mỏ neo trí nhớ (`hook`), và liên kết tương đối trỏ về bài học gốc (`origin`). Thẻ có `origin.href` (thẻ từ hộp thư) cho `origin: { label, href }` với `href` nguyên vẹn và nhãn tiếng Việt ngắn như `Mira · điểm dừng 3`, `Sổ lỗi · ERR_2026-10-12_ab12cd`, `Orion · <phép kiểm tra>`.
- **Summary Slide:** Bảng tổng kết số thẻ hoàn thành và lời nhắc đồng bộ.

### Phím tắt khi học với Aurora SRS
- **Space / Enter:** Lật mặt thẻ (Flip card).
- **1:** Again (Quên / Cần học lại ngay).
- **2:** Hard (Nhớ chật vật).
- **3:** Good (Nhớ chuẩn xác).
- **4:** Easy (Nhớ tức thì).

---

## 5. Thống Kê Ghi Nhớ & Giám Sát Tiến Trình (Stats & Monitoring)

Công cụ `vega_stats` cung cấp cái nhìn toàn diện về chất lượng bộ nhớ:
- **By State:** Số lượng thẻ phân theo 5 trạng thái: Mới (`New`), Đang học (`Learning`), Đã thuộc (`Review`), Học lại (`Relearning`), và Tạm dừng (`Suspended`).
- **Reviews Today & Learning-step again today:** Đếm riêng số lượt ôn hoàn thành hôm nay và số lần bấm "Again" trong các bước học ban đầu.
- **True Retention (30 ngày):** Tỉ lệ nhớ thực tế trên các thẻ ở trạng thái Review trong 30 ngày gần nhất (kèm số mẫu `passed / total`).
- **Leech Cards (`lapses >= 6`):** Các thẻ bị quên từ 6 lần trở lên, cần người học hoặc agent kiểm tra và tái cấu trúc lại nội dung.
- **Workload Forecast:** Biểu đồ dự báo số thẻ đến hạn trong 7 ngày tiếp theo.

---

## 6. Hộp Thư Thẻ: Một Hàng Đợi Ôn Tập Duy Nhất (Card Inbox)

Bản đầy đủ: `vega_guide { topic: "inbox" }`. Hợp đồng dùng chung: `vega-card-inbox.v1`.

**Vì sao một hàng đợi?** Giãn cách các lần truy hồi giúp nhớ lâu hơn so với dồn vào một lần (Latimier, Peyre và Ramus, 2021, doi:10.1007/s10648-020-09572-8), và ôn tập cá nhân hóa theo lịch sử từng người với từng mục cho kết quả giữ lại tốt hơn lịch giãn cách chung (Lindsey và cs., 2014, doi:10.1177/0956797613504302). Nếu Polaris, Orion và Mira mỗi nơi tự nhắc ôn theo lịch cố định riêng thì cùng một kiến thức bị nhắc nhiều lần và người học tích tụ "nợ ôn tập" (đây là lập luận kỹ thuật của hệ sinh thái, không phải kết luận của hai bài báo). Vì vậy các công cụ chỉ GỬI ứng viên thẻ; Vega duy nhất xác thực, khử trùng và lên lịch bằng FSRS.

**Cách hoạt động:**
- Nhà sản xuất ghi một tệp mới `<producer>-<YYYYMMDDTHHmmss>-<6 hex>.jsonl` (UTF-8, mỗi dòng một đối tượng JSON) vào `<hub>/.vega/inbox/`, ghi nguyên tử (`.jsonl.tmp` rồi đổi tên). Không bao giờ ghi `cards.json` hay `reviews.jsonl`.
- Mỗi dòng: `v`, `t`, `producer`, `key` (bắt đầu bằng `<producer>:`), `subject`, `deck?`, `kind?`, `front`, `back`, `hint?`, `hook?`, `origin {kind, path, locator?, href?}`, `tags?`, `reason?`. Trường lạ bị từ chối.
- `vega_inbox { action: "ingest" }` (hoặc bước đầu của `vega_sync`) xử lý tệp theo thứ tự tên: bỏ qua dòng có `key` đã tồn tại (thẻ đang học, tạm dừng hoặc đã xóa mềm), tạo thẻ mới trạng thái New cho dòng còn lại, chuyển tệp sang `inbox/done/`, ghi dòng lỗi kèm `_error` vào `inbox/rejected/<cùng tên>`. Chạy lại không đổi gì.
- `vega_inbox { action: "list" }` chỉ xem trước, không ghi gì. CLI: `vega inbox list|ingest [--json]`.
- Khóa chuẩn: `polaris:<môn>:<mã mục Sổ lỗi>`, `polaris:<môn>:selfcheck:<module>:<chỉ số>`, `orion:<lab>:<phép kiểm tra>`, `mira:<trình phát>:stop-<k>`, `rigel:<môn hoặc khóa học>:<ref>:<8 hex đầu của sha1(front)>`.

