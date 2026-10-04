import {
  DEVICE_DEFINITIONS,
  createId,
  getDeviceDefinition,
  getItemIdentity,
  type DeskItem,
  type DeviceType,
  type WorkspacePlan,
} from '../../shared/models'
import { normalizeRotation } from '../../shared/layoutRules'
import { inspectPlan } from '../inspection/inspectionViewModel'

export interface ItemPair {
  base: DeskItem
  other: DeskItem
}

export interface ItemMatchResult {
  pairs: ItemPair[]
  baseOnly: DeskItem[]
  otherOnly: DeskItem[]
}

export interface CompositionEntry {
  type: DeviceType
  label: string
  color: string
  count: number
}

export interface PlanSummary {
  deskWidthMm: number
  deskHeightMm: number
  itemCount: number
  coveragePercent: number
  issueCount: number
  composition: CompositionEntry[]
}

export interface ItemDiff {
  changed: boolean
  parts: string[]
}

export interface AdoptionSnapshot {
  issueCount: number
  coveragePercent: number
  itemCount: number
}

function groupByIdentity(items: DeskItem[]): Map<string, DeskItem[]> {
  const groups = new Map<string, DeskItem[]>()
  items.forEach((item) => {
    const key = getItemIdentity(item)
    const group = groups.get(key)
    if (group) group.push(item)
    else groups.set(key, [item])
  })
  return groups
}

function signatureOf(item: DeskItem): string {
  return `${item.type}|${item.widthMm}|${item.heightMm}`
}

function centerDistance(first: DeskItem, second: DeskItem): number {
  const firstCenterX = first.x + first.widthMm / 2
  const firstCenterY = first.y + first.heightMm / 2
  const secondCenterX = second.x + second.widthMm / 2
  const secondCenterY = second.y + second.heightMm / 2
  return Math.hypot(firstCenterX - secondCenterX, firstCenterY - secondCenterY)
}

/**
 * 配对两个方案里的「同一件设备」。
 * 优先按设备血缘（originId / id）配对；没有血缘关系的旧数据，
 * 退回到「类型 + 尺寸 + 最近位置」的完整签名配对，绝不只按类型名混在一起。
 */
export function matchPlanItems(baseItems: DeskItem[], otherItems: DeskItem[]): ItemMatchResult {
  const pairs: ItemPair[] = []
  const baseRest: DeskItem[] = []
  const otherRest: DeskItem[] = []

  const otherByIdentity = groupByIdentity(otherItems)
  groupByIdentity(baseItems).forEach((baseGroup, identity) => {
    const otherGroup = otherByIdentity.get(identity)
    if (!otherGroup) {
      baseRest.push(...baseGroup)
      return
    }
    otherByIdentity.delete(identity)
    const shared = Math.min(baseGroup.length, otherGroup.length)
    for (let index = 0; index < shared; index += 1) {
      pairs.push({ base: baseGroup[index], other: otherGroup[index] })
    }
    baseRest.push(...baseGroup.slice(shared))
    otherRest.push(...otherGroup.slice(shared))
  })
  otherByIdentity.forEach((group) => otherRest.push(...group))

  const candidates: { base: DeskItem; other: DeskItem; distance: number }[] = []
  baseRest.forEach((base) => {
    otherRest.forEach((other) => {
      if (signatureOf(base) !== signatureOf(other)) return
      candidates.push({ base, other, distance: centerDistance(base, other) })
    })
  })
  candidates.sort((first, second) => first.distance - second.distance)
  const usedBase = new Set<string>()
  const usedOther = new Set<string>()
  candidates.forEach((candidate) => {
    if (usedBase.has(candidate.base.id) || usedOther.has(candidate.other.id)) return
    usedBase.add(candidate.base.id)
    usedOther.add(candidate.other.id)
    pairs.push({ base: candidate.base, other: candidate.other })
  })

  return {
    pairs,
    baseOnly: baseRest.filter((item) => !usedBase.has(item.id)),
    otherOnly: otherRest.filter((item) => !usedOther.has(item.id)),
  }
}

export function describeItemDiff(base: DeskItem, other: DeskItem): ItemDiff {
  const parts: string[] = []
  const baseX = Math.round(base.x)
  const baseY = Math.round(base.y)
  const otherX = Math.round(other.x)
  const otherY = Math.round(other.y)
  if (baseX !== otherX || baseY !== otherY) parts.push(`位置 (${baseX}, ${baseY}) → (${otherX}, ${otherY})`)
  if (base.widthMm !== other.widthMm || base.heightMm !== other.heightMm) {
    parts.push(`尺寸 ${base.widthMm} × ${base.heightMm} → ${other.widthMm} × ${other.heightMm}`)
  }
  const baseRotation = normalizeRotation(base.rotation)
  const otherRotation = normalizeRotation(other.rotation)
  if (baseRotation !== otherRotation) parts.push(`旋转 ${baseRotation}° → ${otherRotation}°`)
  return { changed: parts.length > 0, parts }
}

export function buildPlanSummary(plan: WorkspacePlan): PlanSummary {
  const inspection = inspectPlan(plan)
  const counts = new Map<DeviceType, number>()
  plan.items.forEach((item) => counts.set(item.type, (counts.get(item.type) ?? 0) + 1))
  const composition = DEVICE_DEFINITIONS
    .filter((definition) => (counts.get(definition.type) ?? 0) > 0)
    .map((definition) => ({
      type: definition.type,
      label: definition.label,
      color: definition.color,
      count: counts.get(definition.type) ?? 0,
    }))
  return {
    deskWidthMm: plan.deskWidthMm,
    deskHeightMm: plan.deskHeightMm,
    itemCount: plan.items.length,
    coveragePercent: inspection.analysis.coveragePercent,
    issueCount: inspection.issueCount,
    composition,
  }
}

const CIRCLED_ZERO = 0x245f

function circledNumber(value: number): string {
  return value >= 1 && value <= 10 ? String.fromCharCode(CIRCLED_ZERO + value) : `#${value}`
}

export function labelPlanItems(items: DeskItem[]): Map<string, string> {
  const counters = new Map<DeviceType, number>()
  const labels = new Map<string, string>()
  items.forEach((item) => {
    const next = (counters.get(item.type) ?? 0) + 1
    counters.set(item.type, next)
    labels.set(item.id, `${getDeviceDefinition(item.type).label}${circledNumber(next)}`)
  })
  return labels
}

export function snapshotPlan(plan: WorkspacePlan): AdoptionSnapshot {
  const inspection = inspectPlan(plan)
  return {
    issueCount: inspection.issueCount,
    coveragePercent: inspection.analysis.coveragePercent,
    itemCount: plan.items.length,
  }
}

export function formatAdoptionNotice(subject: string, before: AdoptionSnapshot, after: AdoptionSnapshot): string {
  return `${subject} · 重新检查：问题 ${before.issueCount} → ${after.issueCount}，占用率 ${before.coveragePercent}% → ${after.coveragePercent}%，设备 ${before.itemCount} → ${after.itemCount} 件`
}

/** 把对方方案里的一件设备复制进当前方案；源方案只读，新设备保留血缘 */
export function buildAdoptedPlan(activePlan: WorkspacePlan, sourcePlan: WorkspacePlan, itemId: string): { plan: WorkspacePlan; item: DeskItem } | null {
  const sourceItem = sourcePlan.items.find((item) => item.id === itemId)
  if (!sourceItem) return null
  const adopted: DeskItem = { ...sourceItem, id: createId('item'), originId: getItemIdentity(sourceItem) }
  return { plan: { ...activePlan, items: [...activePlan.items, adopted] }, item: adopted }
}

/** 把对方方案里同一件设备的摆法（位置 / 尺寸 / 角度）应用到当前方案的对应设备上 */
export function buildPlacementPlan(activePlan: WorkspacePlan, sourcePlan: WorkspacePlan, itemId: string): { plan: WorkspacePlan; item: DeskItem } | null {
  const match = matchPlanItems(activePlan.items, sourcePlan.items)
  const pair = match.pairs.find((candidate) => candidate.other.id === itemId)
  if (!pair) return null
  const updated: DeskItem = {
    ...pair.base,
    x: pair.other.x,
    y: pair.other.y,
    rotation: pair.other.rotation,
    widthMm: pair.other.widthMm,
    heightMm: pair.other.heightMm,
  }
  const plan = { ...activePlan, items: activePlan.items.map((item) => item.id === updated.id ? updated : item) }
  return { plan, item: updated }
}

/** 用对方方案整套替换当前方案的内容；保留当前方案的 id 与名称，源方案只读 */
export function buildReplacedPlan(activePlan: WorkspacePlan, sourcePlan: WorkspacePlan): WorkspacePlan {
  return {
    ...activePlan,
    deskWidthMm: sourcePlan.deskWidthMm,
    deskHeightMm: sourcePlan.deskHeightMm,
    items: sourcePlan.items.map((item) => ({ ...item, id: createId('item'), originId: getItemIdentity(item) })),
  }
}
