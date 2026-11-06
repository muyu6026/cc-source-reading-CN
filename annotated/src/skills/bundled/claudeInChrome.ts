import { BROWSER_TOOLS } from '@ant/claude-for-chrome-mcp'
// 登记内置技能「claude-in-chrome」：把浏览器自动化 MCP 工具名映射成 mcp__claude-in-chrome__* 作为 allowedTools，并拼装激活提示词。
import { BASE_CHROME_PROMPT } from '../../utils/claudeInChrome/prompt.js'
import { shouldAutoEnableClaudeInChrome } from '../../utils/claudeInChrome/setup.js'
import { registerBundledSkill } from '../bundledSkills.js'

const CLAUDE_IN_CHROME_MCP_TOOLS = BROWSER_TOOLS.map(
// 把浏览器工具名映射成带前缀的 MCP 工具标识列表。
  tool => `mcp__claude-in-chrome__${tool.name}`,
)

const SKILL_ACTIVATION_MESSAGE = `
Now that this skill is invoked, you have access to Chrome browser automation tools. You can now use the mcp__claude-in-chrome__* tools to interact with web pages.

IMPORTANT: Start by calling mcp__claude-in-chrome__tabs_context_mcp to get information about the user's current browser tabs.
`
// 激活提示词：指引先获取浏览器标签页，再使用相关 MCP 工具。

export function registerClaudeInChromeSkill(): void {
// 注册技能：描述、何时使用、允许工具与启用条件（按 shouldAutoEnableClaudeInChrome）。
  registerBundledSkill({
    name: 'claude-in-chrome',
    description:
      'Automates your Chrome browser to interact with web pages - clicking elements, filling forms, capturing screenshots, reading console logs, and navigating sites. Opens pages in new tabs within your existing Chrome session. Requires site-level permissions before executing (configured in the extension).',
    whenToUse:
      'When the user wants to interact with web pages, automate browser tasks, capture screenshots, read console logs, or perform any browser-based actions. Always invoke BEFORE attempting to use any mcp__claude-in-chrome__* tools.',
    allowedTools: CLAUDE_IN_CHROME_MCP_TOOLS,
    userInvocable: true,
    isEnabled: () => shouldAutoEnableClaudeInChrome(),
    async getPromptForCommand(args) {
// 启用与否由 shouldAutoEnableClaudeInChrome 决定。
      let prompt = `${BASE_CHROME_PROMPT}\n${SKILL_ACTIVATION_MESSAGE}`
// 拼装提示词：基础 prompt + 激活提示，携带参数时追加任务段。
      if (args) {
        prompt += `\n## Task\n\n${args}`
      }
      return [{ type: 'text', text: prompt }]
    },
  })
}
