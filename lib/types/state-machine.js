import { randomUUID } from 'node:crypto';
export class FalsificationLoop {
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
        this.state = 'observe';
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
        if (this.state === 'observe') {
            if (input.type === 'contract-armed') {
                this.state = 'armed';
                out.push(this.ledger.append({ actor: input.actor, kind: 'contract', verdict: 'unknown', message: 'contract armed -> strict' }));
            }
            else if (input.type === 'model-claim') {
                out.push(this.ledger.append({ actor: input.actor, kind: 'claim', claim: input.claim, verdict: 'unknown', message: 'observe: recorded, gate not executed' }));
            }
            else if (input.type === 'model-hypotheses') {
                out.push(this.ledger.append({ actor: input.actor, kind: 'hypotheses', hypotheses: input.hypotheses, verdict: 'unknown', message: 'observe: recorded' }));
            }
            else if (input.type === 'experiment-result') {
                out.push(this.ledger.append({ actor: 'plugin', kind: 'experiment', result: input.result, verdict: input.result.ok ? 'passed' : 'falsified', message: 'observe: recorded, experiment=' + input.experimentCommand }));
            }
            return out;
        }
        // 契约撤销（plan off）：任意专属执行态一律退到 disarmed。
        if (input.type === 'contract-revoked') {
            this.state = 'disarmed';
            out.push(this.ledger.append({ actor: 'plugin', kind: 'disarm', verdict: 'unknown', message: 'contract revoked -> disarmed (plan off)' }));
            return out;
        }
        switch (this.state) {
            case 'armed': {
                if (input.type === 'model-claim' && isValidClaim(input.claim) && this.config.gateRegistry.has(input.claim.predictedGateId)) {
                    this.activeClaim = input.claim;
                    this.state = 'claim-committed';
                    out.push(this.ledger.append({ actor: input.actor, kind: 'claim', claim: input.claim, verdict: 'unknown' }));
                }
                else if (input.type === 'risky-tool-before' && this.config.riskyTools.includes(input.tool)) {
                    this.state = 'awaiting-claim';
                    out.push(this.ledger.append({ actor: 'plugin', kind: 'protocol', message: 'advance protocol: 声明根因假设 + 预测 gate; tool=' + input.tool }));
                }
                else if (input.type === 'disarm') {
                    this.state = 'disarmed';
                    out.push(this.ledger.append({ actor: 'plugin', kind: 'disarm' }));
                }
                else if (input.type === 'human-escalation') {
                    out.push(this.applyEscalation(input.decision));
                }
                break;
            }
            case 'awaiting-claim': {
                const claim = input.type === 'model-claim' ? input.claim : null;
                const claimActor = input.type === 'model-claim' ? input.actor : 'plugin';
                if (claim && isValidClaim(claim) && this.config.gateRegistry.has(claim.predictedGateId)) {
                    this.activeClaim = claim;
                    this.state = 'claim-committed';
                    out.push(this.ledger.append({ actor: claimActor, kind: 'claim', claim, verdict: 'unknown' }));
                }
                else if (this.protocolViolations >= this.config.backstopRounds) {
                    this.state = 'frontier-exhausted';
                    out.push(this.ledger.append({ actor: 'plugin', kind: 'frontier', verdict: 'unknown', message: 'backstop: 协议不合格超限' }));
                }
                else {
                    this.protocolViolations += 1;
                    out.push(this.ledger.append({ actor: 'plugin', kind: 'protocol', verdict: 'unknown', message: 'claim 结构不合格或 gate id 不在注册表，重新声明' }));
                }
                break;
            }
            case 'claim-committed': {
                if (input.type === 'tool-result') {
                    this.state = 'gate-pending';
                    const claim = this.activeClaim;
                    const gate = claim ? this.config.gateRegistry.get(claim.predictedGateId) : undefined;
                    out.push(this.ledger.append({ actor: 'plugin', kind: 'gate', gate: { id: claim ? claim.predictedGateId : '<none>', command: gate ? gate.command : '' }, verdict: 'unknown', message: 'tool=' + input.tool + ' -> gate 排期' }));
                }
                break;
            }
            case 'gate-pending': {
                if (input.type === 'gate-result') {
                    const claim = this.activeClaim;
                    const passed = claim ? input.result.ok === claim.predictedOutcome : false;
                    const verdict = passed ? 'passed' : 'falsified';
                    out.push(this.ledger.append({ actor: 'plugin', kind: 'gate', gate: { id: input.gateId, command: this.config.gateRegistry.get(input.gateId)?.command ?? '' }, result: input.result, verdict }));
                    if (passed) {
                        this.activeClaim = null;
                        this.state = 'armed';
                    }
                    else if (claim) {
                        this.state = 'falsified';
                        out.push(this.ledger.append({ actor: 'plugin', kind: 'falsification', claim, result: input.result, verdict: 'falsified', message: '主张 ' + claim.id + ' 被证据证伪' }));
                    }
                }
                break;
            }
            case 'falsified': {
                if (input.type === 'model-hypotheses') {
                    const novel = input.hypotheses
                        .filter(h => !this.lastExperimentCommands.includes(h.experimentCommand))
                        .filter(h => h.excludes.length >= 1);
                    const uniqueExperiments = new Set(novel.map(h => h.experimentCommand)).size === novel.length;
                    const first = novel[0];
                    if (novel.length >= 2 && first && uniqueExperiments) {
                        this.noveltyRejects = 0;
                        this.lastExperimentCommands.push(...novel.map(h => h.experimentCommand));
                        this.selected = novel.map(h => h.experimentCommand);
                        this.state = 'experiment-selected';
                        out.push(this.ledger.append({ actor: input.actor, kind: 'hypotheses', hypotheses: novel, selected: first.id, verdict: 'unknown', message: '判别实验白名单锁定: ' + novel.map(h => h.experimentCommand).join(' | ') }));
                    }
                    else {
                        this.noveltyRejects += 1;
                        out.push(this.ledger.append({ actor: 'plugin', kind: 'protocol', verdict: 'unknown', message: '新颖性/互斥校验失败（拒绝 #' + this.noveltyRejects + '），重新枚举' }));
                        if (this.noveltyRejects >= this.config.noveltyRejectLimit) {
                            this.state = 'frontier-exhausted';
                            out.push(this.ledger.append({ actor: 'plugin', kind: 'frontier', verdict: 'unknown', message: '假设前沿耗尽：连续新颖性拒绝超限' }));
                        }
                    }
                }
                break;
            }
            case 'experiment-selected': {
                if (input.type === 'experiment-result') {
                    this.selected = [];
                    const verdict = input.result.ok ? 'passed' : 'falsified';
                    out.push(this.ledger.append({ actor: 'plugin', kind: 'experiment', result: input.result, verdict, message: 'experiment=' + input.experimentCommand }));
                    this.state = verdict === 'passed' ? 'armed' : 'falsified';
                }
                break;
            }
            case 'frontier-exhausted':
            case 'escalated': {
                if (input.type === 'human-escalation') {
                    out.push(this.applyEscalation(input.decision));
                }
                break;
            }
            case 'disarmed':
                break;
        }
        return out;
    }
    applyEscalation(decision) {
        if (decision === 'disarm') {
            this.state = 'disarmed';
            return this.ledger.append({ actor: 'human', kind: 'disarm', verdict: 'unknown', message: '人工撤销契约' });
        }
        this.state = 'armed';
        this.activeClaim = null;
        this.protocolViolations = 0;
        this.noveltyRejects = 0;
        return this.ledger.append({ actor: 'human', kind: 'resume', verdict: 'unknown', message: '人工放行，继续契约' });
    }
}
export function isValidClaim(c) {
    return (typeof c.text === 'string' && c.text.length > 0 &&
        ['hard', 'empirical', 'semantic', 'judgment'].includes(c.class) &&
        ['claim', 'strong', 'hedged'].includes(c.assertiveness) &&
        typeof c.predictedGateId === 'string' && c.predictedGateId.length > 0 &&
        typeof c.predictedOutcome === 'boolean');
}
export function makeClaimId() {
    return randomUUID();
}
//# sourceMappingURL=state-machine.js.map