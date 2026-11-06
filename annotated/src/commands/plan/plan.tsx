// React 编译器产物：PlanDisplay 被编译成带 _c(n) 缓存槽的纯函数，槽位比较条件就是依赖数组
import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { handlePlanModeTransition } from '../../bootstrap/state.js';
import type { LocalJSXCommandContext } from '../../commands.js';
import { Box, Text } from '../../ink.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { getExternalEditor } from '../../utils/editor.js';
import { toIDEDisplayName } from '../../utils/ide.js';
import { applyPermissionUpdate } from '../../utils/permissions/PermissionUpdate.js';
import { prepareContextForPlanMode } from '../../utils/permissions/permissionSetup.js';
import { getPlan, getPlanFilePath } from '../../utils/plans.js';
import { editFileInEditor } from '../../utils/promptEditor.js';
import { renderToString } from '../../utils/staticRender.js';
// 计划展示组件（编译器产物）：四个文本片段各自记忆化，依赖变化才重算
function PlanDisplay(t0) {
  const $ = _c(11);
  const {
    planContent,
    planPath,
    editorName
  } = t0;
  let t1;
// 槽位首次命中哨兵值时构建 Current Plan 标题；之后直接复用，不再重建
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Text bold={true}>Current Plan</Text>;
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  let t2;
  if ($[1] !== planPath) {
    t2 = <Text dimColor={true}>{planPath}</Text>;
    $[1] = planPath;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] !== planContent) {
    t3 = <Box marginTop={1}><Text>{planContent}</Text></Box>;
    $[3] = planContent;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] !== editorName) {
    t4 = editorName && <Box marginTop={1}><Text dimColor={true}>"/plan open"</Text><Text dimColor={true}> to edit this plan in </Text><Text bold={true} dimColor={true}>{editorName}</Text></Box>;
    $[5] = editorName;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
// 三个片段任一变化才重排外层 Box：这是编译器把父节点依赖求和优化出来的判断
  if ($[7] !== t2 || $[8] !== t3 || $[9] !== t4) {
    t5 = <Box flexDirection="column">{t1}{t2}{t3}{t4}</Box>;
    $[7] = t2;
    $[8] = t3;
    $[9] = t4;
    $[10] = t5;
  } else {
    t5 = $[10];
  }
  return t5;
}
// 命令主入口：先拿当前 AppState 判断处于哪种模式，再决定启用计划还是展示计划
export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext, args: string): Promise<React.ReactNode> {
  const {
    getAppState,
    setAppState
  } = context;
  const appState = getAppState();
  const currentMode = appState.toolPermissionContext.mode;

// 非计划模式时先切到 plan：改写权限上下文并把模式目标标成会话级
  // If not in plan mode, enable it
  if (currentMode !== 'plan') {
    handlePlanModeTransition(currentMode, 'plan');
    setAppState(prev => ({
      ...prev,
      toolPermissionContext: applyPermissionUpdate(prepareContextForPlanMode(prev.toolPermissionContext), {
        type: 'setMode',
        mode: 'plan',
        destination: 'session'
      })
    }));
    const description = args.trim();
    if (description && description !== 'open') {
      onDone('Enabled plan mode', {
        shouldQuery: true
      });
    } else {
      onDone('Enabled plan mode');
    }
    return null;
  }

// 已在计划模式：读已写好的计划文件，没有就提示还没写
  // Already in plan mode - show the current plan
  const planContent = getPlan();
  const planPath = getPlanFilePath();
  if (!planContent) {
    onDone('Already in plan mode. No plan written yet.');
    return null;
  }

// 解析参数：带 open 就调外部编辑器打开计划文件，否则渲染成字符串交给 onDone
  // If user typed "/plan open", open in editor
  const argList = args.trim().split(/\s+/);
  if (argList[0] === 'open') {
    const result = await editFileInEditor(planPath);
    if (result.error) {
      onDone(`Failed to open plan in editor: ${result.error}`);
    } else {
      onDone(`Opened plan in editor: ${planPath}`);
    }
    return null;
  }
  const editor = getExternalEditor();
  const editorName = editor ? toIDEDisplayName(editor) : undefined;
  const display = <PlanDisplay planContent={planContent} planPath={planPath} editorName={editorName} />;

// 复用本地命令的渲染路径：把 React 节点渲染成字符串回传，而不是自己画界面
  // Render to string and pass to onDone like local commands do
  const output = await renderToString(display);
  onDone(output);
  return null;
}
// 原文件此处有一行 10148 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。