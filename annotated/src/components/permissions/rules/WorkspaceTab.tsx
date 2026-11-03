import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import * as React from 'react';
import { useCallback, useEffect } from 'react';
import { getOriginalCwd } from '../../../bootstrap/state.js';
import type { CommandResultDisplay } from '../../../commands.js';
import { Select } from '../../../components/CustomSelect/select.js';
import { Box, Text } from '../../../ink.js';
import type { ToolPermissionContext } from '../../../Tool.js';
import { useTabHeaderFocus } from '../../design-system/Tabs.js';
type Props = {
  onExit: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  toolPermissionContext: ToolPermissionContext;
  onRequestAddDirectory: () => void;
  onRequestRemoveDirectory: (path: string) => void;
  onHeaderFocusChange?: (focused: boolean) => void;
};
type DirectoryItem = {
  path: string;
  isCurrent: boolean;
  isDeletable: boolean;
};
// 权限设置里的「工作目录」标签页：列出当前额外工作目录，支持新增或删除某个目录
export function WorkspaceTab(t0) {
  const $ = _c(23);
  const {
    onExit,
    toolPermissionContext,
    onRequestAddDirectory,
    onRequestRemoveDirectory,
    onHeaderFocusChange
  } = t0;
  const {
    headerFocused,
    focusHeader
  } = useTabHeaderFocus();
// 复用标签页头聚焦 hook：拿到 `headerFocused` 与 `focusHeader`，用于在表头与列表间上下切换焦点
  let t1;
  let t2;
  if ($[0] !== headerFocused || $[1] !== onHeaderFocusChange) {
    t1 = () => {
      onHeaderFocusChange?.(headerFocused);
    };
    t2 = [headerFocused, onHeaderFocusChange];
    $[0] = headerFocused;
    $[1] = onHeaderFocusChange;
    $[2] = t1;
    $[3] = t2;
  } else {
    t1 = $[2];
    t2 = $[3];
  }
  useEffect(t1, t2);
// 头部聚焦状态变化时回调上层 `onHeaderFocusChange`，让外部感知当前焦点在表头还是列表
  let t3;
  if ($[4] !== toolPermissionContext.additionalWorkingDirectories) {
    t3 = Array.from(toolPermissionContext.additionalWorkingDirectories.keys()).map(_temp);
// 从权限上下文取出所有额外工作目录的键集合，再映射成目录项（含是否可删除标记）
    $[4] = toolPermissionContext.additionalWorkingDirectories;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  const additionalDirectories = t3;
  let t4;
  if ($[6] !== additionalDirectories || $[7] !== onRequestAddDirectory || $[8] !== onRequestRemoveDirectory) {
    t4 = selectedValue => {
      if (selectedValue === "add-directory") {
// 选择处理：选 `add-directory` 触发新增；否则在目录表里找对应项，仅当可删除才调用删除回调
        onRequestAddDirectory();
        return;
      }
      const directory = additionalDirectories.find(d => d.path === selectedValue);
      if (directory && directory.isDeletable) {
        onRequestRemoveDirectory(directory.path);
      }
    };
    $[6] = additionalDirectories;
    $[7] = onRequestAddDirectory;
    $[8] = onRequestRemoveDirectory;
    $[9] = t4;
  } else {
    t4 = $[9];
  }
  const handleDirectorySelect = t4;
  let t5;
  if ($[10] !== onExit) {
    t5 = () => onExit("Workspace dialog dismissed", {
// 取消处理：以「Workspace dialog dismissed」为结果退出，并把展示方式设为 system（系统级提示）
      display: "system"
    });
    $[10] = onExit;
    $[11] = t5;
  } else {
    t5 = $[11];
  }
  const handleCancel = t5;
  let opts;
  if ($[12] !== additionalDirectories) {
    opts = additionalDirectories.map(_temp2);
    let t6;
    if ($[14] === Symbol.for("react.memo_cache_sentinel")) {
      t6 = {
        label: `Add directory${figures.ellipsis}`,
// 列表末尾追加「Add directory…」选项，值固定为 add-directory 以触发新增流程
        value: "add-directory"
      };
      $[14] = t6;
    } else {
      t6 = $[14];
    }
    opts.push(t6);
    $[12] = additionalDirectories;
    $[13] = opts;
  } else {
    opts = $[13];
  }
  const options = opts;
  let t6;
  if ($[15] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = <Box flexDirection="row" marginTop={1} marginLeft={2} gap={1}><Text>{`-  ${getOriginalCwd()}`}</Text><Text dimColor={true}>(Original working directory)</Text></Box>;
// 首行展示原始工作目录 `getOriginalCwd()`，并标注其为「原始工作目录」不可删除
    $[15] = t6;
  } else {
    t6 = $[15];
  }
  const t7 = Math.min(10, options.length);
// 可见选项数上限取 10 与列表长度的小者，目录过多时只露出前 10 项
  let t8;
  if ($[16] !== focusHeader || $[17] !== handleCancel || $[18] !== handleDirectorySelect || $[19] !== headerFocused || $[20] !== options || $[21] !== t7) {
    t8 = <Box flexDirection="column" marginBottom={1}>{t6}<Select options={options} onChange={handleDirectorySelect} onCancel={handleCancel} visibleOptionCount={t7} onUpFromFirstItem={focusHeader} isDisabled={headerFocused} /></Box>;
    $[16] = focusHeader;
    $[17] = handleCancel;
    $[18] = handleDirectorySelect;
    $[19] = headerFocused;
    $[20] = options;
    $[21] = t7;
    $[22] = t8;
  } else {
    t8 = $[22];
  }
  return t8;
}
function _temp2(dir) {
  return {
    label: dir.path,
    value: dir.path
  };
}
function _temp(path) {
  return {
    path,
    isCurrent: false,
    isDeletable: true
  };
}
// 原文件此处有一行 10888 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。