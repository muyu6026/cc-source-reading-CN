import { c as _c } from "react/compiler-runtime";
// FileWritePermissionRequest 是文件写入前的权限确认弹窗：判断是新建还是覆盖，展示差异预览，并把选择交给通用 FilePermissionDialog。
import { basename, relative } from 'path';
import React, { useMemo } from 'react';
import type { z } from 'zod/v4';
import { Text } from '../../../ink.js';
import { FileWriteTool } from '../../../tools/FileWriteTool/FileWriteTool.js';
import { getCwd } from '../../../utils/cwd.js';
import { isENOENT } from '../../../utils/errors.js';
import { readFileSync } from '../../../utils/fileRead.js';
import { FilePermissionDialog } from '../FilePermissionDialog/FilePermissionDialog.js';
import { createSingleEditDiffConfig, type FileEdit, type IDEDiffSupport } from '../FilePermissionDialog/ideDiffConfig.js';
import type { PermissionRequestProps } from '../PermissionRequest.js';
import { FileWriteToolDiff } from './FileWriteToolDiff.js';
type FileWriteToolInput = z.infer<typeof FileWriteTool.inputSchema>;
// FileWriteToolInput 是从 FileWriteTool.inputSchema 推断出的输入类型。
const ideDiffSupport: IDEDiffSupport<FileWriteToolInput> = {
  getConfig: (input: FileWriteToolInput) => {
    let oldContent: string;
    try {
      oldContent = readFileSync(input.file_path);
    } catch (e) {
      if (!isENOENT(e)) throw e;
      oldContent = '';
    }
    return createSingleEditDiffConfig(input.file_path, oldContent, input.content, false // For file writes, we replace the entire content
    );
  },
  applyChanges: (input: FileWriteToolInput, modifiedEdits: FileEdit[]) => {
    const firstEdit = modifiedEdits[0];
    if (firstEdit) {
      return {
        ...input,
        content: firstEdit.new_string
      };
    }
    return input;
  }
};
// ideDiffSupport 描述如何生成和应用 IDE 差异：getConfig 读取旧内容（文件不存在就当空串），生成单文件整文替换的差异配置；applyChanges 取第一条编辑的新内容作为最终写入内容。
export function FileWritePermissionRequest(props) {
  const $ = _c(30);
  const parseInput = _temp;
  let t0;
  if ($[0] !== props.toolUseConfirm.input) {
    t0 = parseInput(props.toolUseConfirm.input);
    $[0] = props.toolUseConfirm.input;
    $[1] = t0;
  } else {
    t0 = $[1];
  }
  const parsed = t0;
// 组件先解析工具输入得到 parsed，再解构出 file_path 和 content。
  const {
    file_path,
    content
  } = parsed;
  let t1;
  if ($[2] !== file_path) {
    ;
    try {
      t1 = {
        fileExists: true,
        oldContent: readFileSync(file_path)
      };
    } catch (t2) {
      const e = t2;
      if (!isENOENT(e)) {
        throw e;
      }
      let t3;
      if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
        t3 = {
          fileExists: false,
          oldContent: ""
        };
        $[4] = t3;
      } else {
        t3 = $[4];
      }
      t1 = t3;
    }
    $[2] = file_path;
    $[3] = t1;
  } else {
    t1 = $[3];
  }
// 通过尝试 readFileSync 判断文件是否存在：ENOENT 异常被吞掉当成不存在（旧内容空串），其他异常照常抛出。
  const {
    fileExists,
    oldContent
  } = t1;
  const actionText = fileExists ? "overwrite" : "create";
// actionText 按文件是否存在取 overwrite 或 create，标题随之取 Overwrite file / Create file。
  const t2 = props.toolUseConfirm;
  const t3 = props.toolUseContext;
  const t4 = props.onDone;
  const t5 = props.onReject;
  const t6 = props.workerBadge;
  const t7 = fileExists ? "Overwrite file" : "Create file";
  let t8;
  if ($[5] !== file_path) {
    t8 = relative(getCwd(), file_path);
    $[5] = file_path;
    $[6] = t8;
  } else {
    t8 = $[6];
  }
// 用 relative 算相对 cwd 的路径作为副标题，basename 取文件名用于问句加粗。
  let t9;
  if ($[7] !== file_path) {
    t9 = basename(file_path);
    $[7] = file_path;
    $[8] = t9;
  } else {
    t9 = $[8];
  }
// 把文件名用 basename 取出并加粗，作为问句里的主角。
  let t10;
  if ($[9] !== t9) {
    t10 = <Text bold={true}>{t9}</Text>;
    $[9] = t9;
    $[10] = t10;
  } else {
    t10 = $[10];
  }
  let t11;
  if ($[11] !== actionText || $[12] !== t10) {
    t11 = <Text>Do you want to {actionText} {t10}?</Text>;
    $[11] = actionText;
    $[12] = t10;
    $[13] = t11;
  } else {
    t11 = $[13];
  }
// 问句 Do you want to <动作> <文件名>? 拼好。
  let t12;
  if ($[14] !== content || $[15] !== fileExists || $[16] !== file_path || $[17] !== oldContent) {
    t12 = <FileWriteToolDiff file_path={file_path} content={content} fileExists={fileExists} oldContent={oldContent} />;
    $[14] = content;
    $[15] = fileExists;
    $[16] = file_path;
    $[17] = oldContent;
    $[18] = t12;
  } else {
    t12 = $[18];
  }
// content 差异预览交给 FileWriteToolDiff，按是否覆盖传入旧内容。
  let t13;
  if ($[19] !== file_path || $[20] !== props.onDone || $[21] !== props.onReject || $[22] !== props.toolUseConfirm || $[23] !== props.toolUseContext || $[24] !== props.workerBadge || $[25] !== t11 || $[26] !== t12 || $[27] !== t7 || $[28] !== t8) {
    t13 = <FilePermissionDialog toolUseConfirm={t2} toolUseContext={t3} onDone={t4} onReject={t5} workerBadge={t6} title={t7} subtitle={t8} question={t11} content={t12} path={file_path} completionType="write_file_single" parseInput={parseInput} ideDiffSupport={ideDiffSupport} />;
    $[19] = file_path;
    $[20] = props.onDone;
    $[21] = props.onReject;
    $[22] = props.toolUseConfirm;
    $[23] = props.toolUseContext;
    $[24] = props.workerBadge;
    $[25] = t11;
    $[26] = t12;
    $[27] = t7;
    $[28] = t8;
    $[29] = t13;
  } else {
    t13 = $[29];
  }
// 把所有字段（标题、问句、差异、路径、完成类型 write_file_single、解析函数、IDE 差异支持）交给通用 FilePermissionDialog 渲染。
  return t13;
// 组件返回拼装好的权限对话框。
}
function _temp(input) {
  return FileWriteTool.inputSchema.parse(input);
}
// _temp 直接调用 FileWriteTool.inputSchema.parse 解析输入（严格模式，失败会抛错）。
// 原文件此处有一行 11852 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。