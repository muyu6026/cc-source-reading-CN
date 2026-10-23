import { c as _c } from "react/compiler-runtime";
import { useCallback, useEffect, useState } from 'react';
import { useNotifications } from 'src/context/notifications.js';
import { getIsRemoteMode } from '../../bootstrap/state.js';
import { getSettingsWithAllErrors } from '../../utils/settings/allErrors.js';
import type { ValidationError } from '../../utils/settings/validation.js';
import { useSettingsChange } from '../useSettingsChange.js';
const SETTINGS_ERRORS_NOTIFICATION_KEY = 'settings-errors';
// 通知 key 固定，add/remove 成对操作同一 key。
export function useSettingsErrors() {
// 设置错误通知。初始渲染即同步扫一遍全部错误
// （getSettingsWithAllErrors），之后监听设置变更重扫；
// 有错弹警告（60s 不自动消失），没错撤通知。
// 同时把错误列表 return 出去给 /doctor 页复用。
  const $ = _c(6);
  const {
    addNotification,
    removeNotification
  } = useNotifications();
  const [errors_0, setErrors] = useState(_temp);
// useState 初始化即读全部错误（同步），首帧就有数据。
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = () => {
      const {
        errors: errors_1
      } = getSettingsWithAllErrors();
      setErrors(errors_1);
    };
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  const handleSettingsChange = t0;
  useSettingsChange(handleSettingsChange);
// 设置文件变更 → 重新全量扫描（含 user/project/local 各层错误）。
  let t1;
  let t2;
  if ($[1] !== addNotification || $[2] !== errors_0 || $[3] !== removeNotification) {
    t1 = () => {
      if (getIsRemoteMode()) {
        return;
      }
      if (errors_0.length > 0) {
        const message = `Found ${errors_0.length} settings ${errors_0.length === 1 ? "issue" : "issues"} · /doctor for details`;
// 文案单复数切换（1 issue / N issues），
// 统一引导 /doctor 查看详情。
        addNotification({
          key: SETTINGS_ERRORS_NOTIFICATION_KEY,
          text: message,
          color: "warning",
          priority: "high",
// 60s 超时：比其他通知长得多——设置错误需要用户
// 停下来去修，不轻易自动消失。
          timeoutMs: 60000
        });
      } else {
        removeNotification(SETTINGS_ERRORS_NOTIFICATION_KEY);
      }
    };
    t2 = [errors_0, addNotification, removeNotification];
    $[1] = addNotification;
    $[2] = errors_0;
    $[3] = removeNotification;
    $[4] = t1;
    $[5] = t2;
  } else {
    t1 = $[4];
    t2 = $[5];
  }
  useEffect(t1, t2);
  return errors_0;
}
// 同步读取全部错误的初始化函数。
function _temp() {
  const {
    errors
  } = getSettingsWithAllErrors();
  return errors;
}
// 原文件此处有一行 4768 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。