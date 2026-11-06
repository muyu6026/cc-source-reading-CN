import type { PermissionUpdate } from '../utils/permissions/PermissionUpdateSchema.js'
// 桥接权限回调的类型契约：请求侧 sendRequest/sendResponse/cancelRequest/onResponse，以及校验解析结果的类型守卫 isBridgePermissionResponse。

type BridgePermissionResponse = {
// 响应结构：behavior 是 allow 或 deny 判别字段，可附带更新后的输入/权限与提示文案。
  behavior: 'allow' | 'deny'
  updatedInput?: Record<string, unknown>
  updatedPermissions?: PermissionUpdate[]
  message?: string
}

type BridgePermissionCallbacks = {
// 回调接口：发请求、发响应、取消待处理请求（让网页端关掉弹窗）、订阅响应（返回取消订阅函数）。
  sendRequest(
    requestId: string,
    toolName: string,
    input: Record<string, unknown>,
    toolUseId: string,
    description: string,
    permissionSuggestions?: PermissionUpdate[],
    blockedPath?: string,
  ): void
  sendResponse(requestId: string, response: BridgePermissionResponse): void
// 发响应：把权限判定结果回传给请求方。
  /** Cancel a pending control_request so the web app can dismiss its prompt. */
  cancelRequest(requestId: string): void
// 取消请求，让 Web 端关闭其提示弹窗。
  onResponse(
    requestId: string,
    handler: (response: BridgePermissionResponse) => void,
  ): () => void // returns unsubscribe
// 订阅某请求的响应，返回的箭头函数是取消订阅器。
}

/** Type predicate for validating a parsed control_response payload
 *  as a BridgePermissionResponse. Checks the required `behavior`
 *  discriminant rather than using an unsafe `as` cast. */
// 类型守卫：判断未知值是否为合法的 BridgePermissionResponse，只看 behavior 是否为 allow 或 deny，比直接 as 断言更安全。
function isBridgePermissionResponse(
  value: unknown,
): value is BridgePermissionResponse {
  if (!value || typeof value !== 'object') return false
// 守卫只看 behavior 是否为 allow 或 deny，拒绝非对象与缺字段的情况。
  return (
    'behavior' in value &&
    (value.behavior === 'allow' || value.behavior === 'deny')
  )
}

export { isBridgePermissionResponse }
// 导出类型和守卫供桥接层使用。
export type { BridgePermissionCallbacks, BridgePermissionResponse }
