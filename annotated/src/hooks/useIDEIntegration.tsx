import { c as _c } from "react/compiler-runtime";
import { useEffect } from 'react';
import type { ScopedMcpServerConfig } from '../services/mcp/types.js';
import { getGlobalConfig } from '../utils/config.js';
import { isEnvDefinedFalsy, isEnvTruthy } from '../utils/envUtils.js';
import type { DetectedIDEInfo } from '../utils/ide.js';
import { type IDEExtensionInstallationStatus, type IdeType, initializeIdeIntegration, isSupportedTerminal } from '../utils/ide.js';
type UseIDEIntegrationProps = {
  autoConnectIdeFlag?: boolean;
  ideToInstallExtension: IdeType | null;
  setDynamicMcpConfig: React.Dispatch<React.SetStateAction<Record<string, ScopedMcpServerConfig> | undefined>>;
  setShowIdeOnboarding: React.Dispatch<React.SetStateAction<boolean>>;
  setIDEInstallationState: React.Dispatch<React.SetStateAction<IDEExtensionInstallationStatus | null>>;
};
export function useIDEIntegration(t0) {
// React Compiler 把整个 props 对象编译重命名为形参 t0，内部再解构成各字段。
  const $ = _c(7);
  const {
    autoConnectIdeFlag,
    ideToInstallExtension,
    setDynamicMcpConfig,
    setShowIdeOnboarding,
    setIDEInstallationState
  } = t0;
  let t1;
  let t2;
  if ($[0] !== autoConnectIdeFlag || $[1] !== ideToInstallExtension || $[2] !== setDynamicMcpConfig || $[3] !== setIDEInstallationState || $[4] !== setShowIdeOnboarding) {
// 依赖数组手写比对五个字段，任一变化才重建 effect 回调 t1（memo 守卫，避免每轮重订阅）。
    t1 = () => {
      const addIde = function addIde(ide) {
        if (!ide) {
          return;
        }
        const globalConfig = getGlobalConfig();
        const autoConnectEnabled = (globalConfig.autoConnectIde || autoConnectIdeFlag || isSupportedTerminal() || process.env.CLAUDE_CODE_SSE_PORT || ideToInstallExtension || isEnvTruthy(process.env.CLAUDE_CODE_AUTO_CONNECT_IDE)) && !isEnvDefinedFalsy(process.env.CLAUDE_CODE_AUTO_CONNECT_IDE);
// 自动连接 IDE 的多路触发：config 开关 / 启动 flag / 受支持终端 / SSE 端口 / 待装扩展 / env 真值；
// 末尾再 && 一个「env 非假值」做负向熔断（env 显式关时强制不连）。
        if (!autoConnectEnabled) {
          return;
        }
        setDynamicMcpConfig(prev => {
          if (prev?.ide) {
            return prev;
          }
          return {
            ...prev,
            ide: {
              type: ide.url.startsWith("ws:") ? "ws-ide" : "sse-ide",
// 按 URL 前缀区分传输协议：ws: 起头用 ws-ide，其余按 sse-ide 处理。
              url: ide.url,
              ideName: ide.name,
              authToken: ide.authToken,
              ideRunningInWindows: ide.ideRunningInWindows,
              scope: "dynamic" as const
            }
          };
        });
      };
      initializeIdeIntegration(addIde, ideToInstallExtension, () => setShowIdeOnboarding(true), status => setIDEInstallationState(status));
// 真正触发 IDE 集成初始化：传入 addIde 回调（命中则写 dynamic MCP config）、
// 待装扩展、引导开关、安装状态回调。
    };
    t2 = [autoConnectIdeFlag, ideToInstallExtension, setDynamicMcpConfig, setShowIdeOnboarding, setIDEInstallationState];
    $[0] = autoConnectIdeFlag;
    $[1] = ideToInstallExtension;
    $[2] = setDynamicMcpConfig;
    $[3] = setIDEInstallationState;
    $[4] = setShowIdeOnboarding;
    $[5] = t1;
    $[6] = t2;
  } else {
    t1 = $[5];
    t2 = $[6];
  }
  useEffect(t1, t2);
}
// 原文件此处有一行 7724 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。