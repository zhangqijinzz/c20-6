import {
  DEVICE_DEFINITIONS,
  cloneItemsWithFreshIds,
  createId,
  getDeviceDefinition,
  type DeskItem,
  type DeviceType,
  type WorkspacePlan,
} from '../../shared/models'
import { normalizeRotation } from '../../shared/layoutRules'
import { inspectPlan } from '../inspection/inspectionViewModel'

/** 位置 / 尺寸 / 角度小于该值视为一致，避免拖动产生的小数误差被当成差异 */
const TOLERANCE = 0.5

export interface CompositionEntry {
  type: DeviceType
  label: string
  count: number
}

export interface PlanSummary {
  planId: string
  name: string
  deskWidthMm: number
  deskHeightMm: number
  itemCount: number
  coveragePercent: number
  issueCount: number
  composition: CompositionEntry[]
}

export type ItemDiffStatus = 'same' | 'changed' | 'only-current' | 'only-other'

export interface ItemDiffRow {
  refId: string
  type: DeviceType
  /** 展示名：同类型有多台时按稳定顺序编号（如「显示器 2」），同一台设备在各方案里编号一致 */
  tag: string
  status: ItemDiffStatus
  current: DeskItem | null
  other: DeskItem | null
  /** 相对当前方案的变化描述，如「右移 30 mm」「加宽 20 mm」 */
  changes: string[]
}

export interface PlanDiff {
  planId: string
  rows: ItemDiffRow[]
  deskChanged: boolean
  changedCount: number
  onlyCurrentCount: number
  onlyOtherCount: number
}

export interface ComparedPlan {
  summary: PlanSummary
  diff: PlanDiff
}

export function summarizePlan(plan: WorkspacePlan): PlanSummary {
  const inspection = inspectPlan(plan)
  const composition = DEVICE_DEFINITIONS
    .map((definition) => ({
      type: definition.type,
      label: definition.label,
      count: plan.items.filter((item) => item.type === definition.type).length,
    }))
    .filter((entry) => entry.count > 0)
  return {
    planId: plan.id,
    name: plan.name,
    deskWidthMm: plan.deskWidthMm,
    deskHeightMm: plan.deskHeightMm,
    itemCount: plan.items.length,
    coveragePercent: inspection.analysis.coveragePercent,
    issueCount: inspection.issueCount,
    composition,
  }
}

function describePositionChanges(dx: number, dy: number): string[] {
  const changes: string[] = []
  if (Math.abs(dx) > TOLERANCE) changes.push(dx > 0 ? `右移 ${Math.round(dx)} mm` : `左移 ${Math.round(-dx)} mm`)
  if (Math.abs(dy) > TOLERANCE) changes.push(dy > 0 ? `下移 ${Math.round(dy)} mm` : `上移 ${Math.round(-dy)} mm`)
  return changes
}

export function describeItemChanges(current: DeskItem, other: DeskItem): string[] {
  if (current.type !== other.type) {
    return [`类型从「${getDeviceDefinition(current.type).label}」变成「${getDeviceDefinition(other.type).label}」`]
  }
  const changes = describePositionChanges(other.x - current.x, other.y - current.y)
  const widthDelta = other.widthMm - current.widthMm
  const heightDelta = other.heightMm - current.heightMm
  if (Math.abs(widthDelta) > TOLERANCE) changes.push(widthDelta > 0 ? `加宽 ${Math.round(widthDelta)} mm` : `收窄 ${Math.round(-widthDelta)} mm`)
  if (Math.abs(heightDelta) > TOLERANCE) changes.push(heightDelta > 0 ? `加深 ${Math.round(heightDelta)} mm` : `变浅 ${Math.round(-heightDelta)} mm`)
  const fromRotation = normalizeRotation(current.rotation)
  const toRotation = normalizeRotation(other.rotation)
  if (Math.abs(toRotation - fromRotation) > TOLERANCE) changes.push(`旋转 ${Math.round(fromRotation)}° → ${Math.round(toRotation)}°`)
  return changes
}

function assignTags(rows: ItemDiffRow[]): void {
  const rowsByType = new Map<DeviceType, ItemDiffRow[]>()
  rows.forEach((row) => {
    const list = rowsByType.get(row.type) ?? []
    list.push(row)
    rowsByType.set(row.type, list)
  })
  rowsByType.forEach((list) => {
    list.forEach((row, index) => {
      const label = getDeviceDefinition(row.type).label
      row.tag = list.length > 1 ? `${label} ${index + 1}` : label
    })
  })
}

/**
 * 以当前方案为基准逐件对比设备。
 * 设备按 refId 对齐（复制方案时保留的稳定身份），绝不按类型名撮合，
 * 所以两台同型号显示器互换位置也能被分别识别出来。
 */
export function diffPlans(current: WorkspacePlan, other: WorkspacePlan): PlanDiff {
  const rows: ItemDiffRow[] = []
  const otherByRefId = new Map(other.items.map((item) => [item.refId, item]))
  const currentRefIds = new Set(current.items.map((item) => item.refId))

  current.items.forEach((item) => {
    const counterpart = otherByRefId.get(item.refId) ?? null
    if (counterpart) {
      const changes = describeItemChanges(item, counterpart)
      rows.push({ refId: item.refId, type: item.type, tag: '', status: changes.length > 0 ? 'changed' : 'same', current: item, other: counterpart, changes })
    } else {
      rows.push({ refId: item.refId, type: item.type, tag: '', status: 'only-current', current: item, other: null, changes: [] })
    }
  })
  other.items.forEach((item) => {
    if (!currentRefIds.has(item.refId)) {
      rows.push({ refId: item.refId, type: item.type, tag: '', status: 'only-other', current: null, other: item, changes: [] })
    }
  })
  assignTags(rows)

  return {
    planId: other.id,
    rows,
    deskChanged: current.deskWidthMm !== other.deskWidthMm || current.deskHeightMm !== other.deskHeightMm,
    changedCount: rows.filter((row) => row.status === 'changed').length,
    onlyCurrentCount: rows.filter((row) => row.status === 'only-current').length,
    onlyOtherCount: rows.filter((row) => row.status === 'only-other').length,
  }
}

export function compareWithPlan(current: WorkspacePlan, other: WorkspacePlan): ComparedPlan {
  return { summary: summarizePlan(other), diff: diffPlans(current, other) }
}

export interface AdoptItemResult {
  items: DeskItem[]
  action: 'updated' | 'added'
  adopted: DeskItem
}

/**
 * 把对比方案里的某一件设备搬进当前方案：
 * 当前方案已有这台设备（refId 相同）就原地换成对方的版本，否则作为新设备追加。
 * 只返回新数组，不改动传入的任何方案。
 */
export function adoptItemVersion(currentItems: DeskItem[], sourceItem: DeskItem): AdoptItemResult {
  const index = currentItems.findIndex((item) => item.refId === sourceItem.refId)
  if (index >= 0) {
    const existing = currentItems[index]
    const adopted: DeskItem = {
      ...existing,
      type: sourceItem.type,
      widthMm: sourceItem.widthMm,
      heightMm: sourceItem.heightMm,
      x: sourceItem.x,
      y: sourceItem.y,
      rotation: sourceItem.rotation,
    }
    return { items: currentItems.map((item, itemIndex) => (itemIndex === index ? adopted : item)), action: 'updated', adopted }
  }
  const adopted: DeskItem = { ...sourceItem, id: createId('item'), refId: sourceItem.refId }
  return { items: [...currentItems, adopted], action: 'added', adopted }
}

export interface AdoptedPlanContent {
  deskWidthMm: number
  deskHeightMm: number
  items: DeskItem[]
}

/** 整套采纳对比方案的内容：桌面尺寸 + 全部设备（换新 id、保留 refId），源方案保持不变 */
export function adoptPlanContent(source: WorkspacePlan): AdoptedPlanContent {
  return {
    deskWidthMm: source.deskWidthMm,
    deskHeightMm: source.deskHeightMm,
    items: cloneItemsWithFreshIds(source.items),
  }
}
