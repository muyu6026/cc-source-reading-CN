// 本文件是 OAuth 登录流程的终端 UI 状态机：八态 OAuthStatus（待选、平台说明、就绪、等登录、建 key、重试中、成功、失败）驱动一套 switch 渲染；主组件管理服务实例、浏览器拉起、手动粘贴授权码兜底与三种键位场景；子组件 OAuthStatusMessage 按状态分派画面。登录与 setup-token（长令牌导出）两种模式共用这套流程。
import { c as _c } from "react/compiler-runtime";
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { installOAuthTokens } from '../cli/handlers/auth.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { setClipboard } from '../ink/termio/osc.js';
import { useTerminalNotification } from '../ink/useTerminalNotification.js';
import { Box, Link, Text } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { getSSLErrorHint } from '../services/api/errorUtils.js';
import { sendNotification } from '../services/notifier.js';
import { OAuthService } from '../services/oauth/index.js';
import { getOauthAccountInfo, validateForceLoginOrg } from '../utils/auth.js';
import { logError } from '../utils/log.js';
import { getSettings_DEPRECATED } from '../utils/settings/settings.js';
import { Select } from './CustomSelect/select.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import { Spinner } from './Spinner.js';
import TextInput from './TextInput.js';
// Props：onDone 收尾回调；mode 区分 login（常规登录）与 setup-token（生成一年期 OAuth 令牌供环境变量 CLAUDE_CODE_OAUTH_TOKEN 用）；forceLoginMethod 可从外部或 settings 强制登录方式，跳过方法选择页。
type Props = {
  onDone(): void;
  startingMessage?: string;
  mode?: 'login' | 'setup-token';
  forceLoginMethod?: 'claudeai' | 'console';
};
// 状态机类型：idle 等选登录方式、ready_to_start 就绪、waiting_for_login 等浏览器回跳、success 与 error 终态；platform_setup 是第三方云平台说明页；about_to_retry 是 1 秒缓冲态、到点自动跳 nextState；creating_api_key 预留给建 key 中间态。toRetry 与 nextState 字段让失败后能回到正确的那一态。
type OAuthStatus = {
  state: 'idle';
} // Initial state, waiting to select login method
| {
  state: 'platform_setup';
} // Show platform setup info (Bedrock/Vertex/Foundry)
| {
  state: 'ready_to_start';
} // Flow started, waiting for browser to open
| {
  state: 'waiting_for_login';
  url: string;
} // Browser opened, waiting for user to login
| {
  state: 'creating_api_key';
} // Got access token, creating API key
| {
  state: 'about_to_retry';
  nextState: OAuthStatus;
} | {
  state: 'success';
  token?: string;
} | {
  state: 'error';
  message: string;
  toRetry?: OAuthStatus;
};
// 粘贴框前缀提示文案；文本框宽度等于终端列数减去它的显示宽度再留 1 列。
const PASTE_HERE_MSG = 'Paste code here if prompted > ';
// 主组件：settings 里读强制登录方式与组织 UUID（企业限组织登录）；forcedMethodMessage 把强制信息透出给用户。
export function ConsoleOAuthFlow({
  onDone,
  startingMessage,
  mode = 'login',
  forceLoginMethod: forceLoginMethodProp
}: Props): React.ReactNode {
  const settings = getSettings_DEPRECATED() || {};
  const forceLoginMethod = forceLoginMethodProp ?? settings.forceLoginMethod;
  const orgUUID = settings.forceLoginOrgUUID;
  const forcedMethodMessage = forceLoginMethod === 'claudeai' ? 'Login method pre-selected: Subscription Plan (Claude Pro/Max)' : forceLoginMethod === 'console' ? 'Login method pre-selected: API Usage Billing (Anthropic Console)' : null;
  const terminal = useTerminalNotification();
// 初始状态推导：setup-token 模式与被强制登录方式时直接跳过 idle（没有选方式这步），常规登录才停在 idle 等用户选。
  const [oauthStatus, setOAuthStatus] = useState<OAuthStatus>(() => {
    if (mode === 'setup-token') {
      return {
        state: 'ready_to_start'
      };
    }
    if (forceLoginMethod === 'claudeai' || forceLoginMethod === 'console') {
      return {
        state: 'ready_to_start'
      };
    }
    return {
      state: 'idle'
    };
  });
  const [pastedCode, setPastedCode] = useState('');
  const [cursorOffset, setCursorOffset] = useState(0);
// OAuthService 实例用惰性初始化（useState 函数形态）保证整个流程用同一个实例——回跳监听、token 交换、cleanup 都挂在它身上。
  const [oauthService] = useState(() => new OAuthService());
// loginWithClaudeAi 决定走订阅登录还是 Console 计费登录；setup-token 固定走订阅登录（需要 user:inference scope）。
  const [loginWithClaudeAi, setLoginWithClaudeAi] = useState(() => {
    // Use Claude AI auth for setup-token mode to support user:inference scope
    return mode === 'setup-token' || forceLoginMethod === 'claudeai';
  });
  // After a few seconds we suggest the user to copy/paste url if the
  // browser did not open automatically. In this flow we expect the user to
  // copy the code from the browser and paste it in the terminal
  const [showPastePrompt, setShowPastePrompt] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const textInputColumns = useTerminalSize().columns - PASTE_HERE_MSG.length - 1;

  // Log forced login method on mount
// 挂载时上报强制登录打点——区分企业策略触发的 claudeai 与 console 强制、用户自主选择。
  useEffect(() => {
    if (forceLoginMethod === 'claudeai') {
      logEvent('tengu_oauth_claudeai_forced', {});
    } else if (forceLoginMethod === 'console') {
      logEvent('tengu_oauth_console_forced', {});
    }
  }, [forceLoginMethod]);

  // Retry logic
// 重试缓冲 effect：进入 about_to_retry 后 1 秒定时跳到 nextState，卸载时清定时器——给「重试中」画面留一拍，避免状态闪烁。
  useEffect(() => {
    if (oauthStatus.state === 'about_to_retry') {
      const timer = setTimeout(setOAuthStatus, 1000, oauthStatus.nextState);
      return () => clearTimeout(timer);
    }
  }, [oauthStatus]);

  // Handle Enter to continue on success state
// 三个 confirm:yes 键位按 isActive 互斥挂载。第一个：成功态按 Enter 结束（setup-token 除外——它有自动退出）。
  useKeybinding('confirm:yes', () => {
    logEvent('tengu_oauth_success', {
      loginWithClaudeAi
    });
    onDone();
  }, {
    context: 'Confirmation',
    isActive: oauthStatus.state === 'success' && mode !== 'setup-token'
  });

  // Handle Enter to continue from platform setup
// 平台说明页按 Enter 回到 idle 重选。
  useKeybinding('confirm:yes', () => {
    setOAuthStatus({
      state: 'idle'
    });
  }, {
    context: 'Confirmation',
    isActive: oauthStatus.state === 'platform_setup'
  });

  // Handle Enter to retry on error state
// 错误态按 Enter：清空粘贴框、经 about_to_retry 回到 toRetry 指定的状态。
  useKeybinding('confirm:yes', () => {
    if (oauthStatus.state === 'error' && oauthStatus.toRetry) {
      setPastedCode('');
      setOAuthStatus({
        state: 'about_to_retry',
        nextState: oauthStatus.toRetry
      });
    }
  }, {
    context: 'Confirmation',
    isActive: oauthStatus.state === 'error' && !!oauthStatus.toRetry
  });
// 兜底交互：等登录且已展示粘贴提示时，输入单字符 c 直接把授权 URL 写进剪贴板（OSC 52），显示 2 秒已复制后复位；输入框立刻清空。
  useEffect(() => {
    if (pastedCode === 'c' && oauthStatus.state === 'waiting_for_login' && showPastePrompt && !urlCopied) {
      void setClipboard(oauthStatus.url).then(raw => {
        if (raw) process.stdout.write(raw);
        setUrlCopied(true);
        setTimeout(setUrlCopied, 2000, false);
      });
      setPastedCode('');
    }
  }, [pastedCode, oauthStatus, showPastePrompt, urlCopied]);
// 手动授权码提交：浏览器回跳 URL 的格式是授权码加井号加 state——拆不开就报错并记住 waiting_for_login 以便重试；拆得开就交给 oauthService 走正常 token 交换。
  async function handleSubmitCode(value: string, url: string) {
    try {
      // Expecting format "authorizationCode#state" from the authorization callback URL
// 按井号拆出授权码与 state 两段，缺任一段都算复制不完整。
      const [authorizationCode, state] = value.split('#');
      if (!authorizationCode || !state) {
        setOAuthStatus({
          state: 'error',
          message: 'Invalid code. Please make sure the full code was copied',
          toRetry: {
            state: 'waiting_for_login',
            url
          }
        });
        return;
      }

      // Track which path the user is taking (manual code entry)
      logEvent('tengu_oauth_manual_entry', {});
      oauthService.handleManualAuthCodeInput({
        authorizationCode,
        state
      });
    } catch (err: unknown) {
      logError(err);
      setOAuthStatus({
        state: 'error',
        message: (err as Error).message,
        toRetry: {
          state: 'waiting_for_login',
          url
        }
      });
    }
  }
// startOAuth，整个流程的引擎：注册浏览器回调（拿到 URL 先切 waiting_for_login，3 秒后才显示粘贴提示——给自动拉起浏览器留窗口），带登录方式、scope、过期、组织参数启动，成功按模式分流收尾。
  const startOAuth = useCallback(async () => {
    try {
      logEvent('tengu_oauth_flow_start', {
        loginWithClaudeAi
      });
      const result = await oauthService.startOAuthFlow(async url_0 => {
        setOAuthStatus({
          state: 'waiting_for_login',
          url: url_0
        });
        setTimeout(setShowPastePrompt, 3000, true);
      }, {
        loginWithClaudeAi,
        inferenceOnly: mode === 'setup-token',
        expiresIn: mode === 'setup-token' ? 365 * 24 * 60 * 60 : undefined,
        // 1 year for setup-token
        orgUUID
// token 交换失败分支：企业 TLS 代理（Zscaler 之类）会截胡交换 POST 造成费解的 SSL 错误，getSSLErrorHint 给出可行动的提示；setup-token 失败回 ready_to_start，登录失败回 idle。
      }).catch(err_1 => {
        const isTokenExchangeError = err_1.message.includes('Token exchange failed');
        // Enterprise TLS proxies (Zscaler et al.) intercept the token
        // exchange POST and cause cryptic SSL errors. Surface an
        // actionable hint so the user isn't stuck in a login loop.
        const sslHint_0 = getSSLErrorHint(err_1);
        setOAuthStatus({
          state: 'error',
          message: sslHint_0 ?? (isTokenExchangeError ? 'Failed to exchange authorization code for access token. Please try again.' : err_1.message),
          toRetry: mode === 'setup-token' ? {
            state: 'ready_to_start'
          } : {
            state: 'idle'
          }
        });
        logEvent('tengu_oauth_token_exchange_error', {
          error: err_1.message,
          ssl_error: sslHint_0 !== null
        });
        throw err_1;
      });
// 成功收尾分流：setup-token 模式把 accessToken 直接展示（不进钥匙串，用户手动 export）；登录模式 installOAuthTokens 落盘、校验强制组织、发系统通知。
      if (mode === 'setup-token') {
        // For setup-token mode, return the OAuth access token directly (it can be used as an API key)
        // Don't save to keychain - the token is displayed for manual use with CLAUDE_CODE_OAUTH_TOKEN
        setOAuthStatus({
          state: 'success',
          token: result.accessToken
        });
      } else {
        await installOAuthTokens(result);
        const orgResult = await validateForceLoginOrg();
        if (!orgResult.valid) {
          throw new Error(orgResult.message);
        }
        setOAuthStatus({
          state: 'success'
        });
        void sendNotification({
          message: 'Claude Code login successful',
          notificationType: 'auth_success'
        }, terminal);
      }
    } catch (err_0) {
      const errorMessage = (err_0 as Error).message;
      const sslHint = getSSLErrorHint(err_0);
      setOAuthStatus({
        state: 'error',
        message: sslHint ?? errorMessage,
        toRetry: {
          state: mode === 'setup-token' ? 'ready_to_start' : 'idle'
        }
      });
      logEvent('tengu_oauth_error', {
        error: errorMessage as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ssl_error: sslHint !== null
      });
    }
  }, [oauthService, setShowPastePrompt, loginWithClaudeAi, mode, orgUUID]);
// 防重入：ready_to_start 的 effect 可能因依赖变化重跑，pendingOAuthStartRef 保证 startOAuth 只被拉起一次；nextTick 把调用挪出渲染周期。
  const pendingOAuthStartRef = useRef(false);
  useEffect(() => {
    if (oauthStatus.state === 'ready_to_start' && !pendingOAuthStartRef.current) {
      pendingOAuthStartRef.current = true;
      process.nextTick((startOAuth_0: () => Promise<void>, pendingOAuthStartRef_0: React.MutableRefObject<boolean>) => {
        void startOAuth_0();
        pendingOAuthStartRef_0.current = false;
      }, startOAuth, pendingOAuthStartRef);
    }
  }, [oauthStatus.state, startOAuth]);

  // Auto-exit for setup-token mode
// setup-token 成功后 500 毫秒自动退出：延迟是为了让令牌画面完整渲染；不清终端，令牌留在屏上供复制。
  useEffect(() => {
    if (mode === 'setup-token' && oauthStatus.state === 'success') {
      // Delay to ensure static content is fully rendered before exiting
      const timer_0 = setTimeout((loginWithClaudeAi_0, onDone_0) => {
        logEvent('tengu_oauth_success', {
          loginWithClaudeAi: loginWithClaudeAi_0
        });
        // Don't clear terminal so the token remains visible
        onDone_0();
      }, 500, loginWithClaudeAi, onDone);
      return () => clearTimeout(timer_0);
    }
  }, [mode, oauthStatus, loginWithClaudeAi, onDone]);

  // Cleanup OAuth service when component unmounts
// 卸载时清理 oauthService（关浏览器回跳监听等）。
  useEffect(() => {
    return () => {
      oauthService.cleanup();
    };
  }, [oauthService]);
// 渲染骨架：顶部按需插入「浏览器没开？」URL 提示块与 setup-token 的令牌展示块，主体交给 OAuthStatusMessage。
  return <Box flexDirection="column" gap={1}>
      {oauthStatus.state === 'waiting_for_login' && showPastePrompt && <Box flexDirection="column" key="urlToCopy" gap={1} paddingBottom={1}>
          <Box paddingX={1}>
            <Text dimColor>
              Browser didn&apos;t open? Use the url below to sign in{' '}
            </Text>
            {urlCopied ? <Text color="success">(Copied!)</Text> : <Text dimColor>
                <KeyboardShortcutHint shortcut="c" action="copy" parens />
              </Text>}
          </Box>
          <Link url={oauthStatus.url}>
            <Text dimColor>{oauthStatus.url}</Text>
          </Link>
        </Box>}
      {mode === 'setup-token' && oauthStatus.state === 'success' && oauthStatus.token && <Box key="tokenOutput" flexDirection="column" gap={1} paddingTop={1}>
            <Text color="success">
              ✓ Long-lived authentication token created successfully!
            </Text>
            <Box flexDirection="column" gap={1}>
              <Text>Your OAuth token (valid for 1 year):</Text>
              <Text color="warning">{oauthStatus.token}</Text>
              <Text dimColor>
                Store this token securely. You won&apos;t be able to see it
                again.
              </Text>
              <Text dimColor>
                Use this token by setting: export
                CLAUDE_CODE_OAUTH_TOKEN=&lt;token&gt;
              </Text>
            </Box>
          </Box>}
      <Box paddingLeft={1} flexDirection="column" gap={1}>
        <OAuthStatusMessage oauthStatus={oauthStatus} mode={mode} startingMessage={startingMessage} forcedMethodMessage={forcedMethodMessage} showPastePrompt={showPastePrompt} pastedCode={pastedCode} setPastedCode={setPastedCode} cursorOffset={cursorOffset} setCursorOffset={setCursorOffset} textInputColumns={textInputColumns} handleSubmitCode={handleSubmitCode} setOAuthStatus={setOAuthStatus} setLoginWithClaudeAi={setLoginWithClaudeAi} />
      </Box>
    </Box>;
}
type OAuthStatusMessageProps = {
  oauthStatus: OAuthStatus;
  mode: 'login' | 'setup-token';
  startingMessage: string | undefined;
  forcedMethodMessage: string | null;
  showPastePrompt: boolean;
  pastedCode: string;
  setPastedCode: (value: string) => void;
  cursorOffset: number;
  setCursorOffset: (offset: number) => void;
  textInputColumns: number;
  handleSubmitCode: (value: string, url: string) => void;
  setOAuthStatus: (status: OAuthStatus) => void;
  setLoginWithClaudeAi: (value: boolean) => void;
};
// 状态画面：按 oauthStatus 的 state 做 switch 分派；每个 case 内部又全是 memo 缓存样板——看 case 标签和最终 return 就够。
function OAuthStatusMessage(t0) {
  const $ = _c(51);
  const {
    oauthStatus,
    mode,
    startingMessage,
    forcedMethodMessage,
    showPastePrompt,
    pastedCode,
    setPastedCode,
    cursorOffset,
    setCursorOffset,
    textInputColumns,
    handleSubmitCode,
    setOAuthStatus,
    setLoginWithClaudeAi
  } = t0;
  switch (oauthStatus.state) {
// idle：欢迎语（可被 startingMessage 覆盖）加三选一。claudeai 选项的 label 里有一段恒为 false 短路的内部版提示（ANT-ONLY），对外部构建是死代码。
    case "idle":
      {
        const t1 = startingMessage ? startingMessage : "Claude Code can be used with your Claude subscription or billed based on API usage through your Console account.";
        let t2;
        if ($[0] !== t1) {
          t2 = <Text bold={true}>{t1}</Text>;
          $[0] = t1;
          $[1] = t2;
        } else {
          t2 = $[1];
        }
        let t3;
        if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
          t3 = <Text>Select login method:</Text>;
          $[2] = t3;
        } else {
          t3 = $[2];
        }
        let t4;
        if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
          t4 = {
            label: <Text>Claude account with subscription ·{" "}<Text dimColor={true}>Pro, Max, Team, or Enterprise</Text>{false && <Text>{"\n"}<Text color="warning">[ANT-ONLY]</Text>{" "}<Text dimColor={true}>Please use this option unless you need to login to a special org for accessing sensitive data (e.g. customer data, HIPI data) with the Console option</Text></Text>}{"\n"}</Text>,
            value: "claudeai"
          };
          $[3] = t4;
        } else {
          t4 = $[3];
        }
        let t5;
        if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
          t5 = {
            label: <Text>Anthropic Console account ·{" "}<Text dimColor={true}>API usage billing</Text>{"\n"}</Text>,
            value: "console"
          };
          $[4] = t5;
        } else {
          t5 = $[4];
        }
        let t6;
        if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
          t6 = [t4, t5, {
            label: <Text>3rd-party platform ·{" "}<Text dimColor={true}>Amazon Bedrock, Microsoft Foundry, or Vertex AI</Text>{"\n"}</Text>,
            value: "platform"
          }];
          $[5] = t6;
        } else {
          t6 = $[5];
        }
        let t7;
        if ($[6] !== setLoginWithClaudeAi || $[7] !== setOAuthStatus) {
// 选择分派：platform 进说明页；claudeai 与 console 都先切 ready_to_start 再记登录方式——effect 链会接着拉起 startOAuth。
          t7 = <Box><Select options={t6} onChange={value_0 => {
              if (value_0 === "platform") {
                logEvent("tengu_oauth_platform_selected", {});
                setOAuthStatus({
                  state: "platform_setup"
                });
              } else {
                setOAuthStatus({
                  state: "ready_to_start"
                });
                if (value_0 === "claudeai") {
                  logEvent("tengu_oauth_claudeai_selected", {});
                  setLoginWithClaudeAi(true);
                } else {
                  logEvent("tengu_oauth_console_selected", {});
                  setLoginWithClaudeAi(false);
                }
              }
            }} /></Box>;
          $[6] = setLoginWithClaudeAi;
          $[7] = setOAuthStatus;
          $[8] = t7;
        } else {
          t7 = $[8];
        }
        let t8;
        if ($[9] !== t2 || $[10] !== t7) {
          t8 = <Box flexDirection="column" gap={1} marginTop={1}>{t2}{t3}{t7}</Box>;
          $[9] = t2;
          $[10] = t7;
          $[11] = t8;
        } else {
          t8 = $[11];
        }
        return t8;
      }
    case "platform_setup":
      {
        let t1;
        if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <Text bold={true}>Using 3rd-party platforms</Text>;
          $[12] = t1;
        } else {
          t1 = $[12];
        }
        let t2;
        let t3;
        if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
          t2 = <Text>Claude Code supports Amazon Bedrock, Microsoft Foundry, and Vertex AI. Set the required environment variables, then restart Claude Code.</Text>;
          t3 = <Text>If you are part of an enterprise organization, contact your administrator for setup instructions.</Text>;
          $[13] = t2;
          $[14] = t3;
        } else {
          t2 = $[13];
          t3 = $[14];
        }
        let t4;
        if ($[15] === Symbol.for("react.memo_cache_sentinel")) {
          t4 = <Text bold={true}>Documentation:</Text>;
          $[15] = t4;
        } else {
          t4 = $[15];
        }
        let t5;
        if ($[16] === Symbol.for("react.memo_cache_sentinel")) {
          t5 = <Text>· Amazon Bedrock:{" "}<Link url="https://code.claude.com/docs/en/amazon-bedrock">https://code.claude.com/docs/en/amazon-bedrock</Link></Text>;
          $[16] = t5;
        } else {
          t5 = $[16];
        }
        let t6;
        if ($[17] === Symbol.for("react.memo_cache_sentinel")) {
          t6 = <Text>· Microsoft Foundry:{" "}<Link url="https://code.claude.com/docs/en/microsoft-foundry">https://code.claude.com/docs/en/microsoft-foundry</Link></Text>;
          $[17] = t6;
        } else {
          t6 = $[17];
        }
        let t7;
        if ($[18] === Symbol.for("react.memo_cache_sentinel")) {
          t7 = <Box flexDirection="column" marginTop={1}>{t4}{t5}{t6}<Text>· Vertex AI:{" "}<Link url="https://code.claude.com/docs/en/google-vertex-ai">https://code.claude.com/docs/en/google-vertex-ai</Link></Text></Box>;
          $[18] = t7;
        } else {
          t7 = $[18];
        }
        let t8;
        if ($[19] === Symbol.for("react.memo_cache_sentinel")) {
          t8 = <Box flexDirection="column" gap={1} marginTop={1}>{t1}<Box flexDirection="column" gap={1}>{t2}{t3}{t7}<Box marginTop={1}><Text dimColor={true}>Press <Text bold={true}>Enter</Text> to go back to login options.</Text></Box></Box></Box>;
          $[19] = t8;
        } else {
          t8 = $[19];
        }
        return t8;
      }
// waiting_for_login：强制方式提示（若有）加「正在打开浏览器」转圈（粘贴提示出现后消失）加粘贴输入框（掩码显示，宽度按前缀文案预算）。
    case "waiting_for_login":
      {
        let t1;
        if ($[20] !== forcedMethodMessage) {
          t1 = forcedMethodMessage && <Box><Text dimColor={true}>{forcedMethodMessage}</Text></Box>;
          $[20] = forcedMethodMessage;
          $[21] = t1;
        } else {
          t1 = $[21];
        }
        let t2;
        if ($[22] !== showPastePrompt) {
          t2 = !showPastePrompt && <Box><Spinner /><Text>Opening browser to sign in…</Text></Box>;
          $[22] = showPastePrompt;
          $[23] = t2;
        } else {
          t2 = $[23];
        }
        let t3;
        if ($[24] !== cursorOffset || $[25] !== handleSubmitCode || $[26] !== oauthStatus.url || $[27] !== pastedCode || $[28] !== setCursorOffset || $[29] !== setPastedCode || $[30] !== showPastePrompt || $[31] !== textInputColumns) {
          t3 = showPastePrompt && <Box><Text>{PASTE_HERE_MSG}</Text><TextInput value={pastedCode} onChange={setPastedCode} onSubmit={value => handleSubmitCode(value, oauthStatus.url)} cursorOffset={cursorOffset} onChangeCursorOffset={setCursorOffset} columns={textInputColumns} mask="*" /></Box>;
          $[24] = cursorOffset;
          $[25] = handleSubmitCode;
          $[26] = oauthStatus.url;
          $[27] = pastedCode;
          $[28] = setCursorOffset;
          $[29] = setPastedCode;
          $[30] = showPastePrompt;
          $[31] = textInputColumns;
          $[32] = t3;
        } else {
          t3 = $[32];
        }
        let t4;
        if ($[33] !== t1 || $[34] !== t2 || $[35] !== t3) {
          t4 = <Box flexDirection="column" gap={1}>{t1}{t2}{t3}</Box>;
          $[33] = t1;
          $[34] = t2;
          $[35] = t3;
          $[36] = t4;
        } else {
          t4 = $[36];
        }
        return t4;
      }
// creating_api_key：建 key 转圈。
    case "creating_api_key":
      {
        let t1;
        if ($[37] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <Box flexDirection="column" gap={1}><Box><Spinner /><Text>Creating API key for Claude Code…</Text></Box></Box>;
          $[37] = t1;
        } else {
          t1 = $[37];
        }
        return t1;
      }
    case "about_to_retry":
      {
        let t1;
        if ($[38] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <Box flexDirection="column" gap={1}><Text color="permission">Retrying…</Text></Box>;
          $[38] = t1;
        } else {
          t1 = $[38];
        }
        return t1;
      }
// success：setup-token 且有 token 时返回 null（令牌已由主组件渲染）；登录模式显示账号邮箱与成功提示。
    case "success":
      {
        let t1;
        if ($[39] !== mode || $[40] !== oauthStatus.token) {
          t1 = mode === "setup-token" && oauthStatus.token ? null : <>{getOauthAccountInfo()?.emailAddress ? <Text dimColor={true}>Logged in as{" "}<Text>{getOauthAccountInfo()?.emailAddress}</Text></Text> : null}<Text color="success">Login successful. Press <Text bold={true}>Enter</Text> to continue…</Text></>;
          $[39] = mode;
          $[40] = oauthStatus.token;
          $[41] = t1;
        } else {
          t1 = $[41];
        }
        let t2;
        if ($[42] !== t1) {
          t2 = <Box flexDirection="column">{t1}</Box>;
          $[42] = t1;
          $[43] = t2;
        } else {
          t2 = $[43];
        }
        return t2;
      }
// error：错误信息（已尽量换成 SSL 提示）；带 toRetry 时提示按 Enter 重试。
    case "error":
      {
        let t1;
        if ($[44] !== oauthStatus.message) {
          t1 = <Text color="error">OAuth error: {oauthStatus.message}</Text>;
          $[44] = oauthStatus.message;
          $[45] = t1;
        } else {
          t1 = $[45];
        }
        let t2;
        if ($[46] !== oauthStatus.toRetry) {
          t2 = oauthStatus.toRetry && <Box marginTop={1}><Text color="permission">Press <Text bold={true}>Enter</Text> to retry.</Text></Box>;
          $[46] = oauthStatus.toRetry;
          $[47] = t2;
        } else {
          t2 = $[47];
        }
        let t3;
        if ($[48] !== t1 || $[49] !== t2) {
          t3 = <Box flexDirection="column" gap={1}>{t1}{t2}</Box>;
          $[48] = t1;
          $[49] = t2;
          $[50] = t3;
        } else {
          t3 = $[50];
        }
        return t3;
      }
    default:
      {
        return null;
      }
  }
}
// 原文件此处有一行 56860 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。