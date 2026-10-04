import { describe, expect, it } from 'vitest'
import { createItem, createPlan, getItemIdentity, type DeskItem, type DeviceType } from '../../../shared/models'
import {
  buildAdoptedPlan,
  buildPlacementPlan,
  buildPlanSummary,
  buildReplacedPlan,
  describeItemDiff,
  formatAdoptionNotice,
  labelPlanItems,
  matchPlanItems,
} from '../compareViewModel'

function itemAt(type: DeviceType, x: number, y: number, extra: Partial<DeskItem> = {}): DeskItem {
  return { ...createItem(type), x, y, ...extra }
}

describe('compare module', () => {
  it('pairs items across duplicated plans even when ids differ', () => {
    const monitor = itemAt('monitor', 100, 100)
    const keyboard = itemAt('keyboard', 300, 400)
    const movedMonitor = { ...monitor, id: 'other-1', x: 160, y: 120 }
    const sameKeyboard = { ...keyboard, id: 'other-2' }
    const match = matchPlanItems([monitor, keyboard], [movedMonitor, sameKeyboard])
    expect(match.pairs).toHaveLength(2)
    expect(match.baseOnly).toHaveLength(0)
    expect(match.otherOnly).toHaveLength(0)
    expect(match.pairs.find((pair) => pair.base.id === monitor.id)?.other.id).toBe('other-1')
  })

  it('does not mix up same-type devices when matching', () => {
    const leftSpeaker = itemAt('speaker', 0, 0)
    const rightSpeaker = itemAt('speaker', 1400, 0)
    const otherLeft = { ...leftSpeaker, id: 'o-left', x: 20, y: 10 }
    const otherRight = { ...rightSpeaker, id: 'o-right', x: 1380, y: 10 }
    const match = matchPlanItems([leftSpeaker, rightSpeaker], [otherRight, otherLeft])
    expect(match.pairs.find((pair) => pair.base.id === leftSpeaker.id)?.other.id).toBe('o-left')
    expect(match.pairs.find((pair) => pair.base.id === rightSpeaker.id)?.other.id).toBe('o-right')
  })

  it('matches by shared lineage even when size and position changed', () => {
    const base = itemAt('monitor', 100, 100)
    const resized = { ...base, id: 'copy-1', originId: getItemIdentity(base), x: 900, y: 500, widthMm: 600, heightMm: 240 }
    const decoy = itemAt('monitor', 105, 105)
    const match = matchPlanItems([base], [decoy, resized])
    expect(match.pairs).toHaveLength(1)
    expect(match.pairs[0].other.id).toBe('copy-1')
    expect(match.otherOnly.map((item) => item.id)).toEqual([decoy.id])
  })

  it('summarizes composition, coverage and issues', () => {
    const plan = createPlan('汇总', false)
    const items = [itemAt('monitor', 0, 0), itemAt('keyboard', 10, 10), itemAt('monitor', 900, 500)]
    const summary = buildPlanSummary({ ...plan, items })
    expect(summary.itemCount).toBe(3)
    expect(summary.composition.find((entry) => entry.type === 'monitor')?.count).toBe(2)
    expect(summary.composition.find((entry) => entry.type === 'keyboard')?.count).toBe(1)
    expect(summary.issueCount).toBe(2)
    expect(summary.coveragePercent).toBeGreaterThan(0)
  })

  it('describes position, size and rotation differences', () => {
    const base = itemAt('monitor', 100, 100)
    const other = { ...base, x: 160, widthMm: 600, rotation: 15 }
    const diff = describeItemDiff(base, other)
    expect(diff.changed).toBe(true)
    expect(diff.parts.join(' ')).toContain('位置 (100, 100) → (160, 100)')
    expect(diff.parts.join(' ')).toContain('尺寸 540 × 210 → 600 × 210')
    expect(diff.parts.join(' ')).toContain('旋转 0° → 15°')
    expect(describeItemDiff(base, { ...base }).changed).toBe(false)
  })

  it('labels repeated device types with stable ordinals', () => {
    const items = [itemAt('monitor', 0, 0), itemAt('monitor', 600, 0), itemAt('lamp', 0, 400)]
    const labels = labelPlanItems(items)
    expect(labels.get(items[0].id)).toBe('显示器①')
    expect(labels.get(items[1].id)).toBe('显示器②')
    expect(labels.get(items[2].id)).toBe('桌面灯①')
  })

  it('adopts a single device into the active plan without touching the source plan', () => {
    const activePlan = { ...createPlan('当前', false), items: [] }
    const sourcePlan = { ...createPlan('参考', false), items: [itemAt('lamp', 50, 60)] }
    const sourceSnapshot = JSON.parse(JSON.stringify(sourcePlan))
    const result = buildAdoptedPlan(activePlan, sourcePlan, sourcePlan.items[0].id)
    expect(result).not.toBeNull()
    expect(result?.plan.items).toHaveLength(1)
    expect(result?.item.id).not.toBe(sourcePlan.items[0].id)
    expect(result?.item.originId).toBe(getItemIdentity(sourcePlan.items[0]))
    expect(sourcePlan).toEqual(sourceSnapshot)
    expect(activePlan.items).toHaveLength(0)
  })

  it('applies the other plan placement to the matched device only', () => {
    const monitor = itemAt('monitor', 100, 100)
    const keyboard = itemAt('keyboard', 500, 400)
    const activePlan = { ...createPlan('当前', false), items: [monitor, keyboard] }
    const moved = { ...monitor, id: 'm-2', originId: getItemIdentity(monitor), x: 640, y: 80, rotation: 90 }
    const sourcePlan = { ...createPlan('参考', false), items: [moved] }
    const result = buildPlacementPlan(activePlan, sourcePlan, moved.id)
    expect(result).not.toBeNull()
    expect(result?.plan.items.find((item) => item.id === monitor.id)).toMatchObject({ x: 640, y: 80, rotation: 90 })
    expect(result?.plan.items.find((item) => item.id === keyboard.id)).toEqual(keyboard)
    expect(buildPlacementPlan(activePlan, sourcePlan, 'missing')).toBeNull()
  })

  it('replaces the active plan content while keeping its identity and the source intact', () => {
    const activePlan = { ...createPlan('当前', false), items: [itemAt('speaker', 0, 0)] }
    const sourcePlan = {
      ...createPlan('参考', false),
      deskWidthMm: 1800,
      deskHeightMm: 900,
      items: [itemAt('monitor', 100, 100), itemAt('keyboard', 200, 300)],
    }
    const sourceSnapshot = JSON.parse(JSON.stringify(sourcePlan))
    const replaced = buildReplacedPlan(activePlan, sourcePlan)
    expect(replaced.id).toBe(activePlan.id)
    expect(replaced.name).toBe('当前')
    expect(replaced.deskWidthMm).toBe(1800)
    expect(replaced.deskHeightMm).toBe(900)
    expect(replaced.items).toHaveLength(2)
    expect(replaced.items.map((item) => item.id)).not.toContain(sourcePlan.items[0].id)
    expect(replaced.items[0].originId).toBe(getItemIdentity(sourcePlan.items[0]))
    expect(sourcePlan).toEqual(sourceSnapshot)
  })

  it('formats adoption notice with before and after inspection numbers', () => {
    const before = { issueCount: 2, coveragePercent: 40, itemCount: 3 }
    const after = { issueCount: 0, coveragePercent: 36, itemCount: 4 }
    expect(formatAdoptionNotice('已把「B」的显示器①搬入当前方案', before, after))
      .toBe('已把「B」的显示器①搬入当前方案 · 重新检查：问题 2 → 0，占用率 40% → 36%，设备 3 → 4 件')
  })
})
