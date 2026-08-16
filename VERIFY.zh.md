# Popper 真机验证清单

逐步骤在真实 `dsh` 会话里确认 Popper 真的在武装、真的在门控——而不是只在单元测试里成立。每一步都写明预期（模型可见）输出；若预期文字对不上，说明插件没有按设计生效。

## 0. 前置条件

- 一台装好 `dsh` 的机器，以及一个可随时重建的 profile（下文用 `demo`）。
- `dsh --profile demo` 能正常启动（首次 `dsh plugin add` 会自动创建 profile）。

## 1. 安装

```sh
dsh plugin --profile demo add github:1473382/dsh-popper
```

核验 bundle 层真的落进去了：

```sh
dsh --profile demo --dump-config
```

预期看到 `# == @deepseek-ai/dsh-popper` 层，插入两行：`popper`（主插件）与 `popper-invariant`（伴生）。

## 2. 配 strict 模式 + 两个 gate

覆写 popper 行（后续 `cordis.patch.yml` 层，或直接改 bundle 层）：

```yaml
- id: popper
  name: '@deepseek-ai/dsh-popper'
  config:
    mode: strict
    gateRegistry:
      - id: sanity
        command: node -e "process.exit(0)"
        timeoutMs: 30000
      - id: breaker
        command: node -e "process.exit(1)"
        timeoutMs: 30000
```

`sanity` 是正确主张应当扛过去的 gate；`breaker` 是错误主张应当被它证伪的 gate。重启会话（`dsh --profile demo`）并开一个新对话。

## 3. 证明工具是模型可见的

让模型列一下它的工具（或先跑一轮废话）。**预期：**能看到 `falsification` 工具，含三个动作：`claim`、`hypotheses`、`experiment`。

## 4. 证明 pre-tool 拦截（缺主张）

让模型**不调用 `falsification`** 直接执行风险动作（如 `write` 写文件 / `exec` 跑命令）。

**预期：**模型收到钉死的提示文本：

> `You performed the risky {tool} call without committing a claim. Next risky change must start with falsification action claim: root-cause hypothesis + predicted gate outcome (gate id from the task contract).`

该风险调用不会作为自由动作执行（协议条目被路由回循环）。

## 5. 证明 claim + gate 执行（绿路）

让模型提交一个主张：`falsification` 动作 `claim`，字段例如：

- `id`：唯一 id
- `text`：根因假设
- `class`：`hard`
- `assertiveness`：`claim`
- `predictedGateId`：`sanity`
- `predictedOutcome`：`true`

然后执行一次风险改动。**预期：**在步骤边界/pre-tool 处 `sanity` gate 被执行（`process.exit(0)`）并**通过**；会话继续，不出现证伪提示。

## 6. 证明证伪（红路）

提交一个 `predictedGateId` 为 `breaker`（`process.exit(1)`）的主张并执行风险改动。

**预期：**收到钉死的证伪提示：

> `Claim {id} was falsified by gate {gateId}. Your next action must be falsification action hypotheses: >=2 mutually exclusive new hypotheses, each with predictedObservable and experimentCommand. Repair is only allowed as a corollary of a chosen hypothesis.`

模型随后必须发出 `hypotheses`，至少两个替代假设；每个都要有 `predictedObservable` 与 `experimentCommand`。

## 7. 证明实验白名单

假设被接受后，让模型用**不在所选假设里**的命令执行 `falsification` 动作 `experiment`。

**预期：**白名单拒绝文本：

> `Experiment {cmd} is not among your selected hypotheses. Pick one of: {allowed}.`

执行白名单内的实验则正常执行（进门控、输出截断）。

## 8. 证明新颖性拒绝与升级

反复提交**复用同一实验命令**的证伪假设。

**预期：**复用已证伪实验被拒（新颖性/协议违规）。连续 `noveltyRejectLimit` 次后升级：有应答者时弹 `userQuestions` 对话框——`Resume`（重置前沿预算）/ `Disarm`（撤销契约）；无应答者时记录 `escalation required` 账本条目，人工裁决前不再放行风险变更。

## 9. 证明账本可回放

在会话日志文件里查事件：

```sh
grep -o '"type":"falsification/ledger"' <session log> | wc -l
```

**预期：**非空、有序的事件链（类型：`claim`、`gate`、`hypotheses`、`experiment`、`falsification`，以及做过的 `resume`/`disarm`/`escalation`），每条带 `seq`、`prevHash`、`hash`——可回放"这一步为何被拦/为何没拦"。

## 10. 可选：plan 挂起行为

在 profile 组合一个 plan 插件，保持 `plan/mode` **未激活**。**预期：**strict 门控被挂起（`strict && planComposed && !planActive`）。激活 plan 模式后**预期：**门控恢复。

## 11. 可选：observe 模式

把 `mode` 改为 `observe`。**预期：**循环只记录 claim/hypotheses/experiment 协议条目与账本事件，不执行任何 gate、不做任何拦截。

## 验收表

| # | 操作 | 预期信号 | 完成 |
|---|---|---|---|
| 1 | `dsh plugin add` | `--dump-config` 里出现 bundle 层 | ☐ |
| 3 | 模型列工具 | `falsification` 可见 | ☐ |
| 3b | 首个工具调用 | 一次性状态横幅（`Popper armed (strict). Gates: ...` 或 `Popper observing: ...`） | ☐ |
| 4 | 无主张风险调用 | 缺主张提示文本、调用不自由放行 | ☐ |
| 5 | claim + `sanity` gate | gate 通过、无证伪 | ☐ |
| 6 | claim + `breaker` gate | 证伪提示送达 | ☐ |
| 7 | 白名单外实验 | 白名单拒绝文本 | ☐ |
| 8 | 复用已证伪实验 | 新颖性拒绝 → 升级（Resume/Disarm 或锁存） | ☐ |
| 9 | 会话日志 | 有序 `falsification/ledger` 链 | ☐ |

## 排查

- **工具不可见**：重启会话让插件的 `ctx.tools.register` 生效；确认 `--dump-config` 里的行 id/name。
- **gate 没跑**：确认 `mode: strict`、`gateRegistry` 非空、claim 的 `predictedGateId` 与注册 id 一致——gate id 是模型的契约词表。
- **模型不理协议**：钉死文本在工具结果/提示里（见 README「模型可见面」）；反复无视会累积协议违规直到升级——这是设计压力，不是漏洞。
- **卡在升级**：无 `userQuestions` 应答者时插件按设计锁存 `escalation required` 并拒绝对新风险变更；请接应答者或 `Disarm`。

## 卸载

```sh
dsh plugin --profile demo remove @deepseek-ai/dsh-popper
```

## 反馈

预期文字/行为与实测不一致？去 github.com/1473382/dsh-popper 开 issue，附上账本摘录。