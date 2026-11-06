// 杂项子命令处理器，从 main.tsx 抽出做懒加载：setup-token、doctor、install
import { c as _c } from "react/compiler-runtime";
/**
 * Miscellaneous subcommand handlers — extracted from main.tsx for lazy loading.
 * setup-token, doctor, install
 */
// CLI 子命令处理器有意退出进程，所以对 no-process-exit 规则整文件豁免
/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handlers intentionally exit */

import { cwd } from 'process';
import React from 'react';
import { WelcomeV2 } from '../../components/LogoV2/WelcomeV2.js';
import { useManagePlugins } from '../../hooks/useManagePlugins.js';
import type { Root } from '../../ink.js';
import { Box, Text } from '../../ink.js';
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js';
import { logEvent } from '../../services/analytics/index.js';
import { MCPConnectionManager } from '../../services/mcp/MCPConnectionManager.js';
import { AppStateProvider } from '../../state/AppState.js';
import { onChangeAppState } from '../../state/onChangeAppState.js';
import { isAnthropicAuthEnabled } from '../../utils/auth.js';
// setup-token：引导 OAuth 长寿命令牌流程，已有环境变量鉴权时给警告，结束后直接 process.exit(0)
export async function setupTokenHandler(root: Root): Promise<void> {
  logEvent('tengu_setup_token_command', {});
  const showAuthWarning = !isAnthropicAuthEnabled();
  const {
// 动态导入 OAuth 流程组件，避免它进主包、拖慢启动
    ConsoleOAuthFlow
  } = await import('../../components/ConsoleOAuthFlow.js');
  await new Promise<void>(resolve => {
    root.render(<AppStateProvider onChangeAppState={onChangeAppState}>
        <KeybindingSetup>
          <Box flexDirection="column" gap={1}>
            <WelcomeV2 />
            {showAuthWarning && <Box flexDirection="column">
                <Text color="warning">
                  Warning: You already have authentication configured via
                  environment variable or API key helper.
                </Text>
                <Text color="warning">
                  The setup-token command will create a new OAuth token which
                  you can use instead.
                </Text>
              </Box>}
            <ConsoleOAuthFlow onDone={() => {
            void resolve();
          }} mode="setup-token" startingMessage="This will guide you through long-lived (1-year) auth token setup for your Claude account. Claude subscription required." />
          </Box>
        </KeybindingSetup>
      </AppStateProvider>);
  });
  root.unmount();
// 渲染完成后卸载根节点并退出；OAuth 流程在 onDone 里 resolve
  process.exit(0);
}

// doctor 命令用懒加载包一层，避免启动时就把整个 Doctor 屏拉进来
// DoctorWithPlugins wrapper + doctor handler
const DoctorLazy = React.lazy(() => import('../../screens/Doctor.js').then(m => ({
  default: m.Doctor
})));
// 编译器产物：只记忆化 onDone 一个依赖，Suspense 包裹 Doctor 做懒加载
function DoctorWithPlugins(t0) {
  const $ = _c(2);
  const {
    onDone
  } = t0;
  useManagePlugins();
  let t1;
  if ($[0] !== onDone) {
    t1 = <React.Suspense fallback={null}><DoctorLazy onDone={onDone} /></React.Suspense>;
    $[0] = onDone;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  return t1;
}
// doctor：把 AppState / MCP / 插件管理都挂上，渲染 Doctor 屏后退出
export async function doctorHandler(root: Root): Promise<void> {
  logEvent('tengu_doctor_command', {});
  await new Promise<void>(resolve => {
    root.render(<AppStateProvider>
        <KeybindingSetup>
          <MCPConnectionManager dynamicMcpConfig={undefined} isStrictMcpConfig={false}>
            <DoctorWithPlugins onDone={() => {
            void resolve();
          }} />
          </MCPConnectionManager>
        </KeybindingSetup>
      </AppStateProvider>);
  });
  root.unmount();
  process.exit(0);
}

// install：先拉 setup 初始化，再调 install 跑安装；失败结果映射成退出码 1
// install handler
export async function installHandler(target: string | undefined, options: {
  force?: boolean;
}): Promise<void> {
  const {
    setup
  } = await import('../../setup.js');
  await setup(cwd(), 'default', false, false, undefined, false);
  const {
    install
  } = await import('../../commands/install.js');
  await new Promise<void>(resolve => {
    const args: string[] = [];
    if (target) args.push(target);
    if (options.force) args.push('--force');
// install 的回调里按结果含不含 failed 决定退出码，结束 process
    void install.call(result => {
      void resolve();
      process.exit(result.includes('failed') ? 1 : 0);
    }, {}, args);
  });
}
// 原文件此处有一行 10652 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。