export interface FalsificationCallArgs {
    action: 'claim' | 'hypotheses' | 'experiment';
    rootCause?: string;
    predictedGateId?: string;
    predictedOutcome?: boolean;
    hypotheses?: {
        text: string;
        predictedObservable: string;
        experimentCommand: string;
    }[];
    experimentCommand?: string;
}
/** 模型可见工具定义；execute 只回显校验后的参数（无副作用），路由靠工具名在 post-execute 完成。 */
export declare function falsificationTool(name: string): import("@deepseek-ai/dsh-tools").ToolDefinition;
//# sourceMappingURL=tool.d.ts.map