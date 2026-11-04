import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { Box, Text, useTheme } from '../../../ink.js';
import { FallbackPermissionRequest } from '../FallbackPermissionRequest.js';
import { FilePermissionDialog } from '../FilePermissionDialog/FilePermissionDialog.js';
import type { ToolInput } from '../FilePermissionDialog/useFilePermissionDialog.js';
import type { PermissionRequestProps, ToolUseConfirm } from '../PermissionRequest.js';
// pathFromToolUse：鸭子类型探测——不检查工具类型，只看它有没有 getPath 函数。调用包在 try 里，工具自己的实现抛错就返回 null，权限弹窗绝不因工具 bug 而崩溃。
function pathFromToolUse(toolUseConfirm: ToolUseConfirm): string | null {
  const tool = toolUseConfirm.tool;
  if ('getPath' in tool && typeof tool.getPath === 'function') {
    try {
      return tool.getPath(toolUseConfirm.input);
    } catch {
      return null;
    }
  }
  return null;
}
// FilesystemPermissionRequest：文件系统类工具（读/写/编辑）的统一权限弹窗入口。按工具能否给出路径分流到文件专用弹窗或通用兜底弹窗。
export function FilesystemPermissionRequest(t0) {
  const $ = _c(30);
  const {
    toolUseConfirm,
    onDone,
    onReject,
    verbose,
    toolUseContext,
    workerBadge
  } = t0;
  const [theme] = useTheme();
  let t1;
// path 与 userFacingName 各自记忆化：路径解析和工具展示名都是纯函数调用，依赖不同的字段就分开缓存。
  if ($[0] !== toolUseConfirm) {
    t1 = pathFromToolUse(toolUseConfirm);
    $[0] = toolUseConfirm;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const path = t1;
  let t2;
  if ($[2] !== toolUseConfirm.input || $[3] !== toolUseConfirm.tool) {
    t2 = toolUseConfirm.tool.userFacingName(toolUseConfirm.input as never);
    $[2] = toolUseConfirm.input;
    $[3] = toolUseConfirm.tool;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  const userFacingName = t2;
// isReadOnly 决定弹窗性质：只读工具标题是 Read file、操作类型 read；可写工具是 Edit file 与 write。同一组件承载读写两类确认，差异全部收进两个派生值。
  const isReadOnly = toolUseConfirm.tool.isReadOnly(toolUseConfirm.input);
  const userFacingReadOrEdit = isReadOnly ? "Read" : "Edit";
  const title = `${userFacingReadOrEdit} file`;
  const parseInput = _temp;
// path 为 null 直接早退到 FallbackPermissionRequest：工具没实现 getPath 就享受不到文件弹窗的路径级规则展示（允许编辑这个文件之类的选项），退回通用三选项。能力探测加优雅降级。
  if (!path) {
    let t3;
    if ($[5] !== onDone || $[6] !== onReject || $[7] !== toolUseConfirm || $[8] !== toolUseContext || $[9] !== verbose || $[10] !== workerBadge) {
      t3 = <FallbackPermissionRequest toolUseConfirm={toolUseConfirm} toolUseContext={toolUseContext} onDone={onDone} onReject={onReject} verbose={verbose} workerBadge={workerBadge} />;
      $[5] = onDone;
      $[6] = onReject;
      $[7] = toolUseConfirm;
      $[8] = toolUseContext;
      $[9] = verbose;
      $[10] = workerBadge;
      $[11] = t3;
    } else {
      t3 = $[11];
    }
    return t3;
  }
  let t3;
  if ($[12] !== theme || $[13] !== toolUseConfirm.input || $[14] !== toolUseConfirm.tool || $[15] !== verbose) {
// renderToolUseMessage：让工具自己渲染参数预览——权限弹窗不认识每个工具的参数结构，只提供主题与 verbose 配置。依赖四个值记忆化。
    t3 = toolUseConfirm.tool.renderToolUseMessage(toolUseConfirm.input as never, {
      theme,
      verbose
    });
    $[12] = theme;
    $[13] = toolUseConfirm.input;
    $[14] = toolUseConfirm.tool;
    $[15] = verbose;
    $[16] = t3;
  } else {
    t3 = $[16];
  }
  let t4;
  if ($[17] !== t3 || $[18] !== userFacingName) {
// content：工具展示名加参数预览，拼成函数调用形态的一行——用户看到的就是即将执行的那次调用本身。
    t4 = <Box flexDirection="column" paddingX={2} paddingY={1}><Text>{userFacingName}({t3})</Text></Box>;
    $[17] = t3;
    $[18] = userFacingName;
    $[19] = t4;
  } else {
    t4 = $[19];
  }
  const content = t4;
  const t5 = isReadOnly ? "read" : "write";
  let t6;
  if ($[20] !== content || $[21] !== onDone || $[22] !== onReject || $[23] !== path || $[24] !== t5 || $[25] !== title || $[26] !== toolUseConfirm || $[27] !== toolUseContext || $[28] !== workerBadge) {
// FilePermissionDialog 承接一切：parseInput 传的是恒等转换 _temp（文件尾定义）——文件弹窗要求的 parseInput 签名在这里无需真正转换。completionType 固定 tool_use_single。
    t6 = <FilePermissionDialog toolUseConfirm={toolUseConfirm} toolUseContext={toolUseContext} onDone={onDone} onReject={onReject} workerBadge={workerBadge} title={title} content={content} path={path} parseInput={parseInput} operationType={t5} completionType="tool_use_single" />;
    $[20] = content;
    $[21] = onDone;
    $[22] = onReject;
    $[23] = path;
    $[24] = t5;
    $[25] = title;
    $[26] = toolUseConfirm;
    $[27] = toolUseContext;
    $[28] = workerBadge;
    $[29] = t6;
  } else {
    t6 = $[29];
  }
  return t6;
}
function _temp(input) {
  return input as ToolInput;
}
// 原文件此处有一行 9312 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。