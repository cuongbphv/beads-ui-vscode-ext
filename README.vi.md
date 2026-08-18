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

> Vài giây cuối mới là điểm mấu chốt: không có thao tác click nào cả. Một agent chạy `bd create`
> và `bd update` bên ngoài editor, và board tự cập nhật theo.

## Nó làm gì

Beads Dashboard đọc database beads cục bộ của bạn qua CLI `bd` và hiển thị theo bốn cách:

- **Overview** — tổng số, phân bố trạng thái, tiến độ epic, và hai danh sách quan trọng ngay khi
  mở lên: việc nào sẵn sàng bắt đầu, việc nào đang bị chặn.
- **Roadmap** — drill-down Epic → Task với thanh tiến độ và số lượng theo từng epic.
- **Board** — bảng kanban có các cột được suy ra từ *category* trạng thái của dự án bạn ngay lúc
  chạy. Kéo 1 thẻ để đổi trạng thái, hoặc bật swimlane để nhóm các cột theo label taxonomy
  (`auto-ok` / `auto-partial` / `needs-human`).
- **Graph** — quan hệ phụ thuộc (blocked-by) của 1 issue dưới dạng đồ thị DAG, tự động sắp xếp và
  kéo thả được từng node.

Kèm theo sidebar **Epics & Tasks** với mục "Needs You" — các gate đang mở hiện cùng với issue được
gán cho bạn, mỗi gate có sẵn action Resolve — và các thao tác nhanh (status, priority, assignee,
claim, close) dùng được từ cây thư mục, board và detail pane.

Mọi thứ đều đọc/ghi qua `bd --json`. Extension không bao giờ đọc trực tiếp `.beads/issues.jsonl`
hay file Dolt — export đó mặc định tắt tự làm mới, và upstream cũng nói rõ đọc trực tiếp là không
tương thích.

## Xem trực tiếp

Mỗi ảnh dưới đây là chụp từ 1 editor thật, trên cùng 1 dự án demo đang dở dang — năm epic, 46
issue, bốn người và một agent. Ảnh được sinh ra tự động, không phải dàn dựng: `npm run
capture:demo` seed dữ liệu rồi chụp lại toàn bộ.

**Overview** — tổng số, phân bố trạng thái, tỷ lệ priority, khối lượng việc theo từng người, và
biểu đồ burn-up những gì đã đóng:

![Tab Overview: 46 issue, 15 sẵn sàng, 4 bị chặn, 2 quá hạn, donut 30% hoàn thành, phân bố priority và loại issue, đường burn-up tăng dần trong sáu tuần, và khối lượng việc theo người phụ trách](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/overview.png)

**Roadmap** — timeline thật với mốc hôm nay, mỗi epic mang theo số liệu tiến độ riêng. Việc đã
đóng được gấp gọn lại phía sau:

![Tab Roadmap: năm epic dạng hàng Gantt với thanh theo từng task trải dài chín tuần, đường mốc hôm nay, và chip "14 closed hidden — show"](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/roadmap.png)

**Board** — các cột được suy ra từ *category* trạng thái ngay lúc chạy, nên 1 status tuỳ biến vẫn
rơi đúng cột. Cột Done bắt đầu ở trạng thái gấp gọn:

![Kanban board với Open 19, In Progress 9, On Hold 4 và cột Done 14 đang gấp gọn; thẻ mang theo type, id, title, label, priority, ngày hạn và assignee](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/board.png)

**Board, bật swimlane** — cùng 1 board, chỉ cách 1 nút bấm để nhóm theo label taxonomy thay vì 1
cột dài duy nhất: `auto-ok`, `auto-partial` và `needs-human`, mỗi lane bốn issue trong dự án này:

![Board với Swimlane đang bật: ba lane taxonomy — auto-ok, auto-partial, needs-human — mỗi lane hiện 4 issue, các cột vẫn tách theo status bên trong từng lane](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/board-swimlanes.png)

**Graph** — quan hệ phụ thuộc (blocked-by) của 1 issue dưới dạng DAG. Node kéo được tới vị trí tuỳ
ý, nhích bằng phím mũi tên, hoặc đưa về vị trí gốc bằng **Reset layout**; issue đang bị chặn được
đánh dấu màu đỏ dù nằm ở đâu trong layout:

![Tab Graph: đồ thị phụ thuộc phân lớp với vài issue bị chặn viền đỏ, nút zoom và reset-layout trên thanh công cụ, cùng mục Gates(1) ở sidebar bên cạnh](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/graph.png)

**Detail pane** — toàn bộ issue mà không cần rời khỏi board. Status, priority và assignee áp dụng
ngay khi bạn chỉnh, comment và composer ghi chú append-only nằm ngay bên dưới, hiện sẵn kể cả khi
chưa có comment nào:

![Detail pane cho 1 feature, hiện select status/priority, ô assignee áp dụng khi nhấn Enter, estimate, ngày hạn, epic cha, dependencies, link Append note, và composer Comments (0) với textarea gửi bằng Ctrl/Cmd+Enter](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/roadmap-detail.png)

**Sidebar** — việc cần bạn nằm trên cùng, rồi mới tới plan. Gate đang mở giờ đứng trên cả issue
được gán cho bạn, vì nó chặn công việc thật cho tới khi có người xử lý:

![Sidebar với mục Needs You dẫn đầu bởi mục Gates(1) và action Resolve, năm issue được gán cho bạn bên dưới, rồi tới Epics & Milestones mở rộng hiện các task con kèm icon loại và priority; status bar hiện 16 ready và icon khiên với số 1](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/sidebar-tree-expanded.png)

## Yêu cầu

- [`bd` CLI](https://github.com/steveyegge/beads) có trong `PATH` (hoặc set `beadsDashboard.bdPath`).
- Một workspace folder chứa thư mục `.beads`. Extension chỉ activate khi tìm thấy thư mục này.

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

Thay đổi từ bên ngoài editor — bởi 1 agent, đồng nghiệp, hay chính terminal của bạn — tự hiện ra
chỉ trong vài giây. Việc kiểm tra đó chỉ là 1 lệnh `bd list --limit 1`, và chỉ reload toàn bộ khi
thật sự có thay đổi; hoàn toàn không kiểm tra gì khi mọi view Beads đang ẩn hoặc cửa sổ đang chạy
nền. Đặt `pollIntervalSeconds` về `0` nếu bạn muốn extension không tự spawn bất cứ thứ gì bạn
không yêu cầu.

## Lệnh

| Lệnh | Ở đâu |
|---|---|
| `Beads: Open Dashboard` | Palette, view title |
| `Beads: Refresh` | Palette, view title |
| `Beads: Show bd Output Log` | Palette — mọi argv và mọi lỗi đều nằm ở đây |
| Đổi status / priority / assignee, Claim, Close, Copy ID | Menu chuột phải trên cây, detail pane |

## Roadmap

Không có deadline, và không có gạch đầu dòng nào dưới đây là lời hứa. Danh sách này tồn tại để câu
"bắt đầu từ đâu?" có câu trả lời: mỗi hạng mục Planned đều là một issue đang mở.

**Planned** — thiết kế bám đúng kiến trúc đã có:

- **Tiến độ molecule** — `bd mol` hiện chưa có UI nào. Một thanh tiến độ cho molecule đang chạy và
  những wisp sắp tự hủy. ([#10](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/10))
- **Fleet monitor** — các worktree và nhánh `work/bead-*` trên đĩa, xếp cạnh đúng bead chúng đang
  mang, để một worktree bỏ quên trở nên nhìn thấy được. ([#11](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/11))
- **Di chuyển card bằng bàn phím** — kéo thả trên Board hiện chỉ chạy bằng con trỏ, trong khi card
  đã tự giới thiệu là "draggable" với screen reader. ([#7](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/7) — good first issue)
- **Workflow chạy trên pull request** — hiện chưa có, vì một phần test suite gọi thẳng binary `bd`
  thật. ([#9](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/9))
- **Windows, do người dùng Windows xác nhận** — nhánh fallback cho `.cmd` shim và đường dẫn Git-Bash
  đã viết nhưng chưa ai chạy thử trên máy Windows thật. ([#12](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/12))
- **Tài liệu Troubleshooting** — bốn trạng thái lỗi mà code đã xử lý tử tế lại chưa được ghi ở đâu
  cả. ([#8](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/8) — good first issue)

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

Mọi ảnh trong README này đều đến từ `capture:demo` / `gif`, không có ảnh nào dàn dựng bằng tay.
Dự án demo là 1 fixture trong [`scripts/lib/demo-project.mjs`](https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/scripts/lib/demo-project.mjs),
được seed qua `bd import` vào 1 workspace dùng 1 lần trong thư mục temp — chính tracker của
extension này gần như đã đóng hết, chụp ảnh trên đó sẽ khiến 1 công cụ đang sống trông như đã
xong việc. Bộ test unit đảm bảo fixture này luôn ở trạng thái đang dở dang thay vì trôi dần về
"nghĩa địa" toàn việc đã đóng.

Các lệnh này, `capture` và `preview` đều chạy `bd --json` thật, nên cần CLI `bd` cài sẵn trên máy.
Đó là lý do chúng không chạy trong CI. `gif` còn cần `ffmpeg` trong `PATH`.

### Phát hành

Tag 1 commit rồi push — [`.github/workflows/release.yml`](https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/.github/workflows/release.yml) build
file `.vsix`, đính kèm vào 1 GitHub Release, rồi publish đúng file đó lên VS Code Marketplace và
Open VSX. Tag phải khớp với `version` trong `package.json`, nếu không workflow sẽ fail trước cả
khi build.

```bash
npm run verify       # workflow không chạy được test dựa trên bd — chạy ở đây
git tag v0.1.0
git push origin v0.1.0
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

Quyết định thiết kế không tuỳ hứng — đọc [design-system/MASTER.md](https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/design-system/MASTER.md) trước
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
