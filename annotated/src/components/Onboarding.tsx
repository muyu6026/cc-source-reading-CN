// 本文件是首次启动引导页：按条件拼装「预检 → 主题 → API 密钥审批 → OAuth → 安全须知 → 终端设置」六种步骤，只渲染当前一步。
import { c as _c } from "react/compiler-runtime";
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { setupTerminal, shouldOfferTerminalSetup } from '../commands/terminalSetup/terminalSetup.js';
import { useExitOnCtrlCDWithKeybindings } from '../hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, Link, Newline, Text, useTheme } from '../ink.js';
import { useKeybindings } from '../keybindings/useKeybinding.js';
import { isAnthropicAuthEnabled } from '../utils/auth.js';
import { normalizeApiKeyForConfig } from '../utils/authPortable.js';
import { getCustomApiKeyStatus } from '../utils/config.js';
import { env } from '../utils/env.js';
import { isRunningOnHomespace } from '../utils/envUtils.js';
import { PreflightStep } from '../utils/preflightChecks.js';
import type { ThemeSetting } from '../utils/theme.js';
import { ApproveApiKey } from './ApproveApiKey.js';
import { ConsoleOAuthFlow } from './ConsoleOAuthFlow.js';
import { Select } from './CustomSelect/select.js';
import { WelcomeV2 } from './LogoV2/WelcomeV2.js';
import { PressEnterToContinue } from './PressEnterToContinue.js';
import { ThemePicker } from './ThemePicker.js';
import { OrderedList } from './ui/OrderedList.js';
// 步骤用字符串 id 标识而非下标判断，因为步骤数量随配置变化，按 id 判断当前在哪一步才稳定。
type StepId = 'preflight' | 'theme' | 'oauth' | 'api-key' | 'security' | 'terminal-setup';
interface OnboardingStep {
  id: StepId;
  component: React.ReactNode;
}
type Props = {
  onDone(): void;
};
// 引导主组件。步骤不是静态数组而是每次渲染时按条件重新拼装（steps 变量），因此 currentStepIndex 只在下标意义上有意义。
export function Onboarding({
  onDone
}: Props): React.ReactNode {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [skipOAuth, setSkipOAuth] = useState(false);
// 惰性初始化：isAnthropicAuthEnabled 只在首次渲染时求值一次，避免每次渲染重复探测认证配置。
  const [oauthEnabled] = useState(() => isAnthropicAuthEnabled());
  const [theme, setTheme] = useTheme();
  useEffect(() => {
    logEvent('tengu_began_setup', {
      oauthEnabled
    });
  }, [oauthEnabled]);
// 前进一步：还没到最后就推进并打点，到最后一步才回调 onDone。打点记录的是「目标步骤」的 id，而不是离开的步骤。
  function goToNextStep() {
    if (currentStepIndex < steps.length - 1) {
      const nextIndex = currentStepIndex + 1;
      setCurrentStepIndex(nextIndex);
      logEvent('tengu_onboarding_step', {
        oauthEnabled,
        stepId: steps[nextIndex]?.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    } else {
      onDone();
    }
  }
// 选主题后立即推进下一步，主题选择本身就是引导流程的一个强制关卡。
  function handleThemeSelection(newTheme: ThemeSetting) {
    setTheme(newTheme);
    goToNextStep();
  }
  const exitState = useExitOnCtrlCDWithKeybindings();

  // Define all onboarding steps
// 主题步骤 JSX 提前定义为常量，便于下面按顺序拼进 steps 数组；skipExitHandling 要关掉，因为退出快捷键由 Onboarding 统一接管。
  const themeStep = <Box marginX={1}>
      <ThemePicker onThemeSelect={handleThemeSelection} showIntroText={true} helpText="To change this later, run /theme" hideEscToCancel={true} skipExitHandling={true} // Skip exit handling as Onboarding already handles it
    />
    </Box>;
// 安全须知步骤。内部注释提醒：OrderedList 在条件渲染时会编错序号，所以条目要么全渲染要么全不渲染，不能按条件拆开。
  const securityStep = <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>Security notes:</Text>
      <Box flexDirection="column" width={70}>
        {/**
         * OrderedList misnumbers items when rendering conditionally,
         * so put all items in the if/else
         */}
        <OrderedList>
          <OrderedList.Item>
            <Text>Claude can make mistakes</Text>
            <Text dimColor wrap="wrap">
              You should always review Claude&apos;s responses, especially when
              <Newline />
              running code.
              <Newline />
            </Text>
          </OrderedList.Item>
          <OrderedList.Item>
            <Text>
              Due to prompt injection risks, only use it with code you trust
            </Text>
            <Text dimColor wrap="wrap">
              For more details see:
              <Newline />
              <Link url="https://code.claude.com/docs/en/security" />
            </Text>
          </OrderedList.Item>
        </OrderedList>
      </Box>
      <PressEnterToContinue />
    </Box>;
  const preflightStep = <PreflightStep onSuccess={goToNextStep} />;
  // Create the steps array - determine which steps to include based on reAuth and oauthEnabled
// 需要审批的 API 密钥：用空 useMemo（依赖为空）只在挂载时算一次。返回空串或 undefined 都会让后续 if 跳过该步骤。
  const apiKeyNeedingApproval = useMemo(() => {
    // Add API key step if needed
    // On homespace, ANTHROPIC_API_KEY is preserved in process.env for child
    // processes but ignored by Claude Code itself (see auth.ts).
// homespace 环境下 ANTHROPIC_API_KEY 虽然还在环境变量里（供子进程用），但 Claude Code 自己不认它，所以不算「待审批的新密钥」。
    if (!process.env.ANTHROPIC_API_KEY || isRunningOnHomespace()) {
      return '';
    }
    const customApiKeyTruncated = normalizeApiKeyForConfig(process.env.ANTHROPIC_API_KEY);
    if (getCustomApiKeyStatus(customApiKeyTruncated) === 'new') {
      return customApiKeyTruncated;
    }
  }, []);
// 密钥审批通过时置 skipOAuth 跳过后面的 OAuth 步骤——两条认证路径互斥，批了密钥就不用再走浏览器授权。
  function handleApiKeyDone(approved: boolean) {
    if (approved) {
      setSkipOAuth(true);
    }
    goToNextStep();
  }
// 步骤数组按固定顺序拼装：预检（可选）→ 主题 → 密钥（可选）→ OAuth（可跳过）→ 安全须知 → 终端设置（可选）。可选步骤缺席时下标自然前移。
  const steps: OnboardingStep[] = [];
  if (oauthEnabled) {
    steps.push({
      id: 'preflight',
      component: preflightStep
    });
  }
  steps.push({
    id: 'theme',
    component: themeStep
  });
  if (apiKeyNeedingApproval) {
    steps.push({
      id: 'api-key',
      component: <ApproveApiKey customApiKeyTruncated={apiKeyNeedingApproval} onDone={handleApiKeyDone} />
    });
  }
  if (oauthEnabled) {
    steps.push({
      id: 'oauth',
// OAuth 包在 SkippableStep 里：skipOAuth 变真时既跳过渲染又自动推进下一步，见文件底部该组件的实现。
      component: <SkippableStep skip={skipOAuth} onSkip={goToNextStep}>
          <ConsoleOAuthFlow onDone={goToNextStep} />
        </SkippableStep>
    });
  }
  steps.push({
    id: 'security',
    component: securityStep
  });
// 终端设置步骤只在当前终端值得配置时出现（Apple Terminal 与其他终端的推荐快捷键不同，文案里按 env.terminal 二选一）。
  if (shouldOfferTerminalSetup()) {
    steps.push({
      id: 'terminal-setup',
      component: <Box flexDirection="column" gap={1} paddingLeft={1}>
          <Text bold>Use Claude Code&apos;s terminal setup?</Text>
          <Box flexDirection="column" width={70} gap={1}>
            <Text>
              For the optimal coding experience, enable the recommended settings
              <Newline />
              for your terminal:{' '}
              {env.terminal === 'Apple_Terminal' ? 'Option+Enter for newlines and visual bell' : 'Shift+Enter for newlines'}
            </Text>
            <Select options={[{
            label: 'Yes, use recommended settings',
            value: 'install'
          }, {
            label: 'No, maybe later with /terminal-setup',
            value: 'no'
          }]} onChange={value => {
            if (value === 'install') {
              // Errors already logged in setupTerminal, just swallow and proceed
// void 前缀吞掉 Promise、catch 空实现吞掉安装失败——错误已在 setupTerminal 内部记日志，这里无论成败都照常进入下一步，不让安装失败卡死引导流程。
              void setupTerminal(theme).catch(() => {}).finally(goToNextStep);
            } else {
              goToNextStep();
            }
          }} onCancel={() => goToNextStep()} />
            <Text dimColor>
              {exitState.pending ? <>Press {exitState.keyName} again to exit</> : <>Enter to confirm · Esc to skip</>}
            </Text>
          </Box>
        </Box>
    });
  }
  const currentStep = steps[currentStepIndex];

  // Handle Enter on security step and Escape on terminal-setup step
  // Dependencies match what goToNextStep uses internally
// 依赖数组把 goToNextStep 内部用到的量都列上（编译器产物里函数本身不入依赖），按当前步骤分流：安全须知回车推进、最后一步回车结束。
  const handleSecurityContinue = useCallback(() => {
    if (currentStepIndex === steps.length - 1) {
      onDone();
    } else {
      goToNextStep();
    }
  }, [currentStepIndex, steps.length, oauthEnabled, onDone]);
  const handleTerminalSetupSkip = useCallback(() => {
    goToNextStep();
  }, [currentStepIndex, steps.length, oauthEnabled, onDone]);
// 两个快捷键绑定都挂同一个 Confirmation 上下文，但用 isActive 互斥：只有当前步骤 id 匹配时才生效，避免回车键在错误步骤触发跳步。
  useKeybindings({
    'confirm:yes': handleSecurityContinue
  }, {
    context: 'Confirmation',
    isActive: currentStep?.id === 'security'
  });
  useKeybindings({
    'confirm:no': handleTerminalSetupSkip
  }, {
    context: 'Confirmation',
    isActive: currentStep?.id === 'terminal-setup'
  });
// 整体布局：横幅在上，当前步骤内容在下；双击退出的提示条挂在步骤内容之后，而不是盖在步骤内部。
  return <Box flexDirection="column">
      <WelcomeV2 />
      <Box flexDirection="column" marginTop={1}>
        {currentStep?.component}
        {exitState.pending && <Box padding={1}>
            <Text dimColor>Press {exitState.keyName} again to exit</Text>
          </Box>}
      </Box>
    </Box>;
}
// 可跳过步骤包装器：挂载时若 skip 为真就调用 onSkip 跳过，并且不渲染 children。编译器把回调抽成了 memo 槽位。
export function SkippableStep(t0) {
  const $ = _c(4);
  const {
    skip,
    onSkip,
    children
  } = t0;
  let t1;
  let t2;
// React Compiler 的记忆槽：onSkip 或 skip 变化时才重建 effect 回调与依赖数组，否则复用缓存里的旧值。
  if ($[0] !== onSkip || $[1] !== skip) {
    t1 = () => {
      if (skip) {
        onSkip();
      }
    };
    t2 = [skip, onSkip];
    $[0] = onSkip;
    $[1] = skip;
    $[2] = t1;
    $[3] = t2;
  } else {
    t1 = $[2];
    t2 = $[3];
  }
// effect 的回调和依赖数组都来自槽位，等价于 useEffect(回调, [skip, onSkip])。
  useEffect(t1, t2);
// skip 时除了触发 onSkip 还要保证自己渲染为 null——但 onSkip 已经推进了步骤，正常不会走到这里渲染，这是兜底。
  if (skip) {
    return null;
  }
  return children;
}
// 原文件此处有一行 23188 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。