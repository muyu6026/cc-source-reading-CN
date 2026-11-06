// React 编译器运行时缓存。
import { c as _c } from "react/compiler-runtime";
import React, { useCallback, useRef, useState } from 'react';
// 引入自定义下拉选择与设计系统对话框。
import { Select } from '../../components/CustomSelect/select.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { Box, Text } from '../../ink.js';
// 属性：继续（带中止信号）与取消回调。
type Props = {
  onProceed: (signal: AbortSignal) => Promise<void>;
  onCancel: () => void;
};
// 超额用量确认对话框组件。
export function UltrareviewOverageDialog(t0) {
  const $ = _c(15);
  const {
    onProceed,
    onCancel
  } = t0;
  const [isLaunching, setIsLaunching] = useState(false);
// 本地状态：是否正在发起计费请求。
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
// 记忆化 AbortController 用于取消。
    t1 = new AbortController();
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const abortControllerRef = useRef(t1);
// ref 持有控制器，便于取消时取用信号。
  let t2;
  if ($[1] !== onCancel || $[2] !== onProceed) {
// 依赖变化时重建选择处理：proceed 触发计费、否则取消。
    t2 = value => {
      if (value === "proceed") {
        setIsLaunching(true);
        onProceed(abortControllerRef.current.signal).catch(() => setIsLaunching(false));
      } else {
        onCancel();
      }
    };
    $[1] = onCancel;
    $[2] = onProceed;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  const handleSelect = t2;
  let t3;
  if ($[4] !== onCancel) {
// 依赖变化时重建取消处理：中止并回调。
    t3 = () => {
      abortControllerRef.current.abort();
      onCancel();
    };
    $[4] = onCancel;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  const handleCancel = t3;
  let t4;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
// 记忆化两个选项：继续计费 / 取消。
    t4 = [{
      label: "Proceed with Extra Usage billing",
      value: "proceed"
    }, {
      label: "Cancel",
      value: "cancel"
    }];
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  const options = t4;
  let t5;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
// 记忆化说明：免费额度已用完，后续按超额计费。
    t5 = <Text>Your free ultrareviews for this organization are used. Further reviews bill as Extra Usage (pay-per-use).</Text>;
    $[7] = t5;
  } else {
    t5 = $[7];
  }
  let t6;
  if ($[8] !== handleCancel || $[9] !== handleSelect || $[10] !== isLaunching) {
// 依赖变化时重建内容区（提示或选择/启动中）。
    t6 = <Box flexDirection="column" gap={1}>{t5}{isLaunching ? <Text color="background">Launching…</Text> : <Select options={options} onChange={handleSelect} onCancel={handleCancel} />}</Box>;
    $[8] = handleCancel;
    $[9] = handleSelect;
    $[10] = isLaunching;
    $[11] = t6;
  } else {
    t6 = $[11];
  }
  let t7;
  if ($[12] !== handleCancel || $[13] !== t6) {
// 组合到带标题的对话框。
    t7 = <Dialog title="Ultrareview billing" onCancel={handleCancel} color="background">{t6}</Dialog>;
    $[12] = handleCancel;
    $[13] = t6;
    $[14] = t7;
  } else {
    t7 = $[14];
  }
  return t7;
// 返回最终节点。
}
// 原文件此处有一行 7108 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。