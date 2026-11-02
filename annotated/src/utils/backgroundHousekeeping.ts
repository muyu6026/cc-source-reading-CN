import { feature } from 'bun:bundle'
// 后台杂务总入口：启动时把「能后台做的一切」全部 fire-and-forget 地点燃——文档索引、技能改进、记忆抽取、插件自动更新、协议注册，外加两条慢清理时间线。
import { initAutoDream } from '../services/autoDream/autoDream.js'
import { initMagicDocs } from '../services/MagicDocs/magicDocs.js'
import { initSkillImprovement } from './hooks/skillImprovement.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const extractMemoriesModule = feature('EXTRACT_MEMORIES')
  ? (require('../services/extractMemories/extractMemories.js') as typeof import('../services/extractMemories/extractMemories.js'))
  : null
const registerProtocolModule = feature('LODESTONE')
  ? (require('./deepLink/registerProtocol.js') as typeof import('./deepLink/registerProtocol.js'))
  : null

/* eslint-enable @typescript-eslint/no-require-imports */
// enable 之后立刻恢复 lint 规则：两个 Ant 专有模块走条件 require，让 Bun 打包时把外部构建用不到的分支连同模块引用一起 DCE 掉。

import { getIsInteractive, getLastInteractionTime } from '../bootstrap/state.js'
import {
  cleanupNpmCacheForAnthropicPackages,
  cleanupOldMessageFilesInBackground,
  cleanupOldVersionsThrottled,
} from './cleanup.js'
import { cleanupOldVersions } from './nativeInstaller/index.js'
import { autoUpdateMarketplacesAndPluginsInBackground } from './plugins/pluginAutoupdate.js'

// 24 hours in milliseconds
const RECURRING_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000
// 每 24 小时一轮的循环清理间隔；函数体内部还有 marker 文件加锁做节流，真正执行频率是「每天至多一次、多进程竞争时只跑一个」。

// 10 minutes after start.
const DELAY_VERY_SLOW_OPERATIONS_THAT_HAPPEN_EVERY_SESSION = 10 * 60 * 1000
// 慢操作的启动延迟是 10 分钟：既避开启动尖峰，又不至于整个会话都没跑到。

export function startBackgroundHousekeeping(): void {
  void initMagicDocs()
  void initSkillImprovement()
  if (feature('EXTRACT_MEMORIES')) {
    extractMemoriesModule!.initExtractMemories()
  }
  initAutoDream()
  void autoUpdateMarketplacesAndPluginsInBackground()
  if (feature('LODESTONE') && getIsInteractive()) {
    void registerProtocolModule!.ensureDeepLinkProtocolRegistered()
  }
// 启动批全部不 await：这些初始化互不依赖、失败也不该阻塞主流程，用 void 丢弃 Promise 即可。

  let needsCleanup = true
  async function runVerySlowOps(): Promise<void> {
    // If the user did something in the last minute, don't make them wait for these slow operations to run.
    if (
      getIsInteractive() &&
      getLastInteractionTime() > Date.now() - 1000 * 60
    ) {
      setTimeout(
        runVerySlowOps,
        DELAY_VERY_SLOW_OPERATIONS_THAT_HAPPEN_EVERY_SESSION,
      ).unref()
      return
    }

    if (needsCleanup) {
      needsCleanup = false
      await cleanupOldMessageFilesInBackground()
    }
// 旧消息文件清理是一次性的：needsCleanup 置位后不再重复，防止长时间会话里反复扫盘。

    // If the user did something in the last minute, don't make them wait for these slow operations to run.
    if (
      getIsInteractive() &&
      getLastInteractionTime() > Date.now() - 1000 * 60
    ) {
      setTimeout(
        runVerySlowOps,
        DELAY_VERY_SLOW_OPERATIONS_THAT_HAPPEN_EVERY_SESSION,
      ).unref()
      return
    }
// 同一个「用户刚操作过就再等等」的检查出现两次：清理旧版本文件前也要让路——这类操作可能卡住事件循环，绝不能打断用户正在输入的时刻。

    await cleanupOldVersions()
  }

  setTimeout(
    runVerySlowOps,
    DELAY_VERY_SLOW_OPERATIONS_THAT_HAPPEN_EVERY_SESSION,
  ).unref()
// unref 是关键：定时器挂在事件循环上但不阻止进程退出，会话结束就不用等这 10 分钟烧完。

  // For long-running sessions, schedule recurring cleanup every 24 hours.
  // Both cleanup functions use marker files and locks to throttle to once per day
  // and skip immediately if another process holds the lock.
  if (process.env.USER_TYPE === 'ant') {
    const interval = setInterval(() => {
      void cleanupNpmCacheForAnthropicPackages()
      void cleanupOldVersionsThrottled()
    }, RECURRING_CLEANUP_INTERVAL_MS)

    // Don't let this interval keep the process alive
    interval.unref()
  }
// 仅 Ant 内部开循环清理：npm 缓存与旧版本二进制的体积管理在内部开发机上更紧要，interval 同样 unref 不滞留进程。
}
// 整个函数没有返回值也没有错误上抛：后台杂务的原则是宁可静默失败，也不把清理逻辑的问题暴露给用户会话。
