<p align="center">
  <img src="https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/media/icon.png" alt="Beads Dashboard" width="128" />
</p>

<h1 align="center">Beads Dashboard for VS Code</h1>

<p align="center">
  为 <a href="https://github.com/steveyegge/beads">Beads</a>（一个原生基于 Git 的 issue 跟踪系统）提供看板、路线图和 epic 追踪 —— 直接集成在你的编辑器里。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT" />
  <img src="https://img.shields.io/badge/VS%20Code-%5E1.105-007ACC" alt="VS Code ^1.105" />
</p>

<p align="center">
  <a href="https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/README.md">English</a> | <a href="https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/README.vi.md">Tiếng Việt</a> | <b>中文</b>
</p>

---

![Beads Dashboard：侧边栏、路线图、在看板上拖动一张卡片，以及当 agent 在终端里创建/更新 issue 时看板自动跟着更新](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/demo.gif)

> 最后几秒才是重点：全程没有任何点击操作。一个 agent 在编辑器之外运行了 `bd create`
> 和 `bd update`，看板自己就跟上了。

## 它能做什么

Beads Dashboard 通过 `bd` CLI 读取你本地的 beads 数据库，并以五种方式呈现：

- **Overview（概览）** —— 总数、状态分布、epic 进度，以及打开时最关心的两个列表：
  哪些可以立即开始，哪些被阻塞。
- **Roadmap（路线图）** —— Epic → Task 的下钻视图，带进度条和按 epic 统计的数量。
- **Board（看板）** —— 看板的列在运行时根据你项目的状态 *分类* 动态推导出来。拖动一张卡片
  即可改变其状态，或者切换 swimlane（泳道），按 taxonomy 标签（`auto-ok` / `auto-partial` /
  `needs-human`）对列进行分组。
- **Graph（依赖图）** —— 将一个 issue 的 blocked-by 依赖关系画成有向无环图（DAG），自动布局，
  并且每个节点都可以拖动。
- **Fleet（舰队）** —— 显示当前工作区里正在运行的 Claude Code 编排/工作会话、它们留下的 git
  worktree，点击某个 worker 还能查看其实时 transcript。详见下方 [Fleet monitor](#fleet-monitor)。

此外还有一个 **Epics & Tasks** 侧边栏，带 "Needs You" 区块 —— 打开中的 gate 会和分配给你的
issue 一起显示，每个 gate 都自带一个内联的 Resolve 操作 —— 以及可在树视图、看板和详情面板中
直接使用的快捷操作（状态、优先级、指派人、认领、关闭）。

所有数据都通过 `bd --json` 读写。本扩展从不直接读取 `.beads/issues.jsonl` 或 Dolt 文件本身 ——
该导出功能默认不自动刷新，上游也明确表示不支持直接读取。

## 实际效果

下面每一张截图都来自同一个真实编辑器，针对的是同一个"进行中"的演示项目 —— 五个 epic、
46 个 issue、四个人加一个 agent。这些图片是自动生成的，不是手工摆拍：`npm run
capture:demo` 会先播种数据，再重新截取每一张图。

**Overview** —— 总数、状态分布、优先级构成、每人的工作量，以及已完成工作的燃起图：

![Overview 标签页：46 个 issue，15 个可开始，4 个被阻塞，2 个已逾期，30% 完成度的环形图，优先级与 issue 类型分布，六周内持续上升的燃起图，以及按指派人划分的工作量](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/overview.png)

**Roadmap** —— 带今天标记线的真实时间线，每个 epic 都带着自己的进度统计。已关闭的工作会被
折叠起来，点击即可展开：

![Roadmap 标签页：五个 epic 以 Gantt 行的形式展示，每个 task 的条形跨越九周，一条"今天"标记线，以及一个"14 closed hidden — show"的提示条](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/roadmap.png)

**Board** —— 列在运行时根据你的状态 *分类* 推导得出，所以自定义状态也能落在正确的列里。
Done 列默认是折叠的：

![看板：Open 19、In Progress 9、On Hold 4，以及折叠起来的 Done 14；卡片带有类型、id、标题、标签、优先级、截止日期和指派人](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/board.png)

**Board，开启泳道（swimlane）** —— 同一个看板，只需一个开关就能按 taxonomy 标签分组，
而不是挤在一条长长的列里：`auto-ok`、`auto-partial` 和 `needs-human`，在这个项目里每条泳道
各有四个 issue：

![开启 Swimlane 后的看板：三条 taxonomy 泳道 —— auto-ok、auto-partial、needs-human —— 每条各显示 4 个 issue，每条泳道内部仍按状态分列](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/board-swimlanes.png)

**Graph（依赖图）** —— 将一个 issue 的 blocked-by 依赖关系画成 DAG。节点可以拖到你想要的
位置，用方向键微调，或者用 **Reset layout** 按钮恢复原位；被阻塞的 issue 无论落在布局的哪个
位置都会用红色标出：

![Graph 标签页：一张分层的依赖关系图，几个被阻塞的 issue 用红色描边标出，工具栏上有缩放和重置布局按钮，旁边还有侧边栏的 Gates(1) 条目](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/graph.png)

**Detail pane（详情面板）** —— 无需离开看板即可查看完整 issue。状态、优先级和指派人在你
设置的同时就会生效，评论以及一个仅追加内容的备注编辑器就在这些字段下方，即使目前还没有任何
评论也会显示出来：

![某个 feature 的详情面板，展示状态与优先级下拉框、按 Enter 生效的指派人字段、预估工时、截止日期、父级 epic、依赖关系、一个 Append note 链接，以及一个可用 Ctrl/Cmd+Enter 提交的 Comments (0) 评论输入框](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/roadmap-detail.png)

**Sidebar（侧边栏）** —— 需要你处理的事项排在最上面，然后才是计划本身。打开中的 gate 现在
排在你自己被指派的 issue 之前，因为它会阻塞真正的工作，直到有人处理为止：

![侧边栏：Needs You 区块最上方是一个 Gates(1) 条目和 Resolve 操作，下面是分配给你的五个 issue，然后是展开的 Epics & Milestones，显示带类型图标和优先级的子任务；状态栏显示 16 ready 以及一个盾牌图标加数字 1](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/sidebar-tree-expanded.png)

## 环境要求

- 你的 `PATH` 中要有 [`bd` CLI](https://github.com/steveyegge/beads)（或设置
  `beadsDashboard.bdPath`）。
- 一个包含 `.beads` 目录的工作区文件夹。只有找到该目录时本扩展才会激活。

有东西不对劲？[docs/TROUBLESHOOTING.md](https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/docs/TROUBLESHOOTING.md) 讲了本扩展刻意处理的四种降级状态 ——
没有工作区文件夹、没有 `.beads` 目录、`PATH` 里没有 `bd`，以及 `bd` 跑得起来却拒绝执行 ——
每一种分别显示什么、为什么，以及怎么解决。

## 安装

在 Extensions 视图里搜索 **Beads Dashboard**，或者：

```bash
code --install-extension cuongbphv.beads-dashboard
```

使用 **Cursor**、**Windsurf** 或 **VSCodium**？这些编辑器无法访问微软的 Marketplace，
所以同一份构建也发布到了 [Open VSX](https://open-vsx.org/)，它们各自的 Extensions 视图
都能找到。每个 release 也都会在
[Releases 页面](https://github.com/cuongbphv/beads-ui-vscode-ext/releases) 附带一个 `.vsix`
文件，方便离线安装。

<details>
<summary>改为从源码构建并安装</summary>

```bash
npm install
npm run install:local     # 构建 → 打包 → 安装；然后 reload window
```

`install:local` 会自动识别 `code`、`code-insiders`、`cursor`、`windsurf` 或 `codium`。
用 `npm run install:local -- --cli cursor` 强制指定某一个，或设置 `VSCODE_CLI`。如果只想
生成 `.vsix` 而不安装，加上 `-- --skip-install`。

完成后：**Ctrl+Shift+P → "Developer: Reload Window"**，然后打开 Activity Bar 上的 Beads
图标。

</details>

## 设置项

| 设置 | 默认值 | 作用 |
|---|---|---|
| `beadsDashboard.bdPath` | `bd` | `bd` 可执行文件的路径。 |
| `beadsDashboard.defaultTab` | `overview` | dashboard 打开时默认所在的标签页。 |
| `beadsDashboard.issueLimit` | `2000` | 每次刷新加载的 issue 数量。 |
| `beadsDashboard.pollIntervalSeconds` | `5` | 多久检查一次编辑器外部的变更。`0` 表示关闭。 |
| `beadsDashboard.showClosed` | `true` | 在看板和树视图中包含已关闭的 issue。 |
| `beadsDashboard.assignee` | `""` | 你是谁，用于 **Needs You**。留空表示使用 `bd` 自身会识别的身份。 |

在编辑器外部发生的变更 —— 无论是 agent、同事，还是你自己在终端里做的操作 —— 都会在几秒内
自动出现。这个检查只是一次 `bd list --limit 1`，只有在确实发生变化时才会触发完整刷新；
当所有 Beads 视图都处于隐藏状态或窗口在后台时，完全不会做任何检查。如果你希望扩展不主动
产生任何你没有要求的进程，可以把 `pollIntervalSeconds` 设为 `0`。

## 命令

| 命令 | 位置 |
|---|---|
| `Beads: Open Dashboard` | Palette、view title |
| `Beads: Refresh` | Palette、view title |
| `Beads: Show bd Output Log` | Palette —— 每一次调用参数和每一次失败都记录在这里 |
| 修改状态 / 优先级 / 指派人，Claim，Close，Copy ID | 树视图右键菜单、详情面板 |

## Fleet monitor

**Fleet** 标签页回答的问题是"我的 agent 编队现在正在对这个工作区做什么？"—— 哪些 Claude Code
会话正作为 orchestrator 运行，它们各自派生了哪些 worker，这些 worker 在磁盘上留下了哪些 git
worktree，以及哪个 worktree 已经过期（没有任何 worker 还在认领它，所以要么是被遗忘了，要么在
等待review）。点击某个 worker 或 orchestrator 即可实时查看其 transcript，直接从 Claude Code
自己写入的那份 JSONL 文件里流式读取。`text`、`thinking` 这两类 block 会经过一个自己手写、不依赖
第三方库的 markdown 渲染器 —— 支持标题、列表、代码块、表格、粗体/斜体 —— 先解析成纯数据 AST，
再直接画成 React element，绝不使用 `dangerouslySetInnerHTML`；transcript 是 agent/tool 可控的
通道，所以这个渲染器本身就是安全边界，不是事后补上的。

数据来源：

- **会话与 worker** —— 读取自 `~/.claude/projects/<mangled-cwd>`，这是 Claude Code 自己的
  transcript 存储，按 Claude Code 自身的方式与本工作区对应。一个会话只有在派生过至少一个
  worker（存在 `subagents/agent-*.jsonl` 文件）时才算作 orchestrator；普通聊天会话不属于 fleet。
- **Worktree 及其 git 状态** —— 先 `git worktree list --porcelain`，再对每个 worktree 执行
  `git status` / `git diff --numstat`，并按 worker 自己的 spawn brief 对应到某个 bead id。没有
  worker 认领的 worktree 会出现在"Stale worktrees"里 —— 这正是
  [#11](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/11) 最初提出的"什么算过期
  worktree"的答案。
- **扫描频率** —— 每 5 秒一次的轮询是始终开启的基线；在 `~/.claude/projects` 上叠加了一个
  `FileSystemWatcher` 作为快速通道，当操作系统更早报告变化时生效。轮询永远不会被去掉：watcher
  本质上是尽力而为（一个刚开始监听的 watcher 有可能错过紧随其后发生的事件 —— 这是在真实的
  Extension Development Host 上实测得出的结论，不是假设），所以最坏情况也就是和只用轮询一样快，
  不会更慢，也不会卡住。
- **降级而不崩溃** —— 这台机器上没有 `~/.claude/projects`、目录为空、`git` 执行失败，或者某个
  worktree 出错，都会渲染出清晰的空状态或内联错误提示，而不是崩溃或一片空白。

这里的数据都不是 `bd` 数据，因此都不经过 `BdService` —— `src/extension/fleet/` 是继 `actor.ts`
的只读 `git config user.name` 探测之后，第三个刻意设置在 `BdService` 之外、会 spawn 进程的地方：
这里的每一次 spawn 都是只读的、有超时限制的，单个 worktree 出错也绝不会让整个快照变空白。之所以
单独成一个模块而不是并入 `actor.ts` 或 `BdService`，是因为它回答的是另一个问题（磁盘上有什么、
Claude Code 自己的 transcript 存储里有什么）—— 具体理由见
`src/extension/fleet/FleetService.ts` 和 `src/extension/fleet/worktree-git.ts` 文件开头的注释。

## 路线图

没有时间表，下面也没有任何一条是承诺。这份清单的用途是让"我该从哪里下手"有答案：Planned 里的每一项
都对应一个已经开着的 issue。

**Shipped** —— 已完成，现在就在扩展里：

- **用键盘移动卡片** —— 空格键把卡片拿起来，方向键让它一列一列、一条泳道一条泳道地移动，再按空格
  放下，按 Escape 放回原处。屏幕阅读器读到的是列名，而不是 droppable 的 id。
  （[#7](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/7)）
- **Fleet monitor** —— 把磁盘上的 worktree 和 `work/bead-*` 分支与它们各自承载的 bead 对齐排列，
  让被遗忘的 worktree 显形，并支持按 worker 实时查看 transcript。详见上方
  [Fleet monitor](#fleet-monitor)。（[#11](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/11)）

**Planned** —— 完全贴合现有架构的设计：

- **Molecule 进度** —— `bd mol` 目前在界面上毫无体现。为正在运行的 molecule 和即将自动消失的 wisp
  加一条进度条。（[#10](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/10)）
- **在 pull request 上运行的 workflow** —— 目前一个都没有，因为测试套件里有一部分直接驱动真实的
  `bd` 可执行文件。（[#9](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/9)）
- **Windows，由 Windows 用户亲自确认** —— `.cmd` shim 的回退路径和 Git-Bash 下的路径都已写好，
  但从未在真实 Windows 机器上验证过。（[#12](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/12)）

**Exploring** —— 一个方向，不是承诺。尚未设计，也还没有对应的 issue。

beads 里的 `human` gate 本身就是"等人确认"的原语，因此远程审批不需要改动 beads 核心：一支 agent
编队在 gate 前停下，负责人看到它、读完上下文再 resolve —— 不一定要坐在电脑前。那样一来，这个扩展
就是更大一件事的编辑器内那一半，再加上 gate 出现或工作被 blocked 时的通知。欢迎反驳这个方向：开一个
issue 说出来。

**不在计划内：** 编排工作。这是一个带快捷操作的查看器 —— 它显示 `bd` 所知道的，并通过 `bd` 写回。
接下来跑什么，是 `bd` 以及驱动 `bd` 的那套工具的事。

## 参与贡献

[CONTRIBUTING.md](https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/CONTRIBUTING.md) 写了环境准备、每个 PR 都必须遵守的三条规则，以及
各个测试套件怎么跑。简版：`npm install`、`npm run watch`、**F5** —— 然后 `npm run demo:seed` 造一个
工作区给开发宿主打开，因为本仓库自己的 `.beads/` 是被 gitignore 的，clone 下来并没有数据库。

还没人认领的活儿标了 [`help wanted`](https://github.com/cuongbphv/beads-ui-vscode-ext/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22)；范围只在一个文件或一条 workflow 内的标了
[`good first issue`](https://github.com/cuongbphv/beads-ui-vscode-ext/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)。报 bug 请附上 `Beads: Show bd Output Log` 的输出和 `bd --version` ——
issue 模板问的正是这些。

## 开发

```bash
npm run watch        # 有变更时重新构建两个 bundle
npm run verify       # lint + typecheck + test + build + npm audit
npm test             # vitest
npm run demo:seed    # 构建一次性使用的 "Harbor" 演示工作区
npm run capture:demo # 播种数据，然后从真实编辑器刷新 docs/screenshots/
npm run gif          # 播种数据，然后录制 docs/screenshots/demo.gif
npm run preview      # 在 Chromium 中以 420/900/1440px 渲染 dashboard
```

本 README 里的每一张图片都来自 `capture:demo` / `gif`，没有一张是手工摆拍的。演示项目是
[`scripts/lib/demo-project.mjs`](https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/scripts/lib/demo-project.mjs)
中的一个 fixture，通过 `bd import` 被播种进临时目录下的一次性工作区里 —— 本扩展自己的
issue 跟踪记录几乎已经全部关闭，如果直接对着它截图，会让一个还在持续开发的工具看起来像是
已经完工了。单元测试套件确保这个 fixture 始终保持"进行中"的状态，而不会逐渐变成一个
全是已关闭 issue 的"墓地"。

这些命令（以及 `capture`、`preview`）都会驱动真实的 `bd --json` 输出，因此需要本地安装
`bd` CLI。这也是它们不在 CI 中运行的原因。`gif` 命令还需要 `PATH` 中有 `ffmpeg`。

### 发布

给某个 commit 打 tag 并推送 —— [`.github/workflows/release.yml`](https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/.github/workflows/release.yml)
会构建出 `.vsix`，将其附加到一个 GitHub Release，然后把这个确切的文件发布到 VS Code
Marketplace 和 Open VSX。tag 必须与 `package.json` 里的 `version` 一致，否则 workflow 会在
构建之前就失败。

```bash
npm run verify       # workflow 无法运行依赖 bd 的测试 —— 所以在这里先跑一遍
git tag v0.1.0
git push origin v0.1.0
```

发布需要两个仓库 secret。缺少对应 token 时，每个发布步骤都会带警告跳过，所以 fork 出去的
仓库仍然能得到一个可用的 `.vsix`：

| Secret | 来源 |
|---|---|
| `VSCE_PAT` | 一个具有 **Marketplace: Manage** 权限的 Azure DevOps PAT。`package.json` 里的 `publisher` 必须先在 [Manage Publishers](https://marketplace.visualstudio.com/manage) 中存在。 |
| `OVSX_PAT` | 一个 [Open VSX access token](https://open-vsx.org/user-settings/tokens)。用 `npx ovsx create-namespace cuongbphv -p <token>` 创建一次命名空间即可。 |

调用链是单向的，任何一层都不能被跳过：

```
view → hook → bridge/rpc.ts → [postMessage] → panel router → bd/queries|mutations → BdService → bd
```

```
src/extension/   扩展宿主进程 —— 唯一会 spawn bd 或 import `vscode` 的地方
  bd/            BdService（进程调用）、queries（读取）、mutations（写入）
  panel/         DashboardPanel（CSP + nonce）以及 RPC router
  tree/          Epic → Task 侧边栏
src/shared/      与框架无关：类型定义、RPC 协议，以及各种 model 推导逻辑
src/webview/     React UI。绝不直接接触 child_process、fs 或网络
  bridge/rpc.ts  唯一调用 acquireVsCodeApi() 的地方
media/           扩展图标和 activity bar 图形
```

`src/shared/` 是两端唯一共同 import 的代码，所以"什么算完成"在侧边栏和看板上的含义是
一致的。

## 设计系统

设计决策并非随意而定 —— 在动 UI 代码之前，请先阅读
[design-system/MASTER.md](https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/design-system/MASTER.md)。
以下是最常被违反的规则：

- **不使用外部字体或 CDN 资源。** webview 的 CSP 会拦截外部主机；请使用
  `var(--vscode-font-family)`。
- **不硬编码十六进制颜色。** 用户的主题才是唯一真相来源；一律映射到 `--vscode-*`。
- **使用容器查询，而不是媒体查询。** 同一个面板在 2560px 宽的窗口里也可能只有 400px 宽。
- **卡片内容预算** —— 一张卡片只显示这四样东西：id、截断后的标题、类型图标、优先级圆点。
  状态由它所在的列表示，而不是另加一个 badge。
- **绝不只靠颜色** 来表达状态或优先级 —— 颜色必须 *搭配* 图标或文字一起使用。
- **图标只来自 `lucide-react`。** 不使用 emoji 作为图标。

## 技术栈

VS Code Extension API · TypeScript 6 · React 19 · Tailwind CSS 4（CSS-first `@theme`）·
`dnd-kit` · `lucide-react` · esbuild（双 bundle）· vitest

## 相关项目

- **[Beads CLI](https://github.com/steveyegge/beads)** —— 本 UI 所包装的原生基于 Git 的
  issue 跟踪系统

## License

MIT —— 见 [LICENSE](https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/LICENSE)。
Copyright (c) 2026 Bùi Phan Viết Cường.
