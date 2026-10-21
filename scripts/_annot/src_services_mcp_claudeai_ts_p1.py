# -*- coding: utf-8 -*-
"""src/services/mcp/claudeai.ts 批注数据"""

ANNOTATIONS = [
    (38, 'after', '''// memoize 的粒度是「一个进程一次」，而 CLI 是短命进程，所以实际等价于
// 「一次会话一次」。
//
// 失效口只有一个：clearClaudeAIMcpConfigsCache()。登录之后必须调它，
// 否则新 token 拿不到新列表 —— 而症状是「登录成功了但 claude.ai 的 server
// 还是没出现」，用户只会觉得登录没生效。'''),
    (65, 'after', '''// 这段注释是「为什么不复用现成判断」的教科书，值得整段读完：
//
// isClaudeAISubscriber() 在「-p 模式 + 设了 ANTHROPIC_API_KEY」这个组合下返回
// false，而用户其实握着有效的 OAuth token。原因在调用链深处：
// preferThirdPartyAuthentication() 让 isAnthropicAuthEnabled() 变 false。
//
// 修法不是去改 isClaudeAISubscriber()，而是把问题换掉：
// 从「你是什么订阅」换成「这个 token 有没有这个 scope」。
// 后者才是真正的条件 —— 前者是它的一个过时近似。'''),
    (99, 'after', '''// 这里有两个不同的「名字」，值得分清：
//   configs 的键      = 显示名（`claude.ai Foo`），给人看的、也是用户配的
//   去重的键          = 归一化名，给下游用的
//
// 用归一化名当唯一性判据，是因为下游（工具前缀、权限规则、/mcp 菜单）全都按
// 归一化名走。显示名唯一而归一化名撞车，就是在 MCP 那一侧互相覆盖。'''),
    (106, 'after', '''// count 先自增再拼，所以第一个冲突拿到的是 `(2)` 而不是 `(1)`。
// 看起来像 off-by-one，其实是「(1) 就是原名本身」这个惯例 ——
// 用 (1) 当后缀会让「本来就叫 X (1)」的 server 和「X 的第二份」撞在一起。'''),
    (154, 'after', '''// 记的是「**曾经**连上过」，不是「现在连着」，这个时态是全部意义所在：
//
//   · 昨天好好的、今天挂了 → 状态变化，值得提醒
//   · 从出现起就一直 needs-auth → 用户已经用行动表示无视，别再弹
//
// 所以写入是 append-only 且 idempotent（已经在列表里就返回原对象，
// 不制造新引用），因为 saveGlobalConfig 的比较是按引用做的。'''),
]
