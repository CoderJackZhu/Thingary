import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { t } from '../../i18n.ts';
/** Cancellable backup task bookkeeping shared by 数据管理 and 备份安全 (backup_task_begin / backup_task_cancel). */
export function useBackupTask() {
  const alive = useRef(true), active = useRef<{ id: string; requested: boolean } | null>(null);
  const [activeTask, setActiveTask] = useState<string | null>(null), [notice, setNotice] = useState('');
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const task = active.current;
      if (task && !task.requested) { task.requested = true; void invoke('backup_task_cancel', { taskId: task.id }).catch(() => undefined); }
    };
  }, []);
  async function withTask<T>(action: (taskId: string) => Promise<T>): Promise<T> {
    const taskId = await invoke<string>('backup_task_begin');
    if (!alive.current) { await invoke('backup_task_cancel', { taskId }).catch(() => undefined); throw { code: 'CANCELLED', message: t('已取消，原成品保留') }; }
    active.current = { id: taskId, requested: false }; setActiveTask(taskId); setNotice('');
    try { return await action(taskId); }
    finally { if (active.current?.id === taskId) { active.current = null; if (alive.current) { setActiveTask(null); setNotice(''); } } }
  }
  async function cancel() {
    const task = active.current;
    if (!task || task.requested) return;
    task.requested = true; setNotice(t('正在请求取消，请等待原操作收尾'));
    try {
      const accepted = await invoke<boolean>('backup_task_cancel', { taskId: task.id });
      if (alive.current && active.current?.id === task.id) setNotice(accepted ? t('正在取消，请等待清理') : t('本次操作已发布或完成，请等待原结果'));
    } catch { if (alive.current && active.current?.id === task.id) setNotice(t('未能确认取消请求，请等待原操作结果')); }
  }
  return { alive, activeTask, notice, withTask, cancel };
}
