[English](README.md) | Tiếng Việt

# Vega MCP

Vega là động cơ ghi nhớ và lặp lại giãn cách thích ứng (Adaptive Spaced Repetition - FSRS) trong hệ sinh thái học tập của người học: tích hợp trên mọi môn học, tự động trích xuất ứng viên thẻ từ tài liệu bài giảng (Polaris facts, Aurora notebook, trắc nghiệm, flashcards, cung điện trí nhớ Loci, và Sổ lỗi errorlog), phục vụ hàng đợi ôn tập hàng ngày và lưu vết trạng thái trí nhớ FSRS.

Được đặt tên theo ngôi sao Vega (sao Chức Nữ), người gặp lại Ngưu Lang đúng thời điểm mỗi năm.

---

## Hệ Sinh Thái (Ecosystem)

Toàn bộ dự án được phát triển bởi DuongNAD:

| Dự án | Vai trò | Kho mã nguồn |
| :--- | :--- | :--- |
| **Polaris** | Kiến trúc sư lộ trình & giáo trình học tập | [polaris-mcp](https://github.com/DuongNAD/polaris-mcp) |
| **Aurora Slides** | Động cơ soạn bài giảng & trình diễn tương tác | [aurora-slides-mcp](https://github.com/DuongNAD/aurora-slides-mcp) |
| **SmartDrive-OS** | Quản trị dữ liệu SSD & tìm kiếm học liệu | [smart-drive-os](https://github.com/DuongNAD/smart-drive-os) |
| **Constellation** | Quản lý đăng ký MCP & hợp đồng hệ sinh thái | [constellation-mcp](https://github.com/DuongNAD/constellation-mcp) |
| **Vega** | Động cơ lặp lại giãn cách thích ứng (FSRS) | [vega-mcp](https://github.com/DuongNAD/vega-mcp) |

---

## Vì Sao Cần Vega & FSRS?

Các hệ thống ôn tập truyền thống thường dùng các chu kỳ cố định ($D+1, D+3, D+7, D+16, D+35$). Trên thực tế, mỗi khái niệm có độ khó khác nhau:
- Thẻ dễ sẽ bị lặp lại quá nhiều lần gây lãng phí thời gian.
- Thẻ khó hoặc dễ quên lại không được lặp lại đủ sớm.

Vega sử dụng thuật toán **FSRS (Free Spaced Repetition Scheduler)** qua gói `ts-fsrs`:
- **Độ ổn định (Stability - $S$):** Số ngày để xác suất nhớ giảm xuống mức mong muốn (mặc định 90%).
- **Độ khó (Difficulty - $D$):** Thang điểm 1-10 đo độ phức tạp nhận thức của thẻ.
- **Khả năng truy hồi (Retrievability - $R$):** Xác suất nhớ lại kiến thức tại thời điểm ôn tập.
- **Chu kỳ thích ứng:** Thẻ dễ giãn cách nhanh; thẻ quên (lapse) được củng cố ngay lập tức.

---

## Nguyên Tắc Cốt Lõi

1. **Agent soạn thẻ chuẩn, Vega lên lịch:** Vega đề xuất ứng viên từ học liệu; agent tinh chỉnh theo 6 quy tắc soạn thẻ (nguyên tử hóa 1 ý/thẻ, cloze cho thuật ngữ, giữ mỏ neo trí nhớ, văn phong tiếng Việt chuẩn mực).
2. **Thuật toán chuẩn mực:** Sử dụng `ts-fsrs` (v5.4.2, MIT) được đóng gói độc lập trong một file chạy duy nhất.
3. **Lưu trữ tinh gọn:** Toàn bộ dữ liệu nằm trong thư mục `VEGA_HUB/.vega/` (mặc định `D:/02_Learning_Knowledge/.vega/`) với 2 file `cards.json` và `reviews.jsonl` qua cơ chế ghi nguyên tử (atomic writes).
4. **Nguồn gốc rõ ràng (Origin Fidelity):** Mỗi thẻ đều lưu trữ chính xác nguồn gốc (`kind`, đường dẫn file, vị trí định vị như "slide 12", "fact F1", "trạm 7") giúp học viên dễ dàng tra cứu lại bài học gốc.

---

## Danh Mục Công Cụ & Lệnh CLI

### Công Cụ (MCP Server qua Stdio)

- `vega_guide { topic? }`: Xem hướng dẫn quy tắc soạn thẻ, nguyên lý FSRS, quy trình vận hành và truy xuất nguồn gốc.
- `vega_candidates { path, from?, subject? }`: Trích xuất tất định ứng viên thẻ từ Polaris `facts.json`, `errorlog.md` hoặc Aurora `deck.json`.
- `vega_add { cards, hub? }`: Kiểm tra hợp lệ, khử trùng lặp, gán ID và khởi tạo trạng thái FSRS ban đầu.
- `vega_edit { id, patch, hub? }`: Chỉnh sửa nội dung mặt trước, mặt sau, gợi ý, mỏ neo hoặc thẻ phân loại.
- `vega_suspend { id, suspended?, hub? }`: Tạm dừng hoặc kích hoạt lại thẻ trong hàng đợi ôn tập.
- `vega_delete { id, hub? }`: Xóa mềm thẻ (loại khỏi bộ sưu tập đang học và ghi nhận sự kiện vào lịch sử).
- `vega_due { subject?, limit?, new_limit?, date?, hub? }`: Lấy hàng đợi hôm nay (thẻ quá hạn -> thẻ đến hạn -> thẻ mới có giới hạn) kèm dự báo tải 7 ngày tới.
- `vega_review { id, rating, ms?, date?, via?, hub? }`: Đánh giá kết quả ôn tập (`again`, `hard`, `good`, `easy`) và cập nhật trạng thái FSRS.
- `vega_stats { subject?, date?, hub? }`: Thống kê thẻ theo trạng thái, số lượt ôn hôm nay, tỉ lệ nhớ thực tế 30 ngày, thẻ vướng (`lapses >= 6`) và dự báo khối lượng học.

### Dòng Lệnh (CLI)

```bash
# Xem hàng đợi ôn tập hôm nay
node dist/vega.mjs due

# Đánh giá kết quả thẻ
node dist/vega.mjs review c_12345 good

# Xem thống kê ghi nhớ
node dist/vega.mjs stats

# Trích xuất ứng viên từ bài giảng Aurora hoặc Polaris
node dist/vega.mjs candidates path/to/deck.json

# Xem cẩm nang quy tắc soạn thẻ
node dist/vega.mjs guide rules
```

---

## Bên Thứ Ba (Third-Party)

- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) (v5.4.2) - MIT License. Thư viện TypeScript thực thi thuật toán Free Spaced Repetition Scheduler.

---

## Bản Quyền (License)

MIT License (c) 2026 DuongNAD.
