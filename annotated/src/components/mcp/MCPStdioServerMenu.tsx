import figures from 'figures';
// figures 提供终端绘制符号
import React, { useState } from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, color, Text, useTheme } from '../../ink.js';
import { getMcpConfigByName } from '../../services/mcp/config.js';
import { useMcpReconnect, useMcpToggleEnabled } from '../../services/mcp/MCPConnectionManager.js';
import { describeMcpConfigFilePath, filterMcpPromptsByServer } from '../../services/mcp/utils.js';
import { useAppState } from '../../state/AppState.js';
import { errorMessage } from '../../utils/errors.js';
import { capitalize } from '../../utils/stringUtils.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { Select } from '../CustomSelect/index.js';
import { Byline } from '../design-system/Byline.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
import { Spinner } from '../Spinner.js';
import { CapabilitiesSection } from './CapabilitiesSection.js';
import type { StdioServerInfo } from './types.js';
import { handleReconnectError, handleReconnectResult } from './utils/reconnectHelpers.js';
type Props = {
// 组件属性：server 信息、工具数、查看工具/取消/完成回调
  server: StdioServerInfo;
  serverToolsCount: number;
  onViewTools: () => void;
  onCancel: () => void;
  onComplete: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  borderless?: boolean;
};
export function MCPStdioServerMenu({
// 标准 stdio MCP 服务菜单组件
  server,
  serverToolsCount,
  onViewTools,
  onCancel,
  onComplete,
  borderless = false
}: Props): React.ReactNode {
  const [theme] = useTheme();
// 读取主题用于状态着色
  const exitState = useExitOnCtrlCDWithKeybindings();
// Ctrl/Cmd+D 退出逻辑
  const mcp = useAppState(s => s.mcp);
// 从应用状态取 mcp 数据
  const reconnectMcpServer = useMcpReconnect();
// 获取重连动作
  const toggleMcpServer = useMcpToggleEnabled();
// 获取启用/禁用切换动作
  const [isReconnecting, setIsReconnecting] = useState(false);
  const handleToggleEnabled = React.useCallback(async () => {
// 切换启用状态，成功后返回服务列表
    const wasEnabled = server.client.type !== 'disabled';
    try {
      await toggleMcpServer(server.name);
      // Return to the server list so user can continue managing other servers
      onCancel();
    } catch (err) {
      const action = wasEnabled ? 'disable' : 'enable';
      onComplete(`Failed to ${action} MCP server '${server.name}': ${errorMessage(err)}`);
    }
  }, [server.client.type, server.name, toggleMcpServer, onCancel, onComplete]);
  const capitalizedServerName = capitalize(String(server.name));

  // Count MCP prompts for this server (skills are shown in /skills, not here)
// 统计该服务关联的 MCP 提示数量
  const serverCommandsCount = filterMcpPromptsByServer(mcp.commands, server.name).length;
  const menuOptions = [];
// 构建菜单选项

  // Only show "View tools" if server is not disabled and has tools
  if (server.client.type !== 'disabled' && serverToolsCount > 0) {
// 未禁用且有工具时显示查看工具入口
    menuOptions.push({
      label: 'View tools',
      value: 'tools'
    });
  }

  // Only show reconnect option if the server is not disabled
  if (server.client.type !== 'disabled') {
// 未禁用时显示重连入口
    menuOptions.push({
      label: 'Reconnect',
      value: 'reconnectMcpServer'
    });
  }
  menuOptions.push({
// 根据当前状态显示禁用或启用选项
    label: server.client.type !== 'disabled' ? 'Disable' : 'Enable',
    value: 'toggle-enabled'
  });

  // If there are no other options, add a back option so Select handles escape
  if (menuOptions.length === 0) {
// 无其他选项时补一个返回项供 Select 处理 Esc
    menuOptions.push({
      label: 'Back',
      value: 'back'
    });
  }
  if (isReconnecting) {
// 重连进行中显示等待界面
    return <Box flexDirection="column" gap={1} padding={1}>
        <Text color="text">
          Reconnecting to <Text bold>{server.name}</Text>
        </Text>
        <Box>
          <Spinner />
          <Text> Restarting MCP server process</Text>
        </Box>
        <Text dimColor>This may take a few moments.</Text>
      </Box>;
  }
  return <Box flexDirection="column">
// 主界面：状态、命令、参数、配置位置与能力
      <Box flexDirection="column" paddingX={1} borderStyle={borderless ? undefined : 'round'}>
        <Box marginBottom={1}>
          <Text bold>{capitalizedServerName} MCP Server</Text>
        </Box>

        <Box flexDirection="column" gap={0}>
          <Box>
            <Text bold>Status: </Text>
            {server.client.type === 'disabled' ? <Text>{color('inactive', theme)(figures.radioOff)} disabled</Text> : server.client.type === 'connected' ? <Text>{color('success', theme)(figures.tick)} connected</Text> : server.client.type === 'pending' ? <>
// 按客户端类型展示连接状态
                <Text dimColor>{figures.radioOff}</Text>
                <Text> connecting…</Text>
              </> : <Text>{color('error', theme)(figures.cross)} failed</Text>}
          </Box>

          <Box>
            <Text bold>Command: </Text>
            <Text dimColor>{server.config.command}</Text>
          </Box>

          {server.config.args && server.config.args.length > 0 && <Box>
              <Text bold>Args: </Text>
              <Text dimColor>{server.config.args.join(' ')}</Text>
            </Box>}

          <Box>
            <Text bold>Config location: </Text>
            <Text dimColor>
              {describeMcpConfigFilePath(getMcpConfigByName(server.name)?.scope ?? 'dynamic')}
            </Text>
          </Box>

          {server.client.type === 'connected' && <CapabilitiesSection serverToolsCount={serverToolsCount} serverPromptsCount={serverCommandsCount} serverResourcesCount={mcp.resources[server.name]?.length || 0} />}
// 已连接时展示工具/提示/资源数量

          {server.client.type === 'connected' && serverToolsCount > 0 && <Box>
              <Text bold>Tools: </Text>
              <Text dimColor>{serverToolsCount} tools</Text>
            </Box>}
        </Box>

        {menuOptions.length > 0 && <Box marginTop={1}>
            <Select options={menuOptions} onChange={async value => {
// Select 根据所选执行查看/重连/切换/返回
          if (value === 'tools') {
            onViewTools();
          } else if (value === 'reconnectMcpServer') {
            setIsReconnecting(true);
            try {
              const result = await reconnectMcpServer(server.name);
              const {
                message
              } = handleReconnectResult(result, server.name);
              onComplete?.(message);
            } catch (err_0) {
              onComplete?.(handleReconnectError(err_0, server.name));
            } finally {
              setIsReconnecting(false);
            }
          } else if (value === 'toggle-enabled') {
            await handleToggleEnabled();
          } else if (value === 'back') {
            onCancel();
          }
        }} onCancel={onCancel} />
          </Box>}
      </Box>

      <Box marginTop={1}>
        <Text dimColor italic>
          {exitState.pending ? <>Press {exitState.keyName} again to exit</> : <Byline>
              <KeyboardShortcutHint shortcut="↑↓" action="navigate" />
              <KeyboardShortcutHint shortcut="Enter" action="select" />
              <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="back" />
            </Byline>}
        </Text>
      </Box>
    </Box>;
}
// 原文件此处有一行 21412 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。