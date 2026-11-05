// 通知系统：基于 AppState 的队列式通知（文本 / JSX），支持优先级、折叠与失效
import type * as React from 'react';
import { useCallback, useEffect } from 'react';
import { useAppStateStore, useSetAppState } from 'src/state/AppState.js';
import type { Theme } from '../utils/theme.js';
// Priority：通知优先级（立即 / 高 / 中 / 低）
type Priority = 'low' | 'medium' | 'high' | 'immediate';
// BaseNotification：通知基类，含 key、失效列表、优先级、超时与 fold 合并函数
type BaseNotification = {
  key: string;
  /**
   * Keys of notifications that this notification invalidates.
   * If a notification is invalidated, it will be removed from the queue
   * and, if currently displayed, cleared immediately.
   */
  invalidates?: string[];
  priority: Priority;
  timeoutMs?: number;
  /**
   * Combine notifications with the same key, like Array.reduce().
   * Called as fold(accumulator, incoming) when a notification with a matching
   * key already exists in the queue or is currently displayed.
   * Returns the merged notification (should carry fold forward for future merges).
   */
  fold?: (accumulator: Notification, incoming: Notification) => Notification;
};
// TextNotification 与 JSXNotification：文本或自定义 JSX 两种通知形态
type TextNotification = BaseNotification & {
  text: string;
  color?: keyof Theme;
};
type JSXNotification = BaseNotification & {
  jsx: React.ReactNode;
};
type AddNotificationFn = (content: Notification) => void;
type RemoveNotificationFn = (key: string) => void;
// Notification：两种通知的联合类型
export type Notification = TextNotification | JSXNotification;
// DEFAULT_TIMEOUT_MS：默认通知超时（8 秒）
const DEFAULT_TIMEOUT_MS = 8000;

// Track current timeout to clear it when immediate notifications arrive
let currentTimeoutId: NodeJS.Timeout | null = null;
// useNotifications：核心 Hook——addNotification 入队、removeNotification 出队、processQueue 推进显示
export function useNotifications(): {
  addNotification: AddNotificationFn;
  removeNotification: RemoveNotificationFn;
} {
  const store = useAppStateStore();
  const setAppState = useSetAppState();

  // Process queue when current notification finishes or queue changes
  const processQueue = useCallback(() => {
    setAppState(prev => {
      const next = getNext(prev.notifications.queue);
      if (prev.notifications.current !== null || !next) {
        return prev;
      }
      currentTimeoutId = setTimeout((setAppState, nextKey, processQueue) => {
        currentTimeoutId = null;
        setAppState(prev => {
          // Compare by key instead of reference to handle re-created notifications
          if (prev.notifications.current?.key !== nextKey) {
            return prev;
          }
          return {
            ...prev,
            notifications: {
              queue: prev.notifications.queue,
              current: null
            }
          };
        });
        processQueue();
      }, next.timeoutMs ?? DEFAULT_TIMEOUT_MS, setAppState, next.key, processQueue);
      return {
        ...prev,
        notifications: {
          queue: prev.notifications.queue.filter(_ => _ !== next),
          current: next
        }
      };
    });
  }, [setAppState]);
// addNotification：处理 immediate 优先级（立即清旧定时器并展示）与非即时通知（入队 / fold / 去重）
  const addNotification = useCallback<AddNotificationFn>((notif: Notification) => {
    // Handle immediate priority notifications
    if (notif.priority === 'immediate') {
      // Clear any existing timeout since we're showing a new immediate notification
      if (currentTimeoutId) {
        clearTimeout(currentTimeoutId);
        currentTimeoutId = null;
      }

      // Set up timeout for the immediate notification
      currentTimeoutId = setTimeout((setAppState, notif, processQueue) => {
        currentTimeoutId = null;
        setAppState(prev => {
          // Compare by key instead of reference to handle re-created notifications
          if (prev.notifications.current?.key !== notif.key) {
            return prev;
          }
          return {
            ...prev,
            notifications: {
              queue: prev.notifications.queue.filter(_ => !notif.invalidates?.includes(_.key)),
              current: null
            }
          };
        });
        processQueue();
      }, notif.timeoutMs ?? DEFAULT_TIMEOUT_MS, setAppState, notif, processQueue);

      // Show the immediate notification right away
      setAppState(prev => ({
        ...prev,
        notifications: {
          current: notif,
          queue:
          // Only re-queue the current notification if it's not immediate
          [...(prev.notifications.current ? [prev.notifications.current] : []), ...prev.notifications.queue].filter(_ => _.priority !== 'immediate' && !notif.invalidates?.includes(_.key))
        }
      }));
      return; // IMPORTANT: Exit addNotification for immediate notifications
    }

    // Handle non-immediate notifications
    setAppState(prev => {
      // Check if we can fold into an existing notification with the same key
      if (notif.fold) {
        // Fold into current notification if keys match
        if (prev.notifications.current?.key === notif.key) {
          const folded = notif.fold(prev.notifications.current, notif);
          // Reset timeout for the folded notification
          if (currentTimeoutId) {
            clearTimeout(currentTimeoutId);
            currentTimeoutId = null;
          }
          currentTimeoutId = setTimeout((setAppState, foldedKey, processQueue) => {
            currentTimeoutId = null;
            setAppState(p => {
              if (p.notifications.current?.key !== foldedKey) {
                return p;
              }
              return {
                ...p,
                notifications: {
                  queue: p.notifications.queue,
                  current: null
                }
              };
            });
            processQueue();
          }, folded.timeoutMs ?? DEFAULT_TIMEOUT_MS, setAppState, folded.key, processQueue);
          return {
            ...prev,
            notifications: {
              current: folded,
              queue: prev.notifications.queue
            }
          };
        }

        // Fold into queued notification if keys match
        const queueIdx = prev.notifications.queue.findIndex(_ => _.key === notif.key);
        if (queueIdx !== -1) {
          const folded = notif.fold(prev.notifications.queue[queueIdx]!, notif);
          const newQueue = [...prev.notifications.queue];
          newQueue[queueIdx] = folded;
          return {
            ...prev,
            notifications: {
              current: prev.notifications.current,
              queue: newQueue
            }
          };
        }
      }

      // Only add to queue if not already present (prevent duplicates)
      const queuedKeys = new Set(prev.notifications.queue.map(_ => _.key));
      const shouldAdd = !queuedKeys.has(notif.key) && prev.notifications.current?.key !== notif.key;
      if (!shouldAdd) return prev;
      const invalidatesCurrent = prev.notifications.current !== null && notif.invalidates?.includes(prev.notifications.current.key);
      if (invalidatesCurrent && currentTimeoutId) {
        clearTimeout(currentTimeoutId);
        currentTimeoutId = null;
      }
      return {
        ...prev,
        notifications: {
          current: invalidatesCurrent ? null : prev.notifications.current,
          queue: [...prev.notifications.queue.filter(_ => _.priority !== 'immediate' && !notif.invalidates?.includes(_.key)), notif]
        }
      };
    });

    // Process queue after adding the notification
    processQueue();
  }, [setAppState, processQueue]);
// removeNotification：按 key 移除当前或队列中的通知并清理定时器
  const removeNotification = useCallback<RemoveNotificationFn>((key: string) => {
    setAppState(prev => {
      const isCurrent = prev.notifications.current?.key === key;
      const inQueue = prev.notifications.queue.some(n => n.key === key);
      if (!isCurrent && !inQueue) {
        return prev;
      }
      if (isCurrent && currentTimeoutId) {
        clearTimeout(currentTimeoutId);
        currentTimeoutId = null;
      }
      return {
        ...prev,
        notifications: {
          current: isCurrent ? null : prev.notifications.current,
          queue: prev.notifications.queue.filter(n => n.key !== key)
        }
      };
    });
    processQueue();
  }, [setAppState, processQueue]);

  // Process queue on mount if there are notifications in the initial state.
  // Imperative read (not useAppState) — a subscription in a mount-only
  // effect would be vestigial and make every caller re-render on queue changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect, store is a stable context ref
  useEffect(() => {
    if (store.getState().notifications.queue.length > 0) {
      processQueue();
    }
  }, []);
// 挂载时若初始状态已有通知则立即推进队列（仅挂载一次，直接读 store 而非订阅）
  return {
    addNotification,
    removeNotification
  };
}
// PRIORITIES：优先级到数值的映射（数值越小越优先）
const PRIORITIES: Record<Priority, number> = {
  immediate: 0,
  high: 1,
  medium: 2,
  low: 3
};
// getNext：从队列取出优先级最高的通知（reduce 比较映射值）
export function getNext(queue: Notification[]): Notification | undefined {
  if (queue.length === 0) return undefined;
  return queue.reduce((min, n) => PRIORITIES[n.priority] < PRIORITIES[min.priority] ? n : min);
}
// 原文件此处有一行 24268 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。