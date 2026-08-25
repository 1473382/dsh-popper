# 武装前 lint（部分自动强制）

面向**武装 strict 之前**的契约编写者。Popper 的状态机已拦住:没主张就动手、复用已证伪实验、白名单外实验、两条假设共用同一 `experimentCommand`。本 lint 补两类原先拦不住的坏件——**重复的 `predictedObservable`**(两假设预测同一可观测,实验无法在它们间判别)与**空字段**——现由 [`../src/lint.ts`](../src/lint.ts) 的 `lintHypotheses` 在状态机 `model-hypotheses` 入口**自动拒绝**(计一次新颖性拒绝,不进实验白名单)。

剩下一条**仍靠人**:**gate 本来就不可能失败**(恒退出 0)。它是词法启发、有误杀风险,故只作 advisory,未自动阻断——契约编写者用同文件的 `lintGateCommand` 自查。

> 完成准则:假设类全过(否则被自动拒);gate 类 advisory 全空或已复查。

## 假设能判别吗（已自动强制）

由 `lintHypotheses` 在 `model-hypotheses` 入口强制,`severity: 'reject'`:

- 任意两条假设的 `predictedObservable` trim 后相同 → 拒(预测同一可观测,无法判别)。
- 任一假设 `predictedObservable` 为空 → 拒(无可观测量)。
- 任一假设 `experimentCommand` 为空 → 拒(无实验)。

被拒的提交计一次新颖性拒绝,连续达 `noveltyRejectLimit` 即前沿耗尽;绝不进实验白名单。这条与状态机原有的「`experimentCommand` 两两不同」校验互补:原校验保证实验不同,本校验保证可观测量不同——两者都成立,实验才可能在假设间判别。

## gate 能失败吗（advisory,未自动阻断）

由 `lintGateCommand` 提供,`severity: 'advisory'`——不阻断,只提示契约编写者复查。命中的词法特征:

- `true` / `:` 这类恒退出 0。
- 仅 `echo …`(只打印,恒退出 0)。
- `node -e "console.log(…)"` 且**不含** `process.exit`(无断言,恒退出 0)。
- 尾部 `|| true` / `&& true`(吞掉非零退出)。
- 空命令 → `reject`(不可能失败)。

advisory 不自动阻断是为避免误杀合法 gate(一条以 `echo` 开头但后接真实断言的命令会被误报)。要更严,把 `lintGateCommand` 接进你的契约校验流水即可。

## claim 绑了真 gate 吗（已由武装期强制,lint 复核）

- claim 的 `predictedGateId` 在 `gateRegistry` 里真实存在:武装期 `apply` 会因空 registry 报错,claim 期状态机校验 id 存在——lint 期就该发现。
- claim 的 `predictedOutcome` 是你真信的预测,不是"怎么都会过"的兜底。

## 实验不重复（已自动强制,lint 复核）

Popper 已拒绝复用被证伪的 `experimentCommand`(新颖性记账,状态机 `lastExperimentCommands`)。lint 只需确认:你预案里的实验命令彼此不同,且与已证伪的不同。
