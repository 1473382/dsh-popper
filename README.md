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

## Design

### Activation: a three-layer switch, event-driven, never polling

- **Layer 1 — mount.** Declaring the plugin in `cordis.yml` starts it in `observe` mode: evidence recorded, nothing gated.
- **Layer 2 — arm.** The moment a task contract appears (a P0 template being approved is the arming signal, recorded into the session log like plan mode), the session moves to `strict`. No contract -> pure observation; contract present -> strict. Both states are recorded, so any session can be replayed and the answer to "why was this step not gated" is a lookup, not a guess.
- **Layer 3 — trigger.** Event-driven interception at specific boundaries only: before high-risk tool calls (pre-tool on `write`/`exec`/core changes), at step boundaries (hard gate at the end of an LLM turn), and at milestones (full verification).

No polling, no per-token scanning. Listeners sit on the event stream; cost is paid only at the boundaries being gated. Arming itself is an event in the audit chain — who armed it, when, with which contract.

### Division of labor: a mechanical judge, not another agent

| Role | What it is | What it does |
|---|---|---|
| Judge | The plugin itself (plain JS, no thinking) | Parses claims, runs gates (deterministic commands), compares prediction vs result, writes the ledger, gates the next step |
| Thinker | The session's LLM | Proposes hypotheses and discriminating experiments — structurally constrained, not free-form |
| Infrastructure | Snapshot / git | True rollback |
| Observer | Human / interaction | Steps in at frontier stall |

Every trust-bearing decision is code: gate pass/fail vs predicted pass/fail, compared, judged. The plugin never asks a model "is this right?". The model still thinks in the same session context, but inside a structural corridor — when a gate falsifies a claim, the plugin injects a forced protocol message ("claim X was falsified by evidence E; give >=2 mutually exclusive hypotheses, each with a discriminating experiment") and enforces it two ways:

- **Output-shape validation**: a reply missing fields, or hypotheses that are not mutually exclusive, is a protocol violation and does not proceed.
- **Tool whitelisting**: the next round may only run the selected hypotheses' discriminating experiment commands; anything else is rejected.

This is one brain plus an external mechanical judge — not "another agent takes over". When should a separate agent appear? At frontier stall: the in-session model's bias lives in its own context — the "confirmed" conclusion was its own, and rephrasing still enumerates its own guesses. Popper then spawns a cold subagent with no session seed, fed only the falsification ledger, to propose hypotheses from zero. Cold start discards sunk-cost bias — the correct antidote to confirmation bias. Its output writes back to the same ledger; no parallel world. (Planned — see Known limitations.)

### Bounded self-evolution: four mechanisms, four iron rules

The plugin evolves — but inside the skeleton, with evidence anchored outside it.

- **Gate mining**: aggregate the ledger across sessions — claim classes with the highest drift rate get a recommendation to tighten their gate; gates that pass a hundred times get a recommendation to downgrade to observe mode and save tokens.
- **Strategy bandit**: small parameters inside the correction loop (experiment aggressiveness, degradation thresholds when experiments are expensive) live in a template library; the variant with the best historical success per claim class is chosen. Parameters evolve; the skeleton is frozen.
- **Meta-falsification (one recursive level)**: the plugin runs the same loop on itself. "Tightening gate G lowers the error rate" is a meta-claim with a prediction; cross-session aggregate metrics (escape rate, deadlock rate, throughput cost) are its gates. If the metric misses, the plugin's own claim is falsified and it must revise its gate set. Same loop, one level up, exactly one level.
- **Failure-mode library**: claim classes that drift repeatedly become a "rap sheet", pre-loaded into later sessions' prompts and contract templates. Cross-session learning is evolution — this repository's Agent Notes and post-mortems are the existing form of this pattern.

The only way recursion could self-destruct is the plugin rewriting its own verification rules. Four iron rules prevent it:

1. **Skeleton frozen**: the claim -> falsify -> enumerate -> discriminate protocol cannot be changed by the plugin; only parameters and the gate set.
2. **Meta-metrics externally computable**: the meta-loop's gates are aggregate statistics derived from session logs, never model self-assessment — no "it passed because it said so".
3. **Change review gate**: evolution produces proposals; applying them requires human approval or an independent review agent (the existing `self-modification` capability).
4. **Ledger append-only**: falsification records and gate history cannot be rewritten by the plugin — otherwise evolution would be self-deception.

In one sentence: **evolution happens inside the skeleton; evidence is anchored outside it.** The plugin can get smarter (choose gates, tune strategy, absorb history), but it can never convince itself to remove the gate.

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