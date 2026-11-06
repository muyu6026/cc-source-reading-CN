import type { Command } from '../../commands.js'
// `/web-setup` 命令：引导用户在网页端配置 Claude Code，需先连接 GitHub 账户。
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { isPolicyAllowed } from '../../services/policyLimits/index.js'

const web = {
// 命令定义：仅在特性开关 `tengu_cobalt_lantern` 命中且策略允许远程会话时启用。
  type: 'local-jsx',
  name: 'web-setup',
  description:
    'Setup Claude Code on the web (requires connecting your GitHub account)',
  availability: ['claude-ai'],
  isEnabled: () =>
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_cobalt_lantern', false) &&
    isPolicyAllowed('allow_remote_sessions'),
// `isEnabled` 同时校验特性开关与 `allow_remote_sessions` 策略；`isHidden` 仅看策略。
  get isHidden() {
    return !isPolicyAllowed('allow_remote_sessions')
  },
  load: () => import('./remote-setup.js'),
} satisfies Command

export default web
