import type { LocalCommandResult } from '../../commands.js'
import { logEvent } from '../../services/analytics/index.js'
import { openBrowser } from '../../utils/browser.js'
import { saveGlobalConfig } from '../../utils/config.js'

const SLACK_APP_URL = 'https://slack.com/marketplace/A08SF47R6P4-claude'
// Slack 应用市场里 Claude 应用的固定安装链接，常量复用。

export async function call(): Promise<LocalCommandResult> {
  logEvent('tengu_install_slack_app_clicked', {})
// 先埋点：记录用户点击了「安装 Slack 应用」这个动作（tengu_ 前缀是内部事件名）。

  // Track that user has clicked to install
  saveGlobalConfig(current => ({
    ...current,
    slackAppInstallCount: (current.slackAppInstallCount ?? 0) + 1,
  }))
// 把全局配置里的 slackAppInstallCount 计数 +1，记录已触发安装意图（当前值缺省为 0）。

  const success = await openBrowser(SLACK_APP_URL)
// 拉起系统浏览器打开安装页，并拿到是否成功打开的标志。

  if (success) {
// 按打开结果返回：成功提示已在浏览器打开；失败则回退为「手动访问此链接」的文案。
    return {
      type: 'text',
      value: 'Opening Slack app installation page in browser…',
    }
  } else {
    return {
      type: 'text',
      value: `Couldn't open browser. Visit: ${SLACK_APP_URL}`,
    }
  }
}
