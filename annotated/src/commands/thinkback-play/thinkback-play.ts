import { join } from 'path'
// /thinkback-play 命令：从已安装的 thinkback 插件目录里取动画并播放；内部市场与官方市场按环境（ant 用内部名）区分插件 id。
import type { LocalCommandResult } from '../../commands.js'
import { loadInstalledPluginsV2 } from '../../utils/plugins/installedPluginsManager.js'
import { OFFICIAL_MARKETPLACE_NAME } from '../../utils/plugins/officialMarketplace.js'
import { playAnimation } from '../thinkback/thinkback.js'

const INTERNAL_MARKETPLACE_NAME = 'claude-code-marketplace'
// 内部市场名与技能名常量；插件 id 形如「thinkback@市场名」。
const SKILL_NAME = 'thinkback'

function getPluginId(): string {
// 根据 USER_TYPE 决定走内部还是官方市场，拼出插件 id。
  const marketplaceName =
    process.env.USER_TYPE === 'ant'
      ? INTERNAL_MARKETPLACE_NAME
      : OFFICIAL_MARKETPLACE_NAME
  return `thinkback@${marketplaceName}`
}

export async function call(): Promise<LocalCommandResult> {
// 命令入口：加载已装插件 V2 配置，定位 thinkback 安装，未安装或路径缺失给出友好文案。
  // Get skill directory from installed plugins config
  const v2Data = loadInstalledPluginsV2()
  const pluginId = getPluginId()
  const installations = v2Data.plugins[pluginId]

  if (!installations || installations.length === 0) {
// 没装插件或安装列表为空时直接返回提示，不报错。
    return {
      type: 'text' as const,
      value:
        'Thinkback plugin not installed. Run /think-back first to install it.',
    }
  }

  const firstInstall = installations[0]
// 取第一个安装实例，缺路径则提示安装路径未找到。
  if (!firstInstall?.installPath) {
    return {
      type: 'text' as const,
      value: 'Thinkback plugin installation path not found.',
    }
  }

  const skillDir = join(firstInstall.installPath, 'skills', SKILL_NAME)
// 拼接技能目录并调用 playAnimation 播放，返回动画消息文本。
  const result = await playAnimation(skillDir)
  return { type: 'text' as const, value: result.message }
}
