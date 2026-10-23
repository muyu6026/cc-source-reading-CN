import type { Notification } from 'src/context/notifications.js';
import { type GlobalConfig, getGlobalConfig } from 'src/utils/config.js';
import { useStartupNotification } from './useStartupNotification.js';

// Shows a one-time notification right after a model migration writes its
// timestamp to config. Each entry reads its own timestamp field(s) and emits
// a notification if the write happened within the last 3s (i.e. this launch).
// Future model migrations: add an entry to MIGRATIONS below.
// 模型迁移（如 Sonnet 4.5→4.6、Opus Pro→4.6）在写 config
// 时间戳的同一次启动里弹一次性通知。判据：时间戳在最近 3s 内
// 被写入 = 本次启动刚迁移。新迁移加一条 MIGRATIONS 即可。
// 迁移表：每项读自己的时间戳字段，命中返回通知。
// 类型签名显式声明返回 Notification | undefined。
const MIGRATIONS: ((c: GlobalConfig) => Notification | undefined)[] = [
// Sonnet 4.5 → 4.6 (pro/max/team premium)
c => {
  if (!recent(c.sonnet45To46MigrationTimestamp)) return;
// Sonnet 4.5→4.6（pro/max/team 高级账号）。
  return {
    key: 'sonnet-46-update',
    text: 'Model updated to Sonnet 4.6',
    color: 'suggestion',
    priority: 'high',
    timeoutMs: 3000
  };
},
// Opus Pro → default, or pinned 4.0/4.1 → opus alias. Both land on the
// current Opus default (4.6 for 1P).
c => {
// 两条迁移路径共用一条通知文案：legacy remap
// （老 pinned 4.0/4.1 → 当前默认）与 Opus Pro → 默认，
// 但 remap 文案更长（含 opt-out 环境变量）且停留 8s。
  const isLegacyRemap = Boolean(c.legacyOpusMigrationTimestamp);
  const ts = c.legacyOpusMigrationTimestamp ?? c.opusProMigrationTimestamp;
  if (!recent(ts)) return;
  return {
    key: 'opus-pro-update',
    text: isLegacyRemap ? 'Model updated to Opus 4.6 · Set CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP=1 to opt out' : 'Model updated to Opus 4.6',
    color: 'suggestion',
    priority: 'high',
    timeoutMs: isLegacyRemap ? 8000 : 3000
  };
}];
export function useModelMigrationNotifications() {
  useStartupNotification(_temp);
// 把整个迁移表塞进 useStartupNotification 一次跑完。
}
function _temp() {
  const config = getGlobalConfig();
  const notifs = [];
  for (const migration of MIGRATIONS) {
    const notif = migration(config);
    if (notif) {
      notifs.push(notif);
    }
  }
  return notifs.length > 0 ? notifs : null;
}
// 3s 窗口：比启动到通知渲染的间隔略宽，
// 又不至于把昨天迁移的用户也算上。
function recent(ts: number | undefined): boolean {
  return ts !== undefined && Date.now() - ts < 3000;
}
// 原文件此处有一行 5132 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。