import { c as _c } from "react/compiler-runtime";
// InvalidConfigDialog 处理配置文件 JSON 非法的极端情况：即使配置读不出来，也要能弹出一个可操作的对话框让用户选择退出或重置。
import React from 'react';
import { Box, render, Text } from '../ink.js';
import { KeybindingSetup } from '../keybindings/KeybindingProviderSetup.js';
import { AppStateProvider } from '../state/AppState.js';
import type { ConfigParseError } from '../utils/errors.js';
import { getBaseRenderOptions } from '../utils/renderOptions.js';
import { jsonStringify, writeFileSync_DEPRECATED } from '../utils/slowOperations.js';
import type { ThemeName } from '../utils/theme.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
interface InvalidConfigHandlerProps {
  error: ConfigParseError;
}
// InvalidConfigHandlerProps 只传一个解析错误对象。
interface InvalidConfigDialogProps {
  filePath: string;
  errorDescription: string;
  onExit: () => void;
  onReset: () => void;
}
// InvalidConfigDialogProps 需要文件路径、错误描述，以及退出/重置两个回调。

/**
 * Dialog shown when the Claude config file contains invalid JSON
 */
// InvalidConfigDialog 的注释说明：当 Claude 配置文件包含非法 JSON 时展示这个对话框。
function InvalidConfigDialog(t0) {
  const $ = _c(19);
  const {
    filePath,
    errorDescription,
    onExit,
    onReset
  } = t0;
  let t1;
  if ($[0] !== onExit || $[1] !== onReset) {
    t1 = value => {
      if (value === "exit") {
        onExit();
      } else {
        onReset();
      }
    };
    $[0] = onExit;
    $[1] = onReset;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const handleSelect = t1;
  let t2;
  if ($[3] !== filePath) {
    t2 = <Text>The configuration file at <Text bold={true}>{filePath}</Text> contains invalid JSON.</Text>;
    $[3] = filePath;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  let t3;
  if ($[5] !== errorDescription) {
    t3 = <Text>{errorDescription}</Text>;
    $[5] = errorDescription;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  let t4;
  if ($[7] !== t2 || $[8] !== t3) {
    t4 = <Box flexDirection="column" gap={1}>{t2}{t3}</Box>;
    $[7] = t2;
    $[8] = t3;
    $[9] = t4;
  } else {
    t4 = $[9];
  }
  let t5;
  if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Text bold={true}>Choose an option:</Text>;
    $[10] = t5;
  } else {
    t5 = $[10];
  }
  let t6;
  if ($[11] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = [{
      label: "Exit and fix manually",
      value: "exit"
    }, {
      label: "Reset with default configuration",
      value: "reset"
    }];
    $[11] = t6;
  } else {
    t6 = $[11];
  }
  let t7;
  if ($[12] !== handleSelect || $[13] !== onExit) {
    t7 = <Box flexDirection="column">{t5}<Select options={t6} onChange={handleSelect} onCancel={onExit} /></Box>;
    $[12] = handleSelect;
    $[13] = onExit;
    $[14] = t7;
  } else {
    t7 = $[14];
  }
  let t8;
  if ($[15] !== onExit || $[16] !== t4 || $[17] !== t7) {
    t8 = <Dialog title="Configuration Error" color="error" onCancel={onExit}>{t4}{t7}</Dialog>;
    $[15] = onExit;
    $[16] = t4;
    $[17] = t7;
    $[18] = t8;
  } else {
    t8 = $[18];
  }
  return t8;
// InvalidConfigDialog 组件把文件路径、错误描述、选项列表（Exit and fix manually / Reset with default configuration）拼进一个 error 色的 Dialog；handleSelect 按选择调用 onExit 或 onReset。
}

/**
 * Safe fallback theme name for error dialogs to avoid circular dependency.
 * Uses a hardcoded dark theme that doesn't require reading from config.
 */
// showInvalidConfigDialog 的注释说明：用硬编码主题名避免与 getGlobalConfig 形成循环依赖，这样即使配置文件有 JSON 语法错误也能显示对话框。
const SAFE_ERROR_THEME_NAME: ThemeName = 'dark';
// SAFE_ERROR_THEME_NAME 固定为 dark，作为错误对话框的兜底主题，绝不依赖配置读取。
export async function showInvalidConfigDialog({
  error
}: InvalidConfigHandlerProps): Promise<void> {
  // Extend RenderOptions with theme property for this specific usage
  type SafeRenderOptions = Parameters<typeof render>[1] & {
    theme?: ThemeName;
  };
  const renderOptions: SafeRenderOptions = {
    ...getBaseRenderOptions(false),
    // IMPORTANT: Use hardcoded theme name to avoid circular dependency with getGlobalConfig()
    // This allows the error dialog to show even when config file has JSON syntax errors
    theme: SAFE_ERROR_THEME_NAME
  };
  await new Promise<void>(async resolve => {
    const {
      unmount
    } = await render(<AppStateProvider>
        <KeybindingSetup>
          <InvalidConfigDialog filePath={error.filePath} errorDescription={error.message} onExit={() => {
          unmount();
          void resolve();
          process.exit(1);
        }} onReset={() => {
          writeFileSync_DEPRECATED(error.filePath, jsonStringify(error.defaultConfig, null, 2), {
            flush: false,
            encoding: 'utf8'
          });
          unmount();
          void resolve();
          process.exit(0);
        }} />
        </KeybindingSetup>
      </AppStateProvider>, renderOptions);
  });
}
// showInvalidConfigDialog 用 render 把 InvalidConfigDialog 挂进 AppStateProvider + KeybindingSetup 里渲染：用户选退出就卸载并 process.exit(1)，选重置就写回默认配置再卸载并 process.exit(0)。
// 原文件此处有一行 10944 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。