---
name: bead-fleet
description: Dùng khi user gõ /bead-fleet, hoặc yêu cầu chạy song song nhiều bead auto-ok tới khi hết việc. Orchestrator spawn agent theo lô — mỗi bead một worktree, rebase + ff-only về nhánh tích hợp, dọn worktree.
disable-model-invocation: true
---

# bead-fleet

Bạn chạy **fleet** `/bead-fleet`. **Tham số = phần text user gõ sau lệnh**
(`[--batch N] [--include-partial] [--unattended]`).

**BẠN LÀ ORCHESTRATOR — bạn không tự sửa code.** Bạn: chọn lô, spawn agent, VERIFY
tuyên bố của agent, rebase → ff-only merge, ghi board, dọn worktree. Lặp tới `HET VIEC`.

`--batch N` mặc định 4 (xem §1c). `--unattended` bật §5.
`<BASE>` = **nhánh tích hợp của dự án**: nhánh user chỉ định, hoặc nhánh hiện tại
của cây chính (`git branch --show-current`) — chốt một lần ở đầu phiên.

## 0. Bất biến — vi phạm một cái là mất cả đêm

- **Mọi ghi lên beads** (`--claim`, `close`, `create`, `dep`, `--append-notes`) do
  **BẠN** chạy ở cây chính. Agent chỉ ĐỌC. `bd list`/`bd show` từ worktree đã đo là
  chạy đúng (`.beads/metadata.json` được track). Hai `bd` ghi đồng thời có an toàn
  không thì chưa đo → đừng thử.
- **Không `git push`, không `bd sync`** trừ khi user cho phép trong lượt này. Lịch sử
  giữ tuyến tính (ff-only) và chưa push ⇒ sáng ra `git reset --hard <sha đầu>` là hoàn
  tác được cả đêm. Đó là lưới an toàn duy nhất — đừng phá nó bằng một cú push.
- **Không tin tuyên bố nào của agent.** Verify: grep tại đúng `file:line` agent nói ·
  chạy lại đúng lệnh test agent nói · đọc exit code thật. `rc=0` không output là tín
  hiệu LỖI. Verdict test đọc từ report máy-đọc-được (`--junitxml`, JSON reporter…),
  KHÔNG đọc dòng summary — đã đo dòng summary bị truncate khi capture trên Git Bash.
- **Skip ≠ pass.** Sau mỗi lô, với mọi file test bị lô đó chạm, đếm trong report
  máy-đọc số `ran`/`skipped`/`FAIL` theo file/classname. Một test mới bị skip lặng lẽ
  trông y hệt rc=0 với nó pass.

## 1. Chọn lô

Extract khối bash §1 của `.cursor/skills/bead-loop/SKILL.md` bằng `awk` rồi chạy —
đừng gõ lại (nó là nguồn duy nhất của luật nhãn + lọc blocker). Từ hàng `auto-ok`
sẵn sàng, lọc tiếp:

a. **Không cạnh dep trong cùng lô** — `bd ready` đã lọc blocker, nhưng kiểm thêm
   `bd dep tree <id>` giữa các bead cùng lô.
b. **Footprint file rời nhau.** Đọc description, đoán file bị chạm; trùng file → khác lô.
c. **Tối đa MỘT bead/lô được regenerate file sinh tự động dùng chung** (golden file,
   snapshot API surface, schema/enum export, contract freeze…). Hai agent regenerate
   cùng file thì rebase hoà được về mặt **text** nhưng nội dung SAI — không test nào
   bắt được.
d. **Loại khỏi fleet, báo lại cho user, KHÔNG tự quyết** — bead mà điều kiện đóng chứa
   một lựa chọn (`bd show` có "quyết định", "RE-SCOPE", "đề xuất … chọn", hoặc hai
   phương án ngang nhau). Nhãn `auto-ok` nói *code làm được*, không nói *scope đã chốt*.

In lô đã chọn + **lý do từng bead bị hoãn**. Không im lặng cắt bớt.

## 2. Spawn — tất cả trong MỘT message

```
git worktree add -b work/bead-<id> ../wt-<id> <BASE>
```
Công cụ worktree tự động của harness chỉ dùng khi chắc nó nhánh từ đúng `<BASE>` —
nhiều harness mặc định nhánh từ `origin/main`, thiếu commit nhánh tích hợp.

**Worktree mới KHÔNG có artefact bị gitignore** (venv, `node_modules`, build cache).
Mỗi stack một cái bẫy riêng, đừng gộp:

- **Python:** nếu repo dùng một venv duy nhất ở cây chính và nó là editable install
  trỏ vào `src/` của **cây chính**, chạy nó từ worktree có thể import package từ cây
  chính ⇒ test xanh mà không test gì của agent. Bắt agent chứng minh trước (§B bước 0).
- **JS/TS:** không có `node_modules` thì typecheck/test chạy không nổi. Chạy trình
  cài đặt **thật** trong worktree (`npm ci`/`pnpm install --frozen-lockfile`…) —
  KHÔNG symlink/junction `node_modules` từ cây chính: đã đo junction làm vitest fail
  hàng loạt ("Vitest failed to find the current suite") dù cùng test file + cùng
  binary pass sạch trong cây chính — nghi dual-module-loading giữa đường dẫn junction
  và đường dẫn thật. Cài đặt cần mạng và vài phút — nếu fail thì bead đó KHÔNG được
  merge, đánh dấu `--append-notes`, không merge mù.
- **Toolchain có cache theo user** (Gradle `~/.gradle`, pip cache, cargo registry…)
  thường chạy được từ worktree không cần cài lại — kiểm một lệnh build nhỏ trước khi tin.

Rồi spawn 1 agent/bead bằng brief ở §B, điền `<ID>`, đường dẫn worktree, và thông tin
toolchain (đường dẫn python/venv, package cần import-proof…) của repo.

## 3. Tích hợp — TUẦN TỰ, một bead một lúc, đúng thứ tự này

Thứ tự là load-bearing: **rebase viết lại SHA**, nên `bd close` phải đi SAU rebase,
không thì reason trích một SHA không còn trên nhánh (chỉ còn trong reflog tới khi gc).

1. Verify tuyên bố agent (§0). Không đạt → **KHÔNG merge**, sang §5.
2. Trong worktree: `git rebase <BASE>`.
3. **SAU rebase**, trong worktree: chạy lại test của chính bead + mọi gate
   snapshot/contract + lint nhanh của repo. Cây sau rebase là cây **chưa agent nào test**.
4. Cây chính: `git merge --ff-only work/bead-<id>`.
5. `bd close <id> --reason "<file:line · tên test + rc thật · commit SAU rebase>"`.
   Bead `auto-partial` → **KHÔNG close**, chỉ
   `bd update <id> --append-notes "RE-MEASURE <ngày> (HEAD <sha>): đã làm gì, commit nào, còn thiếu gì và VÌ SAO cần người"`.
   Đóng nó là biến "chưa đo" thành "đã pass" — ngược hẳn lý do nó được phân loại thế.
6. `git worktree remove ../wt-<id>` rồi `git branch -d work/bead-<id>` (`-d`, KHÔNG `-D`).

## 4. Gate hợp thành — MỘT lần sau mỗi lô

- Chạy **full gate của repo**: lint + typecheck + full test suite — lệnh lấy từ
  doc quy ước / cấu hình CI / script trong `package.json`/`pyproject`/`Makefile`,
  không tự bịa.
- **Pin đúng version tool như CI trước khi đọc kết quả lint/format.** Đổi version là
  đổi rule set: đã đo trên cùng một cây không đổi, version cũ nói "All checks
  passed!", version mới báo hàng nghìn lỗi. Thấy con số kiểu đó là đang đo cái
  *tool*, không phải repo.
- Verdict test đọc từ report máy-đọc-được (§0). Suite lớn: xuất `--junitxml`/JSON
  rồi đọc số liệu. Đọc config của runner trước khi thêm flag — flag xung đột với
  config sẵn có (vd. tắt plugin mà `addopts` vẫn truyền tham số của nó) làm runner
  chết trước khi chạy test nào.
- **Không chạy 2 suite song song** nếu chúng chia sẻ fs/port/DB state.
- Đỏ → §5. Xanh → quay lại §1.

## 5. Chính sách thất bại (bắt buộc khi `--unattended`)

Mục tiêu: **tiến được mà không cần người**, và không bao giờ merge thứ chưa chứng minh.

- Test của bead đỏ → agent sửa tối đa **2** vòng. Vẫn đỏ → bỏ bead đó khỏi lô,
  `--append-notes` ghi *nguyên văn* lỗi + lệnh tái tạo, xoá worktree, **đi tiếp bead khác**.
- Xung đột rebase ở file **thường** → sửa trong worktree, chạy lại §3.3.
- Xung đột rebase ở **file sinh tự động/snapshot** → **KHÔNG tự hoà**. Bỏ bead,
  append-notes. Hoà nhầm ở đây tạo một snapshot xanh mà nội dung sai.
- Gate hợp thành đỏ sau khi đã ff-only merge → tìm bead gây ra bằng `git bisect` trên
  đúng dải commit của lô; `git revert` bead đó, `bd update --append-notes`, re-open bead
  bằng `bd update <id> --status open`. **Không** `git reset --hard` (nó cũng xoá bead khác).
- Nợ mới phát hiện → `bd create` ngay (kèm `--parent <epic>` + nhãn phân loại + lý do
  đo được). Không epic nào phù hợp thì tạo epic — đừng nhét tạm vào một epic "nợ
  chung" không liên quan.
- **Dừng hẳn và chờ người** đúng 3 trường hợp: (a) một bead cần quyết định scope
  (§1d) mà không còn bead nào khác chạy được; (b) gate hợp thành đỏ mà bisect không
  chỉ được thủ phạm; (c) `bd` hoặc `git` trả lỗi bạn chưa từng thấy — đừng đoán.

## 6. Dừng + dọn cuối

`HET VIEC` → dọn tận gốc:
- `git worktree list` · `ls -d ../wt-*` · `git worktree prune`
- `git branch --list` tìm nhánh **mồ côi** của agent (đã merge, `ahead=0`, nhưng
  không còn directory trên đĩa ⇒ `git worktree list` KHÔNG thấy chúng, nên các lần
  dọn trước dễ bỏ sót). Xoá bằng `git branch -d`.

Báo cáo cuối, mỗi mục liệt kê **từng cái**, không báo số lượng suông:
bead đã đóng + SHA · bead `auto-partial` chỉ append-notes + VÌ SAO · bead bỏ giữa
đường + lỗi nguyên văn · bead mới `bd create` + epic + nhãn · `needs-human` còn lại +
lý do từng cái · bead cần user quyết (§1d) + các phương án · lệnh `git push` / `bd sync`
đề xuất (không tự chạy).

---

## §B. Brief cho từng agent (điền rồi spawn)

```
Bạn thi công bead `<ID>` trong worktree riêng: `<WT>`. CHỈ bead này.

## Bước 0 — CHỨNG MINH bạn đang test cây của mình (đừng bỏ)
Worktree không có artefact bị gitignore (venv, node_modules…).
- Python (repo có venv editable-install ở cây chính): với cwd = `<WT>`, chạy:
      <VENV_PY> -c "import <PKG>; print(<PKG>.__file__)"
  Đường dẫn in ra PHẢI nằm trong `<WT>`. Không phải thì DỪNG và báo orchestrator —
  đừng "chạy thử xem sao", test sẽ xanh trên code không phải của bạn.
- JS/TS: kiểm `node_modules` có trong `<WT>` chưa (phải là cài đặt thật, KHÔNG phải
  symlink/junction từ cây chính); chưa có thì báo orchestrator, đừng tự cài.

## Bước 1 — Đọc rồi ĐO trước khi sửa
- `bd show <ID>`: điều kiện đóng nằm trong NOTES; note RE-MEASURE mới nhất đáng tin
  hơn description. Bead thắng doc cho tới khi đo lại.
- Đọc doc quy ước của repo (CLAUDE.md/AGENTS.md… nếu có).
- Grep tại đúng file:line bead nói. Số đo khác note → báo orchestrator append đính
  chính TRƯỚC khi sửa (line number trong bead đã từng sai).
- Bug → quy trình debug có hệ thống (skill `systematic-debugging` nếu có).
  Feature/refactor → TDD (skill `test-driven-development` nếu có).

## Bước 2 — Làm
- Reuse trước, invention sau. Grep tìm owner hiện có trong repo (error type, path
  helper, config loader, HTTP client wrapper, validation…) trước khi viết mới.
  Abstraction mới cần ≥2 caller THẬT hôm nay.
- Guard viết dạng ALLOWLIST, không `!= <giá trị xấu>`; pin bằng test iterate qua
  tập giá trị hợp lệ. Map state phải vét cạn — không default lặng lẽ.
- "Chưa đo" ≠ 0: `None`/`null`/cột để trống, và giữ phân biệt đó qua MỌI hop —
  một `or []` ở layer trên là đủ để xoá sạch fix.
- Tôn trọng ranh giới layer của repo (router/service/store, UI/domain/data…):
  logic đặt đúng tầng, không import ngược chiều phụ thuộc.

## Bước 3 — NỢ KỸ THUẬT: phân biệt 2 loại, đây là chỗ dễ sai nhất
NỢ DO THAY ĐỔI CỦA BẠN SINH RA → fix sạch trong worktree này, cùng commit:
  lint + typecheck sạch trên vùng bạn chạm · mọi snapshot/file sinh tự động bị trip
  (regenerate CÙNG commit) · doc/docstring thành sai → sửa ngay (doc cũ LÀ bug) ·
  field/API mới → cập nhật MỌI consumer trong repo cùng commit hoặc nói rõ VÌ SAO
  consumer đó không cần · mọi path mới phải có test · quy ước riêng của repo
  (registry, audit log, migration checklist… — đọc doc quy ước) làm đủ.
NỢ CÓ TRƯỚC, không liên quan → báo orchestrator `bd create`. KHÔNG mở rộng scope,
  KHÔNG todo tool, KHÔNG markdown checkbox.
NGOẠI LỆ: bạn làm một branch CHƯA TỪNG CHẠY trở nên chạy được ⇒ bạn là chủ nó, bug
  có trước vẫn là việc của bạn.

## Bước 4 — Test
- Chạy test bằng runner + config của repo; xuất report máy-đọc được
  (`--junitxml=<file>.xml` với pytest, JSON reporter với runner khác), đọc verdict
  từ report — KHÔNG tin dòng summary (từng đo bị truncate khi capture).
- Đọc config runner trước khi thêm flag — flag xung đột với addopts/config sẵn có
  làm runner chết trước khi chạy test nào.
- Fix chỉ được coi là chứng minh khi bạn TÁI TẠO điều kiện lỗi: gỡ sửa chữa tay ra,
  chạy lại, xác nhận CODE tự làm được.
- Repo hỗ trợ đa OS thì code phải xanh trên các OS đó: `encoding="utf-8"` tường
  minh · không assert path bằng separator cứng · không API POSIX-only
  (`SIGKILL`/`fcntl`…) không guard · không ký tự NUL thô trong source.

## Bước 5 — Commit rồi TRẢ VIỆC
Bạn KHÔNG `bd close`, KHÔNG `bd update`, KHÔNG rebase, KHÔNG merge, KHÔNG push.
- `git add <đúng path>` ngay trước commit, rồi `git commit --only <path>…`. Tuyệt đối
  không `git add -A`, không stage sớm: `git add <path> && git commit` vẫn commit TOÀN
  BỘ index, đã từng quét việc dở của session khác vào commit người ta.
- Báo về: file đã đổi · lệnh verify + **exit code thật** + đường dẫn report · commit
  SHA · nợ đã fix (từng mục) · nợ để lại cho `bd create` (từng mục) · consumer nào
  đã cập nhật hoặc vì sao không cần.
```
