import { c as _c } from "react/compiler-runtime";
import { relative } from 'path';
import React from 'react';
import { Box, Text } from '../ink.js';
import { DiagnosticTrackingService } from '../services/diagnosticTracking.js';
import type { Attachment } from '../utils/attachments.js';
import { getCwd } from '../utils/cwd.js';
import { CtrlOToExpand } from './CtrlOToExpand.js';
import { MessageResponse } from './MessageResponse.js';
type DiagnosticsAttachment = Extract<Attachment, {
  type: 'diagnostics';
}>;
type DiagnosticsDisplayProps = {
  attachment: DiagnosticsAttachment;
  verbose: boolean;
};
// 诊断信息附件展示：verbose 模式逐文件逐条列出，精简模式只报一行汇总
export function DiagnosticsDisplay(t0) {
  const $ = _c(14);
  const {
    attachment,
    verbose
  } = t0;
  if (attachment.files.length === 0) {
// 无诊断文件直接返回 null——注释写明 Only show if there are diagnostics to report
    return null;
  }
  let t1;
  if ($[0] !== attachment.files) {
    t1 = attachment.files.reduce(_temp, 0);
// reduce 求总问题数：_temp 累加每个文件的 diagnostics.length
    $[0] = attachment.files;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const totalIssues = t1;
  const fileCount = attachment.files.length;
// verbose 分支：逐文件渲染（路径加粗 + 协议来源标注），每条诊断单独一行
  if (verbose) {
    let t2;
    if ($[2] !== attachment.files) {
      t2 = attachment.files.map(_temp3);
      $[2] = attachment.files;
      $[3] = t2;
    } else {
      t2 = $[3];
    }
    let t3;
    if ($[4] !== t2) {
      t3 = <Box flexDirection="column">{t2}</Box>;
      $[4] = t2;
      $[5] = t3;
    } else {
      t3 = $[5];
    }
    return t3;
  } else {
    let t2;
    if ($[6] !== totalIssues) {
      t2 = <Text bold={true}>{totalIssues}</Text>;
      $[6] = totalIssues;
      $[7] = t2;
    } else {
      t2 = $[7];
    }
    const t3 = totalIssues === 1 ? "issue" : "issues";
// 单复数：issue/issues 与 file/files 双重处理
    const t4 = fileCount === 1 ? "file" : "files";
    let t5;
    if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
      t5 = <CtrlOToExpand />;
// CtrlOToExpand 提示用户可展开看详情——精简模式的出口
      $[8] = t5;
    } else {
      t5 = $[8];
    }
    let t6;
    if ($[9] !== fileCount || $[10] !== t2 || $[11] !== t3 || $[12] !== t4) {
      t6 = <MessageResponse><Text dimColor={true} wrap="wrap">Found {t2} new diagnostic{" "}{t3} in {fileCount}{" "}{t4} {t5}</Text></MessageResponse>;
      $[9] = fileCount;
      $[10] = t2;
      $[11] = t3;
      $[12] = t4;
      $[13] = t6;
    } else {
      t6 = $[13];
    }
    return t6;
  }
}
function _temp3(file_0, fileIndex) {
  return <React.Fragment key={fileIndex}><MessageResponse><Text dimColor={true} wrap="wrap"><Text bold={true}>{relative(getCwd(), file_0.uri.replace("file://", "").replace("_claude_fs_right:", ""))}</Text>{" "}<Text dimColor={true}>{file_0.uri.startsWith("file://") ? "(file://)" : file_0.uri.startsWith("_claude_fs_right:") ? "(claude_fs_right)" : `(${file_0.uri.split(":")[0]})`}</Text>:</Text></MessageResponse>{file_0.diagnostics.map(_temp2)}</React.Fragment>;
// 文件路径三段处理：去掉 file:// 与 _claude_fs_right: 前缀，再 relative 到 cwd 得短路径；协议标注从 URI 前缀推断（file:// 或 claude_fs_right 或取冒号前的 scheme）
}
function _temp2(diagnostic, diagIndex) {
  return <MessageResponse key={diagIndex}><Text dimColor={true} wrap="wrap">{"  "}{DiagnosticTrackingService.getSeveritySymbol(diagnostic.severity)}{" [Line "}{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}{"] "}{diagnostic.message}{diagnostic.code ? ` [${diagnostic.code}]` : ""}{diagnostic.source ? ` (${diagnostic.source})` : ""}</Text></MessageResponse>;
// 诊断条目格式：缩进 + severity 符号 + [Line 行:列]（0 基转 1 基）+ 消息 + 可选 [code] 与 (source)
}
// _temp 即求和 reducer：(sum, file)=sum+file.diagnostics.length
function _temp(sum, file) {
  return sum + file.diagnostics.length;
}
// 原文件此处有一行 10004 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。