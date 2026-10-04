import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cloneItemsWithFreshIds,
  createId,
  createInitialDocument,
  createPlan,
  getDeviceDefinition,
  type DeskItem,
  type DeviceType,
  type LayoutAnalysis,
  type WorkspaceDocument,
  type WorkspacePlan,
  type WorkspaceStatus,
} from '../../shared/models'
import { clampDeskSize, clampItemDimension } from '../../shared/layoutRules'
import { moveCanvasItem, rotateCanvasItem } from '../canvas/canvasViewModel'
import { createMaterialDraft } from '../materials/materialsViewModel'
import { inspectPlan } from '../inspection/inspectionViewModel'
import {
  adoptItemVersion,
  adoptPlanContent,
  compareWithPlan,
  summarizePlan,
  type ComparedPlan,
  type PlanSummary,
} from '../compare/compareViewModel'
import { LocalWorkspaceRepository, type WorkspaceRepository } from './workspaceRepository'

export interface WorkspaceViewModel {
  status: WorkspaceStatus
  document: WorkspaceDocument | null
  activePlan: WorkspacePlan | null
  selectedItem: DeskItem | null
  analysis: LayoutAnalysis
  issueIds: string[]
  issueCount: number
  feedback: string
  isPreviewOpen: boolean
  isCompareOpen: boolean
  comparePlanIds: string[]
  activeSummary: PlanSummary | null
  comparisons: ComparedPlan[]
  adoptNotice: string | null
  selectItem: (id: string | null) => void
  addItem: (type: DeviceType) => void
  removeItem: (id: string) => void
  moveItem: (id: string, x: number, y: number) => void
  rotateItem: (id: string, delta: number) => void
  updateItem: (id: string, patch: Partial<Pick<DeskItem, 'widthMm' | 'heightMm' | 'x' | 'y'>>) => void
  updateDesk: (field: 'deskWidthMm' | 'deskHeightMm', value: number) => void
  createNewPlan: () => void
  duplicatePlan: () => void
  selectPlan: (id: string) => void
  deleteCurrentPlan: () => void
  openPreview: () => void
  closePreview: () => void
  openCompare: () => void
  closeCompare: () => void
  toggleComparePlan: (id: string) => void
  adoptItemFromPlan: (planId: string, refId: string) => void
  adoptEntirePlan: (planId: string) => void
}

const emptyInspection = { analysis: { overlapIds: [], outOfBoundsIds: [], coveragePercent: 0, status: 'clear' as const }, issueIds: [], issueCount: 0 }

/** 最多同时对比两个其他方案（连同当前方案共三列） */
const MAX_COMPARE_PLANS = 2

export function useWorkspaceViewModel(repository?: WorkspaceRepository): WorkspaceViewModel {
  const repositoryRef = useRef(repository ?? new LocalWorkspaceRepository())
  const [status, setStatus] = useState<WorkspaceStatus>('loading')
  const [document, setDocument] = useState<WorkspaceDocument | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [isCompareOpen, setIsCompareOpen] = useState(false)
  const [comparePlanIds, setComparePlanIds] = useState<string[]>([])
  const [adoptNotice, setAdoptNotice] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('正在准备你的工作台…')

  useEffect(() => {
    let active = true
    void repositoryRef.current.load().then((loaded) => {
      if (!active) return
      const nextDocument = loaded ?? createInitialDocument()
      setDocument(nextDocument)
      setStatus('ready')
      setFeedback(loaded ? '已恢复上次编辑状态' : '已创建示例工作台，可以直接拖动设备')
    }).catch(() => {
      if (!active) return
      setDocument(createInitialDocument())
      setStatus('error')
      setFeedback('本地数据读取失败，当前使用临时工作台')
    })
    return () => { active = false }
  }, [])

  const activePlan = useMemo(
    () => document?.plans.find((plan) => plan.id === document.activePlanId) ?? null,
    [document],
  )
  const selectedItem = activePlan?.items.find((item) => item.id === selectedItemId) ?? null
  const inspection = useMemo(() => activePlan ? inspectPlan(activePlan) : emptyInspection, [activePlan])
  const { analysis, issueIds, issueCount } = inspection

  const activeSummary = useMemo(() => activePlan ? summarizePlan(activePlan) : null, [activePlan])
  const comparisons = useMemo(() => {
    if (!document || !activePlan) return []
    return comparePlanIds
      .filter((id) => id !== activePlan.id)
      .map((id) => document.plans.find((plan) => plan.id === id))
      .filter((plan): plan is WorkspacePlan => Boolean(plan))
      .map((plan) => compareWithPlan(activePlan, plan))
  }, [document, activePlan, comparePlanIds])

  const persist = useCallback(async (nextDocument: WorkspaceDocument, message: string) => {
    setDocument(nextDocument)
    setStatus('saving')
    setFeedback(message)
    try {
      await repositoryRef.current.save(nextDocument)
      setStatus('ready')
    } catch {
      setStatus('error')
      setFeedback('自动保存失败，请检查浏览器本地存储权限')
    }
  }, [])

  const updateActivePlan = useCallback((updater: (plan: WorkspacePlan) => WorkspacePlan, message: string) => {
    if (!document || !activePlan) return
    const nextPlan = { ...updater(activePlan), updatedAt: new Date().toISOString() }
    const nextDocument = { ...document, plans: document.plans.map((plan) => plan.id === nextPlan.id ? nextPlan : plan) }
    void persist(nextDocument, message)
  }, [activePlan, document, persist])

  const selectItem = useCallback((id: string | null) => setSelectedItemId(id), [])

  const addItem = useCallback((type: DeviceType) => {
    if (!activePlan) return
    const draft = createMaterialDraft(type, activePlan.items.length)
    updateActivePlan((plan) => ({ ...plan, items: [...plan.items, draft.item] }), draft.feedback)
    setSelectedItemId(draft.item.id)
  }, [activePlan, updateActivePlan])

  const removeItem = useCallback((id: string) => {
    updateActivePlan((plan) => ({ ...plan, items: plan.items.filter((item) => item.id !== id) }), '设备已移除')
    setSelectedItemId((current) => current === id ? null : current)
  }, [updateActivePlan])

  const moveItem = useCallback((id: string, x: number, y: number) => {
    updateActivePlan((plan) => ({ ...plan, items: moveCanvasItem(plan.items, id, x, y) }), '位置已更新')
  }, [updateActivePlan])

  const rotateItem = useCallback((id: string, delta: number) => {
    updateActivePlan((plan) => ({ ...plan, items: rotateCanvasItem(plan.items, id, delta) }), '角度已更新')
  }, [updateActivePlan])

  const updateItem = useCallback((id: string, patch: Partial<Pick<DeskItem, 'widthMm' | 'heightMm' | 'x' | 'y'>>) => {
    updateActivePlan((plan) => ({
      ...plan,
      items: plan.items.map((item) => item.id === id ? {
        ...item,
        ...patch,
        widthMm: patch.widthMm === undefined ? item.widthMm : clampItemDimension(patch.widthMm, item.widthMm),
        heightMm: patch.heightMm === undefined ? item.heightMm : clampItemDimension(patch.heightMm, item.heightMm),
      } : item),
    }), '尺寸参数已更新')
  }, [updateActivePlan])

  const updateDesk = useCallback((field: 'deskWidthMm' | 'deskHeightMm', value: number) => {
    if (!activePlan) return
    updateActivePlan((plan) => ({ ...plan, [field]: clampDeskSize(value, plan[field]) }), '桌面尺寸已更新')
  }, [activePlan, updateActivePlan])

  const createNewPlan = useCallback(() => {
    if (!document) return
    const plan = createPlan(`工作台 ${document.plans.length + 1}`, false)
    void persist({ ...document, plans: [...document.plans, plan], activePlanId: plan.id }, '已创建空白方案')
    setSelectedItemId(null)
    setIsCompareOpen(false)
  }, [document, persist])

  const duplicatePlan = useCallback(() => {
    if (!document || !activePlan) return
    const copy: WorkspacePlan = {
      ...activePlan,
      id: createId('plan'),
      name: `${activePlan.name} · 副本`,
      items: cloneItemsWithFreshIds(activePlan.items),
      updatedAt: new Date().toISOString(),
    }
    void persist({ ...document, plans: [...document.plans, copy], activePlanId: copy.id }, '方案已复制，可与原方案对比')
    setSelectedItemId(null)
    setIsCompareOpen(false)
  }, [activePlan, document, persist])

  const selectPlan = useCallback((id: string) => {
    if (!document || !document.plans.some((plan) => plan.id === id)) return
    void persist({ ...document, activePlanId: id }, '已切换方案')
    setSelectedItemId(null)
    setIsCompareOpen(false)
  }, [document, persist])

  const deleteCurrentPlan = useCallback(() => {
    if (!document || !activePlan || document.plans.length <= 1) {
      setFeedback('至少保留一个工作台方案')
      return
    }
    const remaining = document.plans.filter((plan) => plan.id !== activePlan.id)
    void persist({ ...document, plans: remaining, activePlanId: remaining[0].id }, '方案已删除')
    setSelectedItemId(null)
    setIsCompareOpen(false)
  }, [activePlan, document, persist])

  const openPreview = useCallback(() => setIsPreviewOpen(true), [])
  const closePreview = useCallback(() => setIsPreviewOpen(false), [])

  const openCompare = useCallback(() => {
    if (!document || !activePlan) return
    const others = document.plans
      .filter((plan) => plan.id !== activePlan.id)
      .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt))
    setComparePlanIds((current) => {
      const kept = current.filter((id) => others.some((plan) => plan.id === id))
      return kept.length > 0 ? kept : others.slice(0, MAX_COMPARE_PLANS).map((plan) => plan.id)
    })
    setAdoptNotice(null)
    setIsCompareOpen(true)
  }, [document, activePlan])

  const closeCompare = useCallback(() => {
    setIsCompareOpen(false)
    setAdoptNotice(null)
  }, [])

  const toggleComparePlan = useCallback((id: string) => {
    setComparePlanIds((current) => {
      if (current.includes(id)) return current.filter((planId) => planId !== id)
      return [...current, id].slice(-MAX_COMPARE_PLANS)
    })
    setAdoptNotice(null)
  }, [])

  const adoptItemFromPlan = useCallback((planId: string, refId: string) => {
    if (!document || !activePlan) return
    const source = document.plans.find((plan) => plan.id === planId)
    const sourceItem = source?.items.find((item) => item.refId === refId)
    if (!source || !sourceItem || source.id === activePlan.id) return
    const before = inspectPlan(activePlan)
    const result = adoptItemVersion(activePlan.items, sourceItem)
    const nextPlan = { ...activePlan, items: result.items }
    const after = inspectPlan(nextPlan)
    const label = getDeviceDefinition(sourceItem.type).label
    updateActivePlan(() => nextPlan, result.action === 'added' ? `${label}已搬入当前方案` : `已换成「${source.name}」里的${label}`)
    setAdoptNotice(`已从「${source.name}」${result.action === 'added' ? '搬入' : '更新'}${label} · 重新检查：问题 ${before.issueCount} → ${after.issueCount}，占用率 ${before.analysis.coveragePercent}% → ${after.analysis.coveragePercent}%`)
    setSelectedItemId(result.adopted.id)
  }, [activePlan, document, updateActivePlan])

  const adoptEntirePlan = useCallback((planId: string) => {
    if (!document || !activePlan) return
    const source = document.plans.find((plan) => plan.id === planId)
    if (!source || source.id === activePlan.id) return
    const before = inspectPlan(activePlan)
    const content = adoptPlanContent(source)
    const nextPlan = { ...activePlan, ...content }
    const after = inspectPlan(nextPlan)
    const deskNote = activePlan.deskWidthMm !== source.deskWidthMm || activePlan.deskHeightMm !== source.deskHeightMm
      ? `，桌面 ${activePlan.deskWidthMm}×${activePlan.deskHeightMm} → ${source.deskWidthMm}×${source.deskHeightMm} mm`
      : ''
    updateActivePlan(() => nextPlan, `已用「${source.name}」整套替换当前方案`)
    setAdoptNotice(`已整套替换为「${source.name}」 · 重新检查：设备 ${activePlan.items.length} → ${content.items.length} 件，问题 ${before.issueCount} → ${after.issueCount}，占用率 ${before.analysis.coveragePercent}% → ${after.analysis.coveragePercent}%${deskNote}`)
    setSelectedItemId(null)
  }, [activePlan, document, updateActivePlan])

  return {
    status,
    document,
    activePlan,
    selectedItem,
    analysis,
    issueIds,
    issueCount,
    feedback,
    isPreviewOpen,
    isCompareOpen,
    comparePlanIds,
    activeSummary,
    comparisons,
    adoptNotice,
    selectItem,
    addItem,
    removeItem,
    moveItem,
    rotateItem,
    updateItem,
    updateDesk,
    createNewPlan,
    duplicatePlan,
    selectPlan,
    deleteCurrentPlan,
    openPreview,
    closePreview,
    openCompare,
    closeCompare,
    toggleComparePlan,
    adoptItemFromPlan,
    adoptEntirePlan,
  }
}
