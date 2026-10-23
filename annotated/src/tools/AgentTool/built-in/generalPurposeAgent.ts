import type { BuiltInAgentDefinition } from '../loadAgentsDir.js'

const SHARED_PREFIX = `You are an agent for Claude Code, Anthropic's official CLI for Claude. Given the user's message, you should use the tools available to complete the task. Complete the task fully—don't gold-plate, but don't leave it half-done.`
// SHARED_PREFIX：身份声明 + 完成度判据——「完整完成任务，别镀金也别半吊子」，一句话同时防过度工程和敷衍。

const SHARED_GUIDELINES = `Your strengths:
- Searching for code, configurations, and patterns across large codebases
- Analyzing multiple files to understand system architecture
- Investigating complex questions that require exploring many files
- Performing multi-step research tasks

Guidelines:
- For file searches: search broadly when you don't know where something lives. Use Read when you know the specific file path.
- For analysis: Start broad and narrow down. Use multiple search strategies if the first doesn't yield results.
- Be thorough: Check multiple locations, consider different naming conventions, look for related files.
- NEVER create files unless they're absolutely necessary for achieving your goal. ALWAYS prefer editing an existing file to creating a new one.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested.`
// SHARED_GUIDELINES 四条强导：不知道东西在哪就广搜再窄化（多个搜索策略）；多位置、多命名惯例地彻底查；绝不主动建文件（优先改现有的）；绝不主动建文档（*.md/README 除非明确要求）。后两条是给所有 subagent 的通用紧箍——LLM 最爱顺手建 README。

// Note: absolute-path + emoji guidance is appended by enhanceSystemPromptWithEnvDetails.
// absolute-path 和 emoji 指引不在这写——由 enhanceSystemPromptWithEnvDetails 统一追加（环境相关提示Single source）。
function getGeneralPurposeSystemPrompt(): string {
  return `${SHARED_PREFIX} When you complete the task, respond with a concise report covering what was done and any key findings — the caller will relay this to the user, so it only needs the essentials.

${SHARED_GUIDELINES}`
}
// getGeneralPurposeSystemPrompt：prefix + 简洁报告要求（调用方会转述给用户，只要要点）+ guidelines。注意报告要求写的是「what was done and any key findings」——不是给用户的最终答复，是给父 agent 的素材。

export const GENERAL_PURPOSE_AGENT: BuiltInAgentDefinition = {
  agentType: 'general-purpose',
  whenToUse:
    'General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you.',
  tools: ['*'],
  source: 'built-in',
  baseDir: 'built-in',
  // model is intentionally omitted - uses getDefaultSubagentModel().
// model 故意不声明：走 getDefaultSubagentModel()——默认 subagent 模型随部署/实验变，写死就和这套机制打架。
  getSystemPrompt: getGeneralPurposeSystemPrompt,
}
// GENERAL_PURPOSE_AGENT：tools ['*'] 全工具池——general-purpose 是全能兜底 agent（研究/搜索/多步任务都接），与 Explore 的窄面互补。
