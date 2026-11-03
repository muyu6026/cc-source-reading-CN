import { c as _c } from "react/compiler-runtime";
// 导入差异计算所需的类型与工具函数
import type { StructuredPatchHunk } from 'diff';
import * as React from 'react';
import { Suspense, use, useState } from 'react';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { Box, Text } from '../ink.js';
import type { FileEdit } from '../tools/FileEditTool/types.js';
import { findActualString, preserveQuoteStyle } from '../tools/FileEditTool/utils.js';
import { adjustHunkLineNumbers, CONTEXT_LINES, getPatchForDisplay } from '../utils/diff.js';
import { logError } from '../utils/log.js';
import { CHUNK_SIZE, openForScan, readCapped, scanForContext } from '../utils/readEditContext.js';
import { firstLineOf } from '../utils/stringUtils.js';
import { StructuredDiffList } from './StructuredDiffList.js';
type Props = {
// 组件属性：文件路径与一组编辑
  file_path: string;
  edits: FileEdit[];
};
type DiffData = {
// 差异数据：补丁、首行、文件内容
  patch: StructuredPatchHunk[];
  firstLine: string | null;
  fileContent: string | undefined;
};
export function FileEditToolDiff(props) {
// 文件编辑差异预览主组件
  const $ = _c(7);
  let t0;
  if ($[0] !== props.edits || $[1] !== props.file_path) {
    t0 = () => loadDiffData(props.file_path, props.edits);
    $[0] = props.edits;
    $[1] = props.file_path;
    $[2] = t0;
  } else {
    t0 = $[2];
  }
  const [dataPromise] = useState(t0);
// 用 useState 惰性初始化数据加载的 Promise
  let t1;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <DiffFrame placeholder={true} />;
    $[3] = t1;
  } else {
    t1 = $[3];
  }
  let t2;
  if ($[4] !== dataPromise || $[5] !== props.file_path) {
    t2 = <Suspense fallback={t1}><DiffBody promise={dataPromise} file_path={props.file_path} /></Suspense>;
// 以 Suspense 包裹差异主体，加载时显示占位
    $[4] = dataPromise;
    $[5] = props.file_path;
    $[6] = t2;
  } else {
    t2 = $[6];
  }
  return t2;
}
function DiffBody(t0) {
// 差异主体组件，消费 Promise 并渲染结构化 diff 列表
  const $ = _c(6);
  const {
    promise,
    file_path
  } = t0;
  const {
    patch,
    firstLine,
    fileContent
  } = use(promise);
// use 读取 Promise 结果（React 并发特性）
  const {
    columns
  } = useTerminalSize();
  let t1;
  if ($[0] !== columns || $[1] !== fileContent || $[2] !== file_path || $[3] !== firstLine || $[4] !== patch) {
    t1 = <DiffFrame><StructuredDiffList hunks={patch} dim={false} width={columns} filePath={file_path} firstLine={firstLine} fileContent={fileContent} /></DiffFrame>;
    $[0] = columns;
    $[1] = fileContent;
    $[2] = file_path;
    $[3] = firstLine;
    $[4] = patch;
    $[5] = t1;
  } else {
    t1 = $[5];
  }
  return t1;
}
function DiffFrame(t0) {
// 差异外框组件，占位时显示省略号否则渲染子节点
  const $ = _c(5);
  const {
    children,
    placeholder
  } = t0;
  let t1;
  if ($[0] !== children || $[1] !== placeholder) {
    t1 = placeholder ? <Text dimColor={true}>…</Text> : children;
    $[0] = children;
    $[1] = placeholder;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  let t2;
  if ($[3] !== t1) {
    t2 = <Box flexDirection="column"><Box borderColor="subtle" borderStyle="dashed" flexDirection="column" borderLeft={false} borderRight={false}>{t1}</Box></Box>;
    $[3] = t1;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  return t2;
}
async function loadDiffData(file_path: string, edits: FileEdit[]): Promise<DiffData> {
// 异步加载差异数据，依据编辑规模选择读取策略
  const valid = edits.filter(e => e.old_string != null && e.new_string != null);
  const single = valid.length === 1 ? valid[0]! : undefined;

  // SedEditPermissionRequest passes the entire file as old_string. Scanning for
  // a needle ≥ CHUNK_SIZE allocates O(needle) for the overlap buffer — skip the
  // file read entirely and diff the inputs we already have.
  if (single && single.old_string.length >= CHUNK_SIZE) {
// 若单条编辑的旧串超长，直接对输入做 diff 跳过整文件读取
    return diffToolInputsOnly(file_path, [single]);
  }
  try {
    const handle = await openForScan(file_path);
// 尝试打开文件以供扫描上下文
    if (handle === null) return diffToolInputsOnly(file_path, valid);
    try {
      // Multi-edit and empty old_string genuinely need full-file for sequential
      // replacements — structuredPatch needs before/after strings. replace_all
      // routes through the chunked path below (shows first-occurrence window;
      // matches within the slice still replace via edit.replace_all).
      if (!single || single.old_string === '') {
// 多编辑或空旧串需整文件内容以顺序替换
        const file = await readCapped(handle);
        if (file === null) return diffToolInputsOnly(file_path, valid);
        const normalized = valid.map(e => normalizeEdit(file, e));
        return {
          patch: getPatchForDisplay({
            filePath: file_path,
            fileContents: file,
            edits: normalized
          }),
          firstLine: firstLineOf(file),
          fileContent: file
        };
      }
      const ctx = await scanForContext(handle, single.old_string, CONTEXT_LINES);
// 单编辑且有旧串时仅扫描局部上下文窗口
      if (ctx.truncated || ctx.content === '') {
        return diffToolInputsOnly(file_path, [single]);
      }
      const normalized = normalizeEdit(ctx.content, single);
      const hunks = getPatchForDisplay({
        filePath: file_path,
        fileContents: ctx.content,
        edits: [normalized]
      });
      return {
        patch: adjustHunkLineNumbers(hunks, ctx.lineOffset - 1),
// 按上下文偏移量校正 hunk 行号
        firstLine: ctx.lineOffset === 1 ? firstLineOf(ctx.content) : null,
        fileContent: ctx.content
      };
    } finally {
      await handle.close();
    }
  } catch (e) {
    logError(e as Error);
    return diffToolInputsOnly(file_path, valid);
  }
}
function diffToolInputsOnly(filePath: string, edits: FileEdit[]): DiffData {
// 仅依据工具输入生成 diff，无文件内容
  return {
    patch: edits.flatMap(e => getPatchForDisplay({
      filePath,
      fileContents: e.old_string,
      edits: [e]
    })),
    firstLine: null,
    fileContent: undefined
  };
}
function normalizeEdit(fileContent: string, edit: FileEdit): FileEdit {
// 将编辑中的旧串归一化为文件中实际字符串并保留引号风格
  const actualOld = findActualString(fileContent, edit.old_string) || edit.old_string;
  const actualNew = preserveQuoteStyle(edit.old_string, actualOld, edit.new_string);
  return {
    ...edit,
    old_string: actualOld,
    new_string: actualNew
  };
}
// 原文件此处有一行 16076 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。