// React Compiler 运行时入口，本文件由编译器生成。
import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import * as React from 'react';
import { useState } from 'react';
import type { Root } from '../ink.js';
import { Box, Text, useAnimationFrame } from '../ink.js';
import { AppStateProvider } from '../state/AppState.js';
// 从 `../utils/teleport.js` 引入远端会话「传送（teleport）」相关的几个核心函数：分支检出、日志处理、恢复会话等。
import { checkOutTeleportedSessionBranch, processMessagesForTeleportResume, type TeleportProgressStep, type TeleportResult, teleportResumeCodeSession } from '../utils/teleport.js';
type Props = {
  currentStep: TeleportProgressStep;
  sessionId?: string;
};
// SPINNER_FRAMES 是四帧旋转字符，配合下面按时间取模来做出终端里的转圈动画。
const SPINNER_FRAMES = ['◐', '◓', '◑', '◒'];
// STEPS 定义传送的四个阶段：校验会话、拉取日志、拉取分支、检出分支。顺序即进度条的先后顺序。
const STEPS: {
  key: TeleportProgressStep;
  label: string;
}[] = [{
  key: 'validating',
  label: 'Validating session'
}, {
  key: 'fetching_logs',
  label: 'Fetching session logs'
}, {
  key: 'fetching_branch',
  label: 'Getting branch info'
}, {
  key: 'checking_out',
  label: 'Checking out branch'
}];
// TeleportProgress 只负责把「传送进度」渲染成终端 UI，真正的异步工作在外面 `teleportWithProgress` 里完成。
export function TeleportProgress(t0) {
// `_c(16)` 申请 16 个编译器记忆槽位，用于记忆帧动画、步骤索引与各段 JSX。
  const $ = _c(16);
  const {
    currentStep,
    sessionId
  } = t0;
// `useAnimationFrame(100)` 每 100 毫秒回调一次，返回的 `time` 驱动 spinner 动画与进度刷新。
  const [ref, time] = useAnimationFrame(100);
// `frame` 用 elapsed 时间整除 100 再对帧数取模，得到当前该显示哪一帧旋转字符。
  const frame = Math.floor(time / 100) % SPINNER_FRAMES.length;
  let t1;
  if ($[0] !== currentStep) {
    t1 = s => s.key === currentStep;
    $[0] = currentStep;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
// 在 STEPS 里找到当前步骤的下标，用来区分「已完成 / 进行中 / 待处理」三种状态。
  const currentStepIndex = STEPS.findIndex(t1);
  const t2 = SPINNER_FRAMES[frame];
  let t3;
  if ($[2] !== t2) {
    t3 = <Box marginBottom={1}><Text bold={true} color="claude">{t2} Teleporting session…</Text></Box>;
    $[2] = t2;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  let t4;
  if ($[4] !== sessionId) {
    t4 = sessionId && <Box marginBottom={1}><Text dimColor={true}>{sessionId}</Text></Box>;
    $[4] = sessionId;
    $[5] = t4;
  } else {
    t4 = $[5];
  }
// 把每个步骤映射成一行：已完成的打勾、进行中的用 spinner 帧、其余用空心圆，并据此决定颜色与暗显。
  let t5;
  if ($[6] !== currentStepIndex || $[7] !== frame) {
    t5 = STEPS.map((step, index) => {
      const isComplete = index < currentStepIndex;
      const isCurrent = index === currentStepIndex;
      const isPending = index > currentStepIndex;
      let icon;
      let color;
      if (isComplete) {
        icon = figures.tick;
        color = "green";
      } else {
        if (isCurrent) {
          icon = SPINNER_FRAMES[frame];
          color = "claude";
        } else {
          icon = figures.circle;
          color = undefined;
        }
      }
      return <Box key={step.key} flexDirection="row"><Box width={2}><Text color={color as never} dimColor={isPending}>{icon}</Text></Box><Text dimColor={isPending} bold={isCurrent}>{step.label}</Text></Box>;
    });
    $[6] = currentStepIndex;
    $[7] = frame;
    $[8] = t5;
  } else {
    t5 = $[8];
  }
  let t6;
  if ($[9] !== t5) {
    t6 = <Box flexDirection="column" marginLeft={2}>{t5}</Box>;
    $[9] = t5;
    $[10] = t6;
  } else {
    t6 = $[10];
  }
  let t7;
  if ($[11] !== ref || $[12] !== t3 || $[13] !== t4 || $[14] !== t6) {
    t7 = <Box ref={ref} flexDirection="column" paddingX={1} paddingY={1}>{t3}{t4}{t6}</Box>;
    $[11] = ref;
    $[12] = t3;
    $[13] = t4;
    $[14] = t6;
    $[15] = t7;
  } else {
    t7 = $[15];
  }
  return t7;
}

/**
 * Teleports to a remote session with progress UI rendered into the existing root.
 * Fetches the session, checks out the branch, and returns the result.
 */
export async function teleportWithProgress(root: Root, sessionId: string): Promise<TeleportResult> {
  // Capture the setState function from the rendered component
  let setStep: (step: TeleportProgressStep) => void = () => {};
// TeleportProgressWrapper 把「命令式 setState」桥接进 React 树：外层异步函数通过 `setStep` 把进度推进给这个组件。
  function TeleportProgressWrapper(): React.ReactNode {
    const [step, _setStep] = useState<TeleportProgressStep>('validating');
    setStep = _setStep;
    return <TeleportProgress currentStep={step} sessionId={sessionId} />;
  }
// `root.render` 把 Provider 与包装组件挂到已存在的根上，实现「在现有界面里原地渲染进度」。
  root.render(<AppStateProvider>
      <TeleportProgressWrapper />
    </AppStateProvider>);
// `teleportResumeCodeSession` 才是真正的异步恢复工作，并把 `setStep` 作为进度回调传入。
  const result = await teleportResumeCodeSession(sessionId, setStep);
  setStep('checking_out');
// 恢复完成后检出分支，再把日志加工成可回放的消息并返回分支名。
  const {
    branchName,
    branchError
  } = await checkOutTeleportedSessionBranch(result.branch);
  return {
    messages: processMessagesForTeleportResume(result.log, branchError),
    branchName
  };
}
// 原文件此处有一行 12020 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。