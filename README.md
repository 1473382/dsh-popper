# @deepseek-ai/dsh-popper

> 中文版见 [README.zh.md](README.zh.md).

> **Stop retrying. Start falsifying.**

LLM coding agents don't fail like compilers do. They drift: the model latches onto a root-cause guess, slaps a patch, the build fails — and it retries the same guess in new wording, burning tokens while compounding the wrong direction. Popper replaces blind retry with forced falsification. Before any risky change, the agent commits an explicit, checkable claim: a root-cause hypothesis and a predicted outcome bound to a deterministic gate. The gate verifies it. When a claim is falsified, Popper demands at least two mutually exclusive replacement hypotheses, each carrying its own discriminating experiment — and a falsified experiment can never be reused. The loop ends by frontier exhaustion, not by retry counts, so "give up" is a logical state, not an arbitrary number. Every step lands in an append-only SHA-256 evidence ledger you can audit. For DeepSeek Harness agents, Popper turns token burn into evidence, and babysitting into review.

**Popper** is a falsification-driven correction loop for agent sessions. Instead of letting a coding agent *retry* after a failure, it commits the agent to an explicit, evidence-checkable claim before risky work, runs a deterministic **gate** on that work, and when the gate falsifies the claim, forces the agent to propose mutually exclusive replacement hypotheses with discriminating experiments. What survives the loop is a fact; what dies is a hypothesis — on purpose.

The name is an homage: the loop is Karl Popper's method, enforced on an LLM coding session.

## Why

Model debug loops drift: an agent that failed a build tends to make the same guess with a new coat of paint. Popper replaces `retry` with `falsify-and-revise`:

- **Failure is a falsification event**, not a retry ticket. The model must reflect on the evidence and propose a *new* hypothesis.
- **Hypotheses must be mutually exclusive**, each with a `predictedObservable` and a discriminating `experimentCommand`.
- **Novelty is enforced**: reusing an already-falsified experiment is rejected.
- **Termination is frontier exhaustion** (consecutive novelty/protocol rejections), never a fixed retry count. `backstopRounds` is only a cost safety valve.

Trust-bearing parts are deterministic code (state machine, ledger, gate executor). Creative parts stay with the model, bounded by the corridor of falsified evidence.

## Install

Popper installs as a **bundle**: the package ships a `cordis.patch.yml` that inserts two plugin rows (`popper` and its `popper-invariant` companion) into a profile.

From GitHub (recommended — the repository ships prebuilt `lib/`):

```sh
dsh plugin --profile demo add github:1473382/dsh-popper
```

From a release tarball (see the [Releases](https://github.com/1473382/dsh-popper/releases) page):

```sh
dsh plugin --profile demo add ./deepseek-ai-dsh-popper-0.1.0-rc.5.tgz
```

The first `add` initializes the profile with `@deepseek-ai/dsh-base`; `dsh` appends the bundle to `dsh.profile.bundles` because the package declares `dsh.bundle`. Verify with `dsh --profile demo --dump-config` (you should see a `# == @deepseek-ai/dsh-popper` layer) and boot with `dsh --profile demo`.

Requirements: the host `dsh` installation provides the in-box packages (`cordis`, `dsh-tools`, `dsh-llm`, `dsh-session`, `dsh-agent`, `dsh-invariants`); the package declares them as peers. A profile that composes `@deepseek-ai/dsh-base` already satisfies them.

> Publishing under a different npm scope: replace `@deepseek-ai` with your scope in `package.json` (name, deps, peers), in `cordis.patch.yml` row names, and in the `dsh-plugin` install command.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `mode` | `observe` | `observe`: record the model's protocol without executing gates; `strict`: arm and execute gates |
| `backstopRounds` | `6` | consecutive protocol-invalid rounds before escalation |
| `noveltyRejectLimit` | `3` | consecutive novelty rejections -> frontier exhausted |
| `riskyTools` | `[write, exec, patch, delete]` | tool names that trigger gate validation |
| `gateRegistry` | `[]` | deterministic gates: `{ id, command, timeoutMs? }`. In `strict`, must be non-empty; commands come only from the task contract, the model references gate ids |
| `falsificationToolName` | `falsification` | model-facing protocol tool name |
| `gateTimeoutMs` | `120000` | gate execution timeout |
| `outputCapChars` | `2000` | gate output injected back (head + tail) |

`strict` with an empty `gateRegistry` or empty `riskyTools` fails loud at load.

Example `cordis.patch.yml` override (a later patch layer restates the whole row):

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

## Model experience

The model speaks through one tool, `falsification`, with three actions:

- `claim` — commit root-cause hypothesis + `predictedGateId` + `predictedOutcome` before risky work
- `hypotheses` — after a falsification: >=2 mutually exclusive alternatives, each with `predictedObservable` + `experimentCommand`
- `experiment` — run one whitelisted experiment command; results are gated

Notice texts (pinned, model-visible):

- Missing claim: `You performed the risky {tool} call without committing a claim. Next risky change must start with falsification action claim: root-cause hypothesis + predicted gate outcome (gate id from the task contract).`
- Falsification: `Claim {id} was falsified by gate {gateId}. Your next action must be falsification action hypotheses: >=2 mutually exclusive new hypotheses, each with predictedObservable and experimentCommand. Repair is only allowed as a corollary of a chosen hypothesis.`
- Whitelist rejection: `Experiment {cmd} is not among your selected hypotheses. Pick one of: {allowed}.`
- Pending step: `A falsification step is pending: commit the demanded claim or hypotheses before further risky changes.`

Every ledger entry is appended to the session log as an `falsification/ledger` event (model-visible <=> logged). The hash chain, novelty accounting, and verdicts are deterministic and never rendered to the model.

## Semantics

- **Arming**: when plan-mode is composed, the contract is in force while `plan/mode` is active (folded from the session log, replay-safe, last wins); plan off suspends gating. Without plan-mode, `strict` config arms on first use.
- **Escalation**: on frontier exhaustion, Popper asks through `ctx.userQuestions` (optional service): `Resume` resets the frontier budget, `Disarm` revokes the contract. With no answerer, one latched `escalation required` entry is recorded and no further risky change passes until a human decides.
- **Experiment whitelist**: only commands from the selected hypotheses execute; anything else is a protocol violation.
- **Ledger**: append-only, monotonic `seq`, sha256 `prevHash` chain with key-order-canonical hashing so the chain survives session-log round trips; `verifyChain()` detects tamper.

## Security and operational notes

- Gates execute locally via `spawn(..., { shell: true })` with a timeout and head/tail output truncation. There is **no sandbox**; gate commands are arbitrary local commands and must come only from the task contract's `gateRegistry`. Treat the gate allowlist with the same care as a build script.
- Git installs work because the repository commits the prebuilt `lib/`; no `prepare` build runs. If you fork and rebuild, run `pnpm run build` in the package before installing from your fork.
- Validation of gate commands happens at execution time, not at the parser; prefer contract-owned, pinned commands.

## Token cost

Observe mode adds ~0. Strict mode's overhead is dominated by extra turns of re-reading context: roughly +2–4% (0 falsifications), +10–20% (2–4), +30–60% (>=6); a pathological loop is rule-terminated. Full model in [`popper-plugin-design.md`](../../../popper-plugin-design.md) (repository root).

## Development

- `pnpm exec vitest run packages/guard/popper` — 18 tests: state machine transitions (falsify -> hypotheses -> experiment), novelty rejection -> frontier exhaustion, contract revocation, resume budget reset, plan-arming fold, ledger tamper detection, and a real-composition suite driving a full agent loop with a scripted mock adapter.
- `tsc -b packages/guard/popper/tsconfig.json` builds types; `tsdown` bundles the publish entries (`lib/index.js`, `lib/invariant.js`).
- Layout: `src/state-machine.ts` (FSM), `src/ledger.ts`, `src/plan-arming.ts`, `src/tool.ts` (falsification tool), `src/wiring.ts` (agent-loop seam, gates, escalation), `src/invariant.ts` (companion).

## Known limitations and deferred work

1. Plan arming follows `plan/mode` activation; an explicit plan-approval event is not part of the signal.
2. Gate execution has no sandbox yet.
3. Snapshot/rollback (true rollback needs a git checkpoint/worktree) is not implemented.
4. No cold-subagent adversary at frontier stall; escalation goes straight to a human.
5. Cross-agent adapters (Claude Code, Codex, Piebald/Gemini CLI via MCP) are in progress; the controller core is agent-agnostic.

## Publish to a community list

The package is publish-ready (bundle manifest, built lib, charset of files). To publish:

```sh
npm login           # an account with publish rights to your scope
npm publish --access public
```

Then list it in a community catalog so users can discover it:

- [HubaKing/dsh-community-plugins](https://github.com/HubaKing/dsh-community-plugins) — plugins registry: open a PR adding `@deepseek-ai/dsh-popper` with this README's one-liner.
- [oh-my-dsh](https://github.com/like-study1/Oh-MY-DSH) — collection: add an entry under plugins.
- [awesome-deepseek-harness](https://github.com/0xsline/awesome-deepseek-harness) — curated list: add a line.

See also the official packaging guide: [`docs/user/develop/basic/publish.md`](../../../../docs/user/develop/basic/publish.md) in the DeepSeek-Harness repository.