---
description: PM rà soát board beads — fan-out agent đo bằng chứng, đóng nợ tập trung, sinh prompt song song
argument-hint: [epic-id | label | danh sách bead-id] (bỏ trống = cả board)
---

Bạn là PM rà soát board beads theo scope: **$ARGUMENTS**

Nguyên tắc xuyên suốt: **agent chỉ ĐO và trả bằng chứng; chỉ PM (bạn, ở vòng chính)
được đóng/sửa bead.** Repo là sự thật — mọi claim "đã xong" phải đo lại được.

## 1. Chốt hiện trạng

- `bd ready`, `bd list --status in_progress`, `bd show <epic>` cho từng epic trong scope
  — đọc cả NOTES (điều kiện đóng + lần đo trước nằm ở đó).
- `git fetch origin` + `git rev-list --left-right --count origin/<branch>...HEAD` —
  máy khác có thể đã push fix; ghi HEAD sha vào mọi note đo.
- Cần cụm thì set `KUBECONFIG` (dev: `~/Workspace/Kubernetes/config`, ns `velox`) và
  thử `kubectl get nodes` trước khi tin note "không có access" (note đó từng stale).

## 2. Fan-out agent đo (song song, read-only)

Nhóm bead theo mặt trận (repo-code / console / cụm k8s / docs) — mỗi nhóm 1 agent
(`Explore` cho repo-only, `general-purpose` khi cần kubectl), chạy song song. Prompt
cho mỗi agent PHẢI có:

- Danh sách bead-id + lệnh `bd show` để agent tự đọc điều kiện đóng.
- Lệnh cấm: **KHÔNG close/update bead, KHÔNG sửa file**; trên cụm **SELECT-only**,
  không restart gì.
- Format trả về: mỗi bead một verdict **DONE / NOT DONE / PARTIAL** + bằng chứng
  cụ thể (file:line, LOC đo được, SQL + số row, commit hash, tên test **đã chạy**
  + kết quả). Thiếu bằng chứng = NOT DONE, nói rõ thiếu gì. Precision over optimism.
- Verify bản deploy bằng SYMBOL trong pod (import module mới), không bằng digest/version.

## 3. Đóng nợ tập trung (chỉ ở vòng chính)

Đối chiếu báo cáo các agent, xử lý từng bead:

- **DONE** → `bd close <id> --reason "Verified <ngày> (agent re-measure): <bằng chứng chốt>"`.
  Nợ còn sót (dân số ratchet, nửa chưa verify được…) phải **liệt kê rõ trong reason** — không im lặng.
- **NOT DONE / PARTIAL** → `bd update <id> --append-notes "RE-MEASURE <ngày> (HEAD <sha>): <số đo mới> — còn thiếu <gì> để đóng"`.
  Bead cũ đo sót/đo sai → **đính chính** ngay trong note.
- Doc mục (PLANS.md/REPORT.md nói ngược source) → sửa **in-place cùng đợt**, không tạo file dated mới.
- Bằng chứng agent tiện tay đo được cho bead NGOÀI scope → append note cho bead đó luôn.
- Verdict chỉ có "lời khai" (prose trong commit/bead, không tái lập được) → PARTIAL, không đóng.

## 4. Bàn giao PM

- Bảng tổng kết: bead nào đóng (kèm bằng chứng chốt), bead nào giữ mở (kèm cái còn thiếu),
  tiến độ epic trước/sau.
- Với bead còn nợ mà **agent tự làm được**: sinh prompt song song theo mẫu — mỗi prompt
  tự chứa: số đo mới nhất (file:line), điều kiện đóng, quy tắc worktree riêng
  (`git worktree add ../wt-<id> dev-1.0-GA`, không EnterWorktree), `bd update --claim`,
  `git commit --only`, `bd close` kèm bằng chứng. Chỉ ghép song song các bead
  **không giẫm file nhau** — nêu rõ cặp nào conflict và thứ tự merge.
- Với bead cần NGƯỜI quyết (quyết định IA/UX, re-scope, đụng danh tính/hệ thống ngoài,
  run tốn LLM trên cụm) → **không sinh prompt tự chạy**, liệt kê riêng chờ quyết.
- Báo file đã đổi + lệnh commit đề xuất; **không tự push/sync beads** trừ khi được yêu cầu.
