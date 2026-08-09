---
description: Nhận một bead, làm trong worktree riêng theo superpowers, đóng bằng bằng chứng
argument-hint: <bead-id> [ghi chú thêm]
---

Bạn nhận việc theo bead: **$ARGUMENTS**

## 0. Đọc trước khi làm

- `bd show <bead-id>` — đọc KỸ cả description lẫn NOTES: **điều kiện đóng nằm ở đó**,
  và note RE-MEASURE mới nhất (nếu có) là số đo đáng tin hơn description.
- Đọc `CLAUDE.md` (Craft rules + Recurring regressions). Khi bead và doc mâu thuẫn:
  bead thắng cho tới khi đo lại.
- Nếu bead là bug → invoke skill `superpowers:systematic-debugging` trước khi sửa.
  Nếu là feature/refactor → `superpowers:test-driven-development`.

## 1. Claim + worktree riêng

```
bd update <bead-id> --claim
git worktree add ../wt-<bead-id> dev-1.0-GA
```

- **KHÔNG dùng EnterWorktree mặc định** — nó nhánh từ `origin/main`, thiếu commit
  của `dev-1.0-GA`. Tự `git worktree add` rồi làm trong đó.
- Cây chính có thể đang có session khác: không đụng file ngoài scope bead.

## 2. Làm việc

- Đo hiện trạng TRƯỚC khi sửa (grep/LOC/chạy test) — nếu số đo khác note bead,
  append đính chính vào bead rồi mới làm tiếp.
- Theo pattern nhà (Ports&Adapters, Protocol DI, façade re-export, ratchet 2 chiều…) —
  reuse trước, invention sau; abstraction mới cần ≥2 caller thật ngay hôm nay.
- Việc phát sinh ngoài scope → `bd create` ngay, KHÔNG mở rộng scope bead đang làm,
  KHÔNG dùng TodoWrite/markdown checkbox.

## 3. Trả việc — bằng chứng trước, tuyên bố sau

Invoke skill `superpowers:verification-before-completion` rồi:

- Chạy test thật, đọc **exit code** (không `echo OK`; `rc=0` mà không có output là
  tín hiệu lỗi, không phải pass). Ghi lại lệnh + kết quả.
- Contract/snapshot bị trip → regenerate **trong cùng commit** (xem CLAUDE.md).
- Commit: `git add <đúng path>` ngay trước commit, và `git commit --only <path>…` —
  tuyệt đối không `git add -A`, không stage sớm.
- Đóng: `bd close <bead-id> --reason "<bằng chứng: file:line, tên test đã chạy + kết quả, commit hash>"`.
  - Điều kiện đóng chưa đủ → **KHÔNG đóng**: `bd update <bead-id> --append-notes "RE-MEASURE <ngày> (HEAD <sha>): …còn thiếu gì, vì sao"`.
  - Nợ còn lại phải **liệt kê từng mục** trong reason/note — không im lặng, không báo số lượng suông.
- Bàn giao: báo file đã đổi, lệnh verify + output, trạng thái bead, và lệnh
  commit/push đề xuất — **không tự push/sync** trừ khi được yêu cầu (profile conservative).
