import { execa } from 'execa';
import * as React from 'react';
import { useEffect, useState } from 'react';
import { Select } from '../../components/CustomSelect/index.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { LoadingState } from '../../components/design-system/LoadingState.js';
import { Box, Text } from '../../ink.js';
import { logEvent, type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS as SafeString } from '../../services/analytics/index.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { openBrowser } from '../../utils/browser.js';
import { getGhAuthStatus } from '../../utils/github/ghAuthStatus.js';
import { createDefaultEnvironment, getCodeWebUrl, type ImportTokenError, importGithubToken, isSignedIn, RedactedGithubToken } from './api.js';
// 登录态检查结果分成四种：未登录、有令牌、gh 未装、gh 未认证
type CheckResult = {
  status: 'not_signed_in';
} | {
  status: 'has_gh_token';
  token: RedactedGithubToken;
} | {
  status: 'gh_not_installed';
} | {
  status: 'gh_not_authenticated';
};
// 先判断有没有登录 Claude，再判断 gh 的认证态，最后才读令牌
async function checkLoginState(): Promise<CheckResult> {
  if (!(await isSignedIn())) {
    return {
      status: 'not_signed_in'
    };
  }
  const ghStatus = await getGhAuthStatus();
  if (ghStatus === 'not_installed') {
    return {
      status: 'gh_not_installed'
    };
  }
  if (ghStatus === 'not_authenticated') {
    return {
      status: 'gh_not_authenticated'
    };
  }

  // ghStatus === 'authenticated'. getGhAuthStatus spawns with stdout:'ignore'
  // (telemetry-safe); spawn once more with stdout:'pipe' to read the token.
// 已认证时再启一个子进程读令牌：前一个用 ignore 输出（遥测安全），这个用 pipe 读值
  const {
    stdout
  } = await execa('gh', ['auth', 'token'], {
    stdout: 'pipe',
    stderr: 'ignore',
    timeout: 5000,
    reject: false
  });
  const trimmed = stdout.trim();
  if (!trimmed) {
    return {
      status: 'gh_not_authenticated'
    };
  }
  return {
    status: 'has_gh_token',
    token: new RedactedGithubToken(trimmed)
  };
}
// 把错误种类翻成用户能懂的文案：未登录、令牌无效、服务端、网络各自一句
function errorMessage(err: ImportTokenError, codeUrl: string): string {
  switch (err.kind) {
    case 'not_signed_in':
      return `Login failed. Please visit ${codeUrl} and login using the GitHub App`;
    case 'invalid_token':
      return 'GitHub rejected that token. Run `gh auth login` and try again.';
    case 'server':
      return `Server error (${err.status}). Try again in a moment.`;
    case 'network':
      return "Couldn't reach the server. Check your connection.";
  }
}
// 步骤状态机只有三步：检测中、待确认、上传中
type Step = {
  name: 'checking';
} | {
  name: 'confirm';
  token: RedactedGithubToken;
} | {
  name: 'uploading';
};
// Web 组件：挂载时查登录态，按结果决定继续、跳转到浏览器还是直接报错
function Web({
  onDone
}: {
  onDone: LocalJSXCommandOnDone;
}) {
  const [step, setStep] = useState<Step>({
    name: 'checking'
  });
// 挂载即上报开始事件，并异步查登录态
  useEffect(() => {
    logEvent('tengu_remote_setup_started', {});
    void checkLoginState().then(async result => {
      switch (result.status) {
        case 'not_signed_in':
          logEvent('tengu_remote_setup_result', {
            result: 'not_signed_in' as SafeString
          });
          onDone('Not signed in to Claude. Run /login first.');
          return;
        case 'gh_not_installed':
        case 'gh_not_authenticated':
          {
            const url = `${getCodeWebUrl()}/onboarding?step=alt-auth`;
            await openBrowser(url);
            logEvent('tengu_remote_setup_result', {
              result: result.status as SafeString
            });
            onDone(result.status === 'gh_not_installed' ? `GitHub CLI not found. Install it via https://cli.github.com/, then run \`gh auth login\`, or connect GitHub on the web: ${url}` : `GitHub CLI not authenticated. Run \`gh auth login\` and try again, or connect GitHub on the web: ${url}`);
            return;
          }
        case 'has_gh_token':
          setStep({
            name: 'confirm',
            token: result.token
          });
      }
    });
// onDone 跨渲染稳定，故意不写进依赖数组
    // onDone is stable across renders; intentionally not in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
// 取消：上报 cancelled 事件后直接结束步骤
  const handleCancel = () => {
    logEvent('tengu_remote_setup_result', {
      result: 'cancelled' as SafeString
    });
    onDone();
  };
// 确认：先切到上传中，导入令牌；失败报错，成功则建默认环境并打开网页
  const handleConfirm = async (token: RedactedGithubToken) => {
    setStep({
      name: 'uploading'
    });
    const result = await importGithubToken(token);
    if (!result.ok) {
      logEvent('tengu_remote_setup_result', {
        result: 'import_failed' as SafeString,
        error_kind: result.error.kind as SafeString
      });
      onDone(errorMessage(result.error, getCodeWebUrl()));
      return;
    }

    // Token import succeeded. Environment creation is best-effort — if it
    // fails, the web state machine routes to env-setup on landing, which is
    // one extra click but still better than the OAuth dance.
// 令牌导入成功后建环境是尽力而为：失败也不阻断，网页状态机会引导去补
    await createDefaultEnvironment();
    const url = getCodeWebUrl();
    await openBrowser(url);
    logEvent('tengu_remote_setup_result', {
      result: 'success' as SafeString
    });
    onDone(`Connected as ${result.result.github_username}. Opened ${url}`);
  };
// 检测中显示加载态
  if (step.name === 'checking') {
    return <LoadingState message="Checking login status…" />;
  }
  if (step.name === 'uploading') {
    return <LoadingState message="Connecting GitHub to Claude…" />;
  }
  const token = step.token;
// 确认弹窗：说明网页端需要连 GitHub 才能代你克隆推送
  return <Dialog title="Connect Claude on the web to GitHub?" onCancel={handleCancel} hideInputGuide>
      <Box flexDirection="column">
        <Text>
          Claude on the web requires connecting to your GitHub account to clone
          and push code on your behalf.
        </Text>
        <Text dimColor>
          Your local credentials are used to authenticate with GitHub
        </Text>
      </Box>
      <Select options={[{
      label: 'Continue',
      value: 'send'
    }, {
      label: 'Cancel',
      value: 'cancel'
    }]} onChange={value => {
      if (value === 'send') {
        void handleConfirm(token);
      } else {
        handleCancel();
      }
    }} onCancel={handleCancel} />
    </Dialog>;
}
// 命令入口：只负责把 Web 组件挂上 onDone 回调
export async function call(onDone: LocalJSXCommandOnDone): Promise<React.ReactNode> {
  return <Web onDone={onDone} />;
}
// 原文件此处有一行 15696 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。