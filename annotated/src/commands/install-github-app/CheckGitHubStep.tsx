import { c as _c } from "react/compiler-runtime";
// React Compiler 运行时：每个组件顶部由编译器注入 `_c(N)` 缓存槽，N 为需要记忆的值的数量。
import React from 'react';
import { Text } from '../../ink.js';
export function CheckGitHubStep() {
// 纯展示组件，只渲染一行状态文案，提示用户正在检测本机 GitHub CLI 是否就绪。
  const $ = _c(1);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = <Text>Checking GitHub CLI installation…</Text>;
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  return t0;
// 命中或未命中缓存都返回同一 `t0`，编译器把整个组件体收敛成单值记忆化结果。
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJSZWFjdCIsIlRleHQiLCJDaGVja0dpdEh1YlN0ZXAiLCIkIiwiX2MiLCJ0MCIsIlN5bWJvbCIsImZvciJdLCJzb3VyY2VzIjpbIkNoZWNrR2l0SHViU3RlcC50c3giXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IFJlYWN0IGZyb20gJ3JlYWN0J1xuaW1wb3J0IHsgVGV4dCB9IGZyb20gJy4uLy4uL2luay5qcydcblxuZXhwb3J0IGZ1bmN0aW9uIENoZWNrR2l0SHViU3RlcCgpIHtcbiAgcmV0dXJuIDxUZXh0PkNoZWNraW5nIEdpdEh1YiBDTEkgaW5zdGFsbGF0aW9u4oCmPC9UZXh0PlxufVxuIl0sIm1hcHBpbmdzIjoiO0FBQUEsT0FBT0EsS0FBSyxNQUFNLE9BQU87QUFDekIsU0FBU0MsSUFBSSxRQUFRLGNBQWM7QUFFbkMsT0FBTyxTQUFBQyxnQkFBQTtFQUFBLE1BQUFDLENBQUEsR0FBQUMsRUFBQTtFQUFBLElBQUFDLEVBQUE7RUFBQSxJQUFBRixDQUFBLFFBQUFHLE1BQUEsQ0FBQUMsR0FBQTtJQUNFRixFQUFBLElBQUMsSUFBSSxDQUFDLGlDQUFpQyxFQUF0QyxJQUFJLENBQXlDO0lBQUFGLENBQUEsTUFBQUUsRUFBQTtFQUFBO0lBQUFBLEVBQUEsR0FBQUYsQ0FBQTtFQUFBO0VBQUEsT0FBOUNFLEVBQThDO0FBQUEiLCJpZ25vcmVMaXN0IjpbXX0=