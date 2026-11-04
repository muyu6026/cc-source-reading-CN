import chalk from 'chalk';
import React, { type ReactNode, useCallback, useState } from 'react';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { useSetAppState } from 'src/state/AppState.js';
import type { Tools } from '../../../../Tool.js';
import type { AgentDefinition } from '../../../../tools/AgentTool/loadAgentsDir.js';
import { getActiveAgentsFromList } from '../../../../tools/AgentTool/loadAgentsDir.js';
import { editFileInEditor } from '../../../../utils/promptEditor.js';
import { useWizard } from '../../../wizard/index.js';
import { getNewAgentFilePath, saveAgentToFile } from '../../agentFileUtils.js';
import type { AgentWizardData } from '../types.js';
import { ConfirmStep } from './ConfirmStep.js';
type Props = {
  tools: Tools;
  existingAgents: AgentDefinition[];
  onComplete: (message: string) => void;
};
// 向导确认步的包装层：落盘、状态更新、打点、打开编辑器都在这里，ConfirmStep 只负责展示
export function ConfirmStepWrapper({
  tools,
  existingAgents,
  onComplete
}: Props): ReactNode {
  const {
    wizardData
  } = useWizard<AgentWizardData>();
  const [saveError, setSaveError] = useState<string | null>(null);
  const setAppState = useSetAppState();
  const saveAgent = useCallback(async (openInEditor: boolean): Promise<void> => {
// saveAgent 是核心流程：saveAgentToFile 落盘，然后更新 AppState 的 agentDefinitions，可选打开编辑器，最后打点并回报消息
    if (!wizardData?.finalAgent) return;
    try {
      await saveAgentToFile(wizardData.location!, wizardData.finalAgent.agentType, wizardData.finalAgent.whenToUse, wizardData.finalAgent.tools, wizardData.finalAgent.getSystemPrompt(), true, wizardData.finalAgent.color, wizardData.finalAgent.model, wizardData.finalAgent.memory);
// saveAgentToFile 按位置传了一长串参数：位置、名字、描述、工具、提示词（这里调用 getSystemPrompt 求值）、是否覆盖、颜色、模型、记忆
      setAppState(state => {
// setAppState 里再判一次 finalAgent 是否还在：闭包捕获的值可能已过期
        if (!wizardData.finalAgent) return state;
        const allAgents = state.agentDefinitions.allAgents.concat(wizardData.finalAgent);
        return {
          ...state,
          agentDefinitions: {
            ...state.agentDefinitions,
            activeAgents: getActiveAgentsFromList(allAgents),
// activeAgents 由 getActiveAgentsFromList 重算而不是手工追加：启用规则集中在一处
            allAgents
          }
        };
      });
      if (openInEditor) {
        const filePath = getNewAgentFilePath({
          source: wizardData.location!,
          agentType: wizardData.finalAgent.agentType
        });
        await editFileInEditor(filePath);
      }
      logEvent('tengu_agent_created', {
// 打点字段全是布尔与计数，没有文件路径：那个 AnalyticsMetadata 类型就是用来在编译期挡住路径泄漏的
        agent_type: wizardData.finalAgent.agentType,
        generation_method: wizardData.wasGenerated ? 'generated' : 'manual',
        source: wizardData.location!,
        tool_count: wizardData.finalAgent.tools?.length ?? 'all',
// tool_count 用长度或字符串 all：工具全开时没有可数的长度
        has_custom_model: !!wizardData.finalAgent.model,
        has_custom_color: !!wizardData.finalAgent.color,
        has_memory: !!wizardData.finalAgent.memory,
        memory_scope: wizardData.finalAgent.memory ?? 'none',
        ...(openInEditor ? {
          opened_in_editor: true
        } : {})
      } as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS);
      const message = openInEditor ? `Created agent: ${chalk.bold(wizardData.finalAgent.agentType)} and opened in editor. ` + `If you made edits, restart to load the latest version.` : `Created agent: ${chalk.bold(wizardData.finalAgent.agentType)}`;
// 两条完成文案：打开编辑器时额外提醒需要重启才能加载改动
      onComplete(message);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save agent');
// catch 里把错误消息落到 saveError 交给 ConfirmStep 展示，不往上抛
    }
  }, [wizardData, onComplete, setAppState]);
  const handleSave = useCallback(() => saveAgent(false), [saveAgent]);
// 两个入口共用 saveAgent：只差一个布尔
  const handleSaveAndEdit = useCallback(() => saveAgent(true), [saveAgent]);
  return <ConfirmStep tools={tools} existingAgents={existingAgents} onSave={handleSave} onSaveAndEdit={handleSaveAndEdit} error={saveError} />;
}
// 原文件此处有一行 10856 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。