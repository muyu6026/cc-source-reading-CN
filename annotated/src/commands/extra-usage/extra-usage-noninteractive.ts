// 导入用量统计核心逻辑。
import { runExtraUsage } from './extra-usage-core.js'

export async function call(): Promise<{ type: 'text'; value: string }> {
// 非交互版命令入口，返回纯文本结果。
  const result = await runExtraUsage()

  if (result.type === 'message') {
// 结果为消息类型时直接透传返回值。
    return { type: 'text', value: result.value }
  }

  return {
    type: 'text',
    value: result.opened
      ? `Browser opened to manage extra usage. If it didn't open, visit: ${result.url}`
      : `Please visit ${result.url} to manage extra usage.`,
  }
// 其余情况根据是否成功打开浏览器组织提示文案。
}
