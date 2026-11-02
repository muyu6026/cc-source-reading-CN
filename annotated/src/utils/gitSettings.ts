// 这文件把「依赖用户设置的 Git 行为」从 git.ts 拆出来，目的是避免把 settings.ts 的依赖图（进而 @opentelemetry/api 与 undici，vscode 扩展禁用它们）带进 vscode 扩展，同时打破 settings → git/gitignore → git → settings 的循环依赖。
// Git-related behaviors that depend on user settings.
//
// This lives outside git.ts because git.ts is in the vscode extension's
// dep graph and must stay free of settings.ts, which transitively pulls
// @opentelemetry/api + undici (forbidden in vscode). It's also a cycle:
// settings.ts → git/gitignore.ts → git.ts, so git.ts → settings.ts loops.
//
// If you're tempted to add `import settings` to git.ts — don't. Put it here.

import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'
import { getInitialSettings } from './settings/settings.js'

export function shouldIncludeGitInstructions(): boolean {
  const envVal = process.env.CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS
  if (isEnvTruthy(envVal)) return false
  if (isEnvDefinedFalsy(envVal)) return true
  return getInitialSettings().includeGitInstructions ?? true
}
// 函数逻辑：先看环境变量 CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS——显式真值则不含 Git 指令、显式假值（已定义但为假）则含，否则回退到初始设置里的 includeGitInstructions，默认是 true。
