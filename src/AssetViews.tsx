import type { AssetRecord, Page } from './asset';
import { costs, money } from './asset';
import { Cover, Gallery } from './Photos';

export function Icon({ name }: { name: 'items' | 'trash' | 'settings' | 'search' | 'list' | 'grid' }) {
  const paths = {
    items: 'M3 4h6v6H3z M13 4h6v6h-6z M3 14h6v6H3z M13 14h6v6h-6z',
    trash: 'M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',
    settings: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
    search: 'M16 16l5 5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    list: 'M3 5h2 M9 5h12 M3 12h2 M9 12h12 M3 19h2 M9 19h12',
    grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  };
  return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}

export function AssetOverview({ page, filtered }: { page: Page; filtered: boolean }) {
  const known = page.items.filter(r => r.asset.price_cents !== null);
  const total = known.reduce((sum, r) => sum + BigInt(r.asset.price_cents!), 0n);
  const incomplete = page.items.filter(r => r.asset.price_cents === null || !r.asset.purchase_date).length;
  return <div className="asset-overview" aria-label="当前结果概览">
    <div><span>{filtered ? '匹配物品' : '我的物品'}</span><strong>{page.total}<small>件</small></strong><p>{filtered ? '已应用当前搜索与筛选' : '记录物品，也记录日常'}</p></div>
    <div><span>本页购入金额</span><strong>{known.length ? money(total.toString()) : '待补充'}</strong><p>{known.length} 件金额已知 · 不含未知金额</p></div>
    <div><span>本页待补充</span><strong>{incomplete}<small>件</small></strong><p>购入金额或日期尚未记录</p></div>
  </div>;
}

export function AssetFacts({ record, today }: { record: AssetRecord; today: string }) {
  const c = costs(record.asset, today);
  return <><div className="holding-cost"><span>日均持有成本</span><strong>{money(c.daily)}{c.daily !== null && <small> / 天</small>}</strong><p>{c.days === null ? '补全购入日期后计算持有天数' : `已与你相伴 ${c.days} 天`}</p></div>
    <dl className="facts"><dt>购入金额</dt><dd>{money(record.asset.price_cents)}</dd><dt>购入日期</dt><dd>{record.asset.purchase_date || '待补充'}</dd><dt>分类</dt><dd>未分类</dd></dl>
    {c.daily === null && <p className="muted small">补全金额和日期，即可查看日均持有成本。</p>}</>;
}

export function AssetDetail({ record, generation, today, onEdit, onDelete }: { record: AssetRecord; generation: string; today: string; onEdit: () => void; onDelete: () => void }) {
  return <><header className="asset-hero"><Cover record={record} generation={generation} large/><div className="hero-copy"><span className="pill">使用中</span><h2 id="detail-heading" tabIndex={-1}>{record.asset.name}</h2><p className="muted">{[record.details.brand, record.details.model].filter(Boolean).join(' · ') || '一件物品，一段日常'}</p><button onClick={onEdit}>编辑资料 <kbd>⌘E</kbd></button></div></header>
    <div className="detail-columns"><div><article className="detail-section"><div className="section-heading"><h3>物品资料</h3><span>把值得记住的细节留在这里</span></div><dl className="facts"><dt>品牌</dt><dd>{record.details.brand || '待补充'}</dd><dt>型号</dt><dd>{record.details.model || '待补充'}</dd><dt>序列号</dt><dd>{record.details.serial_number || '待补充'}</dd></dl></article><article className="detail-section"><h3>备注</h3><p className="notes">{record.details.notes || '还没有备注。记下购买的缘由，或使用中的小细节。'}</p></article><article className="detail-section"><div className="section-heading"><h3>图片</h3><span>{record.photos.length} 张</span></div><Gallery record={record} generation={generation} showHeading={false}/></article></div>
      <aside className="ownership-card"><h3>持有与购买</h3><AssetFacts record={record} today={today}/><p className="muted small">按自然日计算，包含购入当天。</p></aside></div>
    <footer className="detail-footer"><details className="archive-meta"><summary>档案信息</summary><dl className="facts"><dt>建档时间</dt><dd>{record.created_at ? new Date(record.created_at).toLocaleString('zh-CN') : '旧记录未提供'}</dd><dt>修改时间</dt><dd>{record.updated_at ? new Date(record.updated_at).toLocaleString('zh-CN') : '旧记录未提供'}</dd><dt>档案编号</dt><dd><code>{record.asset.id}</code></dd><dt>保存版本</dt><dd>{record.asset.revision}</dd></dl></details><button className="danger" onClick={onDelete}>移入最近删除…</button></footer>
  </>;
}
