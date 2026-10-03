<p align="center">
  <img src="https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/media/icon.png" alt="Beads Dashboard" width="128" />
</p>

<h1 align="center">Beads Dashboard cho VS Code</h1>

<p align="center">
  Kanban, roadmap và theo dõi epic cho bộ theo dõi issue git-native <a href="https://github.com/steveyegge/beads">Beads</a> — ngay trong editor của bạn.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT" />
  <img src="https://img.shields.io/badge/VS%20Code-%5E1.105-007ACC" alt="VS Code ^1.105" />
</p>

<p align="center">
  <a href="https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/README.md">English</a> | <b>Tiếng Việt</b> | <a href="https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/README.zh-cn.md">中文</a>
</p>

---

![Beads Dashboard: sidebar, roadmap, kéo thả 1 thẻ trên board, và board tự cập nhật khi agent tạo/cập nhật issue từ terminal](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/demo.gif)

> Gần cuối đoạn demo, agent chạy `bd create` và `bd update` trong terminal. Board
> cập nhật mà không cần thao tác trong editor.

## Nó làm gì

Beads Dashboard đọc database beads cục bộ của bạn qua CLI `bd` và hiển thị qua năm tab:

- **Overview** — tổng số, phân bố trạng thái, tiến độ epic, danh sách Ready của Beads với
  **Show more** và **Claim**, cùng những việc đang bị chặn và kiểm tra Project health khi cần.
- **Roadmap** — timeline Epic → Task và chế độ List/Graph cho quan hệ phụ thuộc.
- **Board** — bảng kanban có các cột được suy ra từ *category* trạng thái của dự án bạn ngay lúc
  chạy. Có bộ lọc **Ready only**, Claim issue được chọn, kéo thẻ đổi trạng thái và swimlane theo
  taxonomy (`auto-ok` / `auto-partial` / `needs-human`).
- **Molecules** — molecule đang chạy, các bước song song, wisp và human gate; gate cho biết
  những issue đang bị chặn và có nút Resolve khi người dùng cần xử lý.
- **Fleet** — các phiên Claude Code và Codex gắn với workspace, git worktree và transcript
  của orchestrator/worker. Xem mục
  [Fleet monitor](#fleet-monitor) bên dưới.

Sidebar **Epics & Tasks** có mục "Needs You" cho các gate đang mở và issue được
gán cho bạn. Mỗi gate có action Resolve. Các thao tác nhanh (status, priority, assignee,
claim, close) dùng được từ cây thư mục, board và detail pane.

Mọi thứ đều đọc/ghi qua `bd --json`. Extension không bao giờ đọc trực tiếp `.beads/issues.jsonl`
hay file Dolt — export đó mặc định tắt tự làm mới, và upstream cũng nói rõ đọc trực tiếp là không
tương thích.

## Beads Workbench trong v0.2.0

Workbench lấy workspace theo `bd context`, kể cả worktree hoặc `BEADS_DIR`, rồi dùng tập Ready
do Beads xác định để quyết định việc có thể bắt đầu. Overview cho duyệt thêm issue Ready và
**Claim** ngay trên dòng; Board có **Ready only**. **Needs You** tập hợp việc được giao và human
gate; Molecules chỉ rõ issue nào bị mỗi gate chặn. Thao tác Claim và sửa issue dùng precondition
của CLI để xung đột được báo và tải lại, không âm thầm ghi đè.

Fleet đọc transcript Claude Code và Codex: có tải trang sự kiện cũ; khối text, thinking, lệnh
gọi tool và kết quả dài mặc định hiện bản xem trước, với **Show all / Show less** để đọc đầy đủ
từ file gốc khi cần. Payload liên-agent dạng mã hóa opaque của Codex không thể giải mã từ
transcript nên được ghi nhãn rõ.

Workbench này hiện ở `develop`, dành cho v0.2.0 chưa phát hành. Bản v0.1.7 trên `main` chưa có
toàn bộ luồng này.

## Xem trực tiếp

Các ảnh dưới đây được chụp trong editor từ dự án demo gồm năm epic, 54 issue, bốn người
và một agent. Lệnh `npm run capture:demo` tạo dữ liệu demo rồi chụp lại ảnh.

**Overview** — tổng số, phân bố trạng thái, tỷ lệ priority, khối lượng việc theo từng người, và
biểu đồ burn-up những gì đã đóng:

![Tab Overview với thống kê tổng quan, issue Ready, blocked và tiến độ dự án](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/overview.png)

**Ready → Claim** — Overview cuộn tới danh sách Ready, hiện số issue đã tải và nút Claim trên từng dòng:

![Danh sách Ready trong Overview cùng nút Claim và phạm vi dữ liệu](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/overview-ready.png)

**Overview, sync và sức khỏe dự án** — sau khi bấm Refresh và Run checks, header cho biết backend
còn hoạt động hay không, còn drawer hiển thị các kiểm tra stale/orphan/lint/dependency:

![Overview với trạng thái đồng bộ và kết quả Project health](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/overview-health.png)

**Roadmap** — timeline thật với mốc hôm nay, mỗi epic mang theo số liệu tiến độ riêng. Việc đã
đóng được gấp gọn lại phía sau:

![Roadmap với timeline các epic, task, mốc hôm nay và bộ đếm issue đã đóng đang ẩn](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/roadmap.png)

**Board** — các cột được suy ra từ *category* trạng thái ngay lúc chạy, nên 1 status tuỳ biến vẫn
rơi đúng cột. Cột Done bắt đầu ở trạng thái gấp gọn:

![Board với các cột trạng thái và thẻ chứa loại issue, nhãn, ưu tiên, hạn và assignee](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/board.png)

**Board, chỉ việc Ready** — lọc theo tập Ready gốc của Beads, không suy đoán qua status:

![Board bật bộ lọc Ready only và chỉ hiện những issue có thể bắt đầu](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/board-ready.png)

**Board, bật swimlane** — cùng 1 board, chỉ cách 1 nút bấm để nhóm theo label taxonomy thay vì 1
cột dài duy nhất: `auto-ok`, `auto-partial` và `needs-human`, mỗi lane bốn issue trong dự án này:

![Board với Swimlane đang bật: ba lane taxonomy — auto-ok, auto-partial, needs-human — mỗi lane hiện 4 issue, các cột vẫn tách theo status bên trong từng lane](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/board-swimlanes.png)

**Graph** — quan hệ phụ thuộc (blocked-by) của 1 issue dưới dạng DAG. Node kéo được tới vị trí tuỳ
ý, nhích bằng phím mũi tên, hoặc đưa về vị trí gốc bằng **Reset layout**; issue đang bị chặn được
đánh dấu màu đỏ dù nằm ở đâu trong layout:

![Graph phụ thuộc phân lớp với issue bị chặn, nút zoom và reset layout](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/graph.png)

**Molecules** — human gate và molecule đang chạy, kèm issue bị gate chặn:

![Molecules hiện hai gate và một molecule đang thực hiện](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/molecules.png)

**Molecules, mở danh sách bước** — các bước gated, đang làm, ready, done và pending:

![Danh sách bước của molecule với trạng thái và gate liên quan](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/molecules-detail.png)

**Fleet** — một orchestrator và worker gắn với git worktree `wt-*`, transcript mở bên cạnh
danh sách. Nhãn hoạt động chỉ nói về thời điểm ghi transcript, không khẳng định tiến trình còn chạy. Xem
[Fleet monitor](#fleet-monitor) bên dưới:

![Fleet với worker Claude Code được chọn và transcript mở bên cạnh](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/fleet.png)

**Fleet, transcript của một worker** — block text và thinking render qua
markdown renderer tự viết tay: heading, bold, inline code, một code block, và
kết quả `✓ PASSED`, vẽ trực tiếp thành React element, không bao giờ dùng
`dangerouslySetInnerHTML`:

![Transcript Fleet với kết quả tool đã mở và phần tóm tắt của assistant](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/fleet-transcript.png)

**Detail pane** — toàn bộ issue mà không cần rời khỏi board. Status, priority và assignee áp dụng
ngay khi bạn chỉnh, comment và composer ghi chú append-only nằm ngay bên dưới, hiện sẵn kể cả khi
chưa có comment nào:

![Detail pane cho 1 feature, hiện select status/priority, ô assignee áp dụng khi nhấn Enter, estimate, ngày hạn, epic cha, dependencies, link Append note, và composer Comments (0) với textarea gửi bằng Ctrl/Cmd+Enter](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/roadmap-detail.png)

**Sidebar** — việc cần bạn nằm trên cùng, rồi mới tới plan. Gate đang mở giờ đứng trên cả issue
được gán cho bạn, vì nó chặn công việc thật cho tới khi có người xử lý:

![Sidebar có Needs You, human gate, issue được giao và cây Epics & Milestones](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/sidebar-tree-expanded.png)

## Yêu cầu

- [`bd` CLI](https://github.com/steveyegge/beads) có trong `PATH` (hoặc set `beadsDashboard.bdPath`).
- Workspace có database mà `bd context` resolve được; `.beads` tại chỗ, worktree redirect hoặc
  `BEADS_DIR` đều có thể cung cấp đường dẫn này.

Có gì đó không chạy? [docs/TROUBLESHOOTING.md](https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/docs/TROUBLESHOOTING.md) mô tả bốn trạng thái degraded mà
extension chủ động xử lý — không có workspace folder, không có thư mục `.beads`, không có `bd`
trong `PATH`, và một `bd` chạy được nhưng từ chối — kèm thứ bạn nhìn thấy, vì sao, và cách xử lý.

## Cài đặt

Tìm **Beads Dashboard** trong tab Extensions, hoặc:

```bash
code --install-extension cuongbphv.beads-dashboard
```

Dùng **Cursor**, **Windsurf** hay **VSCodium**? Những trình soạn thảo này không truy cập được
Marketplace của Microsoft, nên cùng 1 bản build được publish lên
[Open VSX](https://open-vsx.org/) và tab Extensions của chúng sẽ tìm thấy. Mỗi release cũng kèm
theo file `.vsix` trên
[trang Releases](https://github.com/cuongbphv/beads-ui-vscode-ext/releases) để cài offline.

<details>
<summary>Build và cài từ source thay vì tải sẵn</summary>

```bash
npm install
npm run install:local     # build → package → cài đặt; rồi reload window
```

`install:local` tự nhận diện `code`, `code-insiders`, `cursor`, `windsurf` hoặc `codium`. Ép dùng
1 trình cụ thể bằng `npm run install:local -- --cli cursor`, hoặc set `VSCODE_CLI`. Muốn chỉ tạo
`.vsix` mà không cài, thêm `-- --skip-install`.

Sau khi xong: **Ctrl+Shift+P → "Developer: Reload Window"**, rồi mở icon Beads trên Activity Bar.

</details>

## Cấu hình

| Setting | Mặc định | Chức năng |
|---|---|---|
| `beadsDashboard.bdPath` | `bd` | Đường dẫn tới executable `bd`. |
| `beadsDashboard.defaultTab` | `overview` | Tab dashboard mở lên đầu tiên. |
| `beadsDashboard.issueLimit` | `2000` | Số issue tải mỗi lần refresh. |
| `beadsDashboard.pollIntervalSeconds` | `5` | Bao lâu kiểm tra thay đổi từ bên ngoài editor một lần. `0` để tắt. |
| `beadsDashboard.showClosed` | `true` | Hiện cả issue đã đóng trên board và cây thư mục. |
| `beadsDashboard.assignee` | `""` | Bạn là ai, dùng cho **Needs You**. Để trống nghĩa là dùng đúng identity mà `bd` tự nhận diện. |

Thay đổi từ bên ngoài editor được tải lại khi lần kiểm tra đang hoạt động tiếp theo
phát hiện chúng. Với Beads 1.3 và events journal đã bật, extension kiểm tra cấu hình
journal và đọc JSON Lines từ `bd events tail`; trường hợp khác dùng `bd list --limit 1`.
Mỗi 12 lần kiểm tra vẫn tải lại toàn bộ để bắt thay đổi từ sync hoặc SQL không được
ghi vào journal. Không kiểm tra khi các view Beads bị ẩn hoặc cửa sổ chạy nền.
Đặt `pollIntervalSeconds` về `0` để tắt. Extension không tự bật journal hoặc nâng cấp
database. Xem [ghi chú tương thích Beads 1.3.1](docs/BEADS-1.3.1.md).

## Lệnh

| Lệnh | Ở đâu |
|---|---|
| `Beads: Open Dashboard` | Palette, view title |
| `Beads: Refresh` | Palette, view title |
| `Beads: Show bd Output Log` | Palette — mọi argv và mọi lỗi đều nằm ở đây |
| Đổi status / priority / assignee, Claim, Close, Copy ID | Menu chuột phải trên cây, detail pane |

## Fleet monitor

Tab **Fleet** cho biết các phiên Claude Code và Codex được phát hiện trong workspace, worker
và git worktree liên quan. Worktree chưa liên kết worker được ghi là **Unassociated worktrees**;
nhãn này không khẳng định agent đã dừng. Bấm vào worker hoặc orchestrator để theo dõi transcript
từ file JSONL của chính provider. Có thể tải sự kiện cũ theo trang, tìm kiếm trong phần đã tải,
và mở nội dung khối bị cắt bằng **Show all**. Block `text` và `thinking` được render qua
một markdown renderer tự viết tay — heading, list, code fence, table, bold/italic, không phụ thuộc
thư viện ngoài — parse ra plain-data AST rồi vẽ trực tiếp thành React element, không bao giờ dùng
`dangerouslySetInnerHTML`; transcript là kênh do agent/tool kiểm soát, nên renderer này chính là
lớp bảo vệ, không phải chuyện tiện thể thêm sau.

![Transcript Fleet với kết quả tool đã mở và phần tóm tắt của assistant](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/fleet-transcript.png)

Dữ liệu lấy từ đâu:

- **Phiên và worker** — Claude Code từ `~/.claude/projects/<mangled-cwd>`; Codex từ
  `~/.codex/sessions` hoặc `CODEX_HOME/sessions`. Đường dẫn transcript phải nằm trong kho tương ứng.
- **Worktree và git status** — `git worktree list --porcelain`, sau đó `git status` /
  `git diff --numstat` cho từng worktree, đối chiếu với id bead từ brief lúc spawn worker. Worktree
  chưa đối chiếu được worker sẽ nằm ở mục "Unassociated worktrees — worker link unknown" — không
  suy luận rằng agent đã ngừng làm việc. Xem
  [#11](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/11) về thế nào là một worktree cũ.
- **Tần suất quét** — poll mỗi 5 giây là baseline luôn bật; một `FileSystemWatcher` trên
  `~/.claude/projects` được thêm vào như một fast path khi OS báo thay đổi sớm hơn. Poll không bao
  giờ bị bỏ: watcher về bản chất là best-effort (một watcher vừa khởi tạo có thể bỏ lỡ sự kiện ngay
  sau đó — đã đo thật, không suy đoán, trên một Extension Development Host thật), nên trường hợp
  xấu nhất vẫn nhanh y như chỉ poll, không chậm hơn hay bị kẹt.
- **Suy giảm, không vỡ** — provider mất dữ liệu, `git` lỗi hoặc một worktree hỏng được báo lỗi
  và giữ snapshot thành công gần nhất; có thời điểm dữ liệu và nút Retry.

Đây không phải dữ liệu `bd`, nên không đi qua `BdService` — `src/extension/fleet/` là điểm thứ ba,
có chủ đích, nằm ngoài `BdService` mà vẫn spawn process (sau probe `git config user.name` chỉ-đọc
của `actor.ts`): mọi lệnh spawn ở đây chỉ đọc, có timeout, và một worktree lỗi không bao giờ làm
trắng cả snapshot. Nó là module riêng thay vì gộp vào `actor.ts` hay `BdService` vì trả lời một câu
hỏi khác (cái gì đang trên đĩa và trong các kho transcript của agent) — xem doc comment ở đầu
`src/extension/fleet/FleetService.ts` và `src/extension/fleet/worktree-git.ts` để rõ lý do.

## Roadmap

Phân biệt tính năng đã có trong mã nguồn và kiểm chứng còn cần trước khi phát hành.

**Shipped** — đã xong, và đã có trong extension:

- **Di chuyển card bằng bàn phím** — nhấn space để nhấc một card lên, các phím mũi tên đưa nó qua
  từng cột và từng swimlane, space để thả và escape để trả nó về chỗ cũ. Screen reader đọc lên tên
  cột chứ không phải id của droppable. ([#7](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/7))
- **Fleet monitor** — các worktree và nhánh `work/bead-*` trên đĩa, xếp cạnh đúng bead chúng đang
  mang, để một worktree bỏ quên trở nên nhìn thấy được, cộng theo dõi transcript trực tiếp theo
  từng worker. Xem [Fleet monitor](#fleet-monitor) ở trên. ([#11](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/11))
- **Molecules** — molecule, các bước, wisp và human gate với action Resolve. ([#10](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/10))
- **CI cho pull request** — lint, typecheck, build, unit test và bài tương thích Beads 1.3.1
  dùng database riêng. ([#9](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/9))

**Còn cần kiểm chứng** — chạy smoke test thật trên Windows cho toàn bộ luồng v0.2.0; đường dẫn
`.cmd` shim và Git-Bash đã có test. ([#12](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/12))

**Exploring** — là một hướng đi, không phải cam kết. Chưa thiết kế, chưa mở issue.

Gate `human` trong beads vốn đã là primitive "chờ người duyệt", nên có thể làm phê duyệt từ xa mà
không cần sửa beads core: một phi đội agent dừng lại ở gate, người chịu trách nhiệm thấy nó, đọc
context rồi resolve — không nhất thiết phải đang ngồi trước máy. Khi đó extension này là nửa
trong-editor của một thứ lớn hơn, kèm thông báo khi có gate mới hoặc khi việc bị blocked. Phản biện
hướng này rất hữu ích — cứ mở issue và nói ra.

**Không nằm trong kế hoạch:** điều phối công việc. Đây là một viewer kèm quick action — nó hiển thị
những gì `bd` biết và ghi lại qua `bd`. Chạy gì tiếp theo là việc của `bd` và của thứ đang điều
khiển `bd`.

## Đóng góp

[CONTRIBUTING.md](https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/CONTRIBUTING.md) có phần cài đặt, ba luật mà mọi PR phải tôn trọng,
và cách chạy từng suite. Bản ngắn: `npm install`, `npm run watch`, **F5** — rồi `npm run demo:seed`
để có một workspace cho dev host trỏ vào, vì `.beads/` của chính repo này bị gitignore, clone về sẽ
không có database nào.

Việc chưa ai nhận được gắn nhãn [`help wanted`](https://github.com/cuongbphv/beads-ui-vscode-ext/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22); những việc gói trong một file hoặc một
workflow là [`good first issue`](https://github.com/cuongbphv/beads-ui-vscode-ext/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22). Báo lỗi thì cần log của `Beads: Show bd Output Log` và
`bd --version` — issue template hỏi đúng những thứ đó.

## Phát triển

```bash
npm run watch        # rebuild cả 2 bundle khi có thay đổi
npm run verify       # lint + typecheck + test + build + npm audit
npm test             # vitest
npm run demo:seed    # dựng workspace demo "Harbor" dùng 1 lần
npm run capture:demo # seed rồi làm mới docs/screenshots/ từ 1 editor thật
npm run gif          # seed rồi ghi docs/screenshots/demo.gif
npm run preview      # render dashboard trong Chromium ở 420/900/1440px
```

Ảnh trong README này được tạo bằng `capture:demo` và `gif`.
Dự án demo là 1 fixture trong [`scripts/lib/demo-project.mjs`](https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/scripts/lib/demo-project.mjs),
được seed qua `bd import` vào 1 workspace dùng 1 lần trong thư mục temp — chính tracker của
extension này gần như đã đóng hết, chụp ảnh trên đó sẽ khiến 1 công cụ đang sống trông như đã
xong việc. Bộ test unit đảm bảo fixture này luôn ở trạng thái đang dở dang thay vì trôi dần về
"nghĩa địa" toàn việc đã đóng.

Các lệnh này, `capture` và `preview` đều chạy `bd --json` thật, nên cần CLI `bd` cài sẵn trên máy.
CI chạy bộ kiểm tra tương thích Beads 1.3.1 trong workspace riêng; công cụ chụp ảnh và editor E2E chạy tại máy phát triển. `gif` còn cần `ffmpeg` trong `PATH`.

### Phát hành

Tag 1 commit rồi push — [`.github/workflows/release.yml`](https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/.github/workflows/release.yml) build
file `.vsix`, đính kèm vào 1 GitHub Release, rồi publish đúng file đó lên VS Code Marketplace và
Open VSX. Tag phải khớp với `version` trong `package.json`, nếu không workflow sẽ fail trước cả
khi build.

```bash
npm run verify
npm run test:e2e:workbench
npm run package
# Chỉ tạo tag v<package.json version> sau khi kiểm tra và duyệt bản phát hành.
```

Việc publish cần 2 secret của repository. Mỗi bước publish sẽ bị skip kèm cảnh báo nếu thiếu
token, nên 1 bản fork vẫn có được `.vsix` chạy được:

| Secret | Lấy từ đâu |
|---|---|
| `VSCE_PAT` | 1 Azure DevOps PAT có scope **Marketplace: Manage**. `publisher` trong `package.json` phải tồn tại sẵn tại [Manage Publishers](https://marketplace.visualstudio.com/manage). |
| `OVSX_PAT` | 1 [Open VSX access token](https://open-vsx.org/user-settings/tokens). Tạo namespace 1 lần bằng `npx ovsx create-namespace cuongbphv -p <token>`. |

Chuỗi gọi chỉ đi 1 chiều, không tầng nào được phép bỏ qua:

```
view → hook → bridge/rpc.ts → [postMessage] → panel router → bd/queries|mutations → BdService → bd
```

```
src/extension/   Extension host — nơi duy nhất spawn bd hoặc import `vscode`
  bd/            BdService (spawn), queries (đọc), mutations (ghi)
  panel/         DashboardPanel (CSP + nonce) và RPC router
  tree/          Sidebar Epic → Task
src/shared/      Không phụ thuộc framework: types, RPC protocol, và các phép suy diễn model
src/webview/     UI React. Không bao giờ đụng child_process, fs, hay network
  bridge/rpc.ts  Nơi duy nhất gọi acquireVsCodeApi()
media/           Icon extension và glyph activity bar
```

`src/shared/` là code duy nhất cả 2 phía cùng import, nên "thế nào là xong" mang cùng 1 nghĩa ở
sidebar lẫn trên board.

## Hệ thống thiết kế

Trước khi sửa UI, đọc [design-system/MASTER.md](https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/design-system/MASTER.md) trước
khi đụng vào code UI. Những quy tắc hay bị vi phạm nhất:

- **Không font/asset từ CDN bên ngoài.** CSP của webview chặn host bên ngoài; dùng
  `var(--vscode-font-family)`.
- **Không hardcode màu hex.** Theme của người dùng là nguồn chân lý; map vào `--vscode-*`.
- **Container query, không phải media query.** 1 panel có thể rộng 400px trong 1 cửa sổ 2560px.
- **Ngân sách nội dung của thẻ** — 1 thẻ hiện đúng bốn thứ: id, title rút gọn, icon loại,
  chấm priority. Status là cột nó nằm trong, không phải 1 badge riêng.
- **Không bao giờ chỉ dùng màu** cho status hay priority — luôn màu *cộng thêm* icon hoặc chữ.
- **Icon chỉ từ `lucide-react`.** Không dùng emoji làm icon.

## Tech stack

VS Code Extension API · TypeScript 6 · React 19 · Tailwind CSS 4 (CSS-first `@theme`) · `dnd-kit` ·
`lucide-react` · esbuild (dual bundle) · vitest

## Dự án liên quan

- **[Beads CLI](https://github.com/steveyegge/beads)** — bộ theo dõi issue git-native mà UI này bọc quanh

## License

MIT — xem [LICENSE](https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/LICENSE). Copyright (c) 2026 Bùi Phan Viết Cường.
