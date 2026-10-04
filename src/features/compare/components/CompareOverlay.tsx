import { Check, GitCompare, X } from 'lucide-react'
import { getDeviceDefinition, type WorkspacePlan } from '../../../shared/models'
import { buildPlanSummary, describeItemDiff, labelPlanItems, matchPlanItems } from '../compareViewModel'

interface CompareOverlayProps {
  basePlan: WorkspacePlan
  otherPlans: WorkspacePlan[]
  notice: string | null
  onAdoptItem: (sourcePlanId: string, itemId: string) => void
  onApplyPlacement: (sourcePlanId: string, itemId: string) => void
  onReplaceWith: (sourcePlanId: string) => void
  onClose: () => void
}

export function CompareOverlay({ basePlan, otherPlans, notice, onAdoptItem, onApplyPlacement, onReplaceWith, onClose }: CompareOverlayProps) {
  const plans = [basePlan, ...otherPlans]
  const baseLabels = labelPlanItems(basePlan.items)
  return (
    <div className="preview-backdrop" role="dialog" aria-modal="true" aria-labelledby="compare-title">
      <section className="preview-modal compare-modal">
        <header className="preview-modal-header">
          <div>
            <span className="eyebrow">PLAN COMPARE</span>
            <h2 id="compare-title">方案对比</h2>
            <p>并排查看 {plans.length} 个方案 · 对比为只读，采纳前不会改动任何方案</p>
          </div>
          <button className="close-preview" aria-label="关闭对比" onClick={onClose} type="button"><X size={18} /></button>
        </header>
        {notice && <div className="adoption-notice"><Check size={15} /><span>{notice}</span></div>}
        <div className="compare-grid" style={{ gridTemplateColumns: `repeat(${plans.length}, minmax(0, 1fr))` }}>
          {plans.map((plan, index) => {
            const summary = buildPlanSummary(plan)
            const isBase = index === 0
            return (
              <article className={`compare-card ${isBase ? 'is-base' : ''}`} key={plan.id}>
                <span className="compare-plan-tag">{isBase ? '当前方案' : '对比方案'}</span>
                <h3>{plan.name}</h3>
                <div className="compare-stats">
                  <div className="compare-stat"><span>桌面尺寸</span><strong>{summary.deskWidthMm} × {summary.deskHeightMm} mm</strong></div>
                  <div className="compare-stat"><span>设备</span><strong>{summary.itemCount} 件</strong></div>
                  <div className="compare-stat composition-stat">
                    <span>构成</span>
                    <div className="composition-chips">
                      {summary.composition.length === 0
                        ? <em>空桌面</em>
                        : summary.composition.map((entry) => (
                          <span className="composition-chip" key={entry.type}><i style={{ backgroundColor: entry.color }} />{entry.label} ×{entry.count}</span>
                        ))}
                    </div>
                  </div>
                  <div className="compare-stat"><span>占用率</span><strong>{summary.coveragePercent}%</strong></div>
                  <div className="compare-stat"><span>问题数</span><strong className={summary.issueCount > 0 ? 'has-issue' : ''}>{summary.issueCount === 0 ? '通过' : `${summary.issueCount} 个`}</strong></div>
                </div>
                {!isBase && <button className="replace-plan-button" onClick={() => onReplaceWith(plan.id)} type="button">整套替换当前方案</button>}
              </article>
            )
          })}
        </div>
        {otherPlans.map((other) => {
          const match = matchPlanItems(basePlan.items, other.items)
          const otherLabels = labelPlanItems(other.items)
          const identical = match.baseOnly.length === 0 && match.otherOnly.length === 0
            && match.pairs.every((pair) => !describeItemDiff(pair.base, pair.other).changed)
          return (
            <section className="compare-diff" key={other.id}>
              <h3><GitCompare size={14} /> 「{basePlan.name}」 vs 「{other.name}」</h3>
              {identical ? <p className="diff-empty">两个方案的设备构成与摆法一致。</p> : (
                <ul className="diff-list">
                  {match.pairs.map((pair) => {
                    const diff = describeItemDiff(pair.base, pair.other)
                    return (
                      <li className="diff-row" key={pair.base.id}>
                        <span className="diff-swatch" style={{ backgroundColor: getDeviceDefinition(pair.base.type).color }} />
                        <div className="diff-copy">
                          <strong>{baseLabels.get(pair.base.id)}</strong>
                          <small className={diff.changed ? 'is-different' : ''}>{diff.changed ? diff.parts.join('；') : '位置与尺寸一致'}</small>
                        </div>
                        {diff.changed && <button className="diff-action" onClick={() => onApplyPlacement(other.id, pair.other.id)} type="button">采用对方摆法</button>}
                      </li>
                    )
                  })}
                  {match.otherOnly.map((item) => (
                    <li className="diff-row" key={item.id}>
                      <span className="diff-swatch" style={{ backgroundColor: getDeviceDefinition(item.type).color }} />
                      <div className="diff-copy">
                        <strong>{otherLabels.get(item.id)}</strong>
                        <small>仅「{other.name}」有 · {item.widthMm} × {item.heightMm} mm · 位置 ({Math.round(item.x)}, {Math.round(item.y)})</small>
                      </div>
                      <button className="diff-action" onClick={() => onAdoptItem(other.id, item.id)} type="button">搬入当前方案</button>
                    </li>
                  ))}
                  {match.baseOnly.map((item) => (
                    <li className="diff-row" key={item.id}>
                      <span className="diff-swatch" style={{ backgroundColor: getDeviceDefinition(item.type).color }} />
                      <div className="diff-copy">
                        <strong>{baseLabels.get(item.id)}</strong>
                        <small>仅当前方案有，「{other.name}」未保留</small>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </section>
    </div>
  )
}
