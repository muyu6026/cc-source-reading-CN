import { c as _c } from "react/compiler-runtime";
import React, { useCallback, useEffect, useState } from 'react';
import { type OptionWithDescription, Select } from '../../components/CustomSelect/index.js';
import { Pane } from '../../components/design-system/Pane.js';
import { Spinner } from '../../components/Spinner.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- enter to proceed through setup steps
import { Box, Text, useInput } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { detectPythonPackageManager, getPythonApiInstructions, installIt2, markIt2SetupComplete, type PythonPackageManager, setPreferTmuxOverIterm2, verifyIt2Setup } from './backends/it2Setup.js';
type SetupStep = 'initial' | 'installing' | 'install-failed' | 'verify-api' | 'api-instructions' | 'verifying' | 'success' | 'failed';
// `SetupStep` 联合类型枚举了安装向导的全部步骤状态。
type Props = {
  onDone: (result: 'installed' | 'use-tmux' | 'cancelled') => void;
  tmuxAvailable: boolean;
};
// `Props` 定义完成回调 `onDone` 与 tmux 是否可用的标记。
export function It2SetupPrompt(t0) {
// `It2SetupPrompt` 组件入口，`t0` 为传入属性（React Compiler 产物，变量名经压缩）。
  const $ = _c(44);
  const {
    onDone,
    tmuxAvailable
  } = t0;
  const [step, setStep] = useState("initial");
// `step` 状态初始为 `initial`（向导起始页）。
  const [packageManager, setPackageManager] = useState(null);
  const [error, setError] = useState(null);
  const exitState = useExitOnCtrlCDWithKeybindings();
// 接入 Ctrl+C 退出键绑定，取得退出状态。
  let t1;
  let t2;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = () => {
      detectPythonPackageManager().then(pm => {
        setPackageManager(pm);
      });
    };
// 挂载副作用：探测 Python 包管理器并写入状态。
    t2 = [];
    $[0] = t1;
    $[1] = t2;
  } else {
    t1 = $[0];
    t2 = $[1];
  }
  useEffect(t1, t2);
// 用 `useEffect` 在挂载时触发包管理器探测。
  let t3;
  if ($[2] !== onDone) {
    t3 = () => {
      onDone("cancelled");
    };
    $[2] = onDone;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  const handleCancel = t3;
// `handleCancel` 取消回调，由键绑定复用。
  const t4 = step !== "installing" && step !== "verifying";
  let t5;
  if ($[4] !== t4) {
    t5 = {
      context: "Confirmation",
      isActive: t4
    };
    $[4] = t4;
    $[5] = t5;
  } else {
    t5 = $[5];
  }
  useKeybinding("confirm:no", handleCancel, t5);
// 注册 `confirm:no` 键绑定，触发取消。
  let t6;
  if ($[6] !== onDone || $[7] !== step) {
    t6 = (_input, key) => {
      if (step === "api-instructions" && key.return) {
        setStep("verifying");
        verifyIt2Setup().then(result => {
          if (result.success) {
            markIt2SetupComplete();
            setStep("success");
            setTimeout(onDone, 1500, "installed" as const);
          } else {
            setError(result.error || "Verification failed");
            setStep("failed");
          }
        });
      }
    };
    $[6] = onDone;
    $[7] = step;
    $[8] = t6;
  } else {
    t6 = $[8];
  }
  useInput(t6);
// `useInput` 处理安装与验证步骤的回车输入。
  let t7;
  if ($[9] !== packageManager) {
    t7 = async function handleInstall() {
      if (!packageManager) {
        setError("No Python package manager found (uvx, pipx, or pip)");
        setStep("failed");
        return;
      }
      setStep("installing");
// 进入安装中状态并调用 `installIt2`。
      const result_0 = await installIt2(packageManager);
      if (result_0.success) {
        setStep("api-instructions");
      } else {
        setError(result_0.error || "Installation failed");
        setStep("install-failed");
      }
    };
// `handleInstall` 定义结束。
    $[9] = packageManager;
    $[10] = t7;
  } else {
    t7 = $[10];
  }
  const handleInstall = t7;
// `handleInstall` 引用，用于选项切换。
  let t8;
  if ($[11] !== onDone) {
    t8 = function handleUseTmux() {
      setPreferTmuxOverIterm2(true);
      onDone("use-tmux");
    };
// `handleUseTmux` 设置偏好并回调使用 tmux。
    $[11] = onDone;
    $[12] = t8;
  } else {
    t8 = $[12];
  }
  const handleUseTmux = t8;
// `handleUseTmux` 引用，供选项使用。
  let T0;
  let T1;
  let t10;
  let t11;
  let t12;
  let t13;
  let t14;
  let t9;
  if ($[13] !== error || $[14] !== handleInstall || $[15] !== handleUseTmux || $[16] !== onDone || $[17] !== packageManager || $[18] !== step || $[19] !== tmuxAvailable) {
    const renderContent = () => {
      switch (step) {
        case "initial":
          {
            return renderInitialPrompt();
          }
        case "installing":
          {
            return renderInstalling();
          }
        case "install-failed":
          {
            return renderInstallFailed();
          }
        case "api-instructions":
          {
            return renderApiInstructions();
          }
        case "verifying":
          {
            return renderVerifying();
          }
        case "success":
          {
            return renderSuccess();
          }
        case "failed":
          {
            return renderFailed();
          }
        default:
          {
            return null;
          }
      }
    };
// `renderContent` 按当前步骤切换不同渲染分支。
    function renderInitialPrompt() {
      const options = [{
        label: "Install it2 now",
        value: "install",
        description: packageManager ? `Uses ${packageManager} to install the it2 CLI tool` : "Requires Python (uvx, pipx, or pip)"
      }];
      if (tmuxAvailable) {
        options.push({
          label: "Use tmux instead",
          value: "tmux",
          description: "Opens teammates in a separate tmux session"
        });
      }
      options.push({
        label: "Cancel",
        value: "cancel",
        description: "Skip teammate spawning for now"
      });
      return <Box flexDirection="column" gap={1}><Text>To use native iTerm2 split panes for teammates, you need the{" "}<Text bold={true}>it2</Text> CLI tool.</Text><Text dimColor={true}>This enables teammates to appear as split panes within your current window.</Text><Box marginTop={1}><Select options={options} onChange={value => {
            bb61: switch (value) {
              case "install":
                {
                  handleInstall();
                  break bb61;
                }
              case "tmux":
                {
                  handleUseTmux();
                  break bb61;
                }
              case "cancel":
                {
                  onDone("cancelled");
                }
            }
          }} onCancel={() => onDone("cancelled")} /></Box></Box>;
    }
// 初始提示：提供安装 it2、改用 tmux 或取消三个选项。
    function renderInstalling() {
      return <Box flexDirection="column" gap={1}><Box><Spinner /><Text> Installing it2 using {packageManager}…</Text></Box><Text dimColor={true}>This may take a moment.</Text></Box>;
    }
    function renderInstallFailed() {
      const options_0 = [{
        label: "Try again",
        value: "retry",
        description: "Retry the installation"
      }];
      if (tmuxAvailable) {
        options_0.push({
          label: "Use tmux instead",
          value: "tmux",
          description: "Falls back to tmux for teammate panes"
        });
      }
      options_0.push({
        label: "Cancel",
        value: "cancel",
        description: "Skip teammate spawning for now"
      });
      return <Box flexDirection="column" gap={1}><Text color="error">Installation failed</Text>{error && <Text dimColor={true}>{error}</Text>}<Text dimColor={true}>You can try installing manually:{" "}{packageManager === "uvx" ? "uv tool install it2" : packageManager === "pipx" ? "pipx install it2" : "pip install --user it2"}</Text><Box marginTop={1}><Select options={options_0} onChange={value_0 => {
            bb89: switch (value_0) {
              case "retry":
                {
                  handleInstall();
                  break bb89;
                }
              case "tmux":
                {
                  handleUseTmux();
                  break bb89;
                }
              case "cancel":
                {
                  onDone("cancelled");
                }
            }
          }} onCancel={() => onDone("cancelled")} /></Box></Box>;
    }
// 安装失败提示，并提供重试、改用 tmux 或取消。
    function renderApiInstructions() {
      const instructions = getPythonApiInstructions();
      return <Box flexDirection="column" gap={1}><Text color="success">✓ it2 installed successfully</Text><Box flexDirection="column" marginTop={1}>{instructions.map(_temp)}</Box><Box marginTop={1}><Text dimColor={true}>Press Enter when ready to verify…</Text></Box></Box>;
    }
    function renderVerifying() {
      return <Box><Spinner /><Text> Verifying it2 can communicate with iTerm2…</Text></Box>;
    }
    function renderSuccess() {
      return <Box flexDirection="column"><Text color="success">✓ iTerm2 split pane support is ready</Text><Text dimColor={true}>Teammates will now appear as split panes.</Text></Box>;
    }
    function renderFailed() {
      const options_1 = [{
        label: "Try again",
        value: "retry",
        description: "Verify the connection again"
      }];
      if (tmuxAvailable) {
        options_1.push({
          label: "Use tmux instead",
          value: "tmux",
          description: "Falls back to tmux for teammate panes"
        });
      }
      options_1.push({
        label: "Cancel",
        value: "cancel",
        description: "Skip teammate spawning for now"
      });
      return <Box flexDirection="column" gap={1}><Text color="error">Verification failed</Text>{error && <Text dimColor={true}>{error}</Text>}<Text>Make sure:</Text><Box flexDirection="column" paddingLeft={2}><Text>· Python API is enabled in iTerm2 preferences</Text><Text>· You may need to restart iTerm2 after enabling</Text></Box><Box marginTop={1}><Select options={options_1} onChange={value_1 => {
            bb115: switch (value_1) {
              case "retry":
                {
                  setStep("verifying");
                  verifyIt2Setup().then(result_1 => {
                    if (result_1.success) {
                      markIt2SetupComplete();
                      setStep("success");
                      setTimeout(onDone, 1500, "installed" as const);
                    } else {
                      setError(result_1.error || "Verification failed");
                      setStep("failed");
                    }
                  });
                  break bb115;
                }
              case "tmux":
                {
                  handleUseTmux();
                  break bb115;
                }
              case "cancel":
                {
                  onDone("cancelled");
                }
            }
          }} onCancel={() => onDone("cancelled")} /></Box></Box>;
    }
// 验证失败提示，并引导用户重新验证或回退 tmux。
    T1 = Pane;
    t14 = "permission";
    T0 = Box;
    t9 = "column";
    t10 = 1;
    t11 = 1;
    if ($[28] === Symbol.for("react.memo_cache_sentinel")) {
      t12 = <Text bold={true} color="permission">iTerm2 Split Pane Setup</Text>;
      $[28] = t12;
    } else {
      t12 = $[28];
    }
    t13 = renderContent();
// 调用 `renderContent` 取得当前步骤的界面内容。
    $[13] = error;
    $[14] = handleInstall;
    $[15] = handleUseTmux;
    $[16] = onDone;
    $[17] = packageManager;
    $[18] = step;
    $[19] = tmuxAvailable;
    $[20] = T0;
    $[21] = T1;
    $[22] = t10;
    $[23] = t11;
    $[24] = t12;
    $[25] = t13;
    $[26] = t14;
    $[27] = t9;
  } else {
    T0 = $[20];
    T1 = $[21];
    t10 = $[22];
    t11 = $[23];
    t12 = $[24];
    t13 = $[25];
    t14 = $[26];
    t9 = $[27];
  }
// 大段条件渲染闭包结束，进入最终组装。
  let t15;
  if ($[29] !== exitState || $[30] !== step) {
    t15 = step !== "installing" && step !== "verifying" && step !== "success" && <Text dimColor={true} italic={true}>{exitState.pending ? <>Press {exitState.keyName} again to exit</> : <>Esc to cancel</>}</Text>;
// 退出提示文本随步骤与退出状态变化（再次按键或 Esc 取消）。
    $[29] = exitState;
    $[30] = step;
    $[31] = t15;
  } else {
    t15 = $[31];
  }
  let t16;
  if ($[32] !== T0 || $[33] !== t10 || $[34] !== t11 || $[35] !== t12 || $[36] !== t13 || $[37] !== t15 || $[38] !== t9) {
    t16 = <T0 flexDirection={t9} gap={t10} paddingBottom={t11}>{t12}{t13}{t15}</T0>;
    $[32] = T0;
    $[33] = t10;
    $[34] = t11;
    $[35] = t12;
    $[36] = t13;
    $[37] = t15;
    $[38] = t9;
    $[39] = t16;
  } else {
    t16 = $[39];
  }
  let t17;
  if ($[40] !== T1 || $[41] !== t14 || $[42] !== t16) {
    t17 = <T1 color={t14}>{t16}</T1>;
    $[40] = T1;
    $[41] = t14;
    $[42] = t16;
    $[43] = t17;
  } else {
    t17 = $[43];
  }
  return t17;
// 组合最终渲染树并返回。
}
// `It2SetupPrompt` 组件结束。
function _temp(line, i) {
  return <Text key={i}>{line}</Text>;
}
// `_temp` 把每条 API 指令渲染为一行文本。
// 原文件此处有一行 30660 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。