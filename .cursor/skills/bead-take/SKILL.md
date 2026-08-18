---
name: bead-take
description: Dùng khi user gõ /bead-take, hoặc yêu cầu nhận việc/claim/làm một bead cụ thể từ board beads (bd). Nhận một bead, làm trong worktree riêng, đóng bằng bằng chứng.
disable-model-invocation: true
---

# bead-take

Bạn nhận việc theo bead **user gõ sau `/bead-take`** (`<bead-id> [ghi chú thêm]`).
Không có id → chạy `bd ready --json`, đề xuất bead ưu tiên cao nhất và hỏi trước khi claim.

## 0. Đọc trước khi làm

- `bd show <bead-id>` — đọc KỸ cả description lẫn NOTES: **điều kiện đóng nằm ở đó**,
  và note RE-MEASURE mới nhất (nếu có) là số đo đáng tin hơn description.
- Đọc doc quy ước của repo (`CLAUDE.md`/`AGENTS.md`… nếu có). Khi bead và doc mâu
  thuẫn: bead thắng cho tới khi đo lại.
- Nếu bead là bug → làm theo quy trình debug có hệ thống (skill
  `systematic-debugging` nếu môi trường có) trước khi sửa. Nếu là feature/refactor →
  TDD (skill `test-driven-development` nếu có).

## 1. Claim + worktree riêng

```bash
bd update <bead-id> --claim
git worktree add -b work/bead-<bead-id> ../wt-<bead-id> <BASE>
```

- `<BASE>` = **nhánh tích hợp của dự án**: nhánh user chỉ định, hoặc nhánh hiện tại
  của cây chính (`git branch --show-current`). Đừng mặc định `origin/main` khi dự án
  đang tích hợp trên nhánh khác.
- Công cụ worktree tự động của harness chỉ dùng khi chắc chắn nó nhánh từ đúng
  `<BASE>` — nhiều harness mặc định nhánh từ `origin/main`, thiếu commit của nhánh
  tích hợp. Không chắc thì tự `git worktree add` như trên.
- Worktree mới **không có artefact bị gitignore** (venv, `node_modules`, build
  cache). Cài đặt thật trong worktree trước khi tin bất kỳ kết quả build/test nào.
- Cây chính có thể đang có session khác: không đụng file ngoài scope bead.

## 2. Làm việc

- Đo hiện trạng TRƯỚC khi sửa (grep/LOC/chạy test) — nếu số đo khác note bead,
  append đính chính vào bead rồi mới làm tiếp.
- Theo pattern hiện có của repo (đọc doc kiến trúc nếu có) — reuse trước, invention
  sau; abstraction mới cần ≥2 caller thật ngay hôm nay.
- Việc phát sinh ngoài scope → `bd create` ngay, KHÔNG mở rộng scope bead đang làm,
  KHÔNG dùng todo tool/markdown checkbox thay cho board.

## 3. Trả việc — bằng chứng trước, tuyên bố sau

- Chạy test thật, đọc **exit code** (không `echo OK`; `rc=0` mà không có output là
  tín hiệu lỗi, không phải pass). Ghi lại lệnh + kết quả. Verdict đọc từ output
  máy-đọc-được của test runner (junitxml, JSON reporter…) khi có — dòng summary
  cuối có thể bị truncate khi capture.
- Snapshot/file sinh tự động bị trip → regenerate **trong cùng commit**.
- Commit: `git add <đúng path>` ngay trước commit, và `git commit --only <path>…` —
  tuyệt đối không `git add -A`, không stage sớm.
- Đóng: `bd close <bead-id> --reason "<bằng chứng: file:line, tên test đã chạy + kết quả, commit hash>"`.
  - Điều kiện đóng chưa đủ → **KHÔNG đóng**: `bd update <bead-id> --append-notes "RE-MEASURE <ngày> (HEAD <sha>): …còn thiếu gì, vì sao"`.
  - Nợ còn lại phải **liệt kê từng mục** trong reason/note — không im lặng, không báo số lượng suông.
- Bàn giao: báo file đã đổi, lệnh verify + output, trạng thái bead, và lệnh
  commit/push đề xuất — **không tự push/sync** trừ khi được yêu cầu (profile conservative).
