// Development only (loaded by preview.ts): a page that shows every UI kit component, plus a pushed
// page, a modal and a sheet, so module authors can see and screenshot the kit.
// Open with mobile-preview.html?route=dev.gallery (or dev.gallery.page / .modal / .sheet).
import { useState } from 'react';
import { routes } from './routes';
import type { RouteDef, RouteName } from './routes';
const dev = (name: string) => name as RouteName;
import { useNav } from './nav-context';
import { ActionBar, BarChart, Button, Card, ChipRow, DateField, DonutChart, EmptyState, ErrorState, FormGroup, HBarChart, HeroCard, Icon, IconButton, LargeTitle, LineAreaChart, ListGroup, ListRow, Loading, Metric, MetricGrid, MoneyField, NavBar, Notice, Section, SelectField, Switch, SwipeRow, TextAreaField, TextField, UnknownState } from './ui';

function Gallery() {
  const nav = useNav();
  const [chip, setChip] = useState('all'), [tags, setTags] = useState(['work']), [on, setOn] = useState(true), [hidden, setHidden] = useState(false);
  const [amount, setAmount] = useState('649000'), [date, setDate] = useState('2025-02-16'), [name, setName] = useState('索尼 A7C2 相机'), [note, setNote] = useState('');
  return <div className="m-page">
    <LargeTitle title="组件库" actions={<><IconButton label="隐藏金额" pressed={hidden} onClick={() => setHidden(!hidden)}><Icon name={hidden ? 'eyeOff' : 'eye'}/></IconButton><IconButton label="搜索"><Icon name="search"/></IconButton></>}/>
    <HeroCard eyebrow="规划 · 财务自由" action="查看规划" title="还要上 21 年 10 个月班" subtitle="51 岁，最早 2048 年 8 月可以不靠工资生活" tags={[{ text: '两人都不上班：2050 年 3 月' }, { text: '每月多存 1,000 元可提前约 1 年 5 个月', tone: 'positive' }]} footnote="估算结果，不是理财建议" onClick={() => nav.push(dev('dev.gallery.page'))}/>
    <MetricGrid>
      <Metric label="金融净资产" value="¥88.4 万" sub="较上次 +¥1.2 万" subTone="positive"><LineAreaChart values={[70, 72, 71, 80, 84, 88.4]} summary="最近 6 次盘点金融净资产缓慢上升，最近一次 88.4 万"/></Metric>
      <Metric label="物品日均成本" value="未知" unknown sub="还没有可计入的物品"/>
    </MetricGrid>
    <ChipRow label="分类" items={[{ id: 'all', label: '全部' }, { id: 'digital', label: '数码' }, { id: 'home', label: '家电' }, { id: 'photo', label: '摄影' }, { id: 'out', label: '出行' }]} value={chip} onChange={setChip}/>
    <ChipRow label="标签" multiple items={[{ id: 'work', label: '工作用' }, { id: 'family', label: '家用' }, { id: 'commute', label: '通勤' }]} value={tags} onChange={setTags}/>
    <ListGroup title="待处理" action={<span>3 项</span>}>
      <ListRow icon="shield" tone="warn" title="保修 40 天内到期 1 件" subtitle="iPad Air · 11 月 30 日到期" onClick={() => nav.push(dev('dev.gallery.page'))}/>
      <ListRow icon="calendar" title="周期付款 10 月 25 日" subtitle="房租 ¥4,800 · 4 天后" value="¥4,800" onClick={() => nav.push(dev('dev.gallery.modal'))}/>
      <ListRow icon="doc" tone="neutral" title="本月金额" subtitle="尚未盘点" value="未知" unknown/>
    </ListGroup>
    <ListGroup title="左滑行">
      <SwipeRow label="索尼 A7C2" actions={[{ label: '置顶', icon: 'pin', onAction: () => {} }, { label: '删除', icon: 'trash', tone: 'danger', onAction: () => {} }]}><ListRow icon="camera" title="索尼 A7C2 相机" subtitle="摄影 · 工作用 · 2025-02-16" value="¥11.42/天" valueSub="¥6,490"/></SwipeRow>
      <ListRow icon="gear" title="开关行" trailing={<Switch checked={on} onChange={setOn} label="开关行"/>}/>
    </ListGroup>
    <FormGroup title="表单" footer="金额或日期不确定就留空，不要用 0 代替不知道。">
      <TextField label="名称" value={name} onChange={setName}/>
      <MoneyField label="购买价格" value={amount} onChange={setAmount}/>
      <DateField label="购买日期" value={date} onChange={setDate} allowClear/>
      <SelectField label="分类" value="photo" onChange={() => {}} options={[{ id: 'photo', label: '摄影' }, { id: 'digital', label: '数码' }]}/>
      <TextAreaField label="备注" value={note} onChange={setNote} placeholder="保修卡和发票在书桌抽屉"/>
    </FormGroup>
    <Card><Section title="图表（带文字结论）"><DonutChart summary="资产结构：基金 58%，股票 28%，现金 10%，外币 4%" center={{ top: '¥89 万', bottom: '计入资产' }} slices={[{ label: '基金', value: 58 }, { label: '股票', value: 28 }, { label: '现金', value: 10 }, { label: '外币', value: 4 }]}/>
      <BarChart summary="近 6 个月购买金额，8 月未记录金额" bars={[{ label: '5月', value: 3 }, { label: '6月', value: 8 }, { label: '7月', value: 2 }, { label: '8月', value: null }, { label: '9月', value: 5 }, { label: '10月', value: 6 }]}/>
      <HBarChart summary="分类花费排行：数码最高" rows={[{ label: '数码', value: 9999, display: '¥9,999' }, { label: '摄影', value: 6490, display: '¥6,490' }, { label: '出行', value: null }]}/></Section></Card>
    <Notice>卡片内的提示条：核算注意事项。</Notice>
    <Loading/><EmptyState icon="box" title="还没有物品" message="拍一张照片就能建档。" action={<Button variant="primary">拍照建档</Button>}/><UnknownState message="还没有完整盘点，净资产保持未知。"/><ErrorState message="资料读取失败。" onRetry={() => {}}/>
    <ActionBar status="已填 2 / 5 个账户"><Button onClick={() => nav.push(dev('dev.gallery.sheet'))}>弹窗</Button><Button variant="primary" onClick={() => nav.push(dev('dev.gallery.modal'))}>模态页</Button></ActionBar>
  </div>;
}
function Detail() { const nav = useNav(); return <div className="m-page"><NavBar/><LargeTitle title="二级页"/><Card>推入的页面：左上角显示「‹ 上一页标题」，浏览器后退键与 iOS 边缘返回都会回到上一页。</Card><Button onClick={() => nav.push(dev('dev.gallery.page'))}>再推入一页</Button></div>; }
function Modal() { const nav = useNav(); return <div className="m-page"><NavBar title="新增物品" primary={{ label: '保存', onClick: () => nav.pop() }}/><FormGroup title="模态页"><TextField label="名称" value="" onChange={() => {}} placeholder="必填"/></FormGroup></div>; }
function SheetBody() { const [value, setValue] = useState('date'); return <div className="m-page"><ChipRow label="排序" items={[{ id: 'date', label: '购入日期' }, { id: 'price', label: '购入金额' }]} value={value} onChange={setValue}/></div>; }

const pages = { 'dev.gallery': Gallery, 'dev.gallery.page': Detail, 'dev.gallery.modal': Modal, 'dev.gallery.sheet': SheetBody };
/** Adds the gallery routes to the registry at runtime (preview only). */
export function registerGalleryRoutes() {
  const defs: Record<string, RouteDef> = {
    'dev.gallery': { tab: 'me', title: '组件库', load: async () => ({ default: pages['dev.gallery'] }) },
    'dev.gallery.page': { tab: 'me', title: '二级页', load: async () => ({ default: pages['dev.gallery.page'] }) },
    'dev.gallery.modal': { tab: 'me', kind: 'modal', title: '新增物品', load: async () => ({ default: pages['dev.gallery.modal'] }) },
    'dev.gallery.sheet': { tab: 'me', kind: 'sheet', title: '筛选与排序', load: async () => ({ default: pages['dev.gallery.sheet'] }) },
  };
  Object.assign(routes, defs);
}
