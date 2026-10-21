import { createContext } from 'react';
export type TerminalSize = {
  columns: number;
  rows: number;
};
export const TerminalSizeContext = createContext<TerminalSize | null>(null);
// 默认值是 null，不是 {columns: 80, rows: 24} —— 于是每个消费方都得
// 自己处理「还没拿到尺寸」的情况：
//
//   AlternateScreen   size?.rows ?? 24   （硬兜底 24）
//   useTerminalViewport  !terminalSize 时直接 return（不判断可见性）
//
// 两种处理不一致，但都是合理选择：全屏必须有高度，可见性判断可以跳过。
//
// 提供方是 App（App.tsx:155），值来自 props.terminalColumns/Rows，
// 而那两个来自 Ink 的 resize 监听 —— 也就是说这个 context 的更新
// 频率等于窗口拖拽的频率，一次拖拽可能几十次。这也是它只放两个
// 数字、不放别的东西的原因。
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcmVhdGVDb250ZXh0IiwiVGVybWluYWxTaXplIiwiY29sdW1ucyIsInJvd3MiLCJUZXJtaW5hbFNpemVDb250ZXh0Il0sInNvdXJjZXMiOlsiVGVybWluYWxTaXplQ29udGV4dC50c3giXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgY3JlYXRlQ29udGV4dCB9IGZyb20gJ3JlYWN0J1xuXG5leHBvcnQgdHlwZSBUZXJtaW5hbFNpemUgPSB7XG4gIGNvbHVtbnM6IG51bWJlclxuICByb3dzOiBudW1iZXJcbn1cblxuZXhwb3J0IGNvbnN0IFRlcm1pbmFsU2l6ZUNvbnRleHQgPSBjcmVhdGVDb250ZXh0PFRlcm1pbmFsU2l6ZSB8IG51bGw+KG51bGwpXG4iXSwibWFwcGluZ3MiOiJBQUFBLFNBQVNBLGFBQWEsUUFBUSxPQUFPO0FBRXJDLE9BQU8sS0FBS0MsWUFBWSxHQUFHO0VBQ3pCQyxPQUFPLEVBQUUsTUFBTTtFQUNmQyxJQUFJLEVBQUUsTUFBTTtBQUNkLENBQUM7QUFFRCxPQUFPLE1BQU1DLG1CQUFtQixHQUFHSixhQUFhLENBQUNDLFlBQVksR0FBRyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMiLCJpZ25vcmVMaXN0IjpbXX0=