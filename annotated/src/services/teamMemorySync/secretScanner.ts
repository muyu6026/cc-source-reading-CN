// 【模块总览】`secretScanner.ts` 是**上传前的客户端密钥扫描器**（对应安全单 PSR M22174）：
// 在内容离开本机之前用正则扫一遍，命中就整文件不上传，所以密钥**永远不会离开用户机器**。
// 它搬运了 gitleaks（开源密钥检测工具）里**高置信度**的一小撮规则——只挑前缀独特、误报率近零的；
// 那些靠「关键字 + 上下文」的泛化规则被刻意省略（误报会无谓拦截用户正常文件）。
/**
 * Client-side secret scanner for team memory (PSR M22174).
 *
 * Scans content for credentials before upload so secrets never leave the
 * user's machine. Uses a curated subset of high-confidence rules from
 * gitleaks (https://github.com/gitleaks/gitleaks, MIT license) — only
 * rules with distinctive prefixes that have near-zero false-positive
 * rates are included. Generic keyword-context rules are omitted.
 *
 * Rule IDs and regexes sourced directly from the public gitleaks config:
 * https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml
 *
 * JS regex notes:
 *   - gitleaks uses Go regex; inline (?i) and mode groups (?-i:...) are
 *     not portable to JS. Affected rules are rewritten with explicit
 *     character classes ([a-zA-Z0-9] instead of (?i)[a-z0-9]).
 *   - Trailing boundary alternations like (?:[\x60'"\s;]|\\[nr]|$) from
 *     Go regex are kept (JS $ matches end-of-string in default mode).
 */
// 【第 13-19 行】这段「JS 正则笔记」是 Go→JS 移植的坑：gitleaks 用的是 Go 正则，原生不兼容 JS。
// 两个差异：(1) Go 的 `(?i)` 大小写不敏感和 `(?-i:...)` 模式分组在 JS 跑不了，受影响规则改写成显式字符类
// （用 `[a-zA-Z0-9]` 代替 `(?i)[a-z0-9]`）；(2) Go 正则尾部那种「边界字符或转义换行或行尾」三选一的写法，
// 在 JS 里照样保留（JS 默认模式下的美元符号就匹配字符串结尾）。

import { capitalize } from '../../utils/stringUtils.js'

type SecretRule = {
  /** Gitleaks rule ID (kebab-case), used in labels and analytics */
  id: string
  /** Regex source, lazily compiled on first scan */
  source: string
  /** Optional JS regex flags (most rules are case-sensitive by default) */
  flags?: string
}

export type SecretMatch = {
  /** Gitleaks rule ID that matched (e.g., "github-pat", "aws-access-token") */
  ruleId: string
  /** Human-readable label derived from the rule ID */
  label: string
}

// ─── Curated rules ──────────────────────────────────────────────
// High-confidence patterns from gitleaks with distinctive prefixes.
// Ordered roughly by likelihood of appearing in dev-team content.

// Anthropic API key prefix, assembled at runtime so the literal byte
// sequence isn't present in the external bundle (excluded-strings check).
// join() is not constant-folded by the minifier.
const ANT_KEY_PFX = ['sk', 'ant', 'api'].join('-')
// 【第 43-46 行】`ANT_KEY_PFX` 是个反逆向小技巧：Anthropic 的 API key 前缀
// `sk-ant-api` 不在源码里写死成字面量，而是运行时用 `['sk','ant','api'].join('-')` 拼出来——
// 这样「排除字符串检查」（打包时扫可疑字面量）就扫不到它。而且 `join` 不会被压缩器常量折叠，
// 所以运行时才现形。第 75 行的 anthropic-api-key 规则就用到了这个拼出来的前缀。

// 【第 48-224 行】`SECRET_RULES` 是从 gitleaks 公共配置搬运过来的规则数组，**按厂商分组**
// （云厂商 / AI API / 版本控制 / 通讯 / 开发工具 / 可观测 / 支付 / 加密货币 / 私钥）。
// 不需要逐条读懂每条正则——重点是：它只挑「前缀独特、误报率近零」的规则，每条由 `id`（kebab-case，
// 用于标签和遥测）+ `source`（正则源串，首次扫描时才编译）+ 可选 `flags` 组成。正则源串里那些
// 「边界或择一」尾缀，是为了只匹配真正的凭据、不被周围的正常字符干扰。
const SECRET_RULES: SecretRule[] = [
  // — Cloud providers —
  {
    id: 'aws-access-token',
    source: '\\b((?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})\\b',
  },
  {
    id: 'gcp-api-key',
    source: '\\b(AIza[\\w-]{35})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },
  {
    id: 'azure-ad-client-secret',
    source:
      '(?:^|[\\\\\'"\\x60\\s>=:(,)])([a-zA-Z0-9_~.]{3}\\dQ~[a-zA-Z0-9_~.-]{31,34})(?:$|[\\\\\'"\\x60\\s<),])',
  },
  {
    id: 'digitalocean-pat',
    source: '\\b(dop_v1_[a-f0-9]{64})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },
  {
    id: 'digitalocean-access-token',
    source: '\\b(doo_v1_[a-f0-9]{64})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },

  // — AI APIs —
  {
    id: 'anthropic-api-key',
    source: `\\b(${ANT_KEY_PFX}03-[a-zA-Z0-9_\\-]{93}AA)(?:[\\x60'"\\s;]|\\\\[nr]|$)`,
// 【第 73-76 行】anthropic-api-key 这条规则，正则源串里 `${ANT_KEY_PFX}` 就是上面
// 运行时拼出来的前缀——意思是「先拼出 `sk-ant-api` 再嵌进正则」。这样前缀本身不在打包产物里以
// 字面量出现，既防逆向、又让规则能正常匹配。可见第 46 行的技巧和这里是配套的。
  },
  {
    id: 'anthropic-admin-api-key',
    source:
      '\\b(sk-ant-admin01-[a-zA-Z0-9_\\-]{93}AA)(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },
  {
    id: 'openai-api-key',
    source:
      '\\b(sk-(?:proj|svcacct|admin)-(?:[A-Za-z0-9_-]{74}|[A-Za-z0-9_-]{58})T3BlbkFJ(?:[A-Za-z0-9_-]{74}|[A-Za-z0-9_-]{58})\\b|sk-[a-zA-Z0-9]{20}T3BlbkFJ[a-zA-Z0-9]{20})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },
  {
    id: 'huggingface-access-token',
    // gitleaks: hf_(?i:[a-z]{34}) → JS: hf_[a-zA-Z]{34}
    source: '\\b(hf_[a-zA-Z]{34})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },

  // — Version control —
  {
    id: 'github-pat',
    source: 'ghp_[0-9a-zA-Z]{36}',
  },
  {
    id: 'github-fine-grained-pat',
    source: 'github_pat_\\w{82}',
  },
  {
    id: 'github-app-token',
    source: '(?:ghu|ghs)_[0-9a-zA-Z]{36}',
  },
  {
    id: 'github-oauth',
    source: 'gho_[0-9a-zA-Z]{36}',
  },
  {
    id: 'github-refresh-token',
    source: 'ghr_[0-9a-zA-Z]{36}',
  },
  {
    id: 'gitlab-pat',
    source: 'glpat-[\\w-]{20}',
  },
  {
    id: 'gitlab-deploy-token',
    source: 'gldt-[0-9a-zA-Z_\\-]{20}',
  },

  // — Communication —
  {
    id: 'slack-bot-token',
    source: 'xoxb-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*',
  },
  {
    id: 'slack-user-token',
    source: 'xox[pe](?:-[0-9]{10,13}){3}-[a-zA-Z0-9-]{28,34}',
  },
  {
    id: 'slack-app-token',
    source: 'xapp-\\d-[A-Z0-9]+-\\d+-[a-z0-9]+',
    flags: 'i',
  },
  {
    id: 'twilio-api-key',
    source: 'SK[0-9a-fA-F]{32}',
  },
  {
    id: 'sendgrid-api-token',
    // gitleaks: SG\.(?i)[a-z0-9=_\-\.]{66} → JS: case-insensitive via flag
    source: '\\b(SG\\.[a-zA-Z0-9=_\\-.]{66})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },

  // — Dev tooling —
  {
    id: 'npm-access-token',
    source: '\\b(npm_[a-zA-Z0-9]{36})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },
  {
    id: 'pypi-upload-token',
    source: 'pypi-AgEIcHlwaS5vcmc[\\w-]{50,1000}',
  },
  {
    id: 'databricks-api-token',
    source: '\\b(dapi[a-f0-9]{32}(?:-\\d)?)(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },
  {
    id: 'hashicorp-tf-api-token',
    // gitleaks: (?i)[a-z0-9]{14}\.(?-i:atlasv1)\.[a-z0-9\-_=]{60,70}
    // → JS: case-insensitive hex+alnum prefix, literal "atlasv1", case-insensitive suffix
    source: '[a-zA-Z0-9]{14}\\.atlasv1\\.[a-zA-Z0-9\\-_=]{60,70}',
  },
  {
    id: 'pulumi-api-token',
    source: '\\b(pul-[a-f0-9]{40})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },
  {
    id: 'postman-api-token',
    // gitleaks: PMAK-(?i)[a-f0-9]{24}\-[a-f0-9]{34} → JS: use [a-fA-F0-9]
    source:
      '\\b(PMAK-[a-fA-F0-9]{24}-[a-fA-F0-9]{34})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },

  // — Observability —
  {
    id: 'grafana-api-key',
    source:
      '\\b(eyJrIjoi[A-Za-z0-9+/]{70,400}={0,3})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },
  {
    id: 'grafana-cloud-api-token',
    source: '\\b(glc_[A-Za-z0-9+/]{32,400}={0,3})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },
  {
    id: 'grafana-service-account-token',
    source:
      '\\b(glsa_[A-Za-z0-9]{32}_[A-Fa-f0-9]{8})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },
  {
    id: 'sentry-user-token',
    source: '\\b(sntryu_[a-f0-9]{64})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },
  {
    id: 'sentry-org-token',
    source:
      '\\bsntrys_eyJpYXQiO[a-zA-Z0-9+/]{10,200}(?:LCJyZWdpb25fdXJs|InJlZ2lvbl91cmwi|cmVnaW9uX3VybCI6)[a-zA-Z0-9+/]{10,200}={0,2}_[a-zA-Z0-9+/]{43}',
  },

  // — Payment / commerce —
  {
    id: 'stripe-access-token',
    source:
      '\\b((?:sk|rk)_(?:test|live|prod)_[a-zA-Z0-9]{10,99})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },
  {
    id: 'shopify-access-token',
    source: 'shpat_[a-fA-F0-9]{32}',
  },
  {
    id: 'shopify-shared-secret',
    source: 'shpss_[a-fA-F0-9]{32}',
  },

  // — Crypto —
  {
    id: 'private-key',
// 【第 218-223 行】private-key 是少数**跨行**检测：用 `-----BEGIN ... PRIVATE KEY-----`
// 到 `-----END ... PRIVATE KEY-----` 之间的内容来抓 PEM 私钥（含可选的 `BLOCK` / 算法后缀）。
// 这种正则跨度大，所以匹配内容允许跨行，且标了大小写不敏感。它是「内容里藏了私钥文件」这类
// 高危场景的最后一道网。
    source:
      '-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----[\\s\\S-]{64,}?-----END[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----',
    flags: 'i',
  },
]

// Lazily compiled pattern cache — compile once on first scan.
let compiledRules: Array<{ id: string; re: RegExp }> | null = null

function getCompiledRules(): Array<{ id: string; re: RegExp }> {
  if (compiledRules === null) {
    compiledRules = SECRET_RULES.map(r => ({
      id: r.id,
      re: new RegExp(r.source, r.flags),
    }))
  }
  return compiledRules
}

/**
 * Convert a gitleaks rule ID (kebab-case) to a human-readable label.
 * e.g., "github-pat" → "GitHub PAT", "aws-access-token" → "AWS Access Token"
 */
function ruleIdToLabel(ruleId: string): string {
  // Words where the canonical capitalization differs from title case
  const specialCase: Record<string, string> = {
    aws: 'AWS',
    gcp: 'GCP',
    api: 'API',
    pat: 'PAT',
    ad: 'AD',
    tf: 'TF',
    oauth: 'OAuth',
    npm: 'NPM',
    pypi: 'PyPI',
    jwt: 'JWT',
    github: 'GitHub',
    gitlab: 'GitLab',
    openai: 'OpenAI',
    digitalocean: 'DigitalOcean',
    huggingface: 'HuggingFace',
    hashicorp: 'HashiCorp',
    sendgrid: 'SendGrid',
  }
  return ruleId
    .split('-')
    .map(part => specialCase[part] ?? capitalize(part))
    .join(' ')
}
// 【第 239-268 行】`ruleIdToLabel` 把 kebab-case 的 ruleId 转成人类可读标签
// （如 `github-pat` → `GitHub PAT`）。难点是有些词的规范大写不是首字母大写（AWS/GCP/API/PAT/AD/
// OAuth/NPM/PyPI 等），用一张 `specialCase` 表特判，其余走 `capitalize` 默认首字母大写。

/**
 * Scan a string for potential secrets.
 *
 * Returns one match per rule that fired (deduplicated by rule ID). The
 * actual matched text is intentionally NOT returned — we never log or
 * display secret values.
 */
export function scanForSecrets(content: string): SecretMatch[] {
  const matches: SecretMatch[] = []
  const seen = new Set<string>()

  for (const rule of getCompiledRules()) {
    if (seen.has(rule.id)) {
      continue
    }
    if (rule.re.test(content)) {
      seen.add(rule.id)
      matches.push({
        ruleId: rule.id,
        label: ruleIdToLabel(rule.id),
      })
    }
  }

  return matches
}
// 【第 270-295 行】`scanForSecrets` 是上传路径的**守门员**：遍历每条编译后的规则，
// 命中就记录 `ruleId` + `label`（按 ruleId 去重）。
// 最关键的一条纪律（第 274-275 行注释）：**实际匹配的密钥文本绝不返回**——我们只记「哪个规则命中」，
// 既不记值、也不打日志、更不上传。被跳过的文件路径也只记相对路径，不确定会不会泄露仓库结构时连路径都不多记。

/**
 * Get a human-readable label for a gitleaks rule ID.
 * Falls back to kebab-to-Title conversion for unknown IDs.
 */
export function getSecretLabel(ruleId: string): string {
  return ruleIdToLabel(ruleId)
}

/**
 * Redact any matched secrets in-place with [REDACTED].
 * Unlike scanForSecrets, this returns the content with spans replaced
 * so the surrounding text can still be written to disk safely.
 */
let redactRules: RegExp[] | null = null

export function redactSecrets(content: string): string {
  redactRules ??= SECRET_RULES.map(
    r => new RegExp(r.source, (r.flags ?? '').replace('g', '') + 'g'),
  )
  for (const re of redactRules) {
    // Replace only the captured group, not the full match — patterns include
    // boundary chars (space, quote, ;) outside the group that must survive.
    content = content.replace(re, (match, g1) =>
      typeof g1 === 'string' ? match.replace(g1, '[REDACTED]') : '[REDACTED]',
    )
  }
  return content
}
// 【第 305-324 行】`redactSecrets` 与 `scanForSecrets` 互补：它**就地**把命中的密钥替换成
// `[REDACTED]`，返回改完的内容，这样周围文本还能安全落盘（用于「必须写、但要把敏感段遮掉」的场景）。
// 实现细节（第 318-321 行）：只替换**捕获组** `g1`、不替换整段匹配——因为正则里把空格/引号/分号
// 等边界字符放在了捕获组外面，那些边界字符必须保留，否则会把附近的正常文本也删掉。
