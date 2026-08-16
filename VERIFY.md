# Popper on-machine verification checklist

Step-by-step, real-machine confirmation that Popper is actually arming and gating in a live `dsh` session — not just in unit tests. Every step lists the expected, model-visible outcome; if the expected text differs, the plugin did not activate as designed.

## 0. Prerequisites

- A machine with a working `dsh` installation and a disposable profile (here: `demo`).
- `dsh --profile demo` boots successfully (profile created by the first `dsh plugin add`).

## 1. Install

```sh
dsh plugin --profile demo add github:1473382/dsh-popper
```

Verify the bundle layer landed:

```sh
dsh --profile demo --dump-config
```

Expect a `# == @deepseek-ai/dsh-popper` layer inserting two rows: `popper` (main) and `popper-invariant` (companion).

## 2. Configure strict mode with two gates

Override the popper row (a later `cordis.patch.yml` layer, or edit the bundle layer) to:

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

`sanity` is the gate a correct claim should survive; `breaker` is the gate a wrong claim should be falsified by. Restart the session (`dsh --profile demo`), open a new conversation.

## 3. Prove the tool is model-visible

Ask the model to list its tools (or run one trivial turn). **Expected:** the `falsification` tool is present, with three actions: `claim`, `hypotheses`, `experiment`.

## 4. Prove pre-tool interception (missing claim)

Ask the model to run a risky action — `write` a file, or `exec` something — **without** calling `falsification` first.

**Expected:** the model reports the pinned demand text:

> `You performed the risky {tool} call without committing a claim. Next risky change must start with falsification action claim: root-cause hypothesis + predicted gate outcome (gate id from the task contract).`

The risky call is not executed as a free action (the protocol entry is routed back into the loop instead).

## 5. Prove claim + gate execution (green path)

Have the model commit a claim: `falsification` action `claim` with fields such as

- `id`: unique id
- `text`: the root-cause hypothesis
- `class`: `hard`
- `assertiveness`: `claim`
- `predictedGateId`: `sanity`
- `predictedOutcome`: `true`

then perform a risky change. **Expected:** at the step boundary / pre-tool point the gate `sanity` runs (`process.exit(0)`) and **passes**; the session continues; no falsification notice appears.

## 6. Prove falsification (red path)

Commit a claim whose `predictedGateId` is `breaker` (`process.exit(1)`) and perform the risky change.

**Expected:** the pinned falsification notice is delivered:

> `Claim {id} was falsified by gate {gateId}. Your next action must be falsification action hypotheses: >=2 mutually exclusive new hypotheses, each with predictedObservable and experimentCommand. Repair is only allowed as a corollary of a chosen hypothesis.`

The model must then emit `hypotheses` with at least two alternatives; each needs `predictedObservable` and `experimentCommand`.

## 7. Prove the experiment whitelist

After hypotheses are accepted, ask the model to run `falsification` action `experiment` with a command that was **not** among the selected hypotheses.

**Expected:** the whitelist rejection text:

> `Experiment {cmd} is not among your selected hypotheses. Pick one of: {allowed}.`

Running an allowed experiment executes it (gated, output capped).

## 8. Prove novelty rejection and escalation

Repeat falsified hypotheses reusing the **same experiment command** already tried.

**Expected:** reusing a falsified experiment is rejected (novelty violation / protocol violation). After `noveltyRejectLimit` consecutive rejections, the plugin escalates: with an answerer, the `userQuestions` dialog offers `Resume` (resets the frontier budget) / `Disarm` (revokes the contract); without one, an `escalation required` ledger entry is recorded and no further risky change passes until a human decides.

## 9. Prove the ledger is replayable

In the session log file, grep the events:

```sh
grep -o '"type":"falsification/ledger"' <session log> | wc -l
```

**Expected:** a non-empty, ordered chain of entries (kinds: `claim`, `gate`, `hypotheses`, `experiment`, `falsification`, `resume`/`disarm`/`escalation` as exercised), each with `seq`, `prevHash`, `hash` — replayable as "why was this step gated or not".

## 10. Optional: plan-suspend behavior

Compose a plan plugin in the profile and leave `plan/mode` **inactive**. **Expected:** strict gating is suspended (`strict && planComposed && !planActive`). Activate plan mode; **expected:** gating resumes.

## 11. Optional: observe mode

Set `mode: observe`. **Expected:** the loop records claim/hypotheses/experiment protocol entries and ledger events, but executes no gates and imposes no interception.

## Acceptance table

| # | Action | Expected signal | Done |
|---|---|---|---|
| 1 | `dsh plugin add` | bundle layer in `--dump-config` | ☐ |
| 3 | model tool list | `falsification` tool visible | ☐ |
| 3b | first tool call | one-time status banner (`Popper armed (strict). Gates: ...` or `Popper observing: ...`) | ☐ |
| 4 | risky call w/o claim | claim demand text, call not free-run | ☐ |
| 5 | claim + `sanity` gate | gate passes, no falsification | ☐ |
| 6 | claim + `breaker` gate | falsification notice delivered | ☐ |
| 7 | unlisted experiment | whitelist rejection text | ☐ |
| 8 | reuse falsified experiment | novelty reject → escalation (Resume/Disarm or latch) | ☐ |
| 9 | session log | ordered `falsification/ledger` chain | ☐ |

## Troubleshooting

- **Tool invisible**: restart the session so the plugin's `ctx.tools.register` applies; confirm the row id/name in `--dump-config`.
- **No gate ran**: confirm `mode: strict`, non-empty `gateRegistry`, and that the claim's `predictedGateId` matches a registered id — gate id is the model's contract vocabulary.
- **Model ignores the protocol**: the pinned texts are in the tool result/notices (see README "Model experience"); an ignoring model accumulates protocol violations until escalation — that is the designed pressure, not a leak.
- **Stuck at escalation**: without a `userQuestions` answerer the plugin latches `escalation required` and refuses further risky changes by design; provide an answerer or `Disarm`.

## Uninstall

```sh
dsh plugin --profile demo remove @deepseek-ai/dsh-popper
```

## Report

Found a divergence between expected text/behavior and reality? Open an issue at github.com/1473382/dsh-popper with the ledger excerpt.