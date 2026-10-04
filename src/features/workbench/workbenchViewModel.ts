import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createId,
  createInitialDocument,
  createPlan,
  getItemIdentity,
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
  buildAdoptedPlan,
  buildPlacementPlan,
  buildReplacedPlan,
  formatAdoptionNotice,
  labelPlanItems,
  snapshotPlan,
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
  compareIds: string[]
  isCompareOpen: boolean
  adoptionNotice: string | null
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
  toggleComparePlan: (id: string) => void
  openCompare: () => void
  closeCompare: () => void
  adoptItemFromPlan: (planId: string, itemId: string) => void
  applyPlacementFromPlan: (planId: string, itemId: string) => void
  replaceActivePlanWith: (planId: string) => void
}

const emptyInspection = { analysis: { overlapIds: [], outOfBoundsIds: [], coveragePercent: 0, status: 'clear' as const }, issueIds: [], issueCount: 0 }

export function useWorkspaceViewModel(repository?: WorkspaceRepository): WorkspaceViewModel {
  const repositoryRef = useRef(repository ?? new LocalWorkspaceRepository())
  const [status, setStatus] = useState<WorkspaceStatus>('loading')
  const [document, setDocument] = useState<WorkspaceDocument | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [isCompareOpen, setIsCompareOpen] = useState(false)
  const [adoptionNotice, setAdoptionNotice] = useState<string | null>(null)
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
  }, [document, persist])

  const duplicatePlan = useCallback(() => {
    if (!document || !activePlan) return
    const copy: WorkspacePlan = {
      ...activePlan,
      id: createId('plan'),
      name: `${activePlan.name} · 副本`,
      items: activePlan.items.map((item) => ({ ...item, id: createId('item'), originId: getItemIdentity(item) })),
      updatedAt: new Date().toISOString(),
    }
    void persist({ ...document, plans: [...document.plans, copy], activePlanId: copy.id }, '方案已复制')
    setSelectedItemId(null)
  }, [activePlan, document, persist])

  const selectPlan = useCallback((id: string) => {
    if (!document || !document.plans.some((plan) => plan.id === id)) return
    void persist({ ...document, activePlanId: id }, '已切换方案')
    setSelectedItemId(null)
    setCompareIds((current) => current.filter((planId) => planId !== id))
  }, [document, persist])

  const deleteCurrentPlan = useCallback(() => {
    if (!document || !activePlan || document.plans.length <= 1) {
      setFeedback('至少保留一个工作台方案')
      return
    }
    const remaining = document.plans.filter((plan) => plan.id !== activePlan.id)
    void persist({ ...document, plans: remaining, activePlanId: remaining[0].id }, '方案已删除')
    setSelectedItemId(null)
    setCompareIds((current) => current.filter((planId) => planId !== activePlan.id))
  }, [activePlan, document, persist])

  const openPreview = useCallback(() => setIsPreviewOpen(true), [])
  const closePreview = useCallback(() => setIsPreviewOpen(false), [])

  const toggleComparePlan = useCallback((id: string) => {
    if (!document || id === document.activePlanId) return
    setCompareIds((current) => current.includes(id)
      ? current.filter((planId) => planId !== id)
      : current.length >= 2 ? current : [...current, id])
    setAdoptionNotice(null)
  }, [document])

  const openCompare = useCallback(() => {
    setIsCompareOpen(true)
    setAdoptionNotice(null)
  }, [])

  const closeCompare = useCallback(() => {
    setIsCompareOpen(false)
    setAdoptionNotice(null)
  }, [])

  const adoptItemFromPlan = useCallback((planId: string, itemId: string) => {
    if (!document || !activePlan) return
    const sourcePlan = document.plans.find((plan) => plan.id === planId)
    if (!sourcePlan) return
    const adopted = buildAdoptedPlan(activePlan, sourcePlan, itemId)
    if (!adopted) return
    const label = labelPlanItems(sourcePlan.items).get(itemId) ?? '设备'
    const notice = formatAdoptionNotice(`已把「${sourcePlan.name}」的${label}搬入当前方案`, snapshotPlan(activePlan), snapshotPlan(adopted.plan))
    updateActivePlan(() => adopted.plan, notice)
    setAdoptionNotice(notice)
    setSelectedItemId(adopted.item.id)
  }, [activePlan, document, updateActivePlan])

  const applyPlacementFromPlan = useCallback((planId: string, itemId: string) => {
    if (!document || !activePlan) return
    const sourcePlan = document.plans.find((plan) => plan.id === planId)
    if (!sourcePlan) return
    const applied = buildPlacementPlan(activePlan, sourcePlan, itemId)
    if (!applied) return
    const label = labelPlanItems(activePlan.items).get(applied.item.id) ?? '设备'
    const notice = formatAdoptionNotice(`已采用「${sourcePlan.name}」中${label}的摆法`, snapshotPlan(activePlan), snapshotPlan(applied.plan))
    updateActivePlan(() => applied.plan, notice)
    setAdoptionNotice(notice)
  }, [activePlan, document, updateActivePlan])

  const replaceActivePlanWith = useCallback((planId: string) => {
    if (!document || !activePlan) return
    const sourcePlan = document.plans.find((plan) => plan.id === planId)
    if (!sourcePlan || sourcePlan.id === activePlan.id) return
    const nextPlan = buildReplacedPlan(activePlan, sourcePlan)
    const notice = formatAdoptionNotice(`已用「${sourcePlan.name}」整套替换当前方案`, snapshotPlan(activePlan), snapshotPlan(nextPlan))
    updateActivePlan(() => nextPlan, notice)
    setAdoptionNotice(notice)
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
    compareIds,
    isCompareOpen,
    adoptionNotice,
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
    toggleComparePlan,
    openCompare,
    closeCompare,
    adoptItemFromPlan,
    applyPlacementFromPlan,
    replaceActivePlanWith,
  }
}
