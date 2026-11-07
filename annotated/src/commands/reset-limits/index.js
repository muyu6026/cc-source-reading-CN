const stub = { isEnabled: () => false, isHidden: true, name: 'stub' };
// 桩对象：isEnabled 永远返回 false、isHidden 为 true，意味着这个命令在界面上既不可见也不可触发。
export default stub;
export const resetLimits = stub;
// reset-limits 与 reset-limits-non-interactive 都指向同一个被禁用的桩，说明重置限额功能已下线或迁移。
export const resetLimitsNonInteractive = stub;
