import { c as _c } from "react/compiler-runtime";
import { homedir } from 'node:os';
import { join } from 'node:path';
import React, { useEffect, useState } from 'react';
import type { CommandResultDisplay } from 'src/commands.js';
import { logEvent } from 'src/services/analytics/index.js';
import { StatusIcon } from '../components/design-system/StatusIcon.js';
import { Box, render, Text } from '../ink.js';
import { logForDebugging } from '../utils/debug.js';
import { env } from '../utils/env.js';
import { errorMessage } from '../utils/errors.js';
import { checkInstall, cleanupNpmInstallations, cleanupShellAliases, installLatest } from '../utils/nativeInstaller/index.js';
import { getInitialSettings, updateSettingsForSource } from '../utils/settings/settings.js';
interface InstallProps {
  onDone: (result: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  force?: boolean;
  target?: string; // 'latest', 'stable', or version like '1.0.34'
}
// 状态机穷举安装的每一步：检查、清理、下载、配置外壳、配置完成、成功、失败
type InstallState = {
  type: 'checking';
} | {
  type: 'cleaning-npm';
} | {
  type: 'installing';
  version: string;
} | {
  type: 'setting-up';
} | {
  type: 'set-up';
  messages: string[];
} | {
  type: 'success';
  version: string;
  setupMessages?: string[];
} | {
  type: 'error';
  message: string;
  warnings?: string[];
};
// 展示给用户的安装路径：Windows 下要换成反斜杠，否则命令行里贴出来是错的
function getInstallationPath(): string {
  const isWindows = env.platform === 'win32';
  const homeDir = homedir();
// 两个平台的可执行文件名与目录都不同，这里只算给人看的那份
  if (isWindows) {
    // Convert to Windows-style path
    const windowsPath = join(homeDir, '.local', 'bin', 'claude.exe');
    // Replace forward slashes with backslashes for Windows display
    return windowsPath.replace(/\//g, '\\');
  }
  return '~/.local/bin/claude';
}
// 提示块是纯展示组件：缓存槽里存的是静态节点，只有条目列表变化才重建
function SetupNotes(t0) {
  const $ = _c(5);
  const {
    messages
  } = t0;
  if (messages.length === 0) {
    return null;
  }
  let t1;
// 哨兵值表示这个节点只建一次：标题不需要随参数变化，编译器据此永久复用
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Box><Text color="warning"><StatusIcon status="warning" withSpace={true} />Setup notes:</Text></Box>;
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  let t2;
  if ($[1] !== messages) {
    t2 = messages.map(_temp);
    $[1] = messages;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] !== t2) {
    t3 = <Box flexDirection="column" gap={0} marginBottom={1}>{t1}{t2}</Box>;
    $[3] = t2;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  return t3;
}
function _temp(message, index) {
  return <Box key={index} marginLeft={2}><Text dimColor={true}>• {message}</Text></Box>;
}
// 主组件：挂载即开跑，状态推进全靠 setState，视图按状态分支渲染
function Install({
  onDone,
  force,
  target
}: InstallProps): React.ReactNode {
// 初始态是检查中：首帧不该显示下载进度，那会让人以为已经开始了
  const [state, setState] = useState<InstallState>({
    type: 'checking'
  });
// 整个安装过程塞进一个副作用：它只在强制标记或目标版本变化时重跑
  useEffect(() => {
    async function run() {
      try {
        logForDebugging(`Install: Starting installation process (force=${force}, target=${target})`);

        // Install native build first
// 目标优先级：命令行显式指定、其次用户设置里的更新通道、最后才是最新版
        const channelOrVersion = target || getInitialSettings()?.autoUpdatesChannel || 'latest';
        setState({
          type: 'installing',
          version: channelOrVersion
        });

        // Pass force flag to trigger reinstall even if up to date
        logForDebugging(`Install: Calling installLatest(channelOrVersion=${channelOrVersion}, forceReinstall=${force})`);
// 真正的安装在底层完成，返回值里锁失败与是否更新过是两条独立信息
        const result = await installLatest(channelOrVersion, force);
        logForDebugging(`Install: installLatest returned version=${result.latestVersion}, wasUpdated=${result.wasUpdated}, lockFailed=${result.lockFailed}`);

        // Check specifically for lock failure
// 锁冲突要翻成人话：另一个进程正在装，等一会儿再来
        if (result.lockFailed) {
          throw new Error('Could not install - another process is currently installing Claude. Please try again in a moment.');
        }

        // If we couldn't get the version, there might be an issue
// 拿不到版本号只记日志不中止：二进制可能已经装好，只是查不到版本
        if (!result.latestVersion) {
          logForDebugging('Install: Failed to retrieve version information during install', {
            level: 'error'
          });
        }
// 没更新也是正常结果：用户可能就是来修外壳的
        if (!result.wasUpdated) {
          logForDebugging('Install: Already up to date');
        }

        // Set up launcher and shell integration
        setState({
          type: 'setting-up'
        });
// 配置启动器与路径是第二步：它决定用户下次能不能直接在终端里敲命令
        const setupMessages = await checkInstall(true);
        logForDebugging(`Install: Setup launcher completed with ${setupMessages.length} messages`);
        if (setupMessages.length > 0) {
          setupMessages.forEach(msg => logForDebugging(`Install: Setup message: ${msg.message}`));
        }

// 清理放在原生安装成功之后：先删旧的可能把用户唯一能用的版本删掉
        // Now that native installation succeeded, clean up old npm installations
        logForDebugging('Install: Cleaning up npm installations after successful install');
// 清理旧包管理的安装：三份返回值分别是删掉的个数、错误与警告
        const {
          removed,
          errors,
          warnings
        } = await cleanupNpmInstallations();
        if (removed > 0) {
          logForDebugging(`Cleaned up ${removed} npm installation(s)`);
        }
// 清理失败不影响成功：原生版已经可用，这里失败最多留下点垃圾
        if (errors.length > 0) {
          logForDebugging(`Cleanup errors: ${errors.join(', ')}`);
          // Continue despite cleanup errors - native install already succeeded
        }

        // Clean up old shell aliases
// 旧的命令行别名也要清：它们指向已删除的路径，留着会让终端报找不到命令
        const aliasMessages = await cleanupShellAliases();
        if (aliasMessages.length > 0) {
          logForDebugging(`Shell alias cleanup: ${aliasMessages.map(m => m.message).join('; ')}`);
        }

        // Log success event
// 成功事件带两个维度：有没有拿到版本、是不是强制重装
        logEvent('tengu_claude_install_command', {
          has_version: result.latestVersion ? 1 : 0,
          forced: force ? 1 : 0
        });

        // If user explicitly specified a channel, save it to settings
// 只有用户显式指定通道才写回设置：从默认值推出来的不该反过来改用户偏好
        if (target === 'latest' || target === 'stable') {
          updateSettingsForSource('userSettings', {
            autoUpdatesChannel: target
          });
          logForDebugging(`Install: Saved autoUpdatesChannel=${target} to user settings`);
        }

        // Combine all warning/info messages (convert SetupMessage to string)
// 警告与别名提示合成一束：它们都只是备注，展示位置一致
        const allWarnings = [...warnings, ...aliasMessages.map(m_0 => m_0.message)];

        // Check if there were any setup errors or notes
// 有配置提示就先停在这个状态让用户读完，两秒后再切成成功
        if (setupMessages.length > 0) {
          setState({
            type: 'set-up',
            messages: setupMessages.map(m_1 => m_1.message)
          });
          // Still mark as success but show both setup messages and cleanup warnings
// 延迟切换靠定时器：立刻切会把刚出现的提示盖掉，用户根本来不及看
          setTimeout(setState, 2000, {
            type: 'success' as const,
            version: result.latestVersion || 'current',
            setupMessages: [...setupMessages.map(m_2 => m_2.message), ...allWarnings]
          });
        } else {
          // No setup messages, go straight to success (but still show cleanup warnings if any)
          logForDebugging('Install: Shell PATH already configured');
// 没有任何提示就直接进成功态，此时只有清理警告需要附带
          setState({
            type: 'success',
            version: result.latestVersion || 'current',
            setupMessages: allWarnings.length > 0 ? allWarnings : undefined
          });
        }
      } catch (error) {
// 失败只留一句可读信息：堆栈写进调试日志，界面上放它没有帮助
        logForDebugging(`Install command failed: ${error}`, {
          level: 'error'
        });
        setState({
          type: 'error',
          message: errorMessage(error)
        });
      }
    }
    void run();
  }, [force, target]);
// 第二个副作用只管退场：成功等两秒、失败等三秒，让最后一帧留在屏幕上
  useEffect(() => {
    if (state.type === 'success') {
      // Give success message time to render before exiting
// 多等的两秒是给用户读安装路径与下一步提示的时间
      setTimeout(onDone, 2000, 'Claude Code installation completed successfully', {
        display: 'system' as const
      });
    } else if (state.type === 'error') {
      // Give error message time to render before exiting
// 失败多留一秒：错误文案通常更长，还要给出强制重装的建议
      setTimeout(onDone, 3000, 'Claude Code installation failed', {
        display: 'system' as const
      });
    }
  }, [state, onDone]);
// 视图按状态做互斥分支：同一时刻只可能命中一个，所以不需要再套一层判断
  return <Box flexDirection="column" marginTop={1}>
      {state.type === 'checking' && <Text color="claude">Checking installation status...</Text>}

      {state.type === 'cleaning-npm' && <Text color="warning">Cleaning up old npm installations...</Text>}

      {state.type === 'installing' && <Text color="claude">
          Installing Claude Code native build {state.version}...
        </Text>}

      {state.type === 'setting-up' && <Text color="claude">Setting up launcher and shell integration...</Text>}

      {state.type === 'set-up' && <SetupNotes messages={state.messages} />}

// 成功态展示版本、路径与下一步命令：三样都是用户马上要用的信息
      {state.type === 'success' && <Box flexDirection="column" gap={1}>
          <Box>
            <StatusIcon status="success" withSpace />
            <Text color="success" bold>
              Claude Code successfully installed!
            </Text>
          </Box>
          <Box marginLeft={2} flexDirection="column" gap={1}>
// 版本未知时整行不显示，避免出现一个写着 current 的假版本号
            {state.version !== 'current' && <Box>
                <Text dimColor>Version: </Text>
                <Text color="claude">{state.version}</Text>
              </Box>}
            <Box>
              <Text dimColor>Location: </Text>
              <Text color="text">{getInstallationPath()}</Text>
            </Box>
          </Box>
          <Box marginLeft={2} flexDirection="column" gap={1}>
            <Box marginTop={1}>
              <Text dimColor>Next: Run </Text>
              <Text color="claude" bold>
                claude --help
              </Text>
              <Text dimColor> to get started</Text>
            </Box>
          </Box>
          {state.setupMessages && <SetupNotes messages={state.setupMessages} />}
        </Box>}

// 失败态给出强制重装这条路：多数失败是残留状态导致的，强制一次就能过
      {state.type === 'error' && <Box flexDirection="column" gap={1}>
          <Box>
            <StatusIcon status="error" withSpace />
            <Text color="error">Installation failed</Text>
          </Box>
          <Text color="error">{state.message}</Text>
          <Box marginTop={1}>
            <Text dimColor>Try running with --force to override checks</Text>
          </Box>
        </Box>}
    </Box>;
}

// This is only used from cli.tsx, not as a slash command
// 命令对象本身很薄：解析参数、渲染组件、在完成回调里卸载
export const install = {
  type: 'local-jsx' as const,
  name: 'install',
  description: 'Install Claude Code native build',
  argumentHint: '[options]',
  async call(onDone: (result: string, options?: {
    display?: CommandResultDisplay;
  }) => void, _context: unknown, args: string[]) {
    // Parse arguments
// 强制标记只认完整写法，不做前缀匹配，避免误吃掉别的参数
    const force = args.includes('--force');
// 过滤掉所有以双横线开头的参数，剩下的第一个就是目标通道或版本号
    const nonFlagArgs = args.filter(arg => !arg.startsWith('--'));
    const target = nonFlagArgs[0]; // 'latest', 'stable', or version like '1.0.34'

// 卸载交给完成回调：组件自己不知道渲染宿主，只能由这里收尾
    const {
      unmount
    } = await render(<Install onDone={(result, options) => {
      unmount();
      onDone(result, options);
    }} force={force} target={target} />);
  }
};
// 原文件此处有一行 28548 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。