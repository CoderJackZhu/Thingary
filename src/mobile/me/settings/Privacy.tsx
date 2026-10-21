import { useEffect, useState, useSyncExternalStore } from 'react';
import { idleMinutes } from '../../../privacy-lock';
import { FormGroup, FormRow, ListGroup, ListRow, Loading, Notice, SelectField, Switch } from '../../ui';
import { authName, probePrivacy, privacySnapshot, setCover, setLock, subscribePrivacy } from '../privacy-runtime';
import { errorMessage } from '../../../asset';
import { SettingsShell } from './Shell';

const idleLabels: Record<number, string> = { 0: '从不', 5: '5 分钟', 15: '15 分钟', 60: '1 小时' };

/** 隐私: 切到后台时遮住内容, 面容 ID 锁和闲置后重新验证. Same preferences and state machine as the desktop 屏幕隐私. */
export default function PrivacyPage() {
  const privacy = useSyncExternalStore(subscribePrivacy, privacySnapshot), name = authName();
  const [error, setError] = useState('');
  useEffect(() => { if (privacy.available === null) void probePrivacy(); }, []);
  async function changeLock(next: { enabled: boolean; idleMinutes: number }) {
    setError('');
    try { if (!(await setLock(next))) setError(next.enabled ? `需要先通过${name}验证才能开启；也可能无法保存设置，请重试。` : '无法保存隐私设置，请重试。'); }
    catch (cause) { setError(errorMessage(cause)); }
  }
  const unsupported = privacy.available === false;
  return <SettingsShell title="隐私" lead="防止旁人看到屏幕。这只是屏幕保护，不会加密资料库文件。">
    <ListGroup footer="切换应用或回到桌面时，任务切换器里只会看到遮罩。">
      <ListRow title="切到后台时遮住内容" subtitle="系统截屏的任务预览里看不到资料" trailing={<Switch label="切到后台时遮住内容" checked={privacy.cover} onChange={on => setError(setCover(on) ? '' : '无法保存隐私设置，请重试。')}/>}/>
    </ListGroup>
    <ListGroup title={name} footer={unsupported ? `这台设备没有设置${name}或设备密码，无法启用。` : privacy.available === null ? '暂未确认这台设备是否支持验证身份。' : `每次打开物谱需要${name}验证。`}>
      <ListRow title={`启用${name}`} subtitle="打开物谱时先验证身份" trailing={<Switch label={`启用${name}`} checked={privacy.lock.enabled} disabled={privacy.available !== true || privacy.checking} onChange={on => void changeLock({ ...privacy.lock, enabled: on })}/>}/>
    </ListGroup>
    {privacy.available === null && !privacy.error && <Loading label="正在检查设备是否支持…"/>}
    {privacy.lock.enabled && <FormGroup footer="闲置时长只在离开物谱后返回时检查；未完成的编辑、保存或待核对请求会延后验证，处理完后再锁定。">
      <SelectField label="闲置后重新验证" value={String(privacy.lock.idleMinutes)} disabled={privacy.available !== true || privacy.checking} onChange={value => void changeLock({ ...privacy.lock, idleMinutes: Number(value) })} options={idleMinutes.map(value => ({ id: String(value), label: idleLabels[value] }))}/>
    </FormGroup>}
    <FormGroup><FormRow label="资料文件" hint="可另行创建加密备份；本机资料库文件仍未加密。"><span/></FormRow></FormGroup>
    {(error || privacy.error) && <Notice tone="danger">{error || privacy.error}</Notice>}
  </SettingsShell>;
}
