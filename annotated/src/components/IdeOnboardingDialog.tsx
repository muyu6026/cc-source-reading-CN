import { c as _c } from "react/compiler-runtime";
// IdeOnboardingDialog 是首次在某 IDE 里启动 Claude Code 时弹出的欢迎框，介绍它能做什么并标记已展示过。
import React from 'react';
import { envDynamic } from 'src/utils/envDynamic.js';
import { Box, Text } from '../ink.js';
import { useKeybindings } from '../keybindings/useKeybinding.js';
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js';
import { env } from '../utils/env.js';
import { getTerminalIdeType, type IDEExtensionInstallationStatus, isJetBrainsIde, toIDEDisplayName } from '../utils/ide.js';
import { Dialog } from './design-system/Dialog.js';
interface Props {
  onDone: () => void;
  installationStatus: IDEExtensionInstallationStatus | null;
}
// Props 只关心两件事：onDone 关闭弹窗，以及可选的安装状态（用于显示已装插件版本）。
export function IdeOnboardingDialog(t0) {
  const $ = _c(23);
  const {
    onDone,
    installationStatus
  } = t0;
// 组件解构 props 后第一件事就是调用 markDialogAsShown，确保这次展示被记下来。
  markDialogAsShown();
  let t1;
  if ($[0] !== onDone) {
    t1 = {
      "confirm:yes": onDone,
      "confirm:no": onDone
    };
    $[0] = onDone;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = {
      context: "Confirmation"
    };
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  useKeybindings(t1, t2);
// 用 useKeybindings 把 Enter / confirm 的 yes 和 no 都绑到 onDone，等于按回车即关闭。
  let t3;
  if ($[3] !== installationStatus?.ideType) {
    t3 = installationStatus?.ideType ?? getTerminalIdeType();
    $[3] = installationStatus?.ideType;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  const ideType = t3;
// 优先用安装状态里的 ideType，否则回退到终端探测到的类型，决定后续显示哪类 IDE 的名称。
  const isJetBrains = isJetBrainsIde(ideType);
// isJetBrains 区分 JetBrains 系（叫 plugin）和其他（叫 extension），文案据此切换。
  let t4;
  if ($[5] !== ideType) {
    t4 = toIDEDisplayName(ideType);
    $[5] = ideType;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  const ideName = t4;
// toIDEDisplayName 把内部类型翻译成给用户看的名字，如 VS Code / IntelliJ。
  const installedVersion = installationStatus?.installedVersion;
  const pluginOrExtension = isJetBrains ? "plugin" : "extension";
  const mentionShortcut = env.platform === "darwin" ? "Cmd+Option+K" : "Ctrl+Alt+K";
// 快捷键提示按平台不同：macOS 是 Cmd+Option+K，其他是 Ctrl+Alt+K。
  let t5;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Text color="claude">✻ </Text>;
    $[7] = t5;
  } else {
    t5 = $[7];
  }
  let t6;
  if ($[8] !== ideName) {
    t6 = <>{t5}<Text>Welcome to Claude Code for {ideName}</Text></>;
    $[8] = ideName;
    $[9] = t6;
  } else {
    t6 = $[9];
  }
  const t7 = installedVersion ? `installed ${pluginOrExtension} v${installedVersion}` : undefined;
// 如果带安装版本，副标题会写已安装 plugin/extension 加版本号，否则留空。
  let t8;
  if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = <Text color="suggestion">⧉ open files</Text>;
    $[10] = t8;
  } else {
    t8 = $[10];
  }
  let t9;
  if ($[11] === Symbol.for("react.memo_cache_sentinel")) {
    t9 = <Text>• Claude has context of {t8}{" "}and <Text color="suggestion">⧉ selected lines</Text></Text>;
    $[11] = t9;
  } else {
    t9 = $[11];
  }
  let t10;
  if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
    t10 = <Text color="diffAddedWord">+11</Text>;
    $[12] = t10;
  } else {
    t10 = $[12];
  }
  let t11;
  if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
    t11 = <Text>• Review Claude Code's changes{" "}{t10}{" "}<Text color="diffRemovedWord">-22</Text> in the comfort of your IDE</Text>;
    $[13] = t11;
  } else {
    t11 = $[13];
  }
  let t12;
  if ($[14] === Symbol.for("react.memo_cache_sentinel")) {
    t12 = <Text>• Cmd+Esc<Text dimColor={true}> for Quick Launch</Text></Text>;
    $[14] = t12;
  } else {
    t12 = $[14];
  }
  let t13;
  if ($[15] === Symbol.for("react.memo_cache_sentinel")) {
    t13 = <Box flexDirection="column" gap={1}>{t9}{t11}{t12}<Text>• {mentionShortcut}<Text dimColor={true}> to reference files or lines in your input</Text></Text></Box>;
    $[15] = t13;
  } else {
    t13 = $[15];
  }
// t13 把三条卖点（开文件、看改动、快捷启动）竖向拼好，并显示快捷键提示。
  let t14;
  if ($[16] !== onDone || $[17] !== t6 || $[18] !== t7) {
    t14 = <Dialog title={t6} subtitle={t7} color="ide" onCancel={onDone} hideInputGuide={true}>{t13}</Dialog>;
    $[16] = onDone;
    $[17] = t6;
    $[18] = t7;
    $[19] = t14;
  } else {
    t14 = $[19];
  }
// Dialog 组件承载标题（欢迎语）、副标题（版本）、主题色 ide 和关闭回调，内部塞进上面的卖点列表。
  let t15;
  if ($[20] === Symbol.for("react.memo_cache_sentinel")) {
    t15 = <Box paddingX={1}><Text dimColor={true} italic={true}>Press Enter to continue</Text></Box>;
    $[20] = t15;
  } else {
    t15 = $[20];
// 底部那行 Press Enter to continue 用斜体暗色弱提示。
  }
  let t16;
  if ($[21] !== t14) {
    t16 = <>{t14}{t15}</>;
    $[21] = t14;
    $[22] = t16;
  } else {
    t16 = $[22];
  }
  return t16;
// 最终把 Dialog 和底部提示并排拼成返回的内容。
}
export function hasIdeOnboardingDialogBeenShown(): boolean {
  const config = getGlobalConfig();
  const terminal = envDynamic.terminal || 'unknown';
  return config.hasIdeOnboardingBeenShown?.[terminal] === true;
}
// hasIdeOnboardingDialogBeenShown 按当前终端类型查配置，判断欢迎框是否已展示过，防止每次都弹。
function markDialogAsShown(): void {
  if (hasIdeOnboardingDialogBeenShown()) {
    return;
  }
  const terminal = envDynamic.terminal || 'unknown';
  saveGlobalConfig(current => ({
    ...current,
    hasIdeOnboardingBeenShown: {
      ...current.hasIdeOnboardingBeenShown,
      [terminal]: true
    }
  }));
}
// markDialogAsShown 在首次展示后把当前终端标记为已展示，下次不再弹；已展示则直接返回。
// 原文件此处有一行 11704 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。