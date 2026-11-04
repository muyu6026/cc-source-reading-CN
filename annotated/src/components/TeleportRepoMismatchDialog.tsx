import { c as _c } from "react/compiler-runtime";
import React, { useCallback, useState } from 'react';
import { Box, Text } from '../ink.js';
import { getDisplayPath } from '../utils/file.js';
import { removePathFromRepo, validateRepoAtPath } from '../utils/githubRepoPathMapping.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
import { Spinner } from './Spinner.js';
type Props = {
  targetRepo: string;
  initialPaths: string[];
  onSelectPath: (path: string) => void;
  onCancel: () => void;
};
// TeleportRepoMismatchDialog：teleport 目标仓库与当前 checkout 不匹配时，让用户从候选路径里挑正确的本地仓库。三态：候选路径、错误信息、验证中。
export function TeleportRepoMismatchDialog(t0) {
  const $ = _c(18);
  const {
    targetRepo,
    initialPaths,
    onSelectPath,
    onCancel
  } = t0;
  const [availablePaths, setAvailablePaths] = useState(initialPaths);
  const [errorMessage, setErrorMessage] = useState(null);
  const [validating, setValidating] = useState(false);
  let t1;
// handleChange 记忆化依赖四值：cancel 直接退出；否则异步验证所选路径下的仓库是否真的是目标仓库。验证期间换 spinner，期间不可重复选。
  if ($[0] !== availablePaths || $[1] !== onCancel || $[2] !== onSelectPath || $[3] !== targetRepo) {
    t1 = async value => {
      if (value === "cancel") {
        onCancel();
        return;
      }
      setValidating(true);
      setErrorMessage(null);
      const isValid = await validateRepoAtPath(value, targetRepo);
// 验证通过即 onSelectPath 交棒；失败则三连处置：从磁盘映射里持久移除该路径（removePathFromRepo）、从候选列表移除、显示错误提示——坏路径自动淘汰，下次不再出现。
      if (isValid) {
        onSelectPath(value);
        return;
      }
      removePathFromRepo(targetRepo, value);
      const updatedPaths = availablePaths.filter(p => p !== value);
      setAvailablePaths(updatedPaths);
      setValidating(false);
      setErrorMessage(`${getDisplayPath(value)} no longer contains the correct repository. Select another path.`);
    };
    $[0] = availablePaths;
    $[1] = onCancel;
    $[2] = onSelectPath;
    $[3] = targetRepo;
    $[4] = t1;
  } else {
    t1 = $[4];
  }
  const handleChange = t1;
  let t2;
// 选项数组：候选路径逐个转成选项（label 用显示路径），末尾追加常量槽里的 Cancel——Cancel 恒在，候选列表为空时它是唯一出口。
  if ($[5] !== availablePaths) {
    let t3;
    if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
      t3 = {
        label: "Cancel",
        value: "cancel"
      };
      $[7] = t3;
    } else {
      t3 = $[7];
    }
    t2 = [...availablePaths.map(_temp), t3];
    $[5] = availablePaths;
    $[6] = t2;
  } else {
    t2 = $[6];
  }
  const options = t2;
  let t3;
  if ($[8] !== availablePaths.length || $[9] !== errorMessage || $[10] !== handleChange || $[11] !== options || $[12] !== targetRepo || $[13] !== validating) {
// 主体两态：有候选路径时显示错误信息（上一轮验证失败的残留提示）加选择器；没有候选时给出指路文案——让用户在目标仓库的 checkout 里重新运行 claude 加 teleport 参数。
    t3 = availablePaths.length > 0 ? <><Box flexDirection="column" gap={1}>{errorMessage && <Text color="error">{errorMessage}</Text>}<Text>Open Claude Code in <Text bold={true}>{targetRepo}</Text>:</Text></Box>{validating ? <Box><Spinner /><Text> Validating repository…</Text></Box> : <Select options={options} onChange={value_0 => void handleChange(value_0)} />}</> : <Box flexDirection="column" gap={1}>{errorMessage && <Text color="error">{errorMessage}</Text>}<Text dimColor={true}>Run claude --teleport from a checkout of {targetRepo}</Text></Box>;
    $[8] = availablePaths.length;
    $[9] = errorMessage;
    $[10] = handleChange;
    $[11] = options;
    $[12] = targetRepo;
    $[13] = validating;
    $[14] = t3;
  } else {
    t3 = $[14];
  }
  let t4;
  if ($[15] !== onCancel || $[16] !== t3) {
    t4 = <Dialog title="Teleport to Repo" onCancel={onCancel} color="background">{t3}</Dialog>;
    $[15] = onCancel;
    $[16] = t3;
    $[17] = t4;
  } else {
    t4 = $[17];
  }
  return t4;
}
// _temp 把路径转成选项：label 内嵌加粗的显示路径，value 保留原始路径——展示与语义分离。
function _temp(path) {
  return {
    label: <Text>Use <Text bold={true}>{getDisplayPath(path)}</Text></Text>,
    value: path
  };
}
// 原文件此处有一行 9580 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。