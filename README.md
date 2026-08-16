# @deepseek-ai/dsh-popper

> 中文版见 [README.zh.md](README.zh.md).

> **Stop retrying. Start falsifying.**

LLM coding agents don't fail like compilers do. They drift: the model latches onto a root-cause guess, slaps a patch, the build fails — and it retries the same guess in new wording, burning tokens while compounding the wrong direction. Popper replaces blind retry with forced falsification. Before any risky change, the agent commits an explicit, checkable claim: a root-cause hypothesis and a predicted outcome bound to a deterministic gate. The gate verifies it. When a claim is falsified, Popper demands at least two mutually exclusive replacement hypotheses, each carrying its own discriminating experiment — and a falsified experiment can never be reused. The loop ends by frontier exhaustion, not by retry counts, so "give up" is a logical state, not an arbitrary number. Every step lands in an append-only SHA-256 evidence ledger you can audit. For DeepSeek Harness agents, Popper turns token burn into evidence, and babysitting into review.

**Popper** is a falsification-driven correction loop for agent sessions. Instead of letting a coding agent *retry* after a failure, it commits the agent to an explicit, evidence-checkable claim before risky work, runs a deterministic **gate** on that work, and when the gate falsifies the claim, forces the agent to propose mutually exclusive replacement hypotheses with discriminating experiments. What survives the loop is a fact; what dies is a hypothesis — on purpose.

The name is an homage: the loop is Karl Popper's method, enforced on an LLM coding session.

## Why

Model debug loops drift: an agent that failed a build tends to make the same guess with a new coat of paint. Popper replaces `retry` with `falsify-and-revise`:
