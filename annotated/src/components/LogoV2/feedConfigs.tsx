import figures from 'figures';
import { homedir } from 'os';
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import type { Step } from '../../projectOnboardingState.js';
import { formatCreditAmount, getCachedReferrerReward } from '../../services/api/referral.js';
import type { LogOption } from '../../types/logs.js';
import { getCwd } from '../../utils/cwd.js';
import { formatRelativeTimeAgo } from '../../utils/format.js';
import type { FeedConfig, FeedLine } from './Feed.js';
// 四个 Feed 工厂函数之一（RecentActivity）：把会话日志转成 FeedConfig（标题+行+footer+空态文案）
export function createRecentActivityFeed(activities: LogOption[]): FeedConfig {
  const lines: FeedLine[] = activities.map(log => {
    const time = formatRelativeTimeAgo(log.modified);
    const description = log.summary && log.summary !== 'No prompt' ? log.summary : log.firstPrompt;
// 描述优先取 summary，但排除「No prompt」占位文案，回落到 firstPrompt
    return {
      text: description || '',
      timestamp: time
    };
  });
  return {
    title: 'Recent activity',
    lines,
    footer: lines.length > 0 ? '/resume for more' : undefined,
// footer 是行动入口：/resume for more；空列表时 undefined 隐藏
    emptyMessage: 'No recent activity'
  };
}
// WhatsNew 工厂：release notes 列表转 Feed
export function createWhatsNewFeed(releaseNotes: string[]): FeedConfig {
  const lines: FeedLine[] = releaseNotes.map(note => {
    if ("external" === 'ant') {
// 「external」===「ant」是构建期内联的 feature flag：对外版本恒为 false，内部版本才解析时间戳前缀——死代码保留以便内部构建复用
      const match = note.match(/^(\d+\s+\w+\s+ago)\s+(.+)$/);
      if (match) {
        return {
          timestamp: match[1],
          text: match[2] || ''
        };
      }
    }
    return {
      text: note
    };
  });
  const emptyMessage = "external" === 'ant' ? 'Unable to fetch latest claude-cli-internal commits' : 'Check the Claude Code changelog for updates';
// emptyMessage 与 title 都按同一 flag 分叉：内部版显示 CC 内部 commits，外部版引导看 changelog
  return {
    title: "external" === 'ant' ? "What's new [ANT-ONLY: Latest CC commits]" : "What's new",
    lines,
    footer: lines.length > 0 ? '/release-notes for more' : undefined,
    emptyMessage
  };
}
// ProjectOnboarding 工厂：过滤启用步骤并排序
export function createProjectOnboardingFeed(steps: Step[]): FeedConfig {
  const enabledSteps = steps.filter(({
    isEnabled
  }) => isEnabled).sort((a, b) => Number(a.isComplete) - Number(b.isComplete));
// sort 按 Number(isComplete) 升序：未完成（0）排前、已完成（1）排后——待办项置顶，完成项带勾沉底
  const lines: FeedLine[] = enabledSteps.map(({
    text,
    isComplete
  }) => {
    const checkmark = isComplete ? `${figures.tick} ` : '';
// checkmark 前缀：完成加勾和空格，未完成是空串
    return {
      text: `${checkmark}${text}`
    };
  });
  const warningText = getCwd() === homedir() ? 'Note: You have launched claude in your home directory. For the best experience, launch it in a project directory instead.' : undefined;
// home 目录警告：cwd 等于 homedir 时追加一条提示——在家目录跑 claude 体验不佳
  if (warningText) {
    lines.push({
      text: warningText
    });
  }
  return {
    title: 'Tips for getting started',
    lines
  };
}
// GuestPasses 工厂：无 lines，用 customContent 自定义渲染区
export function createGuestPassesFeed(): FeedConfig {
  const reward = getCachedReferrerReward();
  const subtitle = reward ? `Share Claude Code and earn ${formatCreditAmount(reward)} of extra usage` : 'Share Claude Code with friends';
// subtitle 按有无推荐奖励分叉：有奖励显示具体金额（formatCreditAmount），没有就是泛泛的分享文案
  return {
    title: '3 guest passes',
    lines: [],
    customContent: {
      content: <>
          <Box marginY={1}>
            <Text color="claude">[✻] [✻] [✻]</Text>
          </Box>
          <Text dimColor>{subtitle}</Text>
        </>,
      width: 48
// customContent 带 width: 48：自定义内容需要显式宽度，Feed 才能对齐布局
    },
    footer: '/passes'
  };
}
// 原文件此处有一行 9152 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。