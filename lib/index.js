import z from "@deepseek-ai/schemastery";
import { createHash, randomUUID } from "node:crypto";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { spawn } from "node:child_process";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
//#region src/ledger.ts
/** append-only 证伪账本：seq 单调、prevHash 成链、无删改。 */
var Ledger = class {
	sessionId;
	entries = [];
	sealed = false;
	constructor(sessionId) {
		this.sessionId = sessionId;
	}
	append(partial) {
		if (this.sealed) throw new Error("ledger sealed: append-only violated");
		const prev = this.entries.at(-1);
		const entry = {
			...partial,
			id: randomUUID(),
			seq: prev ? prev.seq + 1 : 1,
			prevHash: prev ? hashEntry(prev) : "",
			sessionId: this.sessionId,
			ts: (/* @__PURE__ */ new Date()).toISOString()
		};
		this.entries.push(entry);
		return entry;
	}
	get all() {
		return this.entries;
	}
	/** 冻结账本（会话收尾），之后 append 抛错。 */
	seal() {
		this.sealed = true;
	}
	/** 校验整条哈希链；false = 账本被篡改。 */
	verifyChain() {
		let prevHash = "";
		for (const e of this.entries) {
			if (e.prevHash !== prevHash) return false;
			prevHash = hashEntry(e);
		}
		return true;
	}
};
function hashEntry(entry) {
	return createHash("sha256").update(JSON.stringify(entry)).digest("hex");
}
//#endregion
//#region src/state-machine.ts
var FalsificationLoop = class {
	config;
	ledger;
	state;
	protocolViolations = 0;
	noveltyRejects = 0;
	activeClaim = null;
	lastExperimentCommands = [];
	selected = [];
	constructor(config, ledger) {
		this.config = config;
		this.ledger = ledger;
		this.state = "observe";
	}
	get currentState() {
		return this.state;
	}
	/** 当前被选的判别实验命令（白名单）；wiring 层只放行这些命令。 */
	get selectedExperiments() {
		return this.selected;
	}
	/** 处理一个输入事件，返回本次追加的账本条目（调用方负责转成 session 事件发出）。 */
	handle(input) {
		const out = [];
		if (this.state === "observe") {
			if (input.type === "contract-armed") {
				this.state = "armed";
				out.push(this.ledger.append({
					actor: input.actor,
					kind: "contract",
					verdict: "unknown",
					message: "contract armed -> strict"
				}));
			} else if (input.type === "model-claim") out.push(this.ledger.append({
				actor: input.actor,
				kind: "claim",
				claim: input.claim,
				verdict: "unknown",
				message: "observe: recorded, gate not executed"
			}));
			else if (input.type === "model-hypotheses") out.push(this.ledger.append({
				actor: input.actor,
				kind: "hypotheses",
				hypotheses: input.hypotheses,
				verdict: "unknown",
				message: "observe: recorded"
			}));
			else if (input.type === "experiment-result") out.push(this.ledger.append({
				actor: "plugin",
				kind: "experiment",
				result: input.result,
				verdict: input.result.ok ? "passed" : "falsified",
				message: "observe: recorded, experiment=" + input.experimentCommand
			}));
			return out;
		}
		if (input.type === "contract-revoked") {
			this.state = "disarmed";
			out.push(this.ledger.append({
				actor: "plugin",
				kind: "disarm",
				verdict: "unknown",
				message: "contract revoked -> disarmed (plan off)"
			}));
			return out;
		}
		switch (this.state) {
			case "armed":
				if (input.type === "model-claim" && isValidClaim(input.claim) && this.config.gateRegistry.has(input.claim.predictedGateId)) {
					this.activeClaim = input.claim;
					this.state = "claim-committed";
					out.push(this.ledger.append({
						actor: input.actor,
						kind: "claim",
						claim: input.claim,
						verdict: "unknown"
					}));
				} else if (input.type === "risky-tool-before" && this.config.riskyTools.includes(input.tool)) {
					this.state = "awaiting-claim";
					out.push(this.ledger.append({
						actor: "plugin",
						kind: "protocol",
						message: "advance protocol: 声明根因假设 + 预测 gate; tool=" + input.tool
					}));
				} else if (input.type === "disarm") {
					this.state = "disarmed";
					out.push(this.ledger.append({
						actor: "plugin",
						kind: "disarm"
					}));
				} else if (input.type === "human-escalation") out.push(this.applyEscalation(input.decision));
				break;
			case "awaiting-claim": {
				const claim = input.type === "model-claim" ? input.claim : null;
				const claimActor = input.type === "model-claim" ? input.actor : "plugin";
				if (claim && isValidClaim(claim) && this.config.gateRegistry.has(claim.predictedGateId)) {
					this.activeClaim = claim;
					this.state = "claim-committed";
					out.push(this.ledger.append({
						actor: claimActor,
						kind: "claim",
						claim,
						verdict: "unknown"
					}));
				} else if (this.protocolViolations >= this.config.backstopRounds) {
					this.state = "frontier-exhausted";
					out.push(this.ledger.append({
						actor: "plugin",
						kind: "frontier",
						verdict: "unknown",
						message: "backstop: 协议不合格超限"
					}));
				} else {
					this.protocolViolations += 1;
					out.push(this.ledger.append({
						actor: "plugin",
						kind: "protocol",
						verdict: "unknown",
						message: "claim 结构不合格或 gate id 不在注册表，重新声明"
					}));
				}
				break;
			}
			case "claim-committed":
				if (input.type === "tool-result") {
					this.state = "gate-pending";
					const claim = this.activeClaim;
					const gate = claim ? this.config.gateRegistry.get(claim.predictedGateId) : void 0;
					out.push(this.ledger.append({
						actor: "plugin",
						kind: "gate",
						gate: {
							id: claim ? claim.predictedGateId : "<none>",
							command: gate ? gate.command : ""
						},
						verdict: "unknown",
						message: "tool=" + input.tool + " -> gate 排期"
					}));
				}
				break;
			case "gate-pending":
				if (input.type === "gate-result") {
					const claim = this.activeClaim;
					const passed = claim ? input.result.ok === claim.predictedOutcome : false;
					const verdict = passed ? "passed" : "falsified";
					out.push(this.ledger.append({
						actor: "plugin",
						kind: "gate",
						gate: {
							id: input.gateId,
							command: this.config.gateRegistry.get(input.gateId)?.command ?? ""
						},
						result: input.result,
						verdict
					}));
					if (passed) {
						this.activeClaim = null;
						this.state = "armed";
					} else if (claim) {
						this.state = "falsified";
						out.push(this.ledger.append({
							actor: "plugin",
							kind: "falsification",
							claim,
							result: input.result,
							verdict: "falsified",
							message: "主张 " + claim.id + " 被证据证伪"
						}));
					}
				}
				break;
			case "falsified":
				if (input.type === "model-hypotheses") {
					const novel = input.hypotheses.filter((h) => !this.lastExperimentCommands.includes(h.experimentCommand)).filter((h) => h.excludes.length >= 1);
					const uniqueExperiments = new Set(novel.map((h) => h.experimentCommand)).size === novel.length;
					const first = novel[0];
					if (novel.length >= 2 && first && uniqueExperiments) {
						this.noveltyRejects = 0;
						this.lastExperimentCommands.push(...novel.map((h) => h.experimentCommand));
						this.selected = novel.map((h) => h.experimentCommand);
						this.state = "experiment-selected";
						out.push(this.ledger.append({
							actor: input.actor,
							kind: "hypotheses",
							hypotheses: novel,
							selected: first.id,
							verdict: "unknown",
							message: "判别实验白名单锁定: " + novel.map((h) => h.experimentCommand).join(" | ")
						}));
					} else {
						this.noveltyRejects += 1;
						out.push(this.ledger.append({
							actor: "plugin",
							kind: "protocol",
							verdict: "unknown",
							message: "新颖性/互斥校验失败（拒绝 #" + this.noveltyRejects + "），重新枚举"
						}));
						if (this.noveltyRejects >= this.config.noveltyRejectLimit) {
							this.state = "frontier-exhausted";
							out.push(this.ledger.append({
								actor: "plugin",
								kind: "frontier",
								verdict: "unknown",
								message: "假设前沿耗尽：连续新颖性拒绝超限"
							}));
						}
					}
				}
				break;
			case "experiment-selected":
				if (input.type === "experiment-result") {
					this.selected = [];
					const verdict = input.result.ok ? "passed" : "falsified";
					out.push(this.ledger.append({
						actor: "plugin",
						kind: "experiment",
						result: input.result,
						verdict,
						message: "experiment=" + input.experimentCommand
					}));
					this.state = verdict === "passed" ? "armed" : "falsified";
				}
				break;
			case "frontier-exhausted":
			case "escalated":
				if (input.type === "human-escalation") out.push(this.applyEscalation(input.decision));
				break;
			case "disarmed": break;
		}
		return out;
	}
	applyEscalation(decision) {
		if (decision === "disarm") {
			this.state = "disarmed";
			return this.ledger.append({
				actor: "human",
				kind: "disarm",
				verdict: "unknown",
				message: "人工撤销契约"
			});
		}
		this.state = "armed";
		this.activeClaim = null;
		this.protocolViolations = 0;
		this.noveltyRejects = 0;
		return this.ledger.append({
			actor: "human",
			kind: "resume",
			verdict: "unknown",
			message: "人工放行，继续契约"
		});
	}
};
function isValidClaim(c) {
	return typeof c.text === "string" && c.text.length > 0 && [
		"hard",
		"empirical",
		"semantic",
		"judgment"
	].includes(c.class) && [
		"claim",
		"strong",
		"hedged"
	].includes(c.assertiveness) && typeof c.predictedGateId === "string" && c.predictedGateId.length > 0 && typeof c.predictedOutcome === "boolean";
}
function makeClaimId() {
	return randomUUID();
}
//#endregion
//#region src/tool.ts
/** 模型可见工具定义；execute 只回显校验后的参数（无副作用），路由靠工具名在 post-execute 完成。 */
function falsificationTool(name) {
	return defineTool({
		name,
		description: "Speak the falsification protocol. Use claim to commit to a root-cause hypothesis with a predicted gate outcome before a risky change; use hypotheses to enumerate >=2 mutually exclusive alternatives with discriminating experiments after a gate falsifies your claim; use experiment to run one selected discriminating experiment.",
		parameters: {
			action: {
				type: "string",
				required: true,
				description: "claim | hypotheses | experiment",
				enum: [
					"claim",
					"hypotheses",
					"experiment"
				]
			},
			rootCause: {
				type: "string",
				description: "claim: the root-cause hypothesis you commit to."
			},
			predictedGateId: {
				type: "string",
				description: "claim: gate id from the task contract whose outcome you predict."
			},
			predictedOutcome: {
				type: "boolean",
				description: "claim: your predicted gate outcome."
			},
			hypotheses: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						text: {
							type: "string",
							required: true
						},
						predictedObservable: {
							type: "string",
							required: true
						},
						experimentCommand: {
							type: "string",
							required: true
						}
					}
				},
				description: "hypotheses: >=2 mutually exclusive alternatives."
			},
			experimentCommand: {
				type: "string",
				description: "experiment: one command from your selected hypotheses."
			}
		},
		async execute(args) {
			return {
				accepted: true,
				action: args.action
			};
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					accepted: {
						type: "boolean",
						required: true
					},
					action: {
						type: "string",
						required: true
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: "falsification: " + value.action + (value.accepted ? " accepted" : "")
			}]
		},
		presentCall(args) {
			const a = args;
			return {
				card: "generic",
				title: "falsification: " + a.action,
				rawInput: a.action
			};
		}
	});
}
//#endregion
//#region src/types-events.ts
/** Durable session event type for one ledger entry. */
const FALSIFICATION_LEDGER_EVENT = "falsification/ledger";
//#endregion
//#region src/plan-arming.ts
/** 折叠最后一条 plan/mode 事件；无则视为未激活。 */
function foldPlanActive(events) {
	let active = false;
	for (const e of events) if (e.type === "plan/mode" && e.data && typeof e.data.active === "boolean") active = e.data.active;
	return active;
}
/** strict 且（无 plan-mode 或 plan 激活）→ 武装。 */
function armScope(mode, planComposed, planActive) {
	return mode === "strict" && (!planComposed || planActive);
}
//#endregion
//#region src/wiring.ts
const PLUGIN_SOURCE = {
	kind: "plugin",
	plugin: "popper"
};
function notice(text, summary) {
	return createUserMessage({
		content: [{
			type: "text",
			text
		}],
		source: {
			...PLUGIN_SOURCE,
			form: "notice",
			summary
		}
	});
}
const claimDemand = (tool) => `You performed the risky ${tool} call without committing a claim. Next risky change must start with falsification action claim: root-cause hypothesis + predicted gate outcome (gate id from the task contract).`;
const falsifiedNotice = (claimId, gateId) => `Claim ${claimId} was falsified by gate ${gateId}. Your next action must be falsification action hypotheses: >=2 mutually exclusive new hypotheses, each with predictedObservable and experimentCommand. Repair is only allowed as a corollary of a chosen hypothesis.`;
const experimentViolation = (command, allowed) => `Experiment ${command} is not among your selected hypotheses. Pick one of: ${allowed.join(" | ")}.`;
const pendingNotice = "A falsification step is pending: commit the demanded claim or hypotheses before further risky changes.";
const armedBanner = (gates) => `Popper armed (strict). Gates: ${gates.join(", ") || "(none — add gateRegistry)"}. Risky calls must be backed by a committed falsification claim first.`;
const observeBanner = "Popper observing: recording evidence only, no gating. Set mode: strict plus gateRegistry to arm the loop.";
const disarmedBanner = "Popper disarmed: the contract was revoked, no gating. Re-arm by feeding a fresh contract-armed event.";
const escalationQuestion = "证伪循环已达假设前沿耗尽：继续契约（会重置前沿预算）还是撤销契约？若无应答 UI，agent 不得继续高风险变更，直到人工 resume/disarm。";
/** 执行确定性 gate 命令：超时、输出截断（head+tail+hash），不接沙盒（见 README Known Limitations）。 */
function runGate(command, timeoutMs, cap) {
	return new Promise((resolve) => {
		const child = spawn(command, {
			shell: true,
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			]
		});
		let buf = "";
		const onData = (chunk) => {
			buf = (buf + chunk.toString()).slice(-(cap * 2 + 1));
		};
		const timer = setTimeout(() => {
			child.kill();
			resolve({
				ok: false,
				evidenceHash: hashOf(buf),
				outputHead: "gate timeout",
				outputTail: "",
				truncated: false
			});
		}, timeoutMs);
		const finish = (code, note) => {
			clearTimeout(timer);
			const truncated = buf.length > cap;
			const result = {
				ok: code === 0,
				evidenceHash: hashOf(buf),
				outputHead: note !== void 0 ? note : buf.slice(0, cap),
				outputTail: buf.slice(-cap),
				truncated
			};
			if (code !== null && note === void 0) result.exitCode = code;
			resolve(result);
		};
		child.stdout?.on("data", onData);
		child.stderr?.on("data", onData);
		child.on("error", (err) => finish(null, "gate failed to start: " + String(err.message ?? err)));
		child.on("close", (code) => finish(code));
	});
}
function hashOf(s) {
	return createHash("sha256").update(s).digest("hex");
}
/**
* Append one ledger entry to the session log; a disabled durable record is a
* swallowed logging failure (the in-memory ledger still carries the entry).
*/
function durableAppend(session, entry) {
	const appendRecord = session.append.bind(session);
	try {
		appendRecord(FALSIFICATION_LEDGER_EVENT, entry, { ignorable: true });
		return true;
	} catch {
		return false;
	}
}
function planActiveNow(session) {
	return foldPlanActive([...session.events]);
}
/**
* 接线安装器：注册监听并把工具侧效应转成 LoopInput。
* @param ctx - cordis context.
* @param config - wiring 配置。
* @returns disposer（registrations are effects）。
*/
function installWiring(ctx, config) {
	const controllers = /* @__PURE__ */ new WeakMap();
	/** 每会话只播报一次模式状态（首个工具调用时），避免会话级噪音。 */
	const announced = /* @__PURE__ */ new Set();
	/** 探测 plan-mode 是否已组合（ctx.get 读全局服务存储，可选服务豁免编译依赖）。 */
	function planComposed() {
		return ctx.get("planMode") !== void 0;
	}
	function controller(agent) {
		let c = controllers.get(agent);
		if (!c) {
			const ledger = new Ledger(agent.session.id);
			c = {
				loop: new FalsificationLoop({
					mode: config.mode,
					backstopRounds: config.backstopRounds,
					noveltyRejectLimit: config.noveltyRejectLimit,
					riskyTools: config.riskyTools,
					gateRegistry: new Map([...config.gateRegistry].map(([id, g]) => [id, { command: g.command }]))
				}, ledger),
				ledger,
				session: agent.session,
				escalationPending: false
			};
			if (armScope(config.mode, planComposed(), planActiveNow(agent.session))) for (const entry of c.loop.handle({
				type: "contract-armed",
				actor: "human"
			})) durableAppend(c.session, entry);
			controllers.set(agent, c);
		}
		return c;
	}
	function record(c, partial) {
		const entry = c.ledger.append(partial);
		durableAppend(c.session, entry);
		return entry;
	}
	function feed(c, input) {
		const entries = c.loop.handle(input);
		for (const entry of entries) durableAppend(c.session, entry);
		return entries;
	}
	function lastClaim(c) {
		for (const e of [...c.ledger.all].reverse()) if (e.kind === "claim" && e.claim) return e.claim;
	}
	/** 前沿耗尽 → 请求人工裁决；无应答者/失败时记录 escalation 需求并锁存（只记录一次）。 */
	async function maybeEscalate(c, agent) {
		if (c.loop.currentState !== "frontier-exhausted" || c.escalationPending) return;
		c.escalationPending = true;
		const uq = ctx.get("userQuestions");
		if (!uq) {
			record(c, {
				actor: "plugin",
				kind: "protocol",
				verdict: "unknown",
				message: "escalation required: no answerer; manual resume/disarm needed"
			});
			return;
		}
		try {
			const selected = (await uq.ask({
				questions: [{
					id: "fl-escalation",
					question: escalationQuestion,
					options: [{
						label: "Resume",
						description: "重置前沿预算，继续契约"
					}, {
						label: "Disarm",
						description: "撤销契约，停止门控"
					}]
				}],
				agent
			})).answers.find((a) => a.id === "fl-escalation")?.selected?.[0];
			feed(c, {
				type: "human-escalation",
				decision: selected === "Disarm" ? "disarm" : "resume"
			});
			c.escalationPending = false;
		} catch (err) {
			record(c, {
				actor: "plugin",
				kind: "protocol",
				verdict: "unknown",
				message: "escalation required: ask failed (" + String(err.message ?? err).slice(0, 120) + "); manual resume/disarm needed"
			});
		}
	}
	async function routeExecution(c, exec, inject) {
		const name = exec.name;
		const s = c.loop.currentState;
		if (config.mode === "strict" && planComposed() && !planActiveNow(c.session)) return [];
		if (!announced.has(c.session.id)) {
			announced.add(c.session.id);
			if (config.mode === "strict") inject(notice(s === "disarmed" ? disarmedBanner : armedBanner([...config.gateRegistry.keys()]), "popper status"));
			else inject(notice(observeBanner, "popper status"));
		}
		if (s === "frontier-exhausted" || s === "escalated") await maybeEscalate(c, exec.agent);
		if (name === config.falsificationToolName) {
			const args = exec.arguments;
			if (args.action === "claim") {
				if (args.rootCause && args.predictedGateId && typeof args.predictedOutcome === "boolean") return feed(c, {
					type: "model-claim",
					actor: "model",
					claim: {
						id: makeClaimId(),
						text: args.rootCause,
						class: "hard",
						assertiveness: "claim",
						predictedGateId: args.predictedGateId,
						predictedOutcome: args.predictedOutcome
					}
				});
				return [];
			}
			if (args.action === "hypotheses" && Array.isArray(args.hypotheses) && args.hypotheses.length > 0) return feed(c, {
				type: "model-hypotheses",
				actor: "model",
				hypotheses: args.hypotheses.map((h, i) => ({
					id: "h" + i,
					text: h.text,
					excludes: ["claim"],
					predictedObservable: h.predictedObservable,
					experimentCommand: h.experimentCommand
				}))
			});
			if (args.action === "experiment" && args.experimentCommand) {
				if (s !== "experiment-selected" || !c.loop.selectedExperiments.includes(args.experimentCommand)) {
					const allowed = [...c.loop.selectedExperiments];
					inject(notice(experimentViolation(args.experimentCommand, allowed), "experiment rejected"));
					return [record(c, {
						actor: "plugin",
						kind: "protocol",
						verdict: "unknown",
						message: "experiment not in whitelist: " + args.experimentCommand
					})];
				}
				return feed(c, {
					type: "experiment-result",
					experimentCommand: args.experimentCommand,
					result: await runGate(args.experimentCommand, config.gateTimeoutMs, config.outputCapChars)
				});
			}
			return [];
		}
		if (config.mode === "observe" || s === "disarmed") return [];
		if (config.riskyTools.includes(name)) {
			if (s === "armed") {
				inject(notice(claimDemand(name), "claim missing"));
				return [record(c, {
					actor: "plugin",
					kind: "protocol",
					verdict: "unknown",
					message: "risky tool ran without claim: " + name
				})];
			}
			if (s === "claim-committed") {
				const entries = feed(c, {
					type: "tool-result",
					tool: name
				});
				if (c.loop.currentState === "gate-pending") {
					const claim = lastClaim(c);
					const gate = claim ? config.gateRegistry.get(claim.predictedGateId) : void 0;
					if (gate && claim) {
						const result = await runGate(gate.command, config.gateTimeoutMs, config.outputCapChars);
						entries.push(...feed(c, {
							type: "gate-result",
							gateId: claim.predictedGateId,
							result
						}));
						if (c.loop.currentState === "falsified") inject(notice(falsifiedNotice(claim.id, claim.predictedGateId), "claim " + claim.id + " falsified"));
					}
				}
				return entries;
			}
			if (s === "awaiting-claim" || s === "falsified" || s === "experiment-selected") {
				inject(notice(pendingNotice, "falsification pending"));
				return [record(c, {
					actor: "plugin",
					kind: "protocol",
					verdict: "unknown",
					message: "risky tool during pending falsification step: " + name
				})];
			}
		}
		return [];
	}
	const disposer = ctx.on("tools/post-execute", async (exec, _result, next) => {
		const downstream = await next();
		if (!exec.agent) return downstream;
		const c = controller(exec.agent);
		const contexts = [];
		await routeExecution(c, exec, (msg) => contexts.push(msg));
		if (contexts.length === 0) return downstream;
		if (downstream.kind === "block") return {
			kind: "block",
			feedback: downstream.feedback,
			additionalContexts: [...contexts, ...downstream.additionalContexts ?? []]
		};
		return {
			...downstream,
			additionalContexts: [...contexts, ...downstream.additionalContexts ?? []]
		};
	});
	return () => {
		disposer();
	};
}
//#endregion
//#region src/index.ts
const name = "popper";
const inject = ["tools"];
const Config = z.object({
	mode: z.union(["observe", "strict"]).default("observe"),
	backstopRounds: z.number().min(1).default(6),
	noveltyRejectLimit: z.number().min(1).default(3),
	riskyTools: z.array(z.string()).default([
		"write",
		"exec",
		"patch",
		"delete"
	]),
	gateRegistry: z.array(z.object({
		id: z.string().required(),
		command: z.string().required(),
		timeoutMs: z.number().min(1)
	})).default([]),
	falsificationToolName: z.string().default("falsification"),
	gateTimeoutMs: z.number().min(1).default(12e4),
	outputCapChars: z.number().min(100).default(2e3)
});
/** Convert validated plugin config to the controller's LoopConfig. */
function toLoopConfig(config) {
	return {
		mode: config.mode,
		backstopRounds: config.backstopRounds,
		noveltyRejectLimit: config.noveltyRejectLimit,
		riskyTools: config.riskyTools,
		gateRegistry: new Map(config.gateRegistry.map((g) => [g.id, { command: g.command }]))
	};
}
/**
* Create a controller with its ledger. Sessions own one controller; wiring
* plugins call this per session and drive it with LoopInput events.
* @param sessionId - session identifier stamped on every ledger entry.
* @param config - validated plugin config.
* @returns the ledger and loop controller pair.
*/
function createFalsificationLoop(sessionId, config) {
	const ledger = new Ledger(sessionId);
	return {
		ledger,
		loop: new FalsificationLoop(toLoopConfig(config), ledger)
	};
}
/**
* Install the plugin. Validates configuration fail-loud: a strict deployment
* must name at least one gate and one risky tool, or the load fails.
* @param ctx - cordis context.
* @param config - validated {@link Config}.
*/
function apply(ctx, config) {
	const loopConfig = toLoopConfig(config);
	if (loopConfig.mode === "strict" && loopConfig.gateRegistry.size === 0) throw new Error("popper: strict mode requires a non-empty gateRegistry (commands must come from the task contract, not the model)");
	if (!Number.isInteger(loopConfig.backstopRounds) || !Number.isInteger(loopConfig.noveltyRejectLimit)) throw new Error("popper: backstopRounds and noveltyRejectLimit must be integers");
	if (loopConfig.mode === "strict" && loopConfig.riskyTools.length === 0) throw new Error("popper: strict mode requires a non-empty riskyTools list");
	const toolName = config.falsificationToolName ?? "falsification";
	const gateTimeoutMs = config.gateTimeoutMs ?? 12e4;
	const outputCapChars = config.outputCapChars ?? 2e3;
	const gateMap = new Map(config.gateRegistry.map((g) => g.timeoutMs === void 0 ? [g.id, { command: g.command }] : [g.id, {
		command: g.command,
		timeoutMs: g.timeoutMs
	}]));
	ctx.tools.register(falsificationTool(toolName));
	installWiring(ctx, {
		mode: loopConfig.mode,
		riskyTools: loopConfig.riskyTools,
		falsificationToolName: toolName,
		gateRegistry: gateMap,
		backstopRounds: loopConfig.backstopRounds,
		noveltyRejectLimit: loopConfig.noveltyRejectLimit,
		gateTimeoutMs,
		outputCapChars
	});
}
//#endregion
export { Config, FALSIFICATION_LEDGER_EVENT, FalsificationLoop, Ledger, apply, createFalsificationLoop, inject, isValidClaim, makeClaimId, name, toLoopConfig };
