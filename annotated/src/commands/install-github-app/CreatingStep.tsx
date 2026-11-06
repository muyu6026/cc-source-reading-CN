// 安装 GitHub App 向导的「创建中」步骤（React 编译器产物）：根据是否跳过工作流、是否已有密钥等计算进度文案
import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { Box, Text } from '../../ink.js';
import type { Workflow } from './types.js';
// 引入工作流类型
interface CreatingStepProps {
  currentWorkflowInstallStep: number;
  secretExists: boolean;
  useExistingSecret: boolean;
  secretName: string;
  skipWorkflow?: boolean;
  selectedWorkflows: Workflow[];
}
// 组件 Props：当前步骤 / 密钥状态 / 是否跳过工作流 / 选中工作流
export function CreatingStep(t0) {
// 主组件：用 `$` 缓存记忆化各段 JSX
  const $ = _c(10);
  const {
    currentWorkflowInstallStep,
    secretExists,
    useExistingSecret,
    secretName,
    skipWorkflow: t1,
    selectedWorkflows
  } = t0;
  const skipWorkflow = t1 === undefined ? false : t1;
// Brief 布局下 padding 归零
  let t2;
  if ($[0] !== secretExists || $[1] !== secretName || $[2] !== selectedWorkflows || $[3] !== skipWorkflow || $[4] !== useExistingSecret) {
// 按条件计算进度步骤文案数组（跳过工作流 vs 完整流程）
    t2 = skipWorkflow ? ["Getting repository information", secretExists && useExistingSecret ? "Using existing API key secret" : `Setting up ${secretName} secret`] : ["Getting repository information", "Creating branch", selectedWorkflows.length > 1 ? "Creating workflow files" : "Creating workflow file", secretExists && useExistingSecret ? "Using existing API key secret" : `Setting up ${secretName} secret`, "Opening pull request page"];
    $[0] = secretExists;
    $[1] = secretName;
    $[2] = selectedWorkflows;
    $[3] = skipWorkflow;
    $[4] = useExistingSecret;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  const progressSteps = t2;
// progressSteps 绑定到计算结果
  let t3;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Box flexDirection="column" marginBottom={1}><Text bold={true}>Install GitHub App</Text><Text dimColor={true}>Create GitHub Actions workflow</Text></Box>;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  let t4;
// t4：以带圆角边框的盒子包裹标题与进度步骤
  if ($[7] !== currentWorkflowInstallStep || $[8] !== progressSteps) {
    t4 = <><Box flexDirection="column" borderStyle="round" paddingX={1}>{t3}{progressSteps.map((stepText, index) => {
          let status = "pending";
          if (index < currentWorkflowInstallStep) {
            status = "completed";
          } else {
            if (index === currentWorkflowInstallStep) {
              status = "in-progress";
            }
          }
          return <Box key={index}><Text color={status === "completed" ? "success" : status === "in-progress" ? "warning" : undefined}>{status === "completed" ? "\u2713 " : ""}{stepText}{status === "in-progress" ? "\u2026" : ""}</Text></Box>;
        })}</Box></>;
    $[7] = currentWorkflowInstallStep;
    $[8] = progressSteps;
    $[9] = t4;
  } else {
    t4 = $[9];
  }
  return t4;
// 返回汇总的进度面板 JSX
}
// 原文件此处有一行 6716 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。