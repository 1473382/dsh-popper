# 编写能诚实地失败的 gate

面向**任务契约的编写者**——往 `gateRegistry` 里填 gate 命令的人。模型只能引用 gate id,看不到命令;命令由你写、由你审。

Popper 用 gate 命令的**退出码**判生死:`ok = exit 0`。命令的 stdout/stderr 只进证据账本(`outputHead` + `outputTail` + `evidenceHash`,头尾各截 `outputCapChars`),**不参与过/不过判定**。因此 gate 的全部断言必须由命令自己完成,并在任一断言失败时非零退出。

> 一条 gate 诚实地失败,当且仅当它能在该主张为假时退出非零。

## 让命令自己断言

把“正确性”写进命令,而不是写进一句英文。`pnpm run typecheck` 是好 gate:tsc 在类型错时非零退出。`node -e "console.log('ok')"` 是坏 gate:它在任何情况下都退出 0,不能失败。

完成准则:把 gate 命令跑在你构造的**最小反例**上,它必须非零退出;再跑在已知正确的正例上,它必须退出 0。两端都对,gate 才算写好。

## 成功标记只给人看

命令可以打印一句成功标记(如 `typecheck passed`)方便人工读账本,但 Popper 不读它——退出码是唯一判据。让脚本先做完所有断言,全过后才打印标记并退出 0;任一断言不过,直接非零退出,不印标记。

把“打印了标记”当成通过是空门。

## 测数要独立

不要把任务简报里给定的数字原样写进 gate 的退出逻辑、当它自己的证明。让 gate 从源数据算出该数,套上验收规则,再决定退出码。

## 反例对照

信任一条“缺某物”的 gate 前,先用同一个命令跑一遍**已知存在该物的正例夹具**,确认它非零退出。一个找不到文件、路径写错或正则失配的 gate 会把“什么都没有”误读成“通过”。

## 可移植

优先用仓库自带的 node 脚本。不要假设 stock Windows 提供 `grep`/`tail`/`tr`/`sed` 或 POSIX 管道。gate 在执行点解析,继承当前 shell 与 PATH;从 Git Bash 启动与从 PowerShell 启动可能解析到不同的外部工具——父级复核用同一 shell 与工具链。

## timeout 与输出

gate 默认超时 `gateTimeoutMs`;单条 gate 可在 `gateRegistry` 写 `timeoutMs`。超时即判不过。输出超 `outputCapChars` 被截头尾;超时与启动失败的诊断只进账本,不回注模型当证据。

## 把 gate 当构建脚本对待

`gateRegistry` 里的命令是任意本地 shell 代码,**无沙盒**,以启动 checker 的用户权限与继承环境运行(`spawn(command, { shell: true })`)。对 gate 命令的谨慎程度应等同你的构建脚本——只放你写的或读懂的命令。命令只来自任务契约、模型只能引用 gate id,正是为此。
