# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  adminRequests：Team/Enterprise 用户「向上申请」的接口
// ═══════════════════════════════════════════════════════════════
//
//  两种申请：额度不够要加（limit_increase）、席位等级要升（seat_upgrade）。
//  三个函数：创建、查我自己的、查这个组织允不允许申请。
//
//  这个文件的技术看点全在类型上 —— 它用**可辨识联合**把「哪种申请带哪种
//  附加信息」钉死在了编译期。三个函数的正文几乎一模一样，不值得看；
//  值得看的是它们传的参数长什么样。'''),

    (14, 'before', '''// 【可辨识联合：申请类型决定了 details 的形状】
//
//      request_type: 'limit_increase'  →  details 必须是 null
//      request_type: 'seat_upgrade'    →  details 必须是 SeatUpgradeDetails
//
//  注意 limit_increase 的 details 是 `null` 而不是 `?` 或 `undefined`：
//  这是**故意要求调用方显式写 null**。因为「没有附加信息」本身是一个
//  必须想一下的决定，用可选字段会让人以为是「忘了填」。
//
//  如果写成 `details?: Details`，那么传 'limit_increase' 但同时带上
//  seat_upgrade 的字段也能编译过，服务端会怎么处理就没人知道了。
//  联合类型在这里的作用是：**让「类型和载荷对不上」变成编译错误。**'''),

    (24, 'before', '''// 【返回类型用了交叉而不是嵌套 —— 为什么】
//
//      { uuid, status, created_at, ... }  &  ( 两个分支之一 )
//
//  交叉（&）意味着这些字段是**平铺**的：拿到一个 AdminRequest，
//  可以直接 `req.request_type`，不用 `req.payload.request_type`。
//
//  这和服务端的 JSON 形状一一对应。如果本地改成嵌套，就要写一层转换函数，
//  而转换函数是「字段漏掉」的高发地 —— 尤其在这种有十几个字段的对象上。
//
//  取舍：**宁可类型写得难看一点，也不要加一层运行时映射。**
//  类型难看只有写的人难受，映射出错是所有读的人都难受。'''),

    (40, 'before', '''// 【注释里藏了一条幂等性约定】
//
//      If a pending request of the same type already exists for this user,
//      returns the existing request instead of creating a new one.
//
//  也就是说这是个**幂等**的 POST：重复调用不会创建多条待审批申请。
//
//  为什么必须在服务端做？因为客户端做不到 —— 两次点击之间可能隔着一次
//  网络超时重试，客户端根本不知道第一次到底成没成。
//
//  读接口文档时，「重复调用会怎样」往往比「正常调用返回什么」重要得多。
//  这条注释写在函数上方而不是参数说明里，说明它是**行为契约**，
//  不是某个字段的解释。'''),

    (49, 'before', '''// 【三个函数的前四行完全一样：prepareApiRequest + 两个头】
//
//      const { accessToken, orgUUID } = await prepareApiRequest()
//      const headers = { ...getOAuthHeaders(accessToken), 'x-organization-uuid': orgUUID }
//
//  没有抽成一个公共函数，原因大概是：只有三处、每处两行、抽出去还要
//  处理返回类型。**三处以内的重复，抽函数的收益通常小于它的阅读成本。**
//
//  但要注意这里有个容易漏的点：x-organization-uuid 是必带的。
//  凡是 URL 里带 ${orgUUID} 的接口，头里也要带一份 —— 服务端用它做
//  越权校验（URL 里的 uuid 可能被改成别人的）。'''),

    (83, 'before', '''  // 【手写 query string 拼接，而且 statuses 是重复 key】
  //
  //  拼出来是 `?request_type=xxx&statuses=pending&statuses=approved` ——
  //  同一个 key 出现多次，这是 URL 编码里的「数组」约定。
  //
  //  用 axios 的 params 也能做到（传数组，默认序列化成 statuses[]=a&statuses[]=b），
  //  但那样会带方括号，服务端不一定认。手拼虽然土，但**产出的字节是确定的**。
  //
  //  这类「为了控制具体编码格式而放弃封装」的写法在协议客户端里很常见：
  //  只要有一端是别人写的，你就要对最终字节负责，不能指望库的默认值。'''),
]
