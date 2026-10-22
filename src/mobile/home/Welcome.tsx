import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from '../../asset';
import { pendingGenerations } from '../../library-mode';
import { LogoMark } from '../../LogoMark';
import { choiceStorage, dismissStartChoice, persistOverviewChoice, starterModules } from '../../start-choice';
import type { StartChoice } from '../../start-choice';
import type { RuntimeModules } from '../../modules';
import { storedPending } from '../../wealth';
import { useModules } from '../modules-context';
import { useNav } from '../nav-context';
import { useSession } from '../session';
import { Button, Card, Icon, ListGroup, ListRow, Loading, Notice, Sheet, Switch } from '../ui';
import type { PageProps } from '../routes';
import { installMobileRuntime } from '../me/runtime';
import { readGate } from './read';
import type { Gate } from './read';
import './home.css';
import { t } from '../../i18n.ts';
installMobileRuntime();

/** 首次打开 (design 25). Same logic as the desktop StartChoice: shown only for a library that is not the sample, has no records and was not skipped. */
export default function Welcome(_props: PageProps) {
  const nav = useNav(), session = useSession(), { modules, reload } = useModules();
  const [gate, setGate] = useState<Gate | null>(null), [readError, setReadError] = useState('');
  const [choosing, setChoosing] = useState(false), [hideExtras, setHideExtras] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => { readGate().then(setGate).catch(cause => setReadError(errorMessage(cause))); }, []);

  const blocked = () => session.navBlocked || !!storedPending() || pendingGenerations(localStorage).length > 0;
  const generation = gate?.counts.generation ?? null;

  /** Leaves this screen for the overview (which then opens the chosen place) and remembers the choice for this library. */
  function finish(open: () => void) {
    dismissStartChoice(choiceStorage(), generation);
    nav.replace('home.overview');
    open();
  }
  async function start(choice: StartChoice) {
    if (lock.current || busy) return;
    if (blocked()) { setError('有未完成的操作或待核对的保存结果，请先处理后再开始。'); return; }
    if (choice === 'combined' && modules && !modules.wealth) { setError('账户与盘点已关闭，请先在我的 › 设置 › 功能模块中打开后再盘点。'); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      if (hideExtras) {
        const payload = starterModules(modules as RuntimeModules, modules !== null);
        if (!payload) { setHideExtras(false); setError('模块开关尚未可靠读取，本次没有隐藏辅助模块。再点一次「开始记录」会直接开始，也可在设置中重新读取开关后再试。'); return; }
        try { await invoke<RuntimeModules>('modules_set', payload); reload(); }
        catch (cause) {
          setHideExtras(false);
          try { await invoke<RuntimeModules>('modules_get'); reload(); } catch { /* the original failure is the one to report */ }
          setError('辅助模块设置未完成：' + errorMessage(cause) + ' 再点一次「开始记录」会直接开始，起步选择会保留。');
          return;
        }
      }
      persistOverviewChoice(choiceStorage(), choice);
      setChoosing(false);
      finish(() => { if (choice === 'physical') nav.push('items.edit'); else nav.switchTab('wealth'); });
    } finally { lock.current = false; setBusy(false); }
  }
  async function sample() {
    if (lock.current || busy) return;
    if (blocked()) { setError('有未完成的操作或待核对的保存结果，请先处理后再查看样例。'); return; }
    lock.current = true; setBusy(true); setError('');
    try { await invoke('switch_demo', { demo: true }); location.reload(); }
    catch (cause) { setError(errorMessage(cause)); lock.current = false; setBusy(false); }
  }
  function fromBackup() {
    nav.switchTab('me');
    nav.push('me.data', { focus: 'restore' });
  }

  if (readError) return <div className="m-page h-welcome"><Notice tone="danger">{readError}</Notice><Button onClick={() => { setReadError(''); readGate().then(setGate).catch(cause => setReadError(errorMessage(cause))); }}>{t('重新读取')}</Button></div>;
  if (!gate) return <div className="m-page h-welcome"><Loading/></div>;
  return <div className="m-page h-welcome">
    <div className="h-welcome-brand"><span className="h-logo"><LogoMark maskId="welcome-logo"/></span><span>{t('物谱')}</span></div>
    <h1 className="h-welcome-title">{t('记下每件东西，')}<br/>{t('算清还要上几年班')}</h1>
    <div className="h-welcome-cards">
      {([['camera', 'accent', '物品档案', '拍照建档、保修提醒、日均成本'], ['doc', 'positive', '账户盘点', '每月一次，看清家底'], ['chart', 'warn', '规划', '还要上几年班，两个人一起算']] as const).map(([icon, tone, title, text]) =>
        <Card key={title}><div className="h-feature"><span className={`m-row-icon m-tone-${tone} h-feature-icon`}><Icon name={icon} size={22}/></span><div><strong>{title}</strong><p>{text}</p></div></div></Card>)}
    </div>
    <p className="h-privacy"><Icon name="shield" size={16}/>{t('资料只存在这台手机，没有账号，不联网。')}</p>
    {error && !choosing && <Notice tone="danger">{error}</Notice>}
    <div className="h-welcome-actions">
      <Button variant="primary" block disabled={busy || !generation} onClick={() => setChoosing(true)}>{t('开始记录')}</Button>
      <div className="h-welcome-links">
        <button type="button" className="h-welcome-link" disabled={busy || !generation} onClick={() => void sample()}>{t('先看看样例')}</button>
        <button type="button" className="h-welcome-link" disabled={busy} onClick={fromBackup}>{t('从备份导入')}</button>
        <button type="button" className="h-welcome-link" disabled={busy || !generation} onClick={() => finish(() => undefined)}>{t('以后再说')}</button>
      </div>
    </div>
    {choosing && <Sheet title={t('从哪里开始')} cancelLabel={t('取消')} onClose={() => { if (!busy) setChoosing(false); }}>
      <div className="m-page">
        <ListGroup footer={t('另一件随时都能再开始；起步时先隐藏周期费用和虚拟资产，可在我的 › 设置 › 功能模块中打开。')}>
          <ListRow icon="box" title={t('先整理物品')} subtitle={t('从第一件物品开始建档')} disabled={busy} onClick={() => void start('physical')}/>
          <ListRow icon="doc" tone="positive" title={t('先盘点账户')} subtitle={t('把各平台的余额和欠款录一遍，看到净资产')} disabled={busy} onClick={() => void start('combined')}/>
        </ListGroup>
        <ListGroup><ListRow title={t('先隐藏周期费用和虚拟资产')} trailing={<Switch label={t('先隐藏周期费用和虚拟资产')} checked={hideExtras} disabled={busy} onChange={setHideExtras}/>}/></ListGroup>
        {error && <Notice tone="danger">{error}</Notice>}
        {busy && <Loading label={t('正在准备…')}/>}
      </div>
    </Sheet>}
  </div>;
}
