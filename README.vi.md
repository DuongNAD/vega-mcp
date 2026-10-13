[English](README.md) | Tiếng Việt

<p align="center"><img src="docs/banner.jpg" alt="Vega MCP — cầu ô thước nối sao Chức Nữ và Ngưu Lang qua dải Ngân Hà" width="100%"></p>

# Vega MCP

*Được đặt tên theo sao Chức Nữ: Chức Nữ gặp lại Ngưu Lang đúng thời điểm mỗi năm, tựa như lặp lại ngắt quãng đưa mỗi thẻ nhớ trở lại đúng lúc.*

Vega là động cơ ghi nhớ và lặp lại giãn cách thích ứng (Adaptive Spaced Repetition - FSRS) trong hệ sinh thái học tập của người học: tích hợp trên mọi môn học, tự động trích xuất ứng viên thẻ từ tài liệu bài giảng (Polaris facts, Aurora notebook, trắc nghiệm, flashcards, cung điện trí nhớ Loci, và Sổ lỗi errorlog), phục vụ hàng đợi ôn tập hàng ngày và lưu vết trạng thái trí nhớ FSRS.

Được đặt tên theo ngôi sao Vega (sao Chức Nữ), người gặp lại Ngưu Lang đúng thời điểm mỗi năm.

---

## Hệ Sinh Thái (Ecosystem)

Mọi dự án của DuongNAD:

| Dự án | Vai trò | Kho mã |
| :--- | :--- | :--- |
| **Polaris** | Kiến trúc khóa học: nguồn, dữ kiện có vị trí trích, lộ trình, lịch học, Sổ lỗi | [polaris-mcp](https://github.com/DuongNAD/polaris-mcp) |
| **Aurora Slides** | Bài học kiểu keynote: trắc nghiệm, slide dự đoán và dò code, sự kiện tiến độ | [aurora-slides-mcp](https://github.com/DuongNAD/aurora-slides-mcp) |
| **Vega** | Bộ nhớ FSRS và hàng đợi ôn tập duy nhất (hộp thư thẻ) | [vega-mcp](https://github.com/DuongNAD/vega-mcp) |
| **Orion** | Lab thực hành chấm bằng test thật, bậc thang gợi ý, bậc khởi động PRIMM | [orion-mcp](https://github.com/DuongNAD/orion-mcp) |
| **Mira** | Dò code: trace Python thật, trình phát từng dòng có điểm dừng dự đoán | [mira-mcp](https://github.com/DuongNAD/mira-mcp) |
| **Rigel** | Gia sư bám tài liệu: trả lời từ tài liệu bài học, có trích dẫn [ref] | [rigel-mcp](https://github.com/DuongNAD/rigel-mcp) |
| **Sirius** | Vòng thực thi: hạn chót, phân loại việc, hôm nay học gì, bấm giờ, tổng kết tuần | [sirius-mcp](https://github.com/DuongNAD/sirius-mcp) |
| **Constellation** | Đăng ký MCP, kiểm tra sức khỏe, hợp đồng dữ liệu chung | [constellation-mcp](https://github.com/DuongNAD/constellation-mcp) |
| **SmartDrive-OS** | Quản trị SSD, chỉ mục và tìm kiếm tài liệu học | [smart-drive-os](https://github.com/DuongNAD/smart-drive-os) |

### Kết nối

- Nhà sản xuất của hộp thư thẻ (`vega-card-inbox.v1`): Polaris (Sổ lỗi, câu tự kiểm tra), Orion (lỗi lặp lại), Mira (điểm dừng dự đoán sai), Rigel (thẻ từ tài liệu bài học).
- Aurora: phiên ôn tập là bộ slide Aurora; sự kiện `card` được đồng bộ ngược về Vega bằng `vega_sync`.
- Sirius: đọc `reviews.jsonl` làm bằng chứng học tập.

---

## Vì Sao Cần Vega & FSRS?

Các hệ thống ôn tập truyền thống thường dùng các chu kỳ cố định ($D+1, D+3, D+7, D+16, D+35$). Trên thực tế, mỗi khái niệm có độ khó khác nhau:
- Thẻ dễ sẽ bị lặp lại quá nhiều lần gây lãng phí thời gian.
- Thẻ khó hoặc dễ quên lại không được lặp lại đủ sớm.

Vega sử dụng thuật toán **FSRS (Free Spaced Repetition Scheduler)** qua gói `ts-fsrs`:
- **Độ ổn định (Stability - $S$):** Số ngày để xác suất nhớ giảm xuống mức mong muốn (mặc định 90%).
- **Độ khó (Difficulty - $D$):** Thang điểm 1-10 đo độ phức tạp nhận thức của thẻ.
- **Khả năng truy hồi (Retrievability - $R$):** Xác suất nhớ lại kiến thức tại thời điểm ôn tập.
- **Tỉ lệ nhớ thực tế (True Retention):** Báo cáo tỉ lệ nhớ theo đúng chuẩn FSRS/Anki: chỉ tính trên các thẻ đang ở trạng thái **Review** trước khi đánh giá ($\text{passed} / (\text{passed} + \text{failed})$); loại trừ các bước học và học lại ban đầu để không hạ thấp retention sai lệch khi mới nạp thẻ. Đánh giá Again ở bước học được đếm riêng ở chỉ số "Learning-step again".
- **Chu kỳ thích ứng:** Thẻ dễ giãn cách nhanh; thẻ quên (lapse) được củng cố ngay lập tức.

---

## Nguyên Tắc Cốt Lõi

1. **Agent soạn thẻ chuẩn, Vega lên lịch:** Vega đề xuất ứng viên từ học liệu; agent tinh chỉnh theo 6 quy tắc soạn thẻ (nguyên tử hóa 1 ý/thẻ, cloze cho thuật ngữ, giữ mỏ neo trí nhớ, văn phong tiếng Việt chuẩn mực).
2. **Thuật toán chuẩn mực:** Sử dụng `ts-fsrs` (v5.4.2, MIT) được đóng gói độc lập trong một file chạy duy nhất.
3. **Lưu trữ tinh gọn:** Toàn bộ dữ liệu nằm trong thư mục `VEGA_HUB/.vega/` (mặc định `D:/02_Learning_Knowledge/.vega/`) với các file `cards.json`, `reviews.jsonl`, `sync-state.json`, thư mục bài ôn tập cố định `session/`, và thư mục nhận thẻ `inbox/` (kèm `done/` và `rejected/`) qua cơ chế ghi nguyên tử (atomic writes).
4. **Nguồn gốc rõ ràng & Liên kết bài học:** Mỗi thẻ đều lưu trữ chính xác nguồn gốc (`kind`, đường dẫn file, vị trí định vị như "slide 12", "fact F1", "trạm 7") và tự động tính toán liên kết tương đối trỏ về bài giảng gốc.

---

## Tích Hợp Aurora Slides & Phiên Ôn Tập Hàng Ngày

Vega chuyển đổi hàng đợi ôn tập hàng ngày thành các bộ slide **Aurora Slides** tương tác:

1. **Bộ slide ôn tập hàng ngày (`vega_session`):** Tạo file `<hub>/.vega/session/deck.json` gồm slide Tiêu đề (thống kê thẻ theo môn), các slide `srs` cho từng thẻ, và slide Tổng kết. Tái sử dụng duy nhất một thư mục `session/` để tránh lãng phí dung lượng trên ổ đĩa exFAT.
2. **Slide loại `srs` của Aurora:** Phím `Space`/`Enter` để lật thẻ, phím `1` (Again), `2` (Hard), `3` (Good), `4` (Easy) để đánh giá mức độ nhớ, và nhãn nguồn bấm chuyển về bài học gốc.
3. **Sự kiện tiến độ (`progress.jsonl`):** Các đánh giá trong giao diện phát sinh sự kiện loại `"card"`:
   ```json
   {"v":1, "t":"2026-10-11T09:00:00+07:00", "course":null, "lesson":"session", "deck":"Ôn tập hôm nay", "slide":2, "type":"card", "card":"c_12345", "rating":"good", "ms":3200}
   ```
4. **Đồng bộ tự động bất biến (`vega_sync`):** Đọc `progress.jsonl` và áp dụng đánh giá theo thứ tự thời gian vào thuật toán FSRS, ghi nhận bảng băm vào `sync-state.json` để chống trùng lặp.

---

## Một Hàng Đợi Ôn Tập Duy Nhất: Hộp Thư Thẻ (Card Inbox)

Mọi nơi sinh ra mục cần ôn trong hệ sinh thái (Sổ lỗi và câu tự kiểm tra của Polaris, lỗi lặp lại của Orion, điểm dừng dự đoán sai của Mira, câu hỏi có nguồn dẫn từ tài liệu bài học của Rigel, các bản xuất Aurora sau này) đều thả ứng viên thẻ vào hộp thư của Vega thay vì tự lên lịch ôn. Bằng chứng nghiên cứu ủng hộ một bộ lập lịch giãn cách thích ứng hơn là nhiều bộ lịch cố định (Latimier, Peyre và Ramus 2021, [doi:10.1007/s10648-020-09572-8](https://doi.org/10.1007/s10648-020-09572-8); Lindsey và cs. 2014, [doi:10.1177/0956797613504302](https://doi.org/10.1177/0956797613504302)), còn việc hai bộ lập lịch sinh ra "nợ ôn tập" là lập luận kỹ thuật, không phải kết luận của hai bài báo đó. Vì vậy chỉ Vega xác thực, khử trùng và lên lịch bằng FSRS. Nhà sản xuất không bao giờ ghi `cards.json` hay `reviews.jsonl`.

Hợp đồng `vega-card-inbox.v1`:

- **Tệp:** `<hub>/.vega/inbox/<producer>-<YYYYMMDDTHHmmss>-<6 hex>.jsonl`, mỗi lô một tệp mới, UTF-8, mỗi dòng một đối tượng JSON, ghi nguyên tử (`<tên>.jsonl.tmp` rồi đổi tên). Vega bỏ qua tệp `*.tmp`, thư mục con và tệp không phải `.jsonl`.
- **Dòng:** `{v: 1, t, producer, key, subject, deck?, kind?, front, back, hint?, hook?, origin: {kind, path, locator?, href?}, tags?, reason?}`. Trường lạ bị từ chối. `key` là khóa chống trùng ổn định, phải bắt đầu bằng `<producer>:` (ví dụ `polaris:Machine_Learning:ERR_2026-10-12_ab12cd`, `orion:Lab_1:check_sum`, `mira:vong-lap-for:stop-3`, `rigel:GCI_World_2026_September:D3#12:9f2c1a0b`). `origin.href` thành liên kết bấm được trong bài ôn tập nên liên kết `javascript:`, `data:`, `vbscript:` bị từ chối.
- **Bổ sung 2026-10-13 (tương thích ngược, vẫn là v1):** nhà sản xuất mới `rigel` (Rigel, hỏi đáp có nguồn dẫn trên tài liệu bài học của người học) và loại nguồn mới `rigel-ref` (một đoạn tài liệu bài học có thể trích dẫn: `origin.path` = đường dẫn tuyệt đối của tệp nguồn, `origin.locator` = `<ref> · <slide/trang/mục>` như `D3#12 · slide 7`, `origin.href` tùy chọn). Quy ước khóa `rigel:<môn hoặc khóa học>:<ref>:<8 hex đầu của sha1(front)>`. Vega chấp nhận cả hai giá trị trong bộ xác thực hộp thư, trong các loại nguồn của thẻ và trong `vega_add`; không có gì khác thay đổi.
- **Nạp thẻ** (bước đầu của `vega_sync`, hoặc `vega_inbox { action: "ingest" }`): xử lý tệp theo thứ tự tên; xác thực nghiêm ngặt từng dòng; `key` đã có (thẻ đang học, tạm dừng hoặc đã xóa mềm) thì bỏ qua và tính là trùng; dòng hợp lệ còn lại thành thẻ mới trạng thái New của FSRS (`created` = `t` của dòng). Tệp xử lý xong chuyển sang `inbox/done/`; dòng không hợp lệ, kèm trường `_error`, ghi vào `inbox/rejected/<cùng tên>`. Nạp là bất biến: chạy lại không đổi gì.
- **Xem trước:** `vega_inbox { action: "list" }` cho biết tệp đang chờ, số dòng và kết quả xác thực thử, không ghi gì.
- **Bộ slide ôn tập:** thẻ có `origin.href` cho slide `srs` mang `origin: {label, href}` với nhãn tiếng Việt ngắn như `Mira · điểm dừng 3`, `Sổ lỗi · ERR_2026-10-12_ab12cd`, `Orion · <phép kiểm tra>` hoặc, với nguồn `rigel-ref` (có hay không có `href`), `Tài liệu · D3#12 · slide 7`.
- **Xóa mềm:** `vega_delete` lưu `key` của thẻ trên dòng "deleted" trong `reviews.jsonl`, nên nhà sản xuất gửi lại thẻ mà người học đã xóa sẽ không làm thẻ đó quay lại.

Đọc đầy đủ quy tắc bằng `vega_guide { topic: "inbox" }`.

---

## Danh Mục Công Cụ, Prompts & Lệnh CLI

### Công Cụ (MCP Server qua Stdio)

- `vega_guide { topic? }`: Xem hướng dẫn quy tắc soạn thẻ, nguyên lý FSRS, quy trình vận hành, phiên ôn tập, truy xuất nguồn gốc, thống kê ghi nhớ và hộp thư thẻ (`overview`, `rules`, `fsrs`, `workflows`, `candidates`, `origins`, `session`, `stats`, `inbox`).
- `vega_candidates { path, from?, subject? }`: Trích xuất tất định ứng viên thẻ từ Polaris `facts.json`, `errorlog.md` hoặc Aurora `deck.json`.
- `vega_add { cards, hub? }`: Kiểm tra hợp lệ, khử trùng lặp (cùng nguồn + mặt trước, hoặc cùng `key` tùy chọn), gán ID và khởi tạo trạng thái FSRS ban đầu. Thẻ có thể mang `key` và `origin.href`.
- `vega_inbox { action: "list" | "ingest", hub? }`: Xem trước (không ghi gì) hoặc nạp hộp thư thẻ; báo cáo số tệp đã đọc, thẻ tạo mới, thẻ trùng và dòng bị từ chối kèm lý do (tiếng Việt).
- `vega_edit { id, patch, hub? }`: Chỉnh sửa nội dung mặt trước, mặt sau, gợi ý, mỏ neo hoặc thẻ phân loại.
- `vega_suspend { id, suspended?, hub? }`: Tạm dừng hoặc kích hoạt lại thẻ trong hàng đợi ôn tập.
- `vega_delete { id, hub? }`: Xóa mềm thẻ (loại khỏi bộ sưu tập đang học và ghi nhận sự kiện vào lịch sử, kèm `key` của thẻ nếu có).
- `vega_due { subject?, limit?, new_limit?, date?, hub? }`: Lấy hàng đợi hôm nay (thẻ quá hạn -> thẻ đến hạn -> thẻ mới có giới hạn) kèm dự báo tải 7 ngày tới.
- `vega_session { date?, limit?, new_limit?, subject?, build?, hub? }`: Tạo bộ slide ôn tập hôm nay vào `.vega/session/` và biên dịch với Aurora CLI.
- `vega_sync { file?, hub? }`: Nạp hộp thư thẻ trước (số liệu có trong phản hồi), rồi đồng bộ kết quả đánh giá từ `.vega/session/progress.jsonl` hoặc file xuất vào FSRS một cách bất biến.
- `vega_review { id, rating, ms?, date?, via?, hub? }`: Đánh giá kết quả ôn tập (`again`, `hard`, `good`, `easy`) và cập nhật trạng thái FSRS.
- `vega_stats { subject?, date?, hub? }`: Thống kê thẻ theo trạng thái, số lượt ôn hôm nay, số lần again ở bước học, tỉ lệ nhớ thực tế 30 ngày (chỉ tính thẻ Review), thẻ vướng (`lapses >= 6`) và dự báo khối lượng học.

### Prompts Hướng Dẫn

- `review_today { date?, subject?, hub? }`: Quy trình ôn tập trọn gói hàng ngày (`vega_sync` -> `vega_session` -> học tương tác -> `vega_sync`).
- `make_cards { path, subject?, hub? }`: Quy trình tạo thẻ chuẩn mực (`vega_candidates` -> viết lại theo 6 quy tắc -> `vega_add`).

### Dòng Lệnh (CLI)

```bash
# Tạo bộ slide ôn tập hôm nay
node dist/vega.mjs session

# Nạp hộp thư thẻ, rồi đồng bộ đánh giá từ Aurora vào FSRS
node dist/vega.mjs sync

# Xem trước hộp thư thẻ (không ghi gì) / nạp hộp thư (thêm --json để lấy dữ liệu máy đọc được)
node dist/vega.mjs inbox list
node dist/vega.mjs inbox ingest

# Xem hàng đợi ôn tập hôm nay
node dist/vega.mjs due

# Đánh giá kết quả thẻ trực tiếp
node dist/vega.mjs review c_12345 good

# Xem thống kê ghi nhớ và tỉ lệ lưu giữ
node dist/vega.mjs stats

# Trích xuất ứng viên từ bài giảng Aurora hoặc Polaris
node dist/vega.mjs candidates path/to/deck.json

# Xem cẩm nang hướng dẫn
node dist/vega.mjs guide stats
```

---

## Lịch Sử Phiên Bản (Version History)

- **v0.3.1**: Bổ sung hợp đồng 2026-10-13 cho `vega-card-inbox.v1` (tương thích ngược, vẫn là v1): nhà sản xuất hộp thư mới `rigel` (Rigel, hỏi đáp có nguồn dẫn trên tài liệu bài học của người học; tiền tố khóa `rigel:`) và loại nguồn mới `rigel-ref` (một đoạn tài liệu bài học có thể trích dẫn; `path` = đường dẫn tuyệt đối của tệp nguồn, `locator` như `D3#12 · slide 7`). Cả hai được bộ xác thực hộp thư, các loại nguồn của thẻ và đầu vào `vega_add` chấp nhận; slide `srs` của bộ ôn tập gắn nhãn `Tài liệu · <locator>` cho các thẻ này; chủ đề hướng dẫn `inbox` và `origins` nêu nhà sản xuất mới. Tệp hộp thư và `cards.json` cũ vẫn tải bình thường. e2e: thêm các kiểm tra Rigel (xác thực, nạp thẻ kèm khóa và nhãn, từ chối tiền tố khóa sai, `vega_add`, nhãn phiên ôn, hướng dẫn) và kiểm tra phiên bản nay mong đợi 0.3.1.
- **v0.3.0**: Vega trở thành hàng đợi ôn tập duy nhất của hệ sinh thái MCP. Hợp đồng hộp thư thẻ dùng chung `vega-card-inbox.v1`: các nhà sản xuất (Polaris, Orion, Mira, ...) thả ứng viên thẻ dạng `*.jsonl` vào `<hub>/.vega/inbox/`; Vega xác thực nghiêm ngặt, khử trùng theo `key` (thẻ đang học, tạm dừng và đã xóa mềm), tạo thẻ mới trạng thái New của FSRS, chuyển tệp đã xử lý sang `inbox/done/` và ghi dòng bị từ chối kèm `_error` vào `inbox/rejected/`, một cách bất biến. Công cụ mới `vega_inbox { action: "list" | "ingest" }` và lệnh CLI `vega inbox list|ingest`; `vega_sync` nạp hộp thư trước và báo số liệu. Thẻ có thêm `key` tùy chọn và duy nhất; nguồn gốc có thêm `href` và các loại `polaris-selfcheck`, `aurora-predict`, `orion-attempt`, `mira-stop`; `vega_delete` giữ `key` trên dòng nhật ký. Slide `srs` của bộ ôn tập mang `origin: {label, href}` cho thẻ có `origin.href`. Chủ đề hướng dẫn `inbox`. File `cards.json` cũ vẫn tải bình thường. e2e: kiểm tra CLI `due` nay cố định `--date 2026-10-11` (trước đó so sánh một ngày cố định với đồng hồ thật).
- **v0.2.2**: Định dạng công thức toán KaTeX và mặt trước cụ thể cho trang vở Aurora notebook (thẻ công thức bọc `$$...$$` để Aurora hiển thị chuẩn bằng KaTeX trong phiên ôn tập; mặt trước bọc vế trái trong `$...$`; tách dòng nhiều công thức ngăn cách bởi `\quad`, `\qquad` hoặc `;` thành từng thẻ riêng biệt; dòng quy tắc và mỏ neo dùng định dạng "Quy tắc cốt lõi · <tiểu mục>" / "Mỏ neo trí nhớ · <tiểu mục>"; khử trùng lặp đảm bảo không có 2 thẻ cùng mặt trước trong một deck); cập nhật quy tắc soạn thẻ trong cẩm nang hướng dẫn.
- **v0.2.1**: Tính toán và báo cáo Tỉ lệ nhớ thực tế (True Retention) chuẩn hóa theo FSRS / Anki: chỉ tính trên các thẻ ở trạng thái Review (`passed / (passed + failed)`); loại trừ bước học (Learning) và học lại (Relearning); bổ sung chỉ số "Learning-step again" đếm riêng lượt again khi mới học thẻ; bổ sung chủ đề hướng dẫn `stats`; tương thích ngược với các file nhật ký cũ không lưu trường state_before.
- **v0.2.0**: Tích hợp phiên ôn tập Aurora Slides SRS (`vega_session`), tự động đồng bộ bất biến từ `progress.jsonl` (`vega_sync`), tối ưu hóa tái sử dụng thư mục `.vega/session/`, thêm prompt `review_today` và `make_cards`.
- **v0.1.0**: Bản phát hành đầu tiên với 9 MCP tools, thuật toán FSRS qua `ts-fsrs`, trích xuất tất định ứng viên từ Polaris facts/error logs và Aurora decks, lưu trữ nguyên tử trong `.vega/`.

---

## Bên Thứ Ba (Third-Party)

- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) (v5.4.2) - MIT License. Thư viện TypeScript thực thi thuật toán Free Spaced Repetition Scheduler.

---

## Bản Quyền (License)

MIT License (c) 2026 DuongNAD.
