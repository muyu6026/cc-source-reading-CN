/**
 * PowerShell Constrained Language Mode allowed types.
 *
 * Microsoft's CLM restricts .NET type usage to this allowlist when PS runs
 * under AppLocker/WDAC system lockdown. Any type NOT in this set is considered
 * unsafe for untrusted code execution.
 *
 * We invert this: type literals not in this set → ask. One canonical check
 * replaces enumerating individual dangerous types (named pipes, reflection,
 * process spawning, P/Invoke marshaling, etc.). Microsoft maintains the list.
 *
 * Source: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_language_modes
 *
 * Normalization: entries stored lowercase, short AND full names where both
 * exist (PS resolves type accelerators like [int] → System.Int32 at runtime;
 * we match against what the AST emits, which is the literal text).
 */
// 借微软的 CLM 白名单反向使用：类型字面量不在集合就 ask。一个检查替代枚举所有危险类型（命名管道、反射、进程创建、P/Invoke 编组）——名单由微软维护，我们只做减法。
export const CLM_ALLOWED_TYPES: ReadonlySet<string> = new Set(
  [
    // Type accelerators (short names as they appear in AST TypeName.Name)
    // SECURITY: 'adsi' and 'adsisearcher' REMOVED. Both are Active Directory
    // Service Interface types that perform NETWORK BINDS when cast:
    //   [adsi]'LDAP://evil.com/...' → connects to LDAP server
    //   [adsisearcher]'(objectClass=user)' → binds to AD and queries
    // Microsoft's CLM allows these because it's for Windows admins in trusted
    // domains; we block them since the target isn't validated.
// adsi 与 adsisearcher 被刻意从微软名单移除：类型转型即网络绑定（LDAP 连接远程服务器）。微软允许是因为 CLM 的目标用户是可信域内管理员；这里目标未经验证，必须封。
    'alias',
    'allowemptycollection',
    'allowemptystring',
    'allownull',
    'argumentcompleter',
    'argumentcompletions',
    'array',
    'bigint',
    'bool',
    'byte',
    'char',
    'cimclass',
    'cimconverter',
    'ciminstance',
    // 'cimsession' REMOVED — see wmi/adsi comment below
    'cimtype',
    'cmdletbinding',
    'cultureinfo',
    'datetime',
    'decimal',
    'double',
    'dsclocalconfigurationmanager',
    'dscproperty',
    'dscresource',
    'experimentaction',
    'experimental',
    'experimentalfeature',
    'float',
    'guid',
    'hashtable',
    'int',
    'int16',
    'int32',
    'int64',
    'ipaddress',
    'ipendpoint',
    'long',
    'mailaddress',
    'norunspaceaffinity',
    'nullstring',
    'objectsecurity',
    'ordered',
    'outputtype',
    'parameter',
    'physicaladdress',
    'pscredential',
    'pscustomobject',
    'psdefaultvalue',
    'pslistmodifier',
    'psobject',
    'psprimitivedictionary',
    'pstypenameattribute',
    'ref',
    'regex',
    'sbyte',
    'securestring',
    'semver',
    'short',
    'single',
    'string',
    'supportswildcards',
    'switch',
    'timespan',
    'uint',
    'uint16',
    'uint32',
    'uint64',
    'ulong',
    'uri',
    'ushort',
    'validatecount',
    'validatedrive',
    'validatelength',
    'validatenotnull',
    'validatenotnullorempty',
    'validatenotnullorwhitespace',
    'validatepattern',
    'validaterange',
    'validatescript',
    'validateset',
    'validatetrusteddata',
    'validateuserdrive',
    'version',
    'void',
    'wildcardpattern',
    // SECURITY: 'wmi', 'wmiclass', 'wmisearcher', 'cimsession' REMOVED.
    // WMI type casts perform WMI queries which can target remote computers
    // (network request) and access dangerous classes like Win32_Process.
    // cimsession creates a CIM session (network connection to remote host).
    //   [wmi]'\\evil-host\root\cimv2:Win32_Process.Handle="1"' → remote WMI
    //   [wmisearcher]'SELECT * FROM Win32_Process' → runs WQL query
    // Same rationale as adsi/adsisearcher removal above.
// 同理移除 wmi/wmiclass/wmisearcher/cimsession：类型转型即远程 WMI 查询或 CIM 会话（可打 Win32_Process 等危险类）。注释强调连全限定名（FQ）形式也一并移除——AST 发哪种形式都得堵上。
    'x500distinguishedname',
    'x509certificate',
    'xml',
    // Full names for accelerators that resolve to System.* (AST may emit either)
    'system.array',
    'system.boolean',
    'system.byte',
    'system.char',
    'system.datetime',
    'system.decimal',
    'system.double',
    'system.guid',
    'system.int16',
    'system.int32',
    'system.int64',
    'system.numerics.biginteger',
    'system.sbyte',
    'system.single',
    'system.string',
    'system.timespan',
    'system.uint16',
    'system.uint32',
    'system.uint64',
    'system.uri',
    'system.version',
    'system.void',
    'system.collections.hashtable',
    'system.text.regularexpressions.regex',
    'system.globalization.cultureinfo',
    'system.net.ipaddress',
    'system.net.ipendpoint',
    'system.net.mail.mailaddress',
    'system.net.networkinformation.physicaladdress',
    'system.security.securestring',
    'system.security.cryptography.x509certificates.x509certificate',
    'system.security.cryptography.x509certificates.x500distinguishedname',
    'system.xml.xmldocument',
    // System.Management.Automation.* — FQ equivalents of PS-specific accelerators
    'system.management.automation.pscredential',
    'system.management.automation.pscustomobject',
    'system.management.automation.pslistmodifier',
    'system.management.automation.psobject',
    'system.management.automation.psprimitivedictionary',
    'system.management.automation.psreference',
    'system.management.automation.semanticversion',
    'system.management.automation.switchparameter',
    'system.management.automation.wildcardpattern',
    'system.management.automation.language.nullstring',
    // Microsoft.Management.Infrastructure.* — FQ equivalents of CIM accelerators
    // SECURITY: cimsession FQ REMOVED — same network-bind hazard as short name
    // (creates a CIM session to a remote host).
    'microsoft.management.infrastructure.cimclass',
    'microsoft.management.infrastructure.cimconverter',
    'microsoft.management.infrastructure.ciminstance',
    'microsoft.management.infrastructure.cimtype',
    // FQ equivalents of remaining short-name accelerators
    // SECURITY: DirectoryEntry/DirectorySearcher/ManagementObject/
    // ManagementClass/ManagementObjectSearcher FQ REMOVED — same network-bind
    // hazard as short names adsi/adsisearcher/wmi/wmiclass/wmisearcher
    // (LDAP bind, remote WMI). See short-name removal comments above.
    'system.collections.specialized.ordereddictionary',
    'system.security.accesscontrol.objectsecurity',
    // Arrays of allowed types are allowed (e.g. [string[]])
    // normalizeTypeName strips [] before lookup, so store the base name
    'object',
    'system.object',
    // ModuleSpecification — full qualified name
    'microsoft.powershell.commands.modulespecification',
  ].map(t => t.toLowerCase()),
// 数组统一小写存储后构造 Set。
)

/**
 * Normalize a type name from AST TypeName.FullName or TypeName.Name.
 * Handles array suffix ([]) and generic brackets.
 */
export function normalizeTypeName(name: string): string {
  // Strip array suffix: "String[]" → "string" (arrays of allowed types are allowed)
  // Strip generic args: "List[int]" → "list" (conservative — the generic wrapper
  // might be unsafe even if the type arg is safe, so we check the outer type)
  return name
    .toLowerCase()
    .replace(/\[\]$/, '')
    .replace(/\[.*\]$/, '')
    .trim()
}
// 剥数组后缀（允许类型的数组也允许）与泛型参数——泛型外壳可能不安全，只查最外层类型，保守处理。

/**
 * True if typeName (from AST) is in Microsoft's CLM allowlist.
 * Types NOT in this set trigger ask — they access system APIs CLM blocks.
 */
export function isClmAllowedType(typeName: string): boolean {
  return CLM_ALLOWED_TYPES.has(normalizeTypeName(typeName))
}
// 短名与全名都存：PS 运行时把 [int] 解析成 System.Int32，但校验匹配的是 AST 发出的字面文本，两种形式都得能对上。
