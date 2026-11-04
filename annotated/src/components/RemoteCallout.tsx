import React, { useCallback, useEffect, useRef } from 'react';
import { isBridgeEnabled } from '../bridge/bridgeEnabled.js';
import { Box, Text } from '../ink.js';
import { getClaudeAIOAuthTokens } from '../utils/auth.js';
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js';
import type { OptionWithDescription } from './CustomSelect/select.js';
import { Select } from './CustomSelect/select.js';
import { PermissionDialog } from './permissions/PermissionDialog.js';
type RemoteCalloutSelection = 'enable' | 'dismiss';
type Props = {
  onDone: (selection: RemoteCalloutSelection) => void;
};
// 远程控制首次提示：只在没看过、桥接已启用、且已登录时出现一次
export function RemoteCallout({
  onDone
}: Props): React.ReactNode {
  const onDoneRef = useRef(onDone);
// onDoneRef 转发：两个 useCallback 都是空依赖，回调最新值靠 ref 读
  onDoneRef.current = onDone;
  const handleCancel = useCallback((): void => {
// 取消即 dismiss：Esc 不改变任何配置
    onDoneRef.current('dismiss');
  }, []);

  // Permanently mark as seen on mount so it only shows once
  useEffect(() => {
// 挂载即写 remoteDialogSeen：先标记后交互，保证只弹一次
    saveGlobalConfig(current => {
      if (current.remoteDialogSeen) return current;
// 写配置用函数式更新并提前 return current：已是 true 就不再产生新对象，避免无谓写盘
      return {
        ...current,
        remoteDialogSeen: true
      };
    });
  }, []);
  const handleSelect = useCallback((value: RemoteCalloutSelection): void => {
// 选择后透传 enable 或 dismiss
    onDoneRef.current(value);
  }, []);
  const options: OptionWithDescription<RemoteCalloutSelection>[] = [{
    label: 'Enable Remote Control for this session',
// 两个选项都带 description：说明做什么（开安全连接）与后果（随时可用斜杠命令关掉）
    description: 'Opens a secure connection to claude.ai.',
    value: 'enable'
  }, {
    label: 'Never mind',
    description: 'You can always enable it later with /remote-control.',
    value: 'dismiss'
  }];
  return <PermissionDialog title="Remote Control">
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Box marginBottom={1} flexDirection="column">
// 正文两段：能做什么（网页或 app 接着用）加怎么退出（再跑一次远程命令）
          <Text>
            Remote Control lets you access this CLI session from the web
            (claude.ai/code) or the Claude app, so you can pick up where you
            left off on any device.
          </Text>
          <Text> </Text>
          <Text>
            You can disconnect remote access anytime by running /remote-control
            again.
          </Text>
        </Box>
        <Box>
          <Select options={options} onChange={handleSelect} onCancel={handleCancel} />
        </Box>
      </Box>
    </PermissionDialog>;
}

/**
 * Check whether to show the remote callout (first-time dialog).
 */
// shouldShowRemoteCallout 三段判据：已看过、桥接未启用、无 accessToken，任一成立即不显示
export function shouldShowRemoteCallout(): boolean {
  const config = getGlobalConfig();
  if (config.remoteDialogSeen) return false;
  if (!isBridgeEnabled()) return false;
  const tokens = getClaudeAIOAuthTokens();
  if (!tokens?.accessToken) return false;
  return true;
}
// 原文件此处有一行 7356 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。