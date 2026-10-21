// 【utils.tsx：整个子目录唯一的一个 hook】
//
//  它做一件很窄的事：给一个 tool_use_id，在 lookups 里找到那次调用
//  和它的工具定义，打成一个包返回。
//
//  为什么值得单独抽出来？因为四个子组件都要这个包，
//  而且它们都要**在找不到时安静地什么都不画** ——
//  把「两级 Map 查找 + 两次失败返回 null」封在一处，
//  四处调用点就都变成一行了。
import { c as _c } from "react/compiler-runtime";
import type { ToolUseBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { useMemo } from 'react';
import { findToolByName, type Tool, type Tools } from '../../../Tool.js';
import type { buildMessageLookups } from '../../../utils/messages.js';
// 【函数名以 use 开头，但它是普通 hook 不是「自定义 hook 规范」的范例】
//
//  它返回 `{ tool, toolUse } | null` —— 一个可空的复合对象。
//  这让调用点必须写 `if (!toolUse) return null`，
//  而不是在组件里做两次非空断言。
//
//  **返回可空对象、让调用方显式处理缺席**，比抛错或返回空对象好：
//  前者会崩，后者会让下游拿到假数据（一个没有 name 的 tool）。
//
//  这个仓库里另一种做法是返回 undefined 并按 truthy 判断（常见于
//  findToolByName）。两种都行，但同一个函数里别混用。
export function useGetToolFromMessages(toolUseID, tools, lookups) {
  const $ = _c(7);
  let t0;
// 【依赖数组是 `[toolUseID, lookups, tools]` —— lookups 是对象】
//
//  这意味着**lookups 的引用变了就重算**。而 lookups 是 Messages.tsx
//  每次渲染重建的吗？不是 —— buildMessageLookups 的结果通常被缓存
//  （上一批读过 Messages.tsx 的七道工序）。
//
//  如果哪天 lookups 变成每次新建，这个 hook 就会退化成「每次渲染都重查」。
//  查两次 Map 的代价不大，但外层组件的 memo 也会跟着失效 ——
//  这是「一个上游对象的引用稳定性决定下游一条链的性能」。
//
//  读这类依赖数组时，要顺手确认：**那个对象是谁建的，稳不稳。**
  if ($[0] !== lookups.toolUseByToolUseID || $[1] !== toolUseID || $[2] !== tools) {
    bb0: {
      const toolUse = lookups.toolUseByToolUseID.get(toolUseID);
      if (!toolUse) {
        t0 = null;
        break bb0;
      }
      const tool = findToolByName(tools, toolUse.name);
      if (!tool) {
        t0 = null;
        break bb0;
      }
      let t1;
// 【内层还有一个缓存槽：$[4] !== tool || $[5] !== toolUse】
//
//  为什么外层的 useMemo 之外还要有槽？因为 useMemo 缓存的是
//  **整个计算**（含两次 Map 查找），而内层槽缓存的是**那个对象字面量**。
//
//  两者是不同层级的缓存：
//      useMemo   toolUseID / lookups / tools 都没变 → 完全跳过
//      内层槽    走到了这里，但 tool 和 toolUse 都没变 → 复用上次的对象
//
//  第二层的作用是保证**返回的对象引用稳定** ——
//  否则哪怕值一样，调用点拿到的也是一个新对象，下游 memo 全失效。
//
//  这就是产物里「槽套槽」的典型形态：外层是业务缓存，内层是引用缓存。
      if ($[4] !== tool || $[5] !== toolUse) {
        t1 = {
          tool,
          toolUse
        };
        $[4] = tool;
        $[5] = toolUse;
        $[6] = t1;
      } else {
        t1 = $[6];
      }
      t0 = t1;
    }
    $[0] = lookups.toolUseByToolUseID;
    $[1] = toolUseID;
    $[2] = tools;
    $[3] = t0;
  } else {
    t0 = $[3];
  }
  return t0;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJUb29sVXNlQmxvY2tQYXJhbSIsInVzZU1lbW8iLCJmaW5kVG9vbEJ5TmFtZSIsIlRvb2wiLCJUb29scyIsImJ1aWxkTWVzc2FnZUxvb2t1cHMiLCJ1c2VHZXRUb29sRnJvbU1lc3NhZ2VzIiwidG9vbFVzZUlEIiwidG9vbHMiLCJsb29rdXBzIiwiJCIsIl9jIiwidDAiLCJ0b29sVXNlQnlUb29sVXNlSUQiLCJiYjAiLCJ0b29sVXNlIiwiZ2V0IiwidG9vbCIsIm5hbWUiLCJ0MSJdLCJzb3VyY2VzIjpbInV0aWxzLnRzeCJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7IFRvb2xVc2VCbG9ja1BhcmFtIH0gZnJvbSAnQGFudGhyb3BpYy1haS9zZGsvcmVzb3VyY2VzL2luZGV4Lm1qcydcbmltcG9ydCB7IHVzZU1lbW8gfSBmcm9tICdyZWFjdCdcbmltcG9ydCB7IGZpbmRUb29sQnlOYW1lLCB0eXBlIFRvb2wsIHR5cGUgVG9vbHMgfSBmcm9tICcuLi8uLi8uLi9Ub29sLmpzJ1xuaW1wb3J0IHR5cGUgeyBidWlsZE1lc3NhZ2VMb29rdXBzIH0gZnJvbSAnLi4vLi4vLi4vdXRpbHMvbWVzc2FnZXMuanMnXG5cbmV4cG9ydCBmdW5jdGlvbiB1c2VHZXRUb29sRnJvbU1lc3NhZ2VzKFxuICB0b29sVXNlSUQ6IHN0cmluZyxcbiAgdG9vbHM6IFRvb2xzLFxuICBsb29rdXBzOiBSZXR1cm5UeXBlPHR5cGVvZiBidWlsZE1lc3NhZ2VMb29rdXBzPixcbik6IHsgdG9vbDogVG9vbDsgdG9vbFVzZTogVG9vbFVzZUJsb2NrUGFyYW0gfSB8IG51bGwge1xuICByZXR1cm4gdXNlTWVtbygoKSA9PiB7XG4gICAgY29uc3QgdG9vbFVzZSA9IGxvb2t1cHMudG9vbFVzZUJ5VG9vbFVzZUlELmdldCh0b29sVXNlSUQpXG4gICAgaWYgKCF0b29sVXNlKSB7XG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cbiAgICBjb25zdCB0b29sID0gZmluZFRvb2xCeU5hbWUodG9vbHMsIHRvb2xVc2UubmFtZSlcbiAgICBpZiAoIXRvb2wpIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuICAgIHJldHVybiB7IHRvb2wsIHRvb2xVc2UgfVxuICB9LCBbdG9vbFVzZUlELCBsb29rdXBzLCB0b29sc10pXG59XG4iXSwibWFwcGluZ3MiOiI7QUFBQSxjQUFjQSxpQkFBaUIsUUFBUSx1Q0FBdUM7QUFDOUUsU0FBU0MsT0FBTyxRQUFRLE9BQU87QUFDL0IsU0FBU0MsY0FBYyxFQUFFLEtBQUtDLElBQUksRUFBRSxLQUFLQyxLQUFLLFFBQVEsa0JBQWtCO0FBQ3hFLGNBQWNDLG1CQUFtQixRQUFRLDRCQUE0QjtBQUVyRSxPQUFPLFNBQUFDLHVCQUFBQyxTQUFBLEVBQUFDLEtBQUEsRUFBQUMsT0FBQTtFQUFBLE1BQUFDLENBQUEsR0FBQUMsRUFBQTtFQUFBLElBQUFDLEVBQUE7RUFBQSxJQUFBRixDQUFBLFFBQUFELE9BQUEsQ0FBQUksa0JBQUEsSUFBQUgsQ0FBQSxRQUFBSCxTQUFBLElBQUFHLENBQUEsUUFBQUYsS0FBQTtJQUFBTSxHQUFBO01BTUgsTUFBQUMsT0FBQSxHQUFnQk4sT0FBTyxDQUFBSSxrQkFBbUIsQ0FBQUcsR0FBSSxDQUFDVCxTQUFTLENBQUM7TUFDekQsSUFBSSxDQUFDUSxPQUFPO1FBQ1ZILEVBQUEsR0FBTyxJQUFJO1FBQVgsTUFBQUUsR0FBQTtNQUFXO01BRWIsTUFBQUcsSUFBQSxHQUFhZixjQUFjLENBQUNNLEtBQUssRUFBRU8sT0FBTyxDQUFBRyxJQUFLLENBQUM7TUFDaEQsSUFBSSxDQUFDRCxJQUFJO1FBQ1BMLEVBQUEsR0FBTyxJQUFJO1FBQVgsTUFBQUUsR0FBQTtNQUFXO01BQ1osSUFBQUssRUFBQTtNQUFBLElBQUFULENBQUEsUUFBQU8sSUFBQSxJQUFBUCxDQUFBLFFBQUFLLE9BQUE7UUFDTUksRUFBQTtVQUFBRixJQUFBO1VBQUFGO1FBQWdCLENBQUM7UUFBQUwsQ0FBQSxNQUFBTyxJQUFBO1FBQUFQLENBQUEsTUFBQUssT0FBQTtRQUFBTCxDQUFBLE1BQUFTLEVBQUE7TUFBQTtRQUFBQSxFQUFBLEdBQUFULENBQUE7TUFBQTtNQUF4QkUsRUFBQSxHQUFPTyxFQUFpQjtJQUFBO0lBQUFULENBQUEsTUFBQUQsT0FBQSxDQUFBSSxrQkFBQTtJQUFBSCxDQUFBLE1BQUFILFNBQUE7SUFBQUcsQ0FBQSxNQUFBRixLQUFBO0lBQUFFLENBQUEsTUFBQUUsRUFBQTtFQUFBO0lBQUFBLEVBQUEsR0FBQUYsQ0FBQTtFQUFBO0VBQUEsT0FUbkJFLEVBVXdCO0FBQUEiLCJpZ25vcmVMaXN0IjpbXX0=