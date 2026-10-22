import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from '../../../asset';
import type { DemoStatus } from '../../../library-mode';
import { Button, FormGroup, ListGroup, ListRow, Notice } from '../../ui';
import { MeIcon } from '../icons';
import { shareWorkbook } from '../files';
import type { WorkbookDone } from '../files';
import { SettingsShell } from './Shell';
import { t } from '../../../i18n.ts';
/** 导出表格: one .xlsx workbook of the whole library (`export_workbook`), for reading in a spreadsheet. */
export default function ExportPage() {
  const [demo, setDemo] = useState(false), [state, setState] = useState<{ kind: 'idle' } | { kind: 'running' } | { kind: 'done'; done: WorkbookDone } | { kind: 'error'; text: string }>({ kind: 'idle' });
  useEffect(() => { invoke<DemoStatus>('demo_status').then(status => setDemo(status.active)).catch(() => undefined); }, []);
  async function run() {
    if (state.kind === 'running') return;
    setState({ kind: 'running' });
    try { const done = await shareWorkbook(); setState(done ? { kind: 'done', done } : { kind: 'idle' }); }
    catch (cause) { setState({ kind: 'error', text: '导出未完成：' + errorMessage(cause) }); }
  }
  return <SettingsShell title={t('导出表格')} lead={t('把物品、账户、盘点、支出和周期费用导出成一份 Excel 工作簿，用来在电脑上查看或自己分析。')}>
    <FormGroup footer={t('导出的表格不是备份，不能用来恢复。要保护资料，请使用「数据管理」里的完整备份。')}><div className="me-pad"><Button variant="primary" block disabled={demo || state.kind === 'running'} onClick={() => void run()}>{state.kind === 'running' ? t('正在导出…') : t('导出并分享表格')}</Button></div></FormGroup>
    {demo && <Notice>{t('正在查看样例，不能导出。返回自己的资料后再导出。')}</Notice>}
    {state.kind === 'done' && <ListGroup title={t('已导出')} footer={state.done.path}>{state.done.files.map(file => <ListRow key={file.name} icon={<MeIcon name="table"/>} title={file.name} value={t('{rows} 行', { rows: file.rows })}/>)}</ListGroup>}
    {state.kind === 'error' && <Notice tone="danger">{state.text}</Notice>}
  </SettingsShell>;
}
