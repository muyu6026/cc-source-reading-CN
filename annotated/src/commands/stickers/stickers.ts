// 导入本地命令结果类型。
import type { LocalCommandResult } from '../../types/command.js'
// 导入打开浏览器的工具函数。
import { openBrowser } from '../../utils/browser.js'

export async function call(): Promise<LocalCommandResult> {
// 命令入口：打开贴纸商城页面并返回结果。
  const url = 'https://www.stickermule.com/claudecode'
  const success = await openBrowser(url)

  if (success) {
    return { type: 'text', value: 'Opening sticker page in browser…' }
  } else {
    return {
      type: 'text',
      value: `Failed to open browser. Visit: ${url}`,
    }
// 失败分支返回带地址的提示文案。
  }
}
