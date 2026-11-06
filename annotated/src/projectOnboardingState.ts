// 导入 lodash 的 memoize（记忆化）与路径 join；本文件负责「新项目引导」流程的状态判定
import memoize from 'lodash-es/memoize.js'
import { join } from 'path'
import {
  getCurrentProjectConfig,
  saveCurrentProjectConfig,
} from './utils/config.js'
import { getCwd } from './utils/cwd.js'
import { isDirEmpty } from './utils/file.js'
import { getFsImplementation } from './utils/fsOperations.js'

export type Step = {
// 引导步骤结构：每步含唯一 key、展示文本、是否已完成 / 可完成 / 启用
  key: string
  text: string
  isComplete: boolean
  isCompletable: boolean
  isEnabled: boolean
}

export function getSteps(): Step[] {
// getSteps：依据当前工作区状态算出应展示的引导步骤（共两步）
  const hasClaudeMd = getFsImplementation().existsSync(
// 探测工作区根目录是否存在 CLAUDE.md
    join(getCwd(), 'CLAUDE.md'),
  )
  const isWorkspaceDirEmpty = isDirEmpty(getCwd())
// 探测当前工作区目录是否为空

  return [
    {
      key: 'workspace',
// 第一步 workspace：目录为空时启用，提示让 Claude 创建应用或克隆仓库
      text: 'Ask Claude to create a new app or clone a repository',
      isComplete: false,
      isCompletable: true,
      isEnabled: isWorkspaceDirEmpty,
    },
    {
// 第二步 claudemd：目录非空时启用，提示跑 /init 生成 CLAUDE.md
      key: 'claudemd',
      text: 'Run /init to create a CLAUDE.md file with instructions for Claude',
      isComplete: hasClaudeMd,
      isCompletable: true,
      isEnabled: !isWorkspaceDirEmpty,
    },
  ]
}

export function isProjectOnboardingComplete(): boolean {
// isProjectOnboardingComplete：所有「可完成且启用」的步骤都已 complete 才算完成
  return getSteps()
    .filter(({ isCompletable, isEnabled }) => isCompletable && isEnabled)
    .every(({ isComplete }) => isComplete)
}

export function maybeMarkProjectOnboardingComplete(): void {
// maybeMarkProjectOnboardingComplete：先查配置缓存短路，避免每次回车都读盘
  // Short-circuit on cached config — isProjectOnboardingComplete() hits
  // the filesystem, and REPL.tsx calls this on every prompt submit.
  if (getCurrentProjectConfig().hasCompletedProjectOnboarding) {
// 缓存已标记完成时直接返回，不再调用耗时的文件系统判定
    return
  }
  if (isProjectOnboardingComplete()) {
// 确已完成则把 hasCompletedProjectOnboarding 写回项目配置
    saveCurrentProjectConfig(current => ({
      ...current,
      hasCompletedProjectOnboarding: true,
    }))
  }
}

export const shouldShowProjectOnboarding = memoize((): boolean => {
// shouldShowProjectOnboarding：memoize 记忆化，首屏渲染前也先走缓存短路
  const projectConfig = getCurrentProjectConfig()
  // Short-circuit on cached config before isProjectOnboardingComplete()
  // hits the filesystem — this runs during first render.
  if (
// 已标记完成、已展示≥4 次、或处于演示环境都不会再展示引导
    projectConfig.hasCompletedProjectOnboarding ||
    projectConfig.projectOnboardingSeenCount >= 4 ||
    process.env.IS_DEMO
  ) {
    return false
  }

  return !isProjectOnboardingComplete()
// 其余情况按「引导未完成」展示引导面板
})

export function incrementProjectOnboardingSeenCount(): void {
// incrementProjectOnboardingSeenCount：累加展示次数，用于上面的 seenCount 上限
  saveCurrentProjectConfig(current => ({
    ...current,
    projectOnboardingSeenCount: current.projectOnboardingSeenCount + 1,
  }))
}
