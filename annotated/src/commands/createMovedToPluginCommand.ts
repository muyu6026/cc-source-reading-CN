import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js'
import type { Command } from '../commands.js'
import type { ToolUseContext } from '../Tool.js'
// 依赖：SDK 的 ContentBlockParam 类型、命令与工具上下文类型

type Options = {
// 命令选项类型：名字、描述、进度文案、插件名 / 命令名，以及私有市场下的提示词回调
  name: string
  description: string
  progressMessage: string
  pluginName: string
  pluginCommand: string
  /**
   * The prompt to use while the marketplace is private.
   * External users will get this prompt. Once the marketplace is public,
   * this parameter and the fallback logic can be removed.
   */
  getPromptWhileMarketplaceIsPrivate: (
// getPromptWhileMarketplaceIsPrivate 是函数：私有市场时返回专属提示词
    args: string,
    context: ToolUseContext,
  ) => Promise<ContentBlockParam[]>
}

export function createMovedToPluginCommand({
// 工厂函数：把「已迁移到插件」的命令包装成内置命令
  name,
  description,
  progressMessage,
  pluginName,
  pluginCommand,
  getPromptWhileMarketplaceIsPrivate,
}: Options): Command {
  return {
// 返回命令对象：类型为 prompt、来源标记 builtin
    type: 'prompt',
    name,
    description,
    progressMessage,
    contentLength: 0, // Dynamic content
    userFacingName() {
      return name
    },
    source: 'builtin',
    async getPromptForCommand(
// getPromptForCommand：内部命令处理器
      args: string,
      context: ToolUseContext,
    ): Promise<ContentBlockParam[]> {
      if (process.env.USER_TYPE === 'ant') {
// 内部用户（ant）走插件安装指引文案
        return [
          {
            type: 'text',
            text: `This command has been moved to a plugin. Tell the user:

1. To install the plugin, run:
   claude plugin install ${pluginName}@claude-code-marketplace

2. After installation, use /${pluginName}:${pluginCommand} to run this command

3. For more information, see: https://github.com/anthropics/claude-code-marketplace/blob/main/${pluginName}/README.md

Do not attempt to run the command. Simply inform the user about the plugin installation.`,
          },
        ]
      }

      return getPromptWhileMarketplaceIsPrivate(args, context)
// 否则返回私有市场专属提示词
    },
  }
}
// 工厂函数结束
