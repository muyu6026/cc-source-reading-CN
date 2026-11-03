// 远程控制弹窗。这个文件有一个很反常的形态：组件几乎不接收任何数据，二十多个字段全部从全局状态里逐个读出来。理解它的关键不是读 props，而是看清「哪些是 AppState（跨组件共享）、哪些是本地 useState（只属于这个弹窗）、哪些是哨兵常量」。
import { c as _c } from "react/compiler-runtime";
import { basename } from 'path';
// 把二维码字符串转成字符画。之所以能在终端里出二维码，是因为库支持 utf8 字符集模式——用方块字符拼出模块，而不是渲染位图。
import { toString as qrToString } from 'qrcode';
import * as React from 'react';
import { useEffect, useState } from 'react';
// 取的是 getOriginalCwd 而不是 process.cwd。桥接会话启动后当前目录可能被改过，而仓库名要取的是启动时那个目录——用错会让标题显示成某个子目录名。
import { getOriginalCwd } from '../bootstrap/state.js';
// bridgeStatusUtil 一次给出四件东西：状态标签、标签颜色、活跃态文案、空闲态文案、失败文案。把所有「该显示什么字」的决策压到纯函数里，组件只负责摆放。
import { buildActiveFooterText, buildIdleFooterText, FAILED_FOOTER_TEXT, getBridgeStatus } from '../bridge/bridgeStatusUtil.js';
import { BRIDGE_FAILED_INDICATOR, BRIDGE_READY_INDICATOR } from '../constants/figures.js';
import { useRegisterOverlay } from '../context/overlayContext.js';
// eslint 禁用注释说明 d 键是原始单键、不是可配置的键位动作。这类破例在终端 UI 里很常见：字母键直接对应动作，走键位系统反而绕。
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- raw 'd' key for disconnect, not a configurable keybinding action
import { Box, Text, useInput } from '../ink.js';
import { useKeybindings } from '../keybindings/useKeybinding.js';
import { useAppState, useSetAppState } from '../state/AppState.js';
import { saveGlobalConfig } from '../utils/config.js';
import { getBranch } from '../utils/git.js';
import { Dialog } from './design-system/Dialog.js';
// props 只有一个 onDone。这个弹窗不接收连接状态、不接收 URL、不接收错误——全部从 AppState 读。好处是调用方极简，代价是组件与全局状态强耦合、无法单独预览。
type Props = {
  onDone: () => void;
};
// 入口，_c(87)。这个槽数在整批里最高，因为要缓存的东西既包括二十多个 JSX，还包括被整体缓存的一大块子树（下面会看到 T0 与 T1 这两个变量装的其实是组件本身）。
export function BridgeDialog(t0) {
  const $ = _c(87);
  const {
    onDone
  } = t0;
  useRegisterOverlay("bridge-dialog");
  const connected = useAppState(_temp);
  const sessionActive = useAppState(_temp2);
  const reconnecting = useAppState(_temp3);
  const connectUrl = useAppState(_temp4);
  const sessionUrl = useAppState(_temp5);
  const error = useAppState(_temp6);
  const explicit = useAppState(_temp7);
  const environmentId = useAppState(_temp8);
  const sessionId = useAppState(_temp9);
// verbose 控制是否显示环境 id 与会话 id。这两项属于排障信息，默认藏起来——泄露源码里凡是这种「默认看不见、开关后出现」的字段，基本都是给支持人员用的。
  const verbose = useAppState(_temp0);
  const setAppState = useSetAppState();
  const [showQR, setShowQR] = useState(false);
  const [qrText, setQrText] = useState("");
  const [branchName, setBranchName] = useState("");
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
// 仓库名走哨兵缓存：basename 加 getOriginalCwd 只需算一次，进程生命周期内不会变。这是「常量就该标成常量」的典型——写进依赖数组反而会让它每次重算。
    t1 = basename(getOriginalCwd());
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const repoName = t1;
  let t2;
  let t3;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = () => {
// catch 接的是一个空函数。取不到分支名就静默留空，界面少一段上下文而已——分支名属于装饰性信息，不值得为它弹错。
      getBranch().then(setBranchName).catch(_temp1);
    };
    t3 = [];
    $[1] = t2;
    $[2] = t3;
  } else {
    t2 = $[1];
    t3 = $[2];
  }
  useEffect(t2, t3);
// 两个 URL 二选一：会话已激活时用会话 URL（对方可以直接加入），否则用连接 URL（只能建立新会话）。这个选择直接决定了二维码扫出来是什么。
  const displayUrl = sessionActive ? sessionUrl : connectUrl;
  let t4;
  let t5;
  if ($[3] !== displayUrl || $[4] !== showQR) {
    t4 = () => {
      if (!showQR || !displayUrl) {
        setQrText("");
        return;
      }
// 二维码参数：纠错级别取最低的 L，输出取 small。终端里字符分辨率极高、屏幕也不会被手指磨花，所以不需要高纠错；而 small 能让图案在窄终端里也放得下。
      qrToString(displayUrl, {
        type: "utf8",
        errorCorrectionLevel: "L",
        small: true
      }).then(setQrText).catch(() => setQrText(""));
    };
    t5 = [showQR, displayUrl];
    $[3] = displayUrl;
    $[4] = showQR;
    $[5] = t4;
    $[6] = t5;
  } else {
    t4 = $[5];
    t5 = $[6];
  }
  useEffect(t4, t5);
  let t6;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = () => {
      setShowQR(_temp10);
    };
    $[7] = t6;
  } else {
    t6 = $[7];
  }
  let t7;
  if ($[8] !== onDone) {
    t7 = {
// 两个键位绑定：确认键关闭，另一个动作用来切换二维码。注意切换借用了 Confirmation 上下文——说明这个上下文在本仓库里就是「弹窗打开时的默认上下文」。
      "confirm:yes": onDone,
      "confirm:toggle": t6
    };
    $[8] = onDone;
    $[9] = t7;
  } else {
    t7 = $[9];
  }
  let t8;
  if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = {
      context: "Confirmation"
    };
    $[10] = t8;
  } else {
    t8 = $[10];
  }
  useKeybindings(t7, t8);
  let t9;
  if ($[11] !== explicit || $[12] !== onDone || $[13] !== setAppState) {
    t9 = input => {
      if (input === "d") {
// 只有 explicit 为真才写全局配置。explicit 表示用户曾经在配置里显式开启过远程控制；没显式开过就只改本次会话状态、绝不去动用户的持久化设置。这条「不擅自改用户配置」的边界值得记住。
        if (explicit) {
          saveGlobalConfig(_temp11);
        }
// setAppState 接的是 _temp12 这个纯函数：若本来就没启用就原样返回旧对象。原样返回而不是返回内容相同的新对象，是为了不触发订阅方的无谓重渲染。
        setAppState(_temp12);
        onDone();
      }
    };
    $[11] = explicit;
    $[12] = onDone;
    $[13] = setAppState;
    $[14] = t9;
  } else {
    t9 = $[14];
  }
  useInput(t9);
  let t10;
  if ($[15] !== connected || $[16] !== error || $[17] !== reconnecting || $[18] !== sessionActive) {
// 四个布尔压成 label 加 color。注意它把「重连中」与「出错」都归到同一套出口，状态机只有两条出口：正常与异常。
    t10 = getBridgeStatus({
      error,
      connected,
      sessionActive,
      reconnecting
    });
    $[15] = connected;
    $[16] = error;
    $[17] = reconnecting;
    $[18] = sessionActive;
    $[19] = t10;
  } else {
    t10 = $[19];
  }
  const {
    label: statusLabel,
    color: statusColor
  } = t10;
// 指示符按 error 二选一，而不是按四种状态四选一。也就是说「重连中」显示的仍是就绪指示符、只在文字和颜色上区分——这是有意的：闪烁的红点会让人以为彻底断了。
  const indicator = error ? BRIDGE_FAILED_INDICATOR : BRIDGE_READY_INDICATOR;
  let T0;
  let T1;
  let footerText;
  let t11;
  let t12;
  let t13;
  let t14;
  let t15;
  let t16;
  let t17;
  if ($[20] !== branchName || $[21] !== displayUrl || $[22] !== environmentId || $[23] !== error || $[24] !== indicator || $[25] !== onDone || $[26] !== qrText || $[27] !== sessionActive || $[28] !== sessionId || $[29] !== showQR || $[30] !== statusColor || $[31] !== statusLabel || $[32] !== verbose) {
// 二维码字符画必须过滤空行。空行会让图案在中间断开一条缝，扫码直接失效——这不是排版洁癖，是功能正确性。
    const qrLines = qrText ? qrText.split("\n").filter(_temp13) : [];
    let contextParts;
    if ($[43] !== branchName) {
      contextParts = [];
      if (repoName) {
        contextParts.push(repoName);
      }
      if (branchName) {
        contextParts.push(branchName);
      }
      $[43] = branchName;
      $[44] = contextParts;
    } else {
      contextParts = $[44];
    }
// 上下文串用中点连接。中点写成转义序列而不是字面字符，是为了避免源码文件里混入不可见字符、也避免编辑器把中点渲染成别的宽度。
    const contextSuffix = contextParts.length > 0 ? " \xB7 " + contextParts.join(" \xB7 ") : "";
    let t18;
    if ($[45] !== displayUrl || $[46] !== error || $[47] !== sessionActive) {
// 底部文案四选一：出错就显失败文案；有 URL 且会话活跃显活跃文案；有 URL 但空闲显空闲文案；都没有则不显示。注意这三种文案都在 util 里拼好，这里只做选择。
      t18 = error ? FAILED_FOOTER_TEXT : displayUrl ? sessionActive ? buildActiveFooterText(displayUrl) : buildIdleFooterText(displayUrl) : undefined;
      $[45] = displayUrl;
      $[46] = error;
      $[47] = sessionActive;
      $[48] = t18;
    } else {
      t18 = $[48];
    }
    footerText = t18;
// 这里开始把「组件本身」和「组件的属性值」也写进缓存变量（T1 装 Dialog、t11 装 column、t12 装 gap）。这是编译器为「整块子树一起缓存」做的准备——它把创建元素的输入全部提到同一次判断里。
    T1 = Dialog;
    t15 = "Remote Control";
    t16 = onDone;
    t17 = true;
    T0 = Box;
    t11 = "column";
    t12 = 1;
    let t19;
    if ($[49] !== indicator || $[50] !== statusColor || $[51] !== statusLabel) {
      t19 = <Text color={statusColor}>{indicator} {statusLabel}</Text>;
      $[49] = indicator;
      $[50] = statusColor;
      $[51] = statusLabel;
      $[52] = t19;
    } else {
      t19 = $[52];
    }
    let t20;
    if ($[53] !== contextSuffix) {
      t20 = <Text dimColor={true}>{contextSuffix}</Text>;
      $[53] = contextSuffix;
      $[54] = t20;
    } else {
      t20 = $[54];
    }
    let t21;
    if ($[55] !== t19 || $[56] !== t20) {
      t21 = <Text>{t19}{t20}</Text>;
      $[55] = t19;
      $[56] = t20;
      $[57] = t21;
    } else {
      t21 = $[57];
    }
    let t22;
    if ($[58] !== error) {
      t22 = error && <Text color="error">{error}</Text>;
      $[58] = error;
      $[59] = t22;
    } else {
      t22 = $[59];
    }
    let t23;
    if ($[60] !== environmentId || $[61] !== verbose) {
      t23 = verbose && environmentId && <Text dimColor={true}>Environment: {environmentId}</Text>;
      $[60] = environmentId;
      $[61] = verbose;
      $[62] = t23;
    } else {
      t23 = $[62];
    }
    let t24;
    if ($[63] !== sessionId || $[64] !== verbose) {
      t24 = verbose && sessionId && <Text dimColor={true}>Session: {sessionId}</Text>;
      $[63] = sessionId;
      $[64] = verbose;
      $[65] = t24;
    } else {
      t24 = $[65];
    }
    if ($[66] !== t21 || $[67] !== t22 || $[68] !== t23 || $[69] !== t24) {
// 信息块：状态行、错误行、两个排障字段。四行都可能是 false（不渲染），所以外层 Box 必须容忍空子节点——终端布局里空节点不占行。
      t13 = <Box flexDirection="column">{t21}{t22}{t23}{t24}</Box>;
      $[66] = t21;
      $[67] = t22;
      $[68] = t23;
      $[69] = t24;
      $[70] = t13;
    } else {
      t13 = $[70];
    }
// 二维码块：只有 showQR 且确实有行时才渲染。map 用索引作 key 是对的，因为二维码行从不重排、只整体替换。
    t14 = showQR && qrLines.length > 0 && <Box flexDirection="column">{qrLines.map(_temp14)}</Box>;
    $[20] = branchName;
    $[21] = displayUrl;
    $[22] = environmentId;
    $[23] = error;
    $[24] = indicator;
    $[25] = onDone;
    $[26] = qrText;
    $[27] = sessionActive;
    $[28] = sessionId;
    $[29] = showQR;
    $[30] = statusColor;
    $[31] = statusLabel;
    $[32] = verbose;
    $[33] = T0;
    $[34] = T1;
    $[35] = footerText;
    $[36] = t11;
    $[37] = t12;
    $[38] = t13;
    $[39] = t14;
    $[40] = t15;
    $[41] = t16;
    $[42] = t17;
  } else {
    T0 = $[33];
    T1 = $[34];
    footerText = $[35];
    t11 = $[36];
    t12 = $[37];
    t13 = $[38];
    t14 = $[39];
    t15 = $[40];
    t16 = $[41];
    t17 = $[42];
  }
  let t18;
  if ($[71] !== footerText) {
// 底部文案单独一层：有值才包 Text，没值就整个是 false。省掉一层空 Box，也避免了「空 Box 占掉一行高」这种终端特有的坑。
    t18 = footerText && <Text dimColor={true}>{footerText}</Text>;
    $[71] = footerText;
    $[72] = t18;
  } else {
    t18 = $[72];
  }
  let t19;
  if ($[73] === Symbol.for("react.memo_cache_sentinel")) {
// 按键说明是纯常量，用哨兵缓存。注意这里写死的 d 与 space 与上面 useKeybindings 里定义的键位是两处独立维护——文案与实现不同步是这类提示最常见的失效原因。
    t19 = <Text dimColor={true}>d to disconnect · space for QR code · Enter/Esc to close</Text>;
    $[73] = t19;
  } else {
    t19 = $[73];
  }
  let t20;
  if ($[74] !== T0 || $[75] !== t11 || $[76] !== t12 || $[77] !== t13 || $[78] !== t14 || $[79] !== t18) {
// 组装：一个 column、gap 为 1 的容器，四块依次是信息、二维码、底部文案、按键说明。gap 用 1 而不是靠空行，是因为空行在不同终端下的行高不一致。
    t20 = <T0 flexDirection={t11} gap={t12}>{t13}{t14}{t18}{t19}</T0>;
    $[74] = T0;
    $[75] = t11;
    $[76] = t12;
    $[77] = t13;
    $[78] = t14;
    $[79] = t18;
    $[80] = t20;
  } else {
    t20 = $[80];
  }
  let t21;
  if ($[81] !== T1 || $[82] !== t15 || $[83] !== t16 || $[84] !== t17 || $[85] !== t20) {
// Dialog 带 hideInputGuide。因为底部说明是自己画的（含二维码提示），再让 Dialog 画一遍会重复。这类「关掉默认」的开关通常意味着「这里有过一次视觉冲突」。
    t21 = <T1 title={t15} onCancel={t16} hideInputGuide={t17}>{t20}</T1>;
    $[81] = T1;
    $[82] = t15;
    $[83] = t16;
    $[84] = t17;
    $[85] = t20;
    $[86] = t21;
  } else {
    t21 = $[86];
  }
  return t21;
}
function _temp14(line, i) {
  return <Text key={i}>{line}</Text>;
}
// 过滤空行的谓词被提到模块级，引用稳定。注意它用 length 判断而不是 trim——二维码字符画里的空行确实是零长度，不含空格。
function _temp13(l) {
  return l.length > 0;
}
// 断开连接时的状态更新：本来就没启用则原样返回旧对象。和上面那个配置更新是同一个模式——「无变化就别造新引用」。
function _temp12(prev_0) {
  if (!prev_0.replBridgeEnabled) {
    return prev_0;
  }
  return {
    ...prev_0,
    replBridgeEnabled: false
  };
}
// 全局配置的更新同理：remoteControlAtStartup 已经是 false 就直接返回传入对象。这种「先判后造」的写法在状态库里能显著减少无效广播。
function _temp11(current) {
  if (current.remoteControlAtStartup === false) {
    return current;
  }
  return {
    ...current,
    remoteControlAtStartup: false
  };
}
function _temp10(prev) {
  return !prev;
}
function _temp1() {}
function _temp0(s_8) {
  return s_8.verbose;
}
function _temp9(s_7) {
  return s_7.replBridgeSessionId;
}
function _temp8(s_6) {
  return s_6.replBridgeEnvironmentId;
}
function _temp7(s_5) {
  return s_5.replBridgeExplicit;
}
function _temp6(s_4) {
  return s_4.replBridgeError;
}
function _temp5(s_3) {
  return s_3.replBridgeSessionUrl;
}
function _temp4(s_2) {
  return s_2.replBridgeConnectUrl;
}
function _temp3(s_1) {
  return s_1.replBridgeReconnecting;
}
function _temp2(s_0) {
  return s_0.replBridgeSessionActive;
}
function _temp(s) {
  return s.replBridgeConnected;
}
// 原文件此处有一行 24208 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。