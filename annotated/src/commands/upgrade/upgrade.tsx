import * as React from 'react';
// /upgrade 命令：已是最高的 Max 20x 订阅则提示无需升级；否则打开浏览器到升级页，并用登录组件完成切换 API 计费账户。
import type { LocalJSXCommandContext } from '../../commands.js';
import { getOauthProfileFromOauthToken } from '../../services/oauth/getOauthProfile.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { getClaudeAIOAuthTokens, isClaudeAISubscriber } from '../../utils/auth.js';
import { openBrowser } from '../../utils/browser.js';
import { logError } from '../../utils/log.js';
import { Login } from '../login/login.js';
export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode | null> {
// 命令入口：先检查是否已是最高档 Max 订阅。
  try {
    // Check if user is already on the highest Max plan (20x)
    if (isClaudeAISubscriber()) {
// 仅对 Claude AI 订阅用户做最高档判断。
      const tokens = getClaudeAIOAuthTokens();
      let isMax20x = false;
      if (tokens?.subscriptionType && tokens?.rateLimitTier) {
// 从令牌字段或 OAuth profile 判断是否为 max + 20x 档。
        isMax20x = tokens.subscriptionType === 'max' && tokens.rateLimitTier === 'default_claude_max_20x';
      } else if (tokens?.accessToken) {
        const profile = await getOauthProfileFromOauthToken(tokens.accessToken);
        isMax20x = profile?.organization?.organization_type === 'claude_max' && profile?.organization?.rate_limit_tier === 'default_claude_max_20x';
      }
      if (isMax20x) {
// 已是 20x 则延迟回调提示并返回，不打浏览器。
        setTimeout(onDone, 0, 'You are already on the highest Max subscription plan. For additional usage, run /login to switch to an API usage-billed account.');
        return null;
      }
    }
    const url = 'https://claude.ai/upgrade/max';
// 否则打开升级页并渲染登录组件，登录成功后切换 API 密钥。
    await openBrowser(url);
    return <Login startingMessage={'Starting new login following /upgrade. Exit with Ctrl-C to use existing account.'} onDone={success => {
      context.onChangeAPIKey();
      onDone(success ? 'Login successful' : 'Login interrupted');
    }} />;
  } catch (error) {
// 失败则提示手动访问升级链接。
    logError(error as Error);
    setTimeout(onDone, 0, 'Failed to open browser. Please visit https://claude.ai/upgrade/max to upgrade.');
  }
  return null;
}
// 原文件此处有一行 5476 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。