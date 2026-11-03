import { APIUserAbortError } from '@anthropic-ai/sdk';
import React, { type ReactNode, useCallback, useRef, useState } from 'react';
import { useMainLoopModel } from '../../../../hooks/useMainLoopModel.js';
import { Box, Text } from '../../../../ink.js';
import { useKeybinding } from '../../../../keybindings/useKeybinding.js';
import { createAbortController } from '../../../../utils/abortController.js';
import { editPromptInEditor } from '../../../../utils/promptEditor.js';
import { ConfigurableShortcutHint } from '../../../ConfigurableShortcutHint.js';
import { Byline } from '../../../design-system/Byline.js';
import { Spinner } from '../../../Spinner.js';
import TextInput from '../../../TextInput.js';
import { useWizard } from '../../../wizard/index.js';
import { WizardDialogLayout } from '../../../wizard/WizardDialogLayout.js';
import { generateAgent } from '../../generateAgent.js';
import type { AgentWizardData } from '../types.js';
// 新建代理向导的「生成」步骤：用户输入对代理的描述，调用生成接口产出代理定义后跳到工具步骤
export function GenerateStep(): ReactNode {
  const {
    updateWizardData,
    goBack,
    goToStep,
    wizardData
  } = useWizard<AgentWizardData>();
  const [prompt, setPrompt] = useState(wizardData.generationPrompt || '');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursorOffset, setCursorOffset] = useState(prompt.length);
  const model = useMainLoopModel();
// 四个状态：生成提示词、是否生成中、错误、光标偏移（用于外部编辑器回写后还原光标）
  const abortControllerRef = useRef<AbortController | null>(null);

  // Cancel generation when escape pressed during generation
// 生成中按 Esc 取消：中止控制器并标记取消错误
  const handleCancelGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsGenerating(false);
      setError('Generation cancelled');
    }
  }, []);

  // Use Settings context so 'n' key doesn't cancel (allows typing 'n' in prompt input)
  useKeybinding('confirm:no', handleCancelGeneration, {
// 生成中把 confirm:no 绑定为取消（context=Settings 让 n 键不触发取消输入），仅在生成态激活
    context: 'Settings',
    isActive: isGenerating
  });
// 呼出外部编辑器编辑提示词：写回内容并同步光标偏移
  const handleExternalEditor = useCallback(async () => {
    const result = await editPromptInEditor(prompt);
    if (result.content !== null) {
      setPrompt(result.content);
      setCursorOffset(result.content.length);
    }
  }, [prompt]);
  useKeybinding('chat:externalEditor', handleExternalEditor, {
    context: 'Chat',
    isActive: !isGenerating
  });

  // Go back when escape pressed while not generating
// 未生成时按 Esc 返回：清空已填向导数据并重置错误
  const handleGoBack = useCallback(() => {
    updateWizardData({
      generationPrompt: '',
      agentType: '',
      systemPrompt: '',
      whenToUse: '',
      generatedAgent: undefined,
      wasGenerated: false
    });
    setPrompt('');
    setError(null);
    goBack();
  }, [updateWizardData, goBack]);

  // Use Settings context so 'n' key doesn't cancel (allows typing 'n' in prompt input)
  useKeybinding('confirm:no', handleGoBack, {
    context: 'Settings',
    isActive: !isGenerating
  });
// 生成主流程：校验非空 → 建中止控制器 → 调 generateAgent → 写回代理数据并跳到第 6 步（工具步）
  const handleGenerate = async (): Promise<void> => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setError('Please describe what the agent should do');
      return;
    }
    setError(null);
    setIsGenerating(true);
    updateWizardData({
      generationPrompt: trimmedPrompt,
      isGenerating: true
    });

    // Create abort controller for this generation
    const controller = createAbortController();
    abortControllerRef.current = controller;
    try {
      const generated = await generateAgent(trimmedPrompt, model, [], controller.signal);
      updateWizardData({
        agentType: generated.identifier,
        whenToUse: generated.whenToUse,
        systemPrompt: generated.systemPrompt,
        generatedAgent: generated,
        isGenerating: false,
        wasGenerated: true
      });

      // Skip directly to ToolsStep (index 6) - matching original flow
      goToStep(6);
// 成功后跳过中间步骤直接到第 6 步（工具步），与原流程一致
    } catch (err) {
      // Don't show error if it was cancelled (already set in escape handler)
      if (err instanceof APIUserAbortError) {
// 捕获异常：用户取消不报错，只有非「找不到助手消息」的其它错误才展示
        // User cancelled - no error to show
      } else if (err instanceof Error && !err.message.includes('No assistant message found')) {
        setError(err.message || 'Failed to generate agent');
      }
      updateWizardData({
        isGenerating: false
      });
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };
  const subtitle = 'Describe what this agent should do and when it should be used (be comprehensive for best results)';
  if (isGenerating) {
// 生成中界面：转圈 + 「正在根据描述生成代理」，底部提示按 Esc 取消
    return <WizardDialogLayout subtitle={subtitle} footerText={<ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="cancel" />}>
        <Box flexDirection="row" alignItems="center">
          <Spinner />
          <Text color="suggestion"> Generating agent from description...</Text>
        </Box>
      </WizardDialogLayout>;
  }
  return <WizardDialogLayout subtitle={subtitle} footerText={<Byline>
// 常态界面：文本框输入描述，底部三键提示（提交 / 外部编辑器 / 返回）
          <ConfigurableShortcutHint action="confirm:yes" context="Confirmation" fallback="Enter" description="submit" />
          <ConfigurableShortcutHint action="chat:externalEditor" context="Chat" fallback="ctrl+g" description="open in editor" />
          <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="go back" />
        </Byline>}>
      <Box flexDirection="column">
        {error && <Box marginBottom={1}>
            <Text color="error">{error}</Text>
          </Box>}
        <TextInput value={prompt} onChange={setPrompt} onSubmit={handleGenerate} placeholder="e.g., Help me write unit tests for my code..." columns={80} cursorOffset={cursorOffset} onChangeCursorOffset={setCursorOffset} focus showCursor />
      </Box>
    </WizardDialogLayout>;
}
// 原文件此处有一行 16352 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。