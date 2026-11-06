// 导入 path.relative 与 React；本命令用于开关 / 调整沙箱（sandbox）设置
import { relative } from 'path';
import React from 'react';
import { getCwdState } from '../../bootstrap/state.js';
import { SandboxSettings } from '../../components/sandbox/SandboxSettings.js';
import { color } from '../../ink.js';
import { getPlatform } from '../../utils/platform.js';
import { addToExcludedCommands, SandboxManager } from '../../utils/sandbox/sandbox-adapter.js';
import { getSettings_DEPRECATED, getSettingsFilePathForSource } from '../../utils/settings/settings.js';
import type { ThemeName } from '../../utils/theme.js';
export async function call(onDone: (result?: string) => void, _context: unknown, args?: string): Promise<React.ReactNode | null> {
// call 入口：无头命令，返回 React 节点或字符串回执
  const settings = getSettings_DEPRECATED();
// 读取（已废弃）全局设置，取出主题与平台
  const themeName: ThemeName = settings.theme as ThemeName || 'light';
  const platform = getPlatform();
  if (!SandboxManager.isSupportedPlatform()) {
// 不支持的平台直接报错返回（如 WSL1 只支持 WSL2）
    // WSL1 users will see this since isSupportedPlatform returns false for WSL1
    const errorMessage = platform === 'wsl' ? 'Error: Sandboxing requires WSL2. WSL1 is not supported.' : 'Error: Sandboxing is currently only supported on macOS, Linux, and WSL2.';
    const message = color('error', themeName)(errorMessage);
    onDone(message);
    return null;
  }

  // Check dependencies - get structured result with errors/warnings
// 先查依赖（结构化结果含 errors / warnings）再决定后续流程
  const depCheck = SandboxManager.checkDependencies();

  // Check if platform is in enabledPlatforms list (undocumented enterprise setting)
  if (!SandboxManager.isPlatformInEnabledList()) {
// 若平台不在 enabledPlatforms 企业名单则拒绝改动
    const message = color('error', themeName)(`Error: Sandboxing is disabled for this platform (${platform}) via the enabledPlatforms setting.`);
    onDone(message);
    return null;
  }

  // Check if sandbox settings are locked by higher-priority settings
  if (SandboxManager.areSandboxSettingsLockedByPolicy()) {
// 若被更高优先级策略锁定则拒绝本地修改
    const message = color('error', themeName)('Error: Sandbox settings are overridden by a higher-priority configuration and cannot be changed locally.');
    onDone(message);
    return null;
  }

  // Parse the arguments
// 解析参数（trim 后）；空参走交互菜单
  const trimmedArgs = args?.trim() || '';

  // If no args, show the interactive menu
  if (!trimmedArgs) {
// 无参时渲染 SandboxSettings 交互菜单组件
    return <SandboxSettings onComplete={onDone} depCheck={depCheck} />;
  }

  // Handle subcommands
  if (trimmedArgs) {
// 有参时按子命令分流（当前仅 exclude）
    const parts = trimmedArgs.split(' ');
    const subcommand = parts[0];
    if (subcommand === 'exclude') {
// exclude 子命令：把某命令模式加入排除名单
      // Handle exclude subcommand
      const commandPattern = trimmedArgs.slice('exclude '.length).trim();
      if (!commandPattern) {
        const message = color('error', themeName)('Error: Please provide a command pattern to exclude (e.g., /sandbox exclude "npm run test:*")');
        onDone(message);
        return null;
      }

      // Remove quotes if present
      const cleanPattern = commandPattern.replace(/^["']|["']$/g, '');
// 去掉用户可能自带的引号后再处理

      // Add to excludedCommands
      addToExcludedCommands(cleanPattern);
// 调用适配器把模式写入排除命令表

      // Get the local settings path and make it relative to cwd
      const localSettingsPath = getSettingsFilePathForSource('localSettings');
// 取本地设置文件路径并相对 cwd 展示
      const relativePath = localSettingsPath ? relative(getCwdState(), localSettingsPath) : '.claude/settings.local.json';
      const message = color('success', themeName)(`Added "${cleanPattern}" to excluded commands in ${relativePath}`);
      onDone(message);
      return null;
    } else {
      // Unknown subcommand
      const message = color('error', themeName)(`Error: Unknown subcommand "${subcommand}". Available subcommand: exclude`);
// 未知子命令报错，提示可用子命令只有 exclude
      onDone(message);
      return null;
    }
  }

  // Should never reach here since we handle all cases above
  return null;
}
// 原文件此处有一行 9528 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。