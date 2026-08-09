---
name: bead-take
description: Nhận một bead của repo này, làm theo luật VELOX, verify bằng quality gate rồi đóng bằng bằng chứng. Dùng khi user gõ /bead-take, hoặc yêu cầu nhận việc/claim/làm một bead cụ thể (bd-xxxx), triển khai task từ board beads.
disable-model-invocation: true
---

# bead-take

Bạn nhận việc theo bead **user gõ sau `/bead-take`** (`<bead-id> [ghi chú thêm]`).
Không có id → chạy `bd ready --json`, đề xuất bead ưu tiên cao nhất và hỏi trước khi claim.

## 0. Đọc trước khi làm

- `bd show <bead-id> --json --include-comments --children` — đọc KỸ cả description lẫn **NOTES**:
  *điều kiện đóng nằm ở đó*, và note `RE-MEASURE` mới nhất (nếu có) là số đo đáng tin hơn description.
- Đọc `.velox/docs/VELOX-CONTEXT.md` (luật bắt buộc) + `CLAUDE.md`, rồi `.velox/STATUS.md` và
  `.velox/docs/roadmaps/<M###>-ROADMAP.md` để lấy chi tiết task và tránh đụng session khác.
- Task đụng UI → đọc `design-system/MASTER.md` và dùng skill `ui-ux-pro-max`.
- Cần đúng flag `bd` hay shape dữ liệu → tra
  `beads\docs\CLI_REFERENCE.md` và `internal/types/types.go`.
  **Không bao giờ** đọc `.beads/issues.jsonl` hay file Dolt để lấy dữ liệu.
- Bead là bug → dùng skill `systematic-debugging` **trước khi** sửa.
  Bead là feature/refactor → dùng skill `test-driven-development`.
- Khi bead và doc mâu thuẫn: **bead thắng** cho tới khi đo lại.

## 1. Claim + không gian làm việc

```bash
bd update <bead-id> --claim
git worktree add ../wt-<bead-id> develop   # khi chạy song song nhiều bead
```

- Base branch của repo này là **`develop`** (không phải `main`).
- Chỉ tách worktree khi thực sự chạy song song; nếu chỉ có một session thì làm ở cây chính
  nhưng **không đụng file ngoài scope bead**. Cần cô lập thật sự → giao cho subagent
  `best-of-n-runner` (tự tạo worktree + branch riêng).
- Thêm dòng vào Active Tasks trong `.velox/STATUS.md`.

## 2. Làm việc

- Đo hiện trạng **trước** khi sửa (rg/LOC/chạy test). Số đo khác note bead →
  `bd update <bead-id> --append-notes "..."` đính chính rồi mới làm tiếp.
- Build order bottom-up: `src/shared` → `src/extension` → `src/webview`.
  Sau mỗi lớp: `npm run build && npm run typecheck`.
- Theo pattern nhà — reuse trước, invention sau; abstraction mới cần ≥2 caller thật ngay hôm nay:
  - mọi lệnh `bd` đi qua `BdService`; component không tự dựng argv, gọi method khai báo trong
    `src/shared/protocol.ts`.
  - `acquireVsCodeApi()` chỉ ở `src/webview/bridge/rpc.ts`.
  - `src/shared/` không import `vscode`/`react`; `src/webview/` không import `vscode`.
  - status/type/column load runtime (`bd statuses --json`, `bd types --json`), group theo *category*.
  - màu lấy từ biến `--vscode-*`; responsive bằng container query; không font/CDN từ xa.
- Việc phát sinh ngoài scope → `bd create` ngay, **KHÔNG** mở rộng scope bead đang làm,
  **KHÔNG** dùng markdown checkbox làm task tracking (todo list chỉ dùng cho checklist trong lượt này).

## 3. Trả việc — bằng chứng trước, tuyên bố sau

Dùng skill `verification-before-completion`, rồi:

- Chạy thật và đọc **exit code**, không `echo OK`; `rc=0` mà không có output là tín hiệu lỗi, không phải pass:

```bash
npm run build && npm run typecheck && npm test && npm audit --audit-level=low
```

  Ghi lại lệnh + kết quả. Feature nào cũng phải có test (không có test = chưa xong).
- Contract/snapshot bị trip → regenerate **trong cùng commit**.
- Commit: `git add <đúng path>` ngay trước commit và `git commit --only <path>…` —
  tuyệt đối không `git add -A`, không stage sớm, không `--no-verify`.
- Cập nhật doc theo đúng thứ tự: ROADMAP (`[ ]` → `[x]` + Notes) → `.velox/STATUS.md`
  (bỏ khỏi Active, thêm vào Last Completed) → `.velox/INDEX.md` (nếu có file mới).
- Đóng: `bd close <bead-id> --reason "<bằng chứng: file:line, tên test đã chạy + kết quả, commit hash>"`.
  - Điều kiện đóng chưa đủ → **KHÔNG đóng**:
    `bd update <bead-id> --append-notes "RE-MEASURE <ngày> (HEAD <sha>): …còn thiếu gì, vì sao"`.
  - Bị chặn → chuyển bead sang Blocked trong STATUS.md, mô tả rõ blocker (gì, vì sao, cần gì để gỡ).
  - Nợ còn lại phải **liệt kê từng mục** trong reason/note — không im lặng, không báo số lượng suông.
- Bàn giao: file đã đổi, lệnh verify + output, trạng thái bead, lệnh commit/push đề xuất —
  **không tự push, không `bd dolt push/pull`** trừ khi được yêu cầu (profile conservative).
