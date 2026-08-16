# @deepseek-ai/dsh-popper

> English version: [README.md](README.md).

**Popper** 是面向 agent 会话的证伪驱动修正循环。它不让编码 agent 在失败后「重试」，而是要求它在高风险工作前显式承诺一个可被证据检验的主张，用确定性 **gate** 检验工作结果；gate 证伪主张后，强制 agent 给出互斥的新假设并各配判别性实验。循环之后存活的是事实，被烧掉的是假设——这是设计意图，不是意外。

名字致敬：这个循环就是 Karl Popper 的方法论，被搬到了 LLM 编码会话上。

## 为什么

模型调试循环会漂移：构建失败的 agent 常换个说法重试同一个猜测。Popper 用「证伪并修正」取代「重试」：

- **失败是证伪事件**，不是重试门票。模型必须反思证据并提出*新*假设。
- **假设必须互斥**，各自带 `predictedObservable` 与判别性 `experimentCommand`。
- **强制新颖性**：复用已被证伪的实验会被拒绝。
- **终止 = 假设前沿耗尽**（连续新颖性/协议不合格），不是固定重试次数；`backstopRounds` 只是成本安全阀。

信任环节（状态机、账本、gate 执行）是确定性代码；创造环节留给模型，但被证伪证据划定的走廊约束。

## 安装

Popper 以 **bundle** 形态安装：包内带 `cordis.patch.yml`，向 profile 插入两行插件（`popper` 与 invariant 伴生 `popper-invariant`）。

npm 渠道暂未发布（发布需账号两步验证，后续可用 `dsh plugin add @deepseek-ai/dsh-popper`）。当前推荐：

```sh
dsh plugin --profile demo add github:1473382/dsh-popper
```

Release 安装包（见 [Releases](https://github.com/1473382/dsh-popper/releases) 页）tarball：

```sh
dsh plugin --profile demo add ./deepseek-ai-dsh-popper-0.1.0-rc.5.tgz
```

首次 `add` 会初始化 profile（含 `@deepseek-ai/dsh-base`）；包声明了 `dsh.bundle`，`dsh` 会把它追加进 `dsh.profile.bundles`。用 `dsh --profile demo --dump-config` 核对（应出现 `# == @deepseek-ai/dsh-popper` 层），再 `dsh --profile demo` 启动。

依赖说明：宿主 `dsh` 安装提供 in-box 包（`cordis`、`dsh-tools`、`dsh-llm`、`dsh-session`、`dsh-agent`、`dsh-invariants`），本包以 peers 声明。组合了 `@deepseek-ai/dsh-base` 的 profile 已满足全部 peers。

> 换 npm scope 发布：把 `@deepseek-ai` 换成你的 scope——`package.json`（name/deps/peers）、`cordis.patch.yml` 的行名、以及 `dsh plugin add` 命令里全部同步替换。

## 配置

| Key | 默认 | 含义 |
|---|---|---|
| `mode` | `observe` | `observe` 只记录协议不执行 gate；`strict` 武装并执行 gate |
| `backstopRounds` | `6` | 连续协议不合格轮数 → 升级 |
| `noveltyRejectLimit` | `3` | 连续新颖性拒绝 → 前沿耗尽 |
| `riskyTools` | `[write, exec, patch, delete]` | 触发 gate 校验的工具名 |
| `gateRegistry` | `[]` | 确定性 gate：`{ id, command, timeoutMs? }`；strict 下必非空，命令只来自任务契约，模型只引用 gate id |
| `falsificationToolName` | `falsification` | 模型面协议工具名 |
| `gateTimeoutMs` | `120000` | gate 执行超时 |
| `outputCapChars` | `2000` | 回注模型的 gate 输出上限（head+tail） |

`strict` + 空 `gateRegistry` / 空 `riskyTools` → 加载即报错（fail loud）。

后续 patch 层覆写示例（整行重述）：

```yaml
- id: popper
  name: '@deepseek-ai/dsh-popper'
  config:
    mode: strict
    gateRegistry:
      - id: typecheck
        command: pnpm run typecheck
        timeoutMs: 120000
```

## 模型可见面

模型通过一个工具 `falsification` 说话，三种动作：

- `claim` — 高风险工作前提交根因假设 + `predictedGateId` + `predictedOutcome`
- `hypotheses` — 证伪之后：≥2 条互斥替代假设，各带 `predictedObservable` + `experimentCommand`
- `experiment` — 执行一条白名单内实验命令；结果进门控

钉死的提示文本（模型可见）：

- 缺主张：`You performed the risky {tool} call without committing a claim. Next risky change must start with falsification action claim: root-cause hypothesis + predicted gate outcome (gate id from the task contract).`
- 证伪：`Claim {id} was falsified by gate {gateId}. Your next action must be falsification action hypotheses: >=2 mutually exclusive new hypotheses, each with predictedObservable and experimentCommand. Repair is only allowed as a corollary of a chosen hypothesis.`
- 白名单拒绝：`Experiment {cmd} is not among your selected hypotheses. Pick one of: {allowed}.`
- 待办步骤：`A falsification step is pending: commit the demanded claim or hypotheses before further risky changes.`

每条账本条目以 `falsification/ledger` 事件追加进会话日志（model-visible ⟺ logged）。哈希链、新颖性记账、判定结果全是确定性逻辑，不回注模型。

## 语义

- **武装**：plan-mode 已组合时，契约在 `plan/mode` 激活期间生效（从会话日志折叠，重放安全，最后一条 wins）；plan 关闭则门控挂起。无 plan-mode 时 strict 配置首用即武装。
- **升级**：前沿耗尽时经 `ctx.userQuestions`（可选服务）提问：`Resume` 重置前沿预算，`Disarm` 撤销契约。无应答者时只记录一次锁存的 `escalation required` 条目，人工裁决前不再放行高风险变更。
- **实验白名单**：只放行所选假设的实验命令，其余记协议违规。
- **账本**：append-only、seq 单调、sha256 prevHash 成链，哈希键序规范化保证会话日志往返后链仍成立；`verifyChain()` 可检测篡改。

## 安全与运维

- gate 通过 `spawn(..., { shell: true })` 本地执行，带超时与 head/tail 截断。**无沙盒**；gate 命令是任意本地命令，必须只来自任务契约的 `gateRegistry`——对 gate 白名单的谨慎程度应等同构建脚本。
- git 安装可行：仓库提交了预构建 `lib/`，无需 `prepare`。若 fork 后自行重建，先在包目录跑 `pnpm run build` 再安装。npm 渠道未发布（账号需两步验证），发布后可用 `dsh plugin add @deepseek-ai/dsh-popper`。
- gate 命令在执行点校验而非解析期；优先使用契约拥有的、固定版本的命令。

## Token 成本

observe 模式 ≈ 0。strict 的开销主要来自多轮重读上下文：约 +2–4%（0 次证伪）、+10–20%（2–4 次）、+30–60%（≥6 次）；病态循环按规则终止。完整模型见仓根 [`popper-plugin-design.md`](../../../popper-plugin-design.md)。

## 开发

- `pnpm exec vitest run packages/guard/popper` — 18 tests：状态机迁移（证伪→假设→实验）、新颖性拒绝→前沿耗尽、契约撤销、resume 预算复位、plan 武装折叠、账本篡改检测，以及真实组合测试（完整 agent loop + 脚本化 mock adapter 驱动协议全程）。
- `tsc -b packages/guard/popper/tsconfig.json` 出类型；`tsdown` 打发布入口（`lib/index.js`、`lib/invariant.js`）。
- 结构：`src/state-machine.ts`（FSM）、`src/ledger.ts`、`src/plan-arming.ts`、`src/tool.ts`（falsification 工具）、`src/wiring.ts`（agent-loop 接线、gate、升级）、`src/invariant.ts`（伴生）。

## 已知限制与延后工作

1. plan 武装跟随 `plan/mode` 激活，不含显式 plan-approval 事件信号。
2. gate 执行暂无沙盒。
3. 快照/回滚未实现（真回滚需 git checkpoint/worktree）。
4. 前沿停滞时的冷 subagent 反方辩手未实现，直接转人工。
5. 跨 agent 适配器（Claude Code、Codex、Piebald/Gemini CLI 走 MCP）进行中；控制器核心与 agent 无关。

## 发布到社区列表

包已发布就绪（bundle 清单、构建产物、文件白名单）。发布：

```sh
npm login           # 你的 scope 有发布权的账号
npm publish --access public
```

然后进社区目录让用户可发现：

- [HubaKing/dsh-community-plugins](https://github.com/HubaKing/dsh-community-plugins) — 插件注册表：PR 加 `@deepseek-ai/dsh-popper` + 本 README 一句话简介。
- [oh-my-dsh](https://github.com/like-study1/Oh-My-DSH) — 合集：plugins 下加条目。
- [awesome-deepseek-harness](https://github.com/0xsline/awesome-deepseek-harness) — 精选列表：加一行。

官方打包指南参见 DeepSeek-Harness 仓库 [`docs/user/develop/basic/publish.md`](../../../../docs/user/develop/basic/publish.md)。