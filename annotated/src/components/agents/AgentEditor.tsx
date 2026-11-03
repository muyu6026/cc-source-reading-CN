import chalk from 'chalk';
// chalk 用于终端彩色输出，figures 提供符号
import figures from 'figures';
import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useSetAppState } from 'src/state/AppState.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { Box, Text } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import type { Tools } from '../../Tool.js';
import { type AgentColorName, setAgentColor } from '../../tools/AgentTool/agentColorManager.js';
import { type AgentDefinition, getActiveAgentsFromList, isCustomAgent, isPluginAgent } from '../../tools/AgentTool/loadAgentsDir.js';
import { editFileInEditor } from '../../utils/promptEditor.js';
import { getActualAgentFilePath, updateAgentFile } from './agentFileUtils.js';
import { ColorPicker } from './ColorPicker.js';
import { ModelSelector } from './ModelSelector.js';
import { ToolSelector } from './ToolSelector.js';
import { getAgentSourceDisplayName } from './utils.js';
type Props = {
// 组件属性：agent 定义、tools、保存与返回回调
  agent: AgentDefinition;
  tools: Tools;
  onSaved: (message: string) => void;
  onBack: () => void;
};
type EditMode = 'menu' | 'edit-tools' | 'edit-color' | 'edit-model';
// 编辑模式：菜单 / 编辑工具 / 颜色 / 模型
type SaveChanges = {
  tools?: string[];
  color?: AgentColorName;
  model?: string;
};
export function AgentEditor({
// agent 编辑器主组件
  agent,
  tools,
  onSaved,
  onBack
}: Props): React.ReactNode {
  const setAppState = useSetAppState();
  const [editMode, setEditMode] = useState<EditMode>('menu');
  const [selectedMenuIndex, setSelectedMenuIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<AgentColorName | undefined>(agent.color as AgentColorName | undefined);
  const handleOpenInEditor = useCallback(async () => {
// 在外部编辑器打开 agent 文件
    const filePath = getActualAgentFilePath(agent);
    const result = await editFileInEditor(filePath);
    if (result.error) {
      setError(result.error);
    } else {
      onSaved(`Opened ${agent.agentType} in editor. If you made edits, restart to load the latest version.`);
    }
  }, [agent, onSaved]);
  const handleSave = useCallback(async (changes: SaveChanges = {}) => {
// 保存改动：工具、颜色或模型变化才写入
    const {
      tools: newTools,
      color: newColor,
      model: newModel
    } = changes;
    const finalColor = newColor ?? selectedColor;
    const hasToolsChanged = newTools !== undefined;
    const hasModelChanged = newModel !== undefined;
    const hasColorChanged = finalColor !== agent.color;
    if (!hasToolsChanged && !hasModelChanged && !hasColorChanged) {
      return false;
    }
    try {
      // Only custom/plugin agents can be edited
      // this is for type safety; the UI shouldn't allow editing otherwise
// 仅自定义或插件类 agent 可被编辑（类型安全）
      if (!isCustomAgent(agent) && !isPluginAgent(agent)) {
        return false;
      }
      await updateAgentFile(agent, agent.whenToUse, newTools ?? agent.tools, agent.getSystemPrompt(), finalColor, newModel ?? agent.model);
// 更新 agent 文件并同步颜色
      if (hasColorChanged && finalColor) {
        setAgentColor(agent.agentType, finalColor);
      }
      setAppState(state => {
// 更新应用状态中的 agent 定义与激活列表
        const allAgents = state.agentDefinitions.allAgents.map(a => a.agentType === agent.agentType ? {
          ...a,
          tools: newTools ?? a.tools,
          color: finalColor,
          model: newModel ?? a.model
        } : a);
        return {
          ...state,
          agentDefinitions: {
            ...state.agentDefinitions,
            activeAgents: getActiveAgentsFromList(allAgents),
            allAgents
          }
        };
      });
      onSaved(`Updated agent: ${chalk.bold(agent.agentType)}`);
// 保存成功后通知父组件
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save agent');
      return false;
    }
  }, [agent, selectedColor, onSaved, setAppState]);
  const menuItems = useMemo(() => [{
// 构建菜单项：打开编辑器、编辑工具/模型/颜色
    label: 'Open in editor',
    action: handleOpenInEditor
  }, {
    label: 'Edit tools',
    action: () => setEditMode('edit-tools')
  }, {
    label: 'Edit model',
    action: () => setEditMode('edit-model')
  }, {
    label: 'Edit color',
    action: () => setEditMode('edit-color')
  }], [handleOpenInEditor]);
  const handleEscape = useCallback(() => {
// Esc：菜单态返回，否则回到菜单
    setError(null);
    if (editMode === 'menu') {
      onBack();
    } else {
      setEditMode('menu');
    }
  }, [editMode, onBack]);
  const handleMenuKeyDown = useCallback((e: KeyboardEvent) => {
// 处理菜单方向键与回车选择
    if (e.key === 'up') {
      e.preventDefault();
      setSelectedMenuIndex(index => Math.max(0, index - 1));
    } else if (e.key === 'down') {
      e.preventDefault();
      setSelectedMenuIndex(index_0 => Math.min(menuItems.length - 1, index_0 + 1));
    } else if (e.key === 'return') {
      e.preventDefault();
      const selectedItem = menuItems[selectedMenuIndex];
      if (selectedItem) {
        void selectedItem.action();
      }
    }
  }, [menuItems, selectedMenuIndex]);
  useKeybinding('confirm:no', handleEscape, {
// 绑定 confirm:no 为正向 Esc 行为
    context: 'Confirmation'
  });
  const renderMenu = (): React.ReactNode => <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleMenuKeyDown}>
// 渲染菜单界面，展示来源与各操作项
      <Text dimColor>Source: {getAgentSourceDisplayName(agent.source)}</Text>

      <Box marginTop={1} flexDirection="column">
        {menuItems.map((item, index_1) => <Text key={item.label} color={index_1 === selectedMenuIndex ? 'suggestion' : undefined}>
            {index_1 === selectedMenuIndex ? `${figures.pointer} ` : '  '}
            {item.label}
          </Text>)}
      </Box>

      {error && <Box marginTop={1}>
          <Text color="error">{error}</Text>
        </Box>}
    </Box>;
  switch (editMode) {
// 按当前编辑模式渲染对应子界面
    case 'menu':
      return renderMenu();
    case 'edit-tools':
      return <ToolSelector tools={tools} initialTools={agent.tools} onComplete={async finalTools => {
// 编辑工具：选择后写回并保存
        setEditMode('menu');
        await handleSave({
          tools: finalTools
        });
      }} />;
    case 'edit-color':
      return <ColorPicker agentName={agent.agentType} currentColor={selectedColor || agent.color as AgentColorName || 'automatic'} onConfirm={async color => {
// 编辑颜色：选择后写回并保存
        setSelectedColor(color);
        setEditMode('menu');
        await handleSave({
          color
        });
      }} />;
    case 'edit-model':
      return <ModelSelector initialModel={agent.model} onComplete={async model => {
// 编辑模型：选择后写回并保存
        setEditMode('menu');
        await handleSave({
          model
        });
      }} />;
    default:
      return null;
  }
}
// 原文件此处有一行 19992 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。