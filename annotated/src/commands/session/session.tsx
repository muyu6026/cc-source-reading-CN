// 编译器产物：十九个记忆槽，`$[n]` 的比较条件就是依赖数组，临时变量是被提取出来的闭包
import { c as _c } from "react/compiler-runtime";
import { toString as qrToString } from 'qrcode';
import * as React from 'react';
import { useEffect, useState } from 'react';
import { Pane } from '../../components/design-system/Pane.js';
import { Box, Text } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { useAppState } from '../../state/AppState.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { logForDebugging } from '../../utils/debug.js';
// 命令只收一个回调：渲染什么、什么时候关，全由组件自己决定，入口保持无状态
type Props = {
  onDone: () => void;
};
// 组件体里没有手写的 useMemo 与 useCallback：编译器把闭包提到模块级并逐个缓存
function SessionInfo(t0) {
  const $ = _c(19);
  const {
    onDone
  } = t0;
// 只订阅会话地址一个字段：这个命令对别的状态没有兴趣，订阅面越小，无关更新带来的重渲染越少
  const remoteSessionUrl = useAppState(_temp);
// 二维码是异步生成的字符串，先给空串表示「还没好」，避免多一个加载中状态
  const [qrCode, setQrCode] = useState("");
  let t1;
  let t2;
// 地址变化才重建副作用：会话中途重连换了地址，二维码必须跟着换
  if ($[0] !== remoteSessionUrl) {
    t1 = () => {
      if (!remoteSessionUrl) {
        return;
      }
      const url = remoteSessionUrl;
// 低纠错等级是刻意的：终端字符块本身对比度高、放大后仍可扫，等级开高只会让矩阵更密更难扫
      const generateQRCode = async function generateQRCode() {
        const qr = await qrToString(url, {
          type: "utf8",
          errorCorrectionLevel: "L"
        });
        setQrCode(qr);
      };
// 生成失败只记日志不崩：扫不出来还有下面那行地址可以手动复制
      generateQRCode().catch(_temp2);
    };
    t2 = [remoteSessionUrl];
    $[0] = remoteSessionUrl;
    $[1] = t1;
    $[2] = t2;
  } else {
    t1 = $[1];
    t2 = $[2];
  }
  useEffect(t1, t2);
  let t3;
// 这个标记表示「该槽位存的是常量」：命中就直接复用，省掉一次元素重建
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = {
      context: "Confirmation"
    };
    $[3] = t3;
  } else {
    t3 = $[3];
  }
// Esc 走确认键位而不是硬编码字符：键位可被用户改写，硬编码会让自定义配置在这一个界面失效
  useKeybinding("confirm:no", onDone, t3);
// 没有远端地址时给最短说明：这不是错误，只是命令用错了场景，不需要报错样式
  if (!remoteSessionUrl) {
    let t4;
    if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
      t4 = <Pane><Text color="warning">Not in remote mode. Start with `claude --remote` to use this command.</Text><Text dimColor={true}>(press esc to close)</Text></Pane>;
      $[4] = t4;
    } else {
      t4 = $[4];
    }
    return t4;
  }
  let T0;
  let t4;
  let t5;
  if ($[5] !== qrCode) {
// 按行切分再过滤空行：二维码文本首尾各有一个换行，不过滤就会多渲染两行空白
    const lines = qrCode.split("\n").filter(_temp3);
    const isLoading = lines.length === 0;
    T0 = Pane;
    if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
      t4 = <Box marginBottom={1}><Text bold={true}>Remote session</Text></Box>;
      $[9] = t4;
    } else {
      t4 = $[9];
    }
// 还没有行就显示生成中，且用同一个位置切换：布局不跳动，用户看不到内容忽隐忽现
    t5 = isLoading ? <Text dimColor={true}>Generating QR code…</Text> : lines.map(_temp4);
    $[5] = qrCode;
    $[6] = T0;
    $[7] = t4;
    $[8] = t5;
  } else {
    T0 = $[6];
    t4 = $[7];
    t5 = $[8];
  }
  let t6;
  if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
// 地址那行单独缓存：它只在地址变化时重建，与二维码的生成进度无关
    t6 = <Text dimColor={true}>Open in browser: </Text>;
    $[10] = t6;
  } else {
    t6 = $[10];
  }
  let t7;
  if ($[11] !== remoteSessionUrl) {
    t7 = <Box marginTop={1}>{t6}<Text color="ide">{remoteSessionUrl}</Text></Box>;
    $[11] = remoteSessionUrl;
    $[12] = t7;
  } else {
    t7 = $[12];
  }
  let t8;
  if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = <Box marginTop={1}><Text dimColor={true}>(press esc to close)</Text></Box>;
    $[13] = t8;
  } else {
    t8 = $[13];
  }
  let t9;
// 最后一个槽位把前面几块拼成整棵子树，依赖就是这四个子节点
  if ($[14] !== T0 || $[15] !== t4 || $[16] !== t5 || $[17] !== t7) {
    t9 = <T0>{t4}{t5}{t7}{t8}</T0>;
    $[14] = T0;
    $[15] = t4;
    $[16] = t5;
    $[17] = t7;
    $[18] = t9;
  } else {
    t9 = $[18];
  }
  return t9;
}
function _temp4(line_0, i) {
  return <Text key={i}>{line_0}</Text>;
}
function _temp3(line) {
  return line.length > 0;
}
function _temp2(e) {
  logForDebugging("QR code generation failed", e);
}
function _temp(s) {
  return s.remoteSessionUrl;
}
// 命令入口只是把回调转交出去：真正的界面在组件里，这里不持有任何状态
export const call: LocalJSXCommandCall = async onDone => {
  return <SessionInfo onDone={onDone} />;
};
// 原文件此处有一行 9404 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。