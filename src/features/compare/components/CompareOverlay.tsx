import { CheckCheck, Lock, Replace, X } from 'lucide-react'
import type { DeskItem, WorkspacePlan } from '../../../shared/models'
import type { ComparedPlan, ItemDiffRow, PlanSummary } from '../compareViewModel'

interface CompareOverlayProps {
  currentPlan: WorkspacePlan
  currentSummary: PlanSummary
  otherPlans: WorkspacePlan[]
  selectedIds: string[]
  comparisons: ComparedPlan[]
  notice: string | null
  onTogglePlan: (id: string) => void
  onAdoptItem: (planId: string, refId: string) => void
  onAdoptPlan: (planId: string) => void
  onClose: () => void
}

function formatItemCell(item: DeskItem): string {
  return `${item.widthMm}×${item.heightMm} mm · (${Math.round(item.x)}, ${Math.round(item.y)}) · ${Math.round(item.rotation)}°`
}

function SummaryColumn({ summary, isCurrent, currentSummary, diff, onAdoptPlan }: {
  summary: PlanSummary
  isCurrent: boolean
  currentSummary: PlanSummary
  diff: ComparedPlan['diff'] | null
  onAdoptPlan?: () => void
}) {
  const deskChanged = summary.deskWidthMm !== currentSummary.deskWidthMm || summary.deskHeightMm !== currentSummary.deskHeightMm
  return (
    <div className={`compare-column ${isCurrent ? 'is-current' : ''}`}>
      <div className="compare-column-head">
        <strong title={summary.name}>{summary.name}</strong>
        {isCurrent && <span className="compare-badge">当前</span>}
      </div>
      <div className="compare-metric"><span>桌面尺寸</span><strong className={!isCurrent && deskChanged ? 'is-different' : ''}>{summary.deskWidthMm} × {summary.deskHeightMm} mm</strong></div>
      <div className="compare-metric"><span>设备数量</span><strong>{summary.itemCount} 件</strong></div>
      <div className="compare-metric"><span>问题数</span><strong className={summary.issueCount === 0 ? 'is-good' : 'is-bad'}>{summary.issueCount === 0 ? '无问题' : `${summary.issueCount} 个`}</strong></div>
      <div className="compare-metric"><span>占用率</span><strong>{summary.coveragePercent}%</strong></div>
      <div className="compare-coverage-bar"><span style={{ width: `${Math.max(3, summary.coveragePercent)}%` }} /></div>
      <div className="compare-composition">
        {summary.composition.length > 0
          ? summary.composition.map((entry) => <span key={entry.type}>{entry.label} ×{entry.count}</span>)
          : <span>空桌面</span>}
      </div>
      {diff && (
        <p className="compare-diff-counts">
          {diff.changedCount === 0 && diff.onlyCurrentCount === 0 && diff.onlyOtherCount === 0
            ? '设备与当前方案完全一致'
            : `位置/尺寸不同 ${diff.changedCount} 件 · 仅当前有 ${diff.onlyCurrentCount} 件 · 仅该方案有 ${diff.onlyOtherCount} 件`}
        </p>
      )}
      {!isCurrent && onAdoptPlan && (
        <button className="adopt-plan-button" onClick={onAdoptPlan} type="button"><Replace size={14} /> 整套采用此方案</button>
      )}
    </div>
  )
}

function DiffRow({ row, planId, onAdoptItem }: { row: ItemDiffRow; planId: string; onAdoptItem: (planId: string, refId: string) => void }) {
  return (
    <tr>
      <td><span className="diff-tag">{row.tag}</span></td>
      <td>{row.current ? <span className="compare-item-cell">{formatItemCell(row.current)}</span> : <span className="cell-empty">未放置</span>}</td>
      <td className={row.status === 'changed' ? 'cell-changed' : ''}>{row.other ? <span className="compare-item-cell">{formatItemCell(row.other)}</span> : <span className="cell-empty">未放置</span>}</td>
      <td>
        {row.status === 'same' && <span className="diff-same">一致</span>}
        {row.status === 'changed' && <span className="diff-changes">{row.changes.join('，')}</span>}
        {row.status === 'only-current' && <span className="cell-empty">仅当前方案有</span>}
        {row.status === 'only-other' && <span className="diff-changes">仅该方案有</span>}
      </td>
      <td>
        {row.other && (
          <button className="adopt-item-button" onClick={() => onAdoptItem(planId, row.refId)} type="button">
            {row.current ? '换成这版' : '搬入当前方案'}
          </button>
        )}
      </td>
    </tr>
  )
}

export function CompareOverlay({ currentPlan, currentSummary, otherPlans, selectedIds, comparisons, notice, onTogglePlan, onAdoptItem, onAdoptPlan, onClose }: CompareOverlayProps) {
  return (
    <div className="preview-backdrop" role="dialog" aria-modal="true" aria-labelledby="compare-title">
      <section className="preview-modal compare-modal">
        <header className="preview-modal-header">
          <div>
            <span className="eyebrow">PLAN COMPARE</span>
            <h2 id="compare-title">方案对比</h2>
            <p>以「{currentPlan.name}」为基准，最多再选 2 个方案并排比较</p>
          </div>
          <button className="close-preview" aria-label="关闭对比" onClick={onClose} type="button"><X size={18} /></button>
        </header>

        <div className="compare-picker">
          <span className="compare-picker-label">对比方案</span>
          {otherPlans.map((plan) => (
            <button
              className={`compare-chip ${selectedIds.includes(plan.id) ? 'is-selected' : ''}`}
              key={plan.id}
              onClick={() => onTogglePlan(plan.id)}
              type="button"
            >
              {plan.name}
            </button>
          ))}
          {otherPlans.length === 0 && <span className="compare-picker-hint">还没有其他方案，可以先「复制当前方案」再调整出另一版</span>}
          {otherPlans.length > 2 && <span className="compare-picker-hint">最多同时对比 2 个</span>}
        </div>

        {notice && <div className="adopt-notice"><CheckCheck size={15} /> {notice}</div>}

        <div className="compare-summary-grid" style={{ gridTemplateColumns: `repeat(${1 + comparisons.length}, minmax(0, 1fr))` }}>
          <SummaryColumn summary={currentSummary} isCurrent currentSummary={currentSummary} diff={null} />
          {comparisons.map(({ summary, diff }) => (
            <SummaryColumn key={summary.planId} summary={summary} isCurrent={false} currentSummary={currentSummary} diff={diff} onAdoptPlan={() => onAdoptPlan(summary.planId)} />
          ))}
        </div>

        {comparisons.length === 0 && otherPlans.length > 0 && (
          <p className="compare-empty">在上方勾选要对比的方案，这里会列出逐件设备的差异</p>
        )}

        {comparisons.map(({ summary, diff }) => (
          <section className="compare-diff-section" key={summary.planId}>
            <h3>与「{summary.name}」逐件对比</h3>
            {diff.deskChanged && (
              <p className="compare-desk-note">两个方案的桌面尺寸不同（当前 {currentSummary.deskWidthMm}×{currentSummary.deskHeightMm} mm，对方 {summary.deskWidthMm}×{summary.deskHeightMm} mm），搬入设备后请留意是否越界。</p>
            )}
            <table className="compare-table">
              <thead>
                <tr><th>设备</th><th>当前方案</th><th>{summary.name}</th><th>差异</th><th>采纳</th></tr>
              </thead>
              <tbody>
                {diff.rows.map((row) => <DiffRow key={row.refId} row={row} planId={summary.planId} onAdoptItem={onAdoptItem} />)}
              </tbody>
            </table>
          </section>
        ))}

        <footer className="preview-footer">
          <span className="preview-check"><Lock size={14} /> 对比方案为只读，采纳只会修改当前方案</span>
          <button className="preview-done" onClick={onClose} type="button">返回编辑</button>
        </footer>
      </section>
    </div>
  )
}
