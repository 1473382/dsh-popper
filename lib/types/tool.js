// 模型面对工具：falsification。纯 schema + 渲染；路由/判定在 wiring 层。
import { defineTool } from '@deepseek-ai/dsh-tools';
/** 模型可见工具定义；execute 只回显校验后的参数（无副作用），路由靠工具名在 post-execute 完成。 */
export function falsificationTool(name) {
    return defineTool({
        name,
        description: 'Speak the falsification protocol. Use claim to commit to a root-cause hypothesis with a predicted gate outcome before a risky change; use hypotheses to enumerate >=2 mutually exclusive alternatives with discriminating experiments after a gate falsifies your claim; use experiment to run one selected discriminating experiment.',
        parameters: {
            action: { type: 'string', required: true, description: 'claim | hypotheses | experiment', enum: ['claim', 'hypotheses', 'experiment'] },
            rootCause: { type: 'string', description: 'claim: the root-cause hypothesis you commit to.' },
            predictedGateId: { type: 'string', description: 'claim: gate id from the task contract whose outcome you predict.' },
            predictedOutcome: { type: 'boolean', description: 'claim: your predicted gate outcome.' },
            hypotheses: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true }, predictedObservable: { type: 'string', required: true }, experimentCommand: { type: 'string', required: true } } }, description: 'hypotheses: >=2 mutually exclusive alternatives.' },
            experimentCommand: { type: 'string', description: 'experiment: one command from your selected hypotheses.' },
        },
        async execute(args) {
            return { accepted: true, action: args.action };
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    accepted: { type: 'boolean', required: true },
                    action: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{ type: 'text', text: 'falsification: ' + value.action + (value.accepted ? ' accepted' : '') }],
        },
        presentCall(args) {
            const a = args;
            return { card: 'generic', title: 'falsification: ' + a.action, rawInput: a.action };
        },
    });
}
//# sourceMappingURL=tool.js.map