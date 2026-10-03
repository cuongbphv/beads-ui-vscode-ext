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

> 演示接近结束时，agent 在终端运行 `bd create` 和 `bd update`。看板随即更新，
> 无需在编辑器中点击。

## 它能做什么

Beads Dashboard 通过 `bd` CLI 读取本地 beads 数据库，并在五个标签页中呈现：

- **Overview（概览）** —— 总数、状态分布、epic 进度、Beads 原生 Ready 列表中的
  **Show more** 和 **Claim**，以及被阻塞的工作和按需运行的 Project health 检查。
- **Roadmap（路线图）** —— Epic → Task 时间线，另有 List/Graph 依赖视图。
- **Board（看板）** —— 看板的列在运行时根据你项目的状态 *分类* 动态推导出来。拖动一张卡片
  即可改变状态，也可用 **Ready only** 筛选并认领选中的 Ready issue，或按 taxonomy 标签切换
  swimlane（`auto-ok` / `auto-partial` / `needs-human`）。
- **Molecules** —— 显示运行中的 molecule、并行步骤、wisp 和 human gate；gate 卡片列出
  被阻塞的 issue，并在需要人工处理时提供 Resolve。
- **Fleet（舰队）** —— 显示此工作区的 Claude Code 与 Codex 会话、git worktree，以及
  orchestrator/worker 的 transcript。详见下方 [Fleet monitor](#fleet-monitor)。

此外还有一个 **Epics & Tasks** 侧边栏，带 "Needs You" 区块 —— 打开中的 gate 会和分配给你的
issue 一起显示，每个 gate 都自带一个内联的 Resolve 操作 —— 以及可在树视图、看板和详情面板中
直接使用的快捷操作（状态、优先级、指派人、认领、关闭）。

所有数据都通过 `bd --json` 读写。本扩展从不直接读取 `.beads/issues.jsonl` 或 Dolt 文件本身 ——
该导出功能默认不自动刷新，上游也明确表示不支持直接读取。

## v0.2.0 Beads Workbench

Workbench 通过 `bd context` 解析工作区，包括 worktree 和 `BEADS_DIR`，并以 Beads 原生 Ready
集合判断哪些工作可以开始。Overview 可加载更多 Ready issue 并直接 **Claim**；Board 提供
**Ready only**。**Needs You** 汇集已分配的工作和 human gate，Molecules 会标明每个 gate
阻塞的 issue。认领和编辑使用 CLI 前置条件，发生并发冲突时重新加载，而不会悄悄覆盖。

Fleet 可查看 Claude Code 和 Codex transcript：旧事件按页加载；过长的文本、thinking、工具输入
和结果默认显示预览，点 **Show all / Show less** 才从原始 transcript 读取完整内容。Codex 的
opaque 编码消息无法从 transcript 解码，界面会明确标注。

这些 Workbench 功能目前位于 `develop`，计划随尚未发布的 v0.2.0 提供。`main` 上已发布的
v0.1.7 尚不包含完整流程。

## 实际效果

以下截图来自编辑器中的演示项目，其中有五个 epic、54 个 issue、四个人和一个 agent。
`npm run capture:demo` 会生成演示数据并重新截图。

**Overview** —— 总数、状态分布、优先级构成、每人的工作量，以及已完成工作的燃起图：

![Overview 标签页展示项目统计、Ready、被阻塞的 issue 和进度](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/overview.png)

**Ready → Claim** —— Overview 滚动到原生 Ready 列表，显示已加载范围和每行的 Claim 操作：

![Overview 的 Ready 列表、数据范围和 Claim 按钮](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/overview-ready.png)

**Overview，同步状态与项目健康度** —— 点击 Refresh 和 Run checks 后，顶部显示后端状态，
抽屉展示 stale/orphan/lint/dependency 检查结果：

![Overview 的同步状态和 Project health 检查结果](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/overview-health.png)

**Roadmap** —— 带今天标记线的真实时间线，每个 epic 都带着自己的进度统计。已关闭的工作会被
折叠起来，点击即可展开：

![Roadmap 时间线展示 epic、task、今天标记和隐藏的已关闭 issue 数量](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/roadmap.png)

**Board** —— 列在运行时根据你的状态 *分类* 推导得出，所以自定义状态也能落在正确的列里。
Done 列默认是折叠的：

![Board 的状态列和显示类型、标签、优先级、截止日期及指派人的卡片](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/board.png)

**Board，仅显示 Ready** —— 依据 Beads 原生 Ready 集合筛选，而不是仅凭 status 推测：

![Board 开启 Ready only 筛选后显示可开始的 issue](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/board-ready.png)

**Board，开启泳道（swimlane）** —— 同一个看板，只需一个开关就能按 taxonomy 标签分组，
而不是挤在一条长长的列里：`auto-ok`、`auto-partial` 和 `needs-human`，在这个项目里每条泳道
各有四个 issue：

![开启 Swimlane 后的看板：三条 taxonomy 泳道 —— auto-ok、auto-partial、needs-human —— 每条各显示 4 个 issue，每条泳道内部仍按状态分列](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/board-swimlanes.png)

**Graph（依赖图）** —— 将一个 issue 的 blocked-by 依赖关系画成 DAG。节点可以拖到你想要的
位置，用方向键微调，或者用 **Reset layout** 按钮恢复原位；被阻塞的 issue 无论落在布局的哪个
位置都会用红色标出：

![Graph 分层展示依赖、被阻塞的 issue，以及缩放和重置布局按钮](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/graph.png)

**Molecules** —— human gate 与运行中的 molecule，并列出被 gate 阻塞的 issue：

![Molecules 标签页显示两个 gate 和一个运行中的 molecule](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/molecules.png)

**Molecules，展开步骤** —— 显示 gated、进行中、Ready、Done 和 Pending 的步骤：

![Molecule 步骤列表及相关 gate](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/molecules-detail.png)

**Fleet** —— 一个 orchestrator 和一个关联真实 `wt-*` git worktree 的 worker，transcript
在列表旁打开。活动标签只表示最近的 transcript 写入，不代表进程状态。详见下方
[Fleet monitor](#fleet-monitor)：

![Fleet 标签页选中 Claude Code worker，并在列表旁展示 transcript](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/fleet.png)

**Fleet，某个 worker 的 transcript** —— text 和 thinking block 经过手写的 markdown
渲染器渲染：标题、粗体、行内代码、一段代码块，以及一行 `✓ PASSED` 结果，直接画成
React element，绝不使用 `dangerouslySetInnerHTML`：

![Fleet transcript 展开一个工具结果，下方是 assistant 总结](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/fleet-transcript.png)

**Detail pane（详情面板）** —— 无需离开看板即可查看完整 issue。状态、优先级和指派人在你
设置的同时就会生效，评论以及一个仅追加内容的备注编辑器就在这些字段下方，即使目前还没有任何
评论也会显示出来：

![某个 feature 的详情面板，展示状态与优先级下拉框、按 Enter 生效的指派人字段、预估工时、截止日期、父级 epic、依赖关系、一个 Append note 链接，以及一个可用 Ctrl/Cmd+Enter 提交的 Comments (0) 评论输入框](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/roadmap-detail.png)

**Sidebar（侧边栏）** —— 需要你处理的事项排在最上面，然后才是计划本身。打开中的 gate 现在
排在你自己被指派的 issue 之前，因为它会阻塞真正的工作，直到有人处理为止：

![侧边栏包含 Needs You、human gate、已分配 issue 和 Epics & Milestones 树](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/sidebar-tree-expanded.png)

## 环境要求

- 你的 `PATH` 中要有 [`bd` CLI](https://github.com/steveyegge/beads)（或设置
  `beadsDashboard.bdPath`）。
- `bd context` 能解析出数据库的工作区；本地 `.beads`、worktree 重定向或 `BEADS_DIR`
  都可以提供该路径。

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

编辑器外部的变更会在下一次有效检查检测到后触发刷新。使用 Beads 1.3 且已启用
事件日志时，扩展检查日志配置，并按 JSON Lines 读取 `bd events tail`；其他情况下
使用 `bd list --limit 1`。每 12 次有效检查仍会完整刷新，以捕获未记录的同步和 SQL
变更。所有 Beads 视图隐藏或窗口在后台时不检查；设置 `pollIntervalSeconds` 为 `0`
可关闭检查。扩展不会自动启用日志或升级数据库。
参见 [Beads 1.3.1 兼容性说明](docs/BEADS-1.3.1.md)。

## 命令

| 命令 | 位置 |
|---|---|
| `Beads: Open Dashboard` | Palette、view title |
| `Beads: Refresh` | Palette、view title |
| `Beads: Show bd Output Log` | Palette —— 每一次调用参数和每一次失败都记录在这里 |
| 修改状态 / 优先级 / 指派人，Claim，Close，Copy ID | 树视图右键菜单、详情面板 |

## Fleet monitor

**Fleet** 标签页展示此工作区发现的 Claude Code 和 Codex 会话、worker 及相关 git
worktree。未能关联 worker 的 worktree 会显示为 **Unassociated worktrees**，这不表示
agent 一定已经停止。点击 worker 或 orchestrator 可从对应 provider 的 JSONL 文件跟随
transcript；旧事件可分页加载，也可在已加载事件中搜索。过长的 block 可用 **Show all**
展开。`text`、`thinking` 这两类 block 会经过一个自己手写、不依赖
第三方库的 markdown 渲染器 —— 支持标题、列表、代码块、表格、粗体/斜体 —— 先解析成纯数据 AST，
再直接画成 React element，绝不使用 `dangerouslySetInnerHTML`；transcript 是 agent/tool 可控的
通道，所以这个渲染器本身就是安全边界，不是事后补上的。

![Fleet transcript 展开一个工具结果，下方是 assistant 总结](https://raw.githubusercontent.com/cuongbphv/beads-ui-vscode-ext/main/docs/screenshots/fleet-transcript.png)

数据来源：

- **会话与 worker** —— Claude Code 来自 `~/.claude/projects/<mangled-cwd>`；Codex 来自
  `~/.codex/sessions` 或 `CODEX_HOME/sessions`。transcript 路径必须留在对应的存储目录内。
- **Worktree 及其 git 状态** —— 先 `git worktree list --porcelain`，再对每个 worktree 执行
  `git status` / `git diff --numstat`，并按 worker 自己的 spawn brief 对应到某个 bead id。没有
  worker 关联的 worktree 会显示为"Unassociated worktrees — worker link unknown"，不能据此
  推断 agent 已停止。参见
  [#11](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/11) 最初提出的"什么算过期
  worktree"的答案。
- **扫描频率** —— 每 5 秒一次的轮询是始终开启的基线；在 `~/.claude/projects` 上叠加了一个
  `FileSystemWatcher` 作为快速通道，当操作系统更早报告变化时生效。轮询永远不会被去掉：watcher
  本质上是尽力而为（一个刚开始监听的 watcher 有可能错过紧随其后发生的事件 —— 这是在真实的
  Extension Development Host 上实测得出的结论，不是假设），所以最坏情况也就是和只用轮询一样快，
  不会更慢，也不会卡住。
- **降级而不崩溃** —— provider 数据缺失、`git` 失败或某个 worktree 出错时显示错误并保留
  最近成功的快照，同时给出数据时间和 Retry 操作。

这里的数据都不是 `bd` 数据，因此都不经过 `BdService` —— `src/extension/fleet/` 是继 `actor.ts`
的只读 `git config user.name` 探测之后，第三个刻意设置在 `BdService` 之外、会 spawn 进程的地方：
这里的每一次 spawn 都是只读的、有超时限制的，单个 worktree 出错也绝不会让整个快照变空白。之所以
单独成一个模块而不是并入 `actor.ts` 或 `BdService`，是因为它回答的是另一个问题（磁盘上有什么、
各 agent 的 transcript 存储里有什么）—— 具体理由见
`src/extension/fleet/FleetService.ts` 和 `src/extension/fleet/worktree-git.ts` 文件开头的注释。

## 路线图

这里区分源码中已有的功能与发布前还需完成的验证。

**Shipped** —— 已完成，现在就在扩展里：

- **用键盘移动卡片** —— 空格键把卡片拿起来，方向键让它一列一列、一条泳道一条泳道地移动，再按空格
  放下，按 Escape 放回原处。屏幕阅读器读到的是列名，而不是 droppable 的 id。
  （[#7](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/7)）
- **Fleet monitor** —— 把磁盘上的 worktree 和 `work/bead-*` 分支与它们各自承载的 bead 对齐排列，
  让被遗忘的 worktree 显形，并支持按 worker 实时查看 transcript。详见上方
  [Fleet monitor](#fleet-monitor)。（[#11](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/11)）
- **Molecules** —— molecule、步骤、wisp 和可通过 Resolve 处理的 human gate。
  （[#10](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/10)）
- **Pull-request CI** —— lint、typecheck、build、单元测试及独立数据库中的 Beads 1.3.1
  兼容性测试。（[#9](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/9)）

**仍需验证** —— 在真实 Windows 环境中对完整 v0.2.0 流程做 smoke test；`.cmd` shim 和
Git-Bash 路径已有测试覆盖。（[#12](https://github.com/cuongbphv/beads-ui-vscode-ext/issues/12)）

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

本 README 的图片由 `capture:demo` 和 `gif` 生成。演示项目是
[`scripts/lib/demo-project.mjs`](https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/scripts/lib/demo-project.mjs)
中的一个 fixture，通过 `bd import` 被播种进临时目录下的一次性工作区里 —— 本扩展自己的
issue 跟踪记录几乎已经全部关闭，如果直接对着它截图，会让一个还在持续开发的工具看起来像是
已经完工了。单元测试套件确保这个 fixture 始终保持"进行中"的状态，而不会逐渐变成一个
全是已关闭 issue 的"墓地"。

这些命令（以及 `capture`、`preview`）都会驱动真实的 `bd --json` 输出，因此需要本地安装
`bd` CLI。CI 在独立工作区运行 Beads 1.3.1 兼容性测试；截图工具和编辑器 E2E 测试在本地运行。`gif` 命令还需要 `PATH` 中有 `ffmpeg`。

### 发布

给某个 commit 打 tag 并推送 —— [`.github/workflows/release.yml`](https://github.com/cuongbphv/beads-ui-vscode-ext/blob/main/.github/workflows/release.yml)
会构建出 `.vsix`，将其附加到一个 GitHub Release，然后把这个确切的文件发布到 VS Code
Marketplace 和 Open VSX。tag 必须与 `package.json` 里的 `version` 一致，否则 workflow 会在
构建之前就失败。

```bash
npm run verify
npm run test:e2e:workbench
npm run package
# 检查和发布审查通过后，再创建与 package.json version 相同的 tag。
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

修改 UI 代码之前，请阅读
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
