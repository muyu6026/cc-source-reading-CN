// ═══════════════════════════════════════════════════════════════
//  oauth/crypto：23 行，PKCE 的三块拼图
// ═══════════════════════════════════════════════════════════════
//
//  三个函数，各一行，但每一个都对应 PKCE 流程里一个不可省的角色：
//
//      generateCodeVerifier    客户端生成的随机串（只有自己知道）
//      generateCodeChallenge   它的 sha256（发给服务端）
//      generateState           防 CSRF 的随机串
//
//  全部 32 字节随机。这个文件短到可以背下来，但里面的
//  base64URLEncode 有一个几乎所有手写实现都会漏的细节，见第 3 行。
import { createHash, randomBytes } from 'crypto'

// 【base64URL 的三次替换 —— 第 3 个最容易漏】
//
//      +  →  -
//      /  →  _
//      =  →  （删掉）
//
//  前两个是 RFC 4648 的 URL-safe 字母表（因为 + 和 / 在 URL 里要转义）。
//  第三个去掉 padding 的 = —— 这一步经常被漏掉，而 OAuth 服务端**通常
//  会严格校验**：带 = 的 code_verifier 会被判非法。
//
//  注意替换顺序：先换 + 和 /，最后才删 =。如果先删 =，不影响后面两次替换，
//  但习惯上按这个顺序写的人更容易一次写对。
//
//  为什么要 base64URL 而不是 hex？同样的字节数，base64 更短
//  （32 字节 → 43 字符 vs 64 字符）。而 PKCE 的 verifier 有长度要求
//  （43-128 字符），更短意味着同样的熵占更少的位置。
//
//  这类「编码细节」是 OAuth 实现里最常见的失败点：本地测能过，
//  换个服务端就 400，而错误信息通常只说 invalid_request。
function base64URLEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

// 【verifier 和 state 都是 32 字节随机 —— 但用途完全不同】
//
//  code_verifier  →  PKCE 的「证明我是发起方」
//  state          →  防 CSRF 的「证明这个回调是我这次发起的」
//
//  两者的生命周期也不同：
//
//      verifier   从生成到换 token 一直要留着（存在 OAuthService 实例上）
//      state      只在这一次回调里比对，用完即弃
//
//  为什么 verifier 不能太小？因为它本质是**一次性的共享密钥**：
//  授权码在浏览器里明文传输（URL 参数），能被看到；但攻击者拿到授权码
//  也换不了 token，因为换 token 时必须同时提供 verifier。
//
//  32 字节 = 256 bit，远超暴力破解可行范围。**这个数字不需要「调优」，
//  够大就行。**
export function generateCodeVerifier(): string {
  return base64URLEncode(randomBytes(32))
}

// 【challenge 是 verifier 的 sha256 —— 这就是 PKCE 的全部】
//
//  整个流程：
//
//      1. 客户端生成 verifier（保密），算出 challenge = sha256(verifier)
//      2. 授权请求里带 challenge（明文，谁看见都行）
//      3. 服务端存下 challenge
//      4. 客户端用授权码 + verifier 换 token
//      5. 服务端算 sha256(verifier) 和存下的 challenge 比 —— 一致才发 token
//
//  安全性来自：**challenge 可以公开，因为它不可逆推 verifier。**
//  这样即使授权码被截获（它走浏览器重定向，容易被中间人看到），
//  没有 verifier 也换不到 token。
//
//  注意 code_challenge_method 在 client.ts 里写的是 S256（不是 plain）——
//  plain 模式等于不做哈希，那 PKCE 就失去意义了。
export function generateCodeChallenge(verifier: string): string {
  const hash = createHash('sha256')
  hash.update(verifier)
  return base64URLEncode(hash.digest())
}

export function generateState(): string {
  return base64URLEncode(randomBytes(32))
}
