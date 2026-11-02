// MDM（移动设备管理）设置读取的共享常量与路径构造。这个模块刻意只依赖操作系统信息与路径拼接，不引入任何重型依赖，为的是能被底层原始读取模块安全引用，同时供高层设置模块复用，避免两边各写一份出现漂移。
/**
 * Shared constants and path builders for MDM settings modules.
 *
 * This module has ZERO heavy imports (only `os`) — safe to use from mdmRawRead.ts.
 * Both mdmRawRead.ts and mdmSettings.ts import from here to avoid duplication.
 */

import { homedir, userInfo } from 'os'
import { join } from 'path'

/** macOS preference domain for Claude Code MDM profiles. */
export const MACOS_PREFERENCE_DOMAIN = 'com.anthropic.claudecode'
// macOS 侧的策略配置域标识，读取管理偏好时用它拼出 plist 文件名。

/**
 * Windows registry key paths for Claude Code MDM policies.
 *
 * These keys live under SOFTWARE\Policies which is on the WOW64 shared key
 * list — both 32-bit and 64-bit processes see the same values without
 * redirection. Do not move these to SOFTWARE\ClaudeCode, as SOFTWARE is
 * redirected and 32-bit processes would silently read from WOW6432Node.
 * See: https://learn.microsoft.com/en-us/windows/win32/winprog64/shared-registry-keys
 */
export const WINDOWS_REGISTRY_KEY_PATH_HKLM =
  'HKLM\\SOFTWARE\\Policies\\ClaudeCode'
export const WINDOWS_REGISTRY_KEY_PATH_HKCU =
  'HKCU\\SOFTWARE\\Policies\\ClaudeCode'
// Windows 侧给出机器级与用户级两个注册表位置，都落在策略分支下。注释里的关键提醒是：必须留在策略分支而不能挪到产品自己的分支，因为产品分支在 32 位进程下会被重定向到另一个位置，导致策略静默读不到。

/** Windows registry value name containing the JSON settings blob. */
export const WINDOWS_REGISTRY_VALUE_NAME = 'Settings'

/** Path to macOS plutil binary. */
export const PLUTIL_PATH = '/usr/bin/plutil'

/** Arguments for plutil to convert plist to JSON on stdout (append plist path). */
export const PLUTIL_ARGS_PREFIX = ['-convert', 'json', '-o', '-', '--'] as const
// 这两个常量是调用外部 plutil 的固定参数：把 plist 转成 JSON 输出到标准输出，末尾的双横线用于分隔选项与待转换的文件路径。参数用只读元组标注，防止调用方就地改写。

/** Subprocess timeout in milliseconds. */
export const MDM_SUBPROCESS_TIMEOUT_MS = 5000

/**
 * Build the list of macOS plist paths in priority order (highest first).
 * Evaluates `process.env.USER_TYPE` at call time so ant-only paths are
 * included only when appropriate.
 */
export function getMacOSPlistPaths(): Array<{ path: string; label: string }> {
  let username = ''
  try {
    username = userInfo().username
  } catch {
    // ignore
  }

  const paths: Array<{ path: string; label: string }> = []

  if (username) {
    paths.push({
      path: `/Library/Managed Preferences/${username}/${MACOS_PREFERENCE_DOMAIN}.plist`,
      label: 'per-user managed preferences',
    })
  }

  paths.push({
    path: `/Library/Managed Preferences/${MACOS_PREFERENCE_DOMAIN}.plist`,
    label: 'device-level managed preferences',
  })

  // Allow user-writable preferences for local MDM testing in ant builds only.
  if (process.env.USER_TYPE === 'ant') {
    paths.push({
      path: join(
        homedir(),
        'Library',
        'Preferences',
        `${MACOS_PREFERENCE_DOMAIN}.plist`,
      ),
      label: 'user preferences (ant-only)',
    })
  }

  return paths
}
// 路径列表按优先级从高到低返回：先单用户的管理偏好，再设备级管理偏好；只有在内部构建下才追加用户可写的偏好目录，方便本地模拟 MDM 测试。取用户名用 try.catch 包住，取不到就退化成只有设备级路径，不阻断整个设置读取链路。
