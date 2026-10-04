import { Check, Copy, GitCompare, LayoutGrid, Plus, Trash2 } from 'lucide-react'
import type { WorkspacePlan } from '../../../shared/models'

interface PlanSidebarProps {
  plans: WorkspacePlan[]
  activePlanId: string
  compareIds: string[]
  onSelect: (id: string) => void
  onCreate: () => void
  onDuplicate: () => void
  onDelete: () => void
  onToggleCompare: (id: string) => void
  onOpenCompare: () => void
}

export function PlanSidebar({ plans, activePlanId, compareIds, onSelect, onCreate, onDuplicate, onDelete, onToggleCompare, onOpenCompare }: PlanSidebarProps) {
  return (
    <aside className="plans-sidebar">
      <div className="brand-lockup"><span className="brand-mark"><LayoutGrid size={18} /></span><span>FocusDesk</span></div>
      <div className="sidebar-label"><span>我的工作台</span><span className="plan-total">{plans.length}</span></div>
      <div className="plan-list">
        {plans.map((plan, index) => {
          const isActive = plan.id === activePlanId
          const isCompared = compareIds.includes(plan.id)
          return (
            <div className={`plan-card ${isActive ? 'is-active' : ''}`} key={plan.id}>
              <button className="plan-card-main" onClick={() => onSelect(plan.id)} type="button">
                <span className="plan-number">0{index + 1}</span>
                <span className="plan-card-copy"><strong>{plan.name}</strong><small>{plan.items.length} 件设备 · {plan.deskWidthMm} × {plan.deskHeightMm} mm</small></span>
                {isActive && <span className="active-dot" />}
              </button>
              {!isActive && (
                <button
                  aria-label={isCompared ? `把 ${plan.name} 移出对比` : `把 ${plan.name} 加入对比`}
                  aria-pressed={isCompared}
                  className={`compare-toggle ${isCompared ? 'is-selected' : ''}`}
                  disabled={!isCompared && compareIds.length >= 2}
                  onClick={() => onToggleCompare(plan.id)}
                  title={isCompared ? '移出对比' : '加入对比（当前方案之外最多再选 2 个）'}
                  type="button"
                >
                  {isCompared ? <Check size={13} /> : <GitCompare size={13} />}
                </button>
              )}
            </div>
          )
        })}
      </div>
      <button className="new-plan-button" onClick={onCreate} type="button"><Plus size={16} /> 新建方案</button>
      <div className="sidebar-footer">
        <button className="ghost-action" disabled={compareIds.length === 0} onClick={onOpenCompare} type="button"><GitCompare size={15} /> 对比方案{compareIds.length > 0 ? `（${compareIds.length + 1} 个方案）` : ''}</button>
        <button className="ghost-action" onClick={onDuplicate} type="button"><Copy size={15} /> 复制当前方案</button>
        <button className="ghost-action danger-action" onClick={onDelete} type="button"><Trash2 size={15} /> 删除当前方案</button>
      </div>
    </aside>
  )
}
