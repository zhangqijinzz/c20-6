import { describe, expect, it } from 'vitest'
import { createItem, createPlan, type DeskItem, type DeviceType, type WorkspacePlan } from '../../../shared/models'
import { inspectPlan } from '../../inspection/inspectionViewModel'
import { adoptItemVersion, adoptPlanContent, diffPlans, summarizePlan } from '../compareViewModel'

function itemWithRef(type: DeviceType, refId: string, patch: Partial<DeskItem> = {}): DeskItem {
  return { ...createItem(type), refId, ...patch }
}

function planWith(name: string, items: DeskItem[], desk?: { widthMm: number; heightMm: number }): WorkspacePlan {
  const plan = createPlan(name, false)
  return {
    ...plan,
    items,
    deskWidthMm: desk?.widthMm ?? plan.deskWidthMm,
    deskHeightMm: desk?.heightMm ?? plan.deskHeightMm,
  }
}

describe('compare module', () => {
  it('summarizes composition, coverage and issue count for each plan', () => {
    const plan = planWith('摘要', [
      itemWithRef('monitor', 'r1', { x: 0, y: 0 }),
      itemWithRef('monitor', 'r2', { x: 600, y: 0 }),
      itemWithRef('keyboard', 'r3', { x: 100, y: 400 }),
    ])
    const summary = summarizePlan(plan)
    expect(summary.itemCount).toBe(3)
    expect(summary.composition).toEqual([
      { type: 'monitor', label: '显示器', count: 2 },
      { type: 'keyboard', label: '键盘', count: 1 },
    ])
    expect(summary.issueCount).toBe(0)
    expect(summary.coveragePercent).toBeGreaterThan(0)
  })

  it('matches the same device across plans by refId, never by type name', () => {
    // 两台同型号显示器在两版里互换了位置：按类型名判断会误以为“一致”
    const current = planWith('当前', [
      itemWithRef('monitor', 'ref-a', { x: 0, y: 0 }),
      itemWithRef('monitor', 'ref-b', { x: 1000, y: 0 }),
    ])
    const other = planWith('对方', [
      itemWithRef('monitor', 'ref-a', { x: 1000, y: 0 }),
      itemWithRef('monitor', 'ref-b', { x: 0, y: 0 }),
    ])
    const diff = diffPlans(current, other)
    const rowA = diff.rows.find((row) => row.refId === 'ref-a')
    const rowB = diff.rows.find((row) => row.refId === 'ref-b')
    expect(rowA?.status).toBe('changed')
    expect(rowA?.changes).toEqual(['右移 1000 mm'])
    expect(rowB?.status).toBe('changed')
    expect(rowB?.changes).toEqual(['左移 1000 mm'])
    // 同类型多台时编号稳定：同一台设备在两列里用同一个编号
    expect(rowA?.tag).toBe('显示器 1')
    expect(rowB?.tag).toBe('显示器 2')
  })

  it('reports size and rotation changes plus only-in-one-plan devices', () => {
    const current = planWith('当前', [
      itemWithRef('monitor', 'r1', { x: 100, y: 100, widthMm: 540 }),
      itemWithRef('lamp', 'r2', { x: 900, y: 100 }),
    ])
    const other = planWith('对方', [
      itemWithRef('monitor', 'r1', { x: 100, y: 100, widthMm: 600, rotation: 15 }),
      itemWithRef('speaker', 'r3', { x: 1200, y: 100 }),
    ], { widthMm: 1400, heightMm: 700 })
    const diff = diffPlans(current, other)
    const changed = diff.rows.find((row) => row.refId === 'r1')
    expect(changed?.status).toBe('changed')
    expect(changed?.changes).toEqual(['加宽 60 mm', '旋转 0° → 15°'])
    expect(diff.rows.find((row) => row.refId === 'r2')?.status).toBe('only-current')
    expect(diff.rows.find((row) => row.refId === 'r3')?.status).toBe('only-other')
    expect(diff.deskChanged).toBe(true)
    expect(diff.changedCount).toBe(1)
    expect(diff.onlyCurrentCount).toBe(1)
    expect(diff.onlyOtherCount).toBe(1)
  })

  it('marks identical versions as same and treats sub-millimeter drag noise as equal', () => {
    const current = planWith('当前', [itemWithRef('keyboard', 'r1', { x: 100, y: 100 })])
    const other = planWith('对方', [itemWithRef('keyboard', 'r1', { x: 100.2, y: 99.8 })])
    const diff = diffPlans(current, other)
    expect(diff.rows[0].status).toBe('same')
    expect(diff.rows[0].tag).toBe('键盘')
  })

  it('adopts one device version in place when the current plan already has it', () => {
    const existing = itemWithRef('monitor', 'r1', { x: 0, y: 0, widthMm: 540 })
    const neighbor = itemWithRef('keyboard', 'r2', { x: 800, y: 400 })
    const currentItems = Object.freeze([Object.freeze(existing), Object.freeze(neighbor)]) as DeskItem[]
    const sourceItem = Object.freeze(itemWithRef('monitor', 'r1', { x: 300, y: 220, widthMm: 600, rotation: 15 })) as DeskItem

    const result = adoptItemVersion(currentItems, sourceItem)
    expect(result.action).toBe('updated')
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({ id: existing.id, refId: 'r1', x: 300, y: 220, widthMm: 600, rotation: 15 })
    expect(result.items[1]).toBe(neighbor)
    // 采纳后两版一致
    const after = diffPlans(planWith('当前', result.items), planWith('对方', [sourceItem]))
    expect(after.rows.find((row) => row.refId === 'r1')?.status).toBe('same')
  })

  it('adds the device as a new item when the current plan does not have it', () => {
    const currentItems = Object.freeze([Object.freeze(itemWithRef('keyboard', 'r1'))]) as DeskItem[]
    const sourceItem = Object.freeze(itemWithRef('lamp', 'r9', { x: 1200, y: 80 })) as DeskItem

    const result = adoptItemVersion(currentItems, sourceItem)
    expect(result.action).toBe('added')
    expect(result.items).toHaveLength(2)
    const added = result.items[1]
    expect(added.id).not.toBe(sourceItem.id)
    expect(added.refId).toBe('r9')
    expect(added).toMatchObject({ x: 1200, y: 80, type: 'lamp' })
    // 源设备未被改动
    expect(sourceItem.x).toBe(1200)
  })

  it('clones whole-plan content with fresh ids but stable refIds, leaving the source untouched', () => {
    const sourceItems = [itemWithRef('monitor', 'r1', { x: 10, y: 20 }), itemWithRef('speaker', 'r2')]
    const source = planWith('源方案', sourceItems, { widthMm: 1400, heightMm: 700 })
    Object.freeze(sourceItems)
    sourceItems.forEach((item) => Object.freeze(item))
    Object.freeze(source)

    const content = adoptPlanContent(source)
    expect(content.deskWidthMm).toBe(1400)
    expect(content.deskHeightMm).toBe(700)
    expect(content.items).toHaveLength(2)
    content.items.forEach((item, index) => {
      expect(item.id).not.toBe(sourceItems[index].id)
      expect(item.refId).toBe(sourceItems[index].refId)
      expect(item).toMatchObject({ type: sourceItems[index].type, x: sourceItems[index].x, y: sourceItems[index].y })
    })
    expect(source.items[0]).toMatchObject({ x: 10, y: 20 })
  })

  it('re-inspection improves after adopting a fix from the other plan', () => {
    // 当前方案里键盘压在显示器上；对方方案里同一台键盘位置是好的
    const current = planWith('当前', [
      itemWithRef('monitor', 'r1', { x: 0, y: 0 }),
      itemWithRef('keyboard', 'r2', { x: 100, y: 50 }),
    ])
    const other = planWith('对方', [itemWithRef('keyboard', 'r2', { x: 580, y: 470 })])
    const before = inspectPlan(current)
    expect(before.issueCount).toBe(2)

    const sourceItem = other.items.find((item) => item.refId === 'r2')
    if (!sourceItem) throw new Error('missing source item')
    const result = adoptItemVersion(current.items, sourceItem)
    const after = inspectPlan({ ...current, items: result.items })
    expect(after.issueCount).toBe(0)
    expect(after.analysis.coveragePercent).toBe(before.analysis.coveragePercent)
  })
})
