# -*- coding: utf-8 -*-
# src/utils/plugins/marketplaceHelpers.ts  L592
ANNOTATIONS = [

(9, 'after', r'''文件总览：插件市场（marketplace）的「策略与判定」层。负责把配置里的市场源解析成可展示、可校验的形态，并处理企业策略（黑名单 / 白名单）的拦截逻辑。核心函数 isSourceAllowedByPolicy 是下载前的守门员——被封的来源根本不会碰文件系统。'''),

(33, 'after', r'''formatFailureDetails：把失败列表压成给用户的短串。最多展示前两条，再多就补「and N more」；区分「带原因」与「只列名字」两种模式。'''),

(55, 'after', r'''getMarketplaceSourceDisplay：把 MarketplaceSource 各子类型映射成一行可读字符串——github 取 repo、url/git 取 url、directory/file 取 path、settings 取 name。'''),

(65, 'after', r'''createPluginId：插件的稳定标识 = 插件名@市场名，是插件去重与查找的键。'''),

(114, 'after', r'''loadMarketplacesWithGracefulDegradation：逐个市场加载，单市场失败只记进 failures 不中断其余；被企业策略封禁的源在这里就直接 skip，根本不发起加载。'''),

(141, 'after', r'''formatMarketplaceLoadingErrors：把 failures 翻成 UI 消息。有成功则降级为 warning，全失败时升格为 error。'''),

(147, 'after', r'''formatFailureNames / formatFailureErrors：两个纯格式化内联函数，分别拼「名字串」与「名字:原因串」，给上面的错误消息复用。'''),

(165, 'after', r'''getStrictKnownMarketplaces：从策略设置读「严格白名单」；返回 null 表示无限制。'''),

(177, 'after', r'''getBlockedMarketplaces：从策略设置读「黑名单」；null 表示无封禁。'''),

(185, 'after', r'''getPluginTrustMessage：读自定义的插件信任提示语（可选配置，没有就返回 undefined）。'''),

(223, 'after', r'''areSourcesEqual：逐类型比较两个 MarketplaceSource 是否相等。settings 类型额外用 lodash isEqual 比 plugins 数组，其余按关键字段精确比。'''),

(268, 'after', r'''extractHostFromSource：从源里抠出主机名，供 hostPattern 白名单匹配。只支持 github/git/url 三种；git 同时兼容 SSH（user@host:path）与 HTTPS 两种写法。'''),

(295, 'after', r'''doesSourceMatchHostPattern：拿源的主机名跑白名单里的正则；正则非法就记错并返回 false，不抛，避免一处坏规则拖垮整体匹配。'''),

(321, 'after', r'''doesSourceMatchPathPattern：只对 file/directory 源，拿 .path 跑白名单里的路径正则。'''),

(337, 'after', r'''getHostPatternsFromAllowlist：从白名单里筛出所有 hostPattern 项，专门给错误信息展示用。'''),

(364, 'after', r'''extractGitHubRepoFromGitUrl：从 git URL 里抠 owner/repo，兼容 SSH 与 HTTPS 两种格式，并忽略可选的 .git 后缀。'''),

(381, 'after', r'''blockedConstraintMatches：黑名单 ref/path 约束的匹配。没写约束 = 通配（拦所有 ref/path）；写了就必须精确相等。'''),

(452, 'after', r'''areSourcesEquivalentForBlocklist：黑名单匹配是「非对称」的——除了同类型精确比，还处理 github 与 git 互转（用 git URL 伪装 github 来绕过黑名单也算命中）。'''),

(469, 'after', r'''isSourceInBlocklist：暴露给外部的「是否在黑名单」判定，也顺手挡住用 git URL 伪装 github 的绕过企图。'''),

(505, 'after', r'''isSourceAllowedByPolicy：策略总入口，下载前调用。优先级：先查黑名单（命中即拦）→ 再查白名单（设了就必须在表内）→ 两者都无则放行。'''),

(533, 'after', r'''formatSourceForDisplay：把源翻成错误信息用的可读串；settings 项顺带带出插件数量。'''),

(544, 'after', r'''EmptyMarketplaceReason：Discover 页「空市场」的六类原因联合类型（git 没装 / 全被策略封 / 策略限制了来源 / 全加载失败 / 没配置 / 插件都装完了）。'''),

(592, 'after', r'''detectEmptyMarketplaceReason：按优先级判空——git 是否装 → 策略是否封杀或限制 → 是否配置了市场 → 是否全部加载失败 → 否则就是「能用的都装完了」。'''),

]
