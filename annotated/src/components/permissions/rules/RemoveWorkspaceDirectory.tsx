import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useCallback } from 'react';
import { Select } from '../../../components/CustomSelect/select.js';
import { Box, Text } from '../../../ink.js';
import type { ToolPermissionContext } from '../../../Tool.js';
import { applyPermissionUpdate } from '../../../utils/permissions/PermissionUpdate.js';
import { Dialog } from '../../design-system/Dialog.js';
type Props = {
  directoryPath: string;
  onRemove: () => void;
  onCancel: () => void;
  permissionContext: ToolPermissionContext;
  setPermissionContext: (context: ToolPermissionContext) => void;
};
// RemoveWorkspaceDirectory：把目录从当前工作区移除的确认弹窗。Dialog 用 error 色——收权操作比授权操作更需要确认。
export function RemoveWorkspaceDirectory(t0) {
  const $ = _c(19);
  const {
    directoryPath,
    onRemove,
    onCancel,
    permissionContext,
    setPermissionContext
  } = t0;
  let t1;
// handleRemove 记忆化依赖四值：核心是 applyPermissionUpdate 的 removeDirectories 更新，destination 为 session——移除只影响本会话的权限上下文，磁盘上的设置文件不动，重启会话后目录不会自动回来。
  if ($[0] !== directoryPath || $[1] !== onRemove || $[2] !== permissionContext || $[3] !== setPermissionContext) {
    t1 = () => {
      const updatedContext = applyPermissionUpdate(permissionContext, {
        type: "removeDirectories",
        directories: [directoryPath],
        destination: "session"
      });
      setPermissionContext(updatedContext);
      onRemove();
    };
    $[0] = directoryPath;
    $[1] = onRemove;
    $[2] = permissionContext;
    $[3] = setPermissionContext;
    $[4] = t1;
  } else {
    t1 = $[4];
  }
  const handleRemove = t1;
  let t2;
  if ($[5] !== handleRemove || $[6] !== onCancel) {
// handleSelect：只有 yes 走移除，no 与 Esc 都走 onCancel——确认弹窗的非肯定路径一律等价于取消，不留第三态。
    t2 = value => {
      if (value === "yes") {
        handleRemove();
      } else {
        onCancel();
      }
    };
    $[5] = handleRemove;
    $[6] = onCancel;
    $[7] = t2;
  } else {
    t2 = $[7];
  }
  const handleSelect = t2;
  let t3;
// 目录路径加粗单独渲染，依赖路径单值缓存——路径是用户需要核对的关键信息，其余文案全静态。
  if ($[8] !== directoryPath) {
    t3 = <Box marginX={2} flexDirection="column"><Text bold={true}>{directoryPath}</Text></Box>;
    $[8] = directoryPath;
    $[9] = t3;
  } else {
    t3 = $[9];
  }
  let t4;
// 后果说明进常量槽：移除后 Claude 不再能访问该目录下的文件——讲清「移除」的实际含义是收权，不只是从列表里划掉。
  if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Text>Claude Code will no longer have access to files in this directory.</Text>;
    $[10] = t4;
  } else {
    t4 = $[10];
  }
  let t5;
// 选项数组 yes 与 no 进哨兵槽，整个组件生命周期不变。
  if ($[11] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = [{
      label: "Yes",
      value: "yes"
    }, {
      label: "No",
      value: "no"
    }];
    $[11] = t5;
  } else {
    t5 = $[11];
  }
  let t6;
  if ($[12] !== handleSelect || $[13] !== onCancel) {
    t6 = <Select onChange={handleSelect} onCancel={onCancel} options={t5} />;
    $[12] = handleSelect;
    $[13] = onCancel;
    $[14] = t6;
  } else {
    t6 = $[14];
  }
  let t7;
  if ($[15] !== onCancel || $[16] !== t3 || $[17] !== t6) {
    t7 = <Dialog title="Remove directory from workspace?" onCancel={onCancel} color="error">{t3}{t4}{t6}</Dialog>;
    $[15] = onCancel;
    $[16] = t3;
    $[17] = t6;
    $[18] = t7;
  } else {
    t7 = $[18];
  }
  return t7;
}
// 原文件此处有一行 6876 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。