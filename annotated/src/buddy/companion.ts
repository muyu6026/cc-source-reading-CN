import { getGlobalConfig } from '../utils/config.js'
import {
  type Companion,
  type CompanionBones,
  EYES,
  HATS,
  RARITIES,
  RARITY_WEIGHTS,
  type Rarity,
  SPECIES,
  STAT_NAMES,
  type StatName,
} from './types.js'

// 自己写二十行伪随机数发生器而不引依赖：这里只需要「同一种子得同一结果」，不需要密码学强度
// Mulberry32 — tiny seeded PRNG, good enough for picking ducks
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
// 内层混洗靠乘法高位扩散：这就是该算法的全部秘密，改一个常数就会得到完全不同的分布
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 哈希分两条路：Bun 有原生实现就直接用，其他运行时走 FNV 一遍
function hashString(s: string): number {
  if (typeof Bun !== 'undefined') {
// Bun 的哈希是六十四位，取低三十二位要过 BigInt：直接转数字会在高位溢出
    return Number(BigInt(Bun.hash(s)) & 0xffffffffn)
  }
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// 取模前不做边界判断：随机数的值域是左闭右开，乘长度取整恰好不会越界
function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!
}

// 按权重抽档位：从总权重里一路减，减成负数的那个就是结果
function rollRarity(rng: () => number): Rarity {
  const total = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0)
  let roll = rng() * total
  for (const rarity of RARITIES) {
    roll -= RARITY_WEIGHTS[rarity]
    if (roll < 0) return rarity
  }
  return 'common'
}

// 每档一个属性下限：稀有度抬高的是整只伙伴的基线，而不只是某一项
const RARITY_FLOOR: Record<Rarity, number> = {
  common: 5,
  uncommon: 15,
  rare: 25,
  epic: 35,
  legendary: 50,
}

// 结构固定：一个峰值、一个低谷、其余散在中段——比纯随机更像「有性格的个体」
// One peak stat, one dump stat, rest scattered. Rarity bumps the floor.
function rollStats(
  rng: () => number,
  rarity: Rarity,
): Record<StatName, number> {
  const floor = RARITY_FLOOR[rarity]
// 峰值五选一，低谷再选一次，撞了就重抽：五选一撞的概率不低，这个循环是必要的
  const peak = pick(rng, STAT_NAMES)
  let dump = pick(rng, STAT_NAMES)
  while (dump === peak) dump = pick(rng, STAT_NAMES)

  const stats = {} as Record<StatName, number>
  for (const name of STAT_NAMES) {
    if (name === peak) {
// 峰值封顶一百：下限最高的那一档加五十再加三十会溢出，这层钳制不能省
      stats[name] = Math.min(100, floor + 50 + Math.floor(rng() * 30))
    } else if (name === dump) {
// 低谷至少取一：下限最低的那一档减十会变成负数
      stats[name] = Math.max(1, floor - 10 + Math.floor(rng() * 15))
    } else {
      stats[name] = floor + Math.floor(rng() * 40)
    }
  }
  return stats
}

// 盐值参与哈希：换掉它等于全站重抽，所以它一旦发布就不能再改
const SALT = 'friend-2026-401'

export type Roll = {
  bones: CompanionBones
  inspirationSeed: number
}

// 整只伙伴的全部随机性都在这一个函数里：档位、物种、眼睛、帽子、闪光、属性、灵感种子
function rollFrom(rng: () => number): Roll {
  const rarity = rollRarity(rng)
  const bones: CompanionBones = {
    rarity,
    species: pick(rng, SPECIES),
    eye: pick(rng, EYES),
// 最常见的那档不给帽子：帽子是稀有度的可见奖励，垫底的不该有
    hat: rarity === 'common' ? 'none' : pick(rng, HATS),
    shiny: rng() < 0.01,
    stats: rollStats(rng, rarity),
  }
  return { bones, inspirationSeed: Math.floor(rng() * 1e9) }
}

// Called from three hot paths (500ms sprite tick, per-keystroke PromptInput,
// per-turn observer) with the same userId → cache the deterministic result.
// 只缓存一个结果：三个热路径（精灵刷新、每次按键、每轮观察）都在调，重算不划算
let rollCache: { key: string; value: Roll } | undefined
// 同一用户永远得到同一只：这是「伙伴」而不是「皮肤」的前提
export function roll(userId: string): Roll {
  const key = userId + SALT
  if (rollCache?.key === key) return rollCache.value
  const value = rollFrom(mulberry32(hashString(key)))
  rollCache = { key, value }
  return value
}

export function rollWithSeed(seed: string): Roll {
  return rollFrom(mulberry32(hashString(seed)))
}

export function companionUserId(): string {
  const config = getGlobalConfig()
  return config.oauthAccount?.accountUuid ?? config.userID ?? 'anon'
}

// Regenerate bones from userId, merge with stored soul. Bones never persist
// so species renames and SPECIES-array edits can't break stored companions,
// and editing config.companion can't fake a rarity.
// 骨骼每次重算再合并：存盘的只有灵魂，所以改物种名、改数组、手改配置都影响不到已有伙伴
export function getCompanion(): Companion | undefined {
  const stored = getGlobalConfig().companion
  if (!stored) return undefined
  const { bones } = roll(companionUserId())
  // bones last so stale bones fields in old-format configs get overridden
  return { ...stored, ...bones }
}
