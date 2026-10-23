// Development only (loaded by preview.ts): a page that shows every UI kit component, plus a pushed
// page, a modal and a sheet, so module authors can see and screenshot the kit.
// Open with mobile-preview.html?route=dev.gallery (or dev.gallery.page / .modal / .sheet).
import { useState } from 'react';
import { routes } from './routes';
import type { RouteDef, RouteName } from './routes';
const dev = (name: string) => name as RouteName;
import { useNav } from './nav-context';
import { ActionBar, BarChart, Button, Card, ChipRow, DateField, DonutChart, EmptyState, ErrorState, FormGroup, HBarChart, HeroCard, Icon, IconButton, LargeTitle, LineAreaChart, ListGroup, ListRow, Loading, Metric, MetricGrid, MoneyField, NavBar, Notice, Section, SelectField, Switch, SwipeRow, TextAreaField, TextField, UnknownState } from './ui';
import { t } from '../i18n.ts';
function Gallery() {
  const nav = useNav();
  const [chip, setChip] = useState('all'), [tags, setTags] = useState(['work']), [on, setOn] = useState(true), [hidden, setHidden] = useState(false);
  const [amount, setAmount] = useState('649000'), [date, setDate] = useState('2025-02-16'), [name, setName] = useState('索尼 A7C2 相机'), [note, setNote] = useState('');
  return <div className="m-page">
    <LargeTitle title={t('组件库')} actions={<><IconButton label={t('隐藏金额')} pressed={hidden} onClick={() => setHidden(!hidden)}><Icon name={hidden ? 'eyeOff' : 'eye'}/></IconButton><IconButton label={t('搜索')}><Icon name="search"/></IconButton></>}/>
    <HeroCard eyebrow={t('规划 · 财务自由')} action={t('查看规划')} title={t('还要上 21 年 10 个月班')} subtitle={t('51 岁，最早 2048 年 8 月可以不靠工资生活')} tags={[{ text: t('两人都不上班：2050 年 3 月') }, { text: t('每月多存 1,000 元可提前约 1 年 5 个月'), tone: 'positive' }]} footnote={t('估算结果，不是理财建议')} onClick={() => nav.push(dev('dev.gallery.page'))}/>
    <MetricGrid>
      <Metric label={t('金融净资产')} value="¥884,000" sub={t('较上次 +¥12,000')} subTone="positive"><LineAreaChart values={[70, 72, 71, 80, 84, 88.4]} summary={t('最近 6 次盘点金融净资产缓慢上升，最近一次 ¥884,000')}/></Metric>
      <Metric label={t('物品日均成本')} value={t('未知')} unknown sub={t('还没有可计入的物品')}/>
    </MetricGrid>
    <ChipRow label={t('分类')} items={[{ id: 'all', label: t('全部') }, { id: 'digital', label: t('数码') }, { id: 'home', label: t('家电') }, { id: 'photo', label: t('摄影') }, { id: 'out', label: t('出行') }]} value={chip} onChange={setChip}/>
    <ChipRow label={t('标签')} multiple items={[{ id: 'work', label: t('工作用') }, { id: 'family', label: t('家用') }, { id: 'commute', label: t('通勤') }]} value={tags} onChange={setTags}/>
    <ListGroup title={t('待处理')} action={<span>{t('3 项')}</span>}>
      <ListRow icon="shield" tone="warn" title={t('保修 40 天内到期 1 件')} subtitle={t('iPad Air · 11 月 30 日到期')} onClick={() => nav.push(dev('dev.gallery.page'))}/>
      <ListRow icon="calendar" title={t('周期付款 10 月 25 日')} subtitle={t('房租 ¥4,800 · 4 天后')} value="¥4,800" onClick={() => nav.push(dev('dev.gallery.modal'))}/>
      <ListRow icon="doc" tone="neutral" title={t('本月金额')} subtitle={t('尚未盘点')} value={t('未知')} unknown/>
    </ListGroup>
    <ListGroup title={t('左滑行')}>
      <SwipeRow label={t('索尼 A7C2')} actions={[{ label: t('置顶'), icon: 'pin', onAction: () => {} }, { label: t('删除'), icon: 'trash', tone: 'danger', onAction: () => {} }]}><ListRow icon="camera" title={t('索尼 A7C2 相机')} subtitle={t('摄影 · 工作用 · 2025-02-16')} value={t('¥11.42/天')} valueSub="¥6,490"/></SwipeRow>
      <ListRow icon="gear" title={t('开关行')} trailing={<Switch checked={on} onChange={setOn} label={t('开关行')}/>}/>
    </ListGroup>
    <FormGroup title={t('表单')} footer={t('金额或日期不确定就留空，不要用 0 代替不知道。')}>
      <TextField label={t('名称')} value={name} onChange={setName}/>
      <MoneyField label={t('购买价格')} value={amount} onChange={setAmount}/>
      <DateField label={t('购买日期')} value={date} onChange={setDate} allowClear/>
      <SelectField label={t('分类')} value="photo" onChange={() => {}} options={[{ id: 'photo', label: t('摄影') }, { id: 'digital', label: t('数码') }]}/>
      <TextAreaField label={t('备注')} value={note} onChange={setNote} placeholder={t('保修卡和发票在书桌抽屉')}/>
    </FormGroup>
    <Card><Section title={t('图表（带文字结论）')}><DonutChart summary={t('资产结构：基金 58%，股票 28%，现金 10%，外币 4%')} center={{ top: '¥890,000', bottom: '计入资产' }} slices={[{ label: t('基金'), value: 58 }, { label: t('股票'), value: 28 }, { label: t('现金'), value: 10 }, { label: t('外币'), value: 4 }]}/>
      <BarChart summary={t('近 6 个月购买金额，8 月未记录金额')} bars={[{ label: t('5月'), value: 3 }, { label: t('6月'), value: 8 }, { label: t('7月'), value: 2 }, { label: t('8月'), value: null }, { label: t('9月'), value: 5 }, { label: t('10月'), value: 6 }]}/>
      <HBarChart summary={t('分类花费排行：数码最高')} rows={[{ label: t('数码'), value: 9999, display: '¥9,999' }, { label: t('摄影'), value: 6490, display: '¥6,490' }, { label: t('出行'), value: null }]}/></Section></Card>
    <Notice>{t('卡片内的提示条：核算注意事项。')}</Notice>
    <Loading/><EmptyState icon="box" title={t('还没有物品')} message={t('拍一张照片就能建档。')} action={<Button variant="primary">{t('拍照建档')}</Button>}/><UnknownState message={t('还没有完整盘点，净资产保持未知。')}/><ErrorState message={t('资料读取失败。')} onRetry={() => {}}/>
    <ActionBar status={t('已填 2 / 5 个账户')}><Button onClick={() => nav.push(dev('dev.gallery.sheet'))}>{t('弹窗')}</Button><Button variant="primary" onClick={() => nav.push(dev('dev.gallery.modal'))}>{t('模态页')}</Button></ActionBar>
  </div>;
}
function Detail() { const nav = useNav(); return <div className="m-page"><NavBar/><LargeTitle title={t('二级页')}/><Card>{t('推入的页面：左上角显示「‹ 上一页标题」，浏览器后退键与 iOS 边缘返回都会回到上一页。')}</Card><Button onClick={() => nav.push(dev('dev.gallery.page'))}>{t('再推入一页')}</Button></div>; }
function Modal() { const nav = useNav(); return <div className="m-page"><NavBar title={t('新增物品')} primary={{ label: t('保存'), onClick: () => nav.pop() }}/><FormGroup title={t('模态页')}><TextField label={t('名称')} value="" onChange={() => {}} placeholder={t('必填')}/></FormGroup></div>; }
function SheetBody() { const [value, setValue] = useState('date'); return <div className="m-page"><ChipRow label={t('排序')} items={[{ id: 'date', label: t('购入日期') }, { id: 'price', label: t('购入金额') }]} value={value} onChange={setValue}/></div>; }

const pages = { 'dev.gallery': Gallery, 'dev.gallery.page': Detail, 'dev.gallery.modal': Modal, 'dev.gallery.sheet': SheetBody };
/** Adds the gallery routes to the registry at runtime (preview only). */
export function registerGalleryRoutes() {
  const defs: Record<string, RouteDef> = {
    'dev.gallery': { tab: 'me', title: t('组件库'), load: async () => ({ default: pages['dev.gallery'] }) },
    'dev.gallery.page': { tab: 'me', title: t('二级页'), load: async () => ({ default: pages['dev.gallery.page'] }) },
    'dev.gallery.modal': { tab: 'me', kind: 'modal', title: t('新增物品'), load: async () => ({ default: pages['dev.gallery.modal'] }) },
    'dev.gallery.sheet': { tab: 'me', kind: 'sheet', title: t('筛选与排序'), load: async () => ({ default: pages['dev.gallery.sheet'] }) },
  };
  Object.assign(routes, defs);
}
