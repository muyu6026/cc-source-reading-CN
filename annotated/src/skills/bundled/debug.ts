// /debug 技能所需的文件与调试工具导入。
import { open, stat } from 'fs/promises'
import { CLAUDE_CODE_GUIDE_AGENT_TYPE } from 'src/tools/AgentTool/built-in/claudeCodeGuideAgent.js'
import { getSettingsFilePathForSource } from 'src/utils/settings/settings.js'
import { enableDebugLogging, getDebugLogPath } from '../../utils/debug.js'
import { errorMessage, isENOENT } from '../../utils/errors.js'
import { formatFileSize } from '../../utils/format.js'
import { registerBundledSkill } from '../bundledSkills.js'

// 默认读取行数与尾部截取字节数两个常量。
const DEFAULT_DEBUG_LINES_READ = 20
const TAIL_READ_BYTES = 64 * 1024

// registerDebugSkill：注册 /debug 技能，开启调试日志并诊断。
export function registerDebugSkill(): void {
  registerBundledSkill({
    name: 'debug',
    description:
      process.env.USER_TYPE === 'ant'
        ? 'Debug your current Claude Code session by reading the session debug log. Includes all event logging'
        : 'Enable debug logging for this session and help diagnose issues',
    allowedTools: ['Read', 'Grep', 'Glob'],
// 限制该技能只能用读类工具，避免误操作。
    argumentHint: '[issue description]',
    // disableModelInvocation so that the user has to explicitly request it in
    // interactive mode and so the description does not take up context.
    disableModelInvocation: true,
    userInvocable: true,
    async getPromptForCommand(args) {
      // Non-ants don't write debug logs by default — turn logging on now so
      // subsequent activity in this session is captured.
      const wasAlreadyLogging = enableDebugLogging()
// 非 ant 用户默认不开调试日志，这里先临时开启。
      const debugLogPath = getDebugLogPath()

      let logInfo: string
      try {
        // Tail the log without reading the whole thing - debug logs grow
        // unbounded in long sessions and reading them in full spikes RSS.
        const stats = await stat(debugLogPath)
// stat 拿到日志文件大小，为尾部读取做准备。
        const readSize = Math.min(stats.size, TAIL_READ_BYTES)
        const startOffset = stats.size - readSize
        const fd = await open(debugLogPath, 'r')
        try {
          const { buffer, bytesRead } = await fd.read({
            buffer: Buffer.alloc(readSize),
            position: startOffset,
          })
          const tail = buffer
            .toString('utf-8', 0, bytesRead)
            .split('\n')
            .slice(-DEFAULT_DEBUG_LINES_READ)
// 只取末尾若干行，避免长会话里整文件读入撑爆内存。
            .join('\n')
          logInfo = `Log size: ${formatFileSize(stats.size)}\n\n### Last ${DEFAULT_DEBUG_LINES_READ} lines\n\n\`\`\`\n${tail}\n\`\`\``
        } finally {
          await fd.close()
        }
// 读取失败区分「尚未生成」与「真出错」两种情况。
      } catch (e) {
        logInfo = isENOENT(e)
          ? 'No debug log exists yet — logging was just enabled.'
          : `Failed to read last ${DEFAULT_DEBUG_LINES_READ} lines of debug log: ${errorMessage(e)}`
      }

      const justEnabledSection = wasAlreadyLogging
        ? ''
        : `
## Debug Logging Just Enabled

Debug logging was OFF for this session until now. Nothing prior to this /debug invocation was captured.

Tell the user that debug logging is now active at \`${debugLogPath}\`, ask them to reproduce the issue, then re-read the log. If they can't reproduce, they can also restart with \`claude --debug\` to capture logs from startup.
`

// 拼装调试技能要发给模型的提示词，含日志与设置路径。
      const prompt = `# Debug Skill

Help the user debug an issue they're encountering in this current Claude Code session.
${justEnabledSection}
## Session Debug Log

The debug log for the current session is at: \`${debugLogPath}\`

${logInfo}

For additional context, grep for [ERROR] and [WARN] lines across the full file.

## Issue Description

${args || 'The user did not describe a specific issue. Read the debug log and summarize any errors, warnings, or notable issues.'}

## Settings

Remember that settings are in:
* user - ${getSettingsFilePathForSource('userSettings')}
* project - ${getSettingsFilePathForSource('projectSettings')}
* local - ${getSettingsFilePathForSource('localSettings')}

## Instructions

1. Review the user's issue description
2. The last ${DEFAULT_DEBUG_LINES_READ} lines show the debug file format. Look for [ERROR] and [WARN] entries, stack traces, and failure patterns across the file
3. Consider launching the ${CLAUDE_CODE_GUIDE_AGENT_TYPE} subagent to understand the relevant Claude Code features
4. Explain what you found in plain language
5. Suggest concrete fixes or next steps
`
      return [{ type: 'text', text: prompt }]
    },
// 以文本形式返回提示词供模型消费。
  })
}
