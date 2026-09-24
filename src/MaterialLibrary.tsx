import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './asset';
import type { MaterialEntry } from './materials';

// Shared thumbnail: renders the managed preview from the material library.
export function MaterialThumb({ id, alt, generation }: { id: string; alt: string; generation: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let live = true, url = '';
    setSrc('');
    void invoke<ArrayBuffer>('material_preview', { id, generation }).then(bytes => {
      if (live) { url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' })); setSrc(url); }
    }).catch(() => { if (live) setSrc(''); });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [id, generation]);
  return src ? <img className="material-thumb-image" src={src} alt={alt}/> : <span className="material-thumb-placeholder" aria-hidden="true">…</span>;
}

export function MaterialLibrary({ generation, onNotice }: { generation: string; onNotice: (message: string) => void }) {
  const [entries, setEntries] = useState<MaterialEntry[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const reload = useCallback(() => {
    setError('');
    invoke<MaterialEntry[]>('list_materials').then(list => setEntries(list)).catch(e => { setEntries(null); setError(errorMessage(e)); });
  }, []);
  useEffect(() => { reload(); }, [reload]);
  async function upload() {
    if (busy) return;
    setBusy(true);
    try {
      const entry = await invoke<MaterialEntry>('add_material', { generation });
      onNotice(`已上传素材「${entry.name}」。`);
      reload();
    } catch (e) { onNotice(errorMessage(e)); }
    finally { setBusy(false); }
  }
  async function remove(id: string, name: string) {
    if (busy) return;
    setBusy(true); setConfirming(null);
    try {
      setEntries(await invoke<MaterialEntry[]>('remove_material', { id, generation }));
      onNotice(`已删除素材「${name}」。已保存资产的图片不受影响。`);
    } catch (e) { onNotice(errorMessage(e)); reload(); }
    finally { setBusy(false); }
  }
  return <section className="materials-section" aria-labelledby="materials-heading">
    <section className="card">
      <h2 id="materials-heading">素材库</h2>
      <p className="muted">新增资产时直接从这些图片选择封面与图片。内置素材为示意图，非实物照片；也可以上传自己的图片作为素材。</p>
      <div className="material-library-actions">
        <button type="button" className="primary" disabled={busy} onClick={() => void upload()}>{busy ? '正在处理…' : '上传素材'}</button>
        <span className="muted small">JPEG、PNG、HEIC、WebP · 每张 20 MiB。上传后随档案保存在本机。</span>
      </div>
      {error ? <div role="alert" className="confirm"><p>{error}</p><button type="button" onClick={reload}>重新读取</button></div> : entries ? <div className="material-library-grid">
        {entries.map(entry => <div className="material-card" key={entry.id}>
          <MaterialThumb id={entry.id} generation={generation} alt={entry.builtin ? `${entry.name}示意图（非实物照片）` : entry.name}/>
          <span className="material-card-name" title={entry.name}>{entry.name}</span>
          <span className="material-card-kind">{entry.builtin ? '内置示意图' : '自定义'}</span>
          {!entry.builtin && (confirming === entry.id
            ? <div className="material-card-actions"><span>删除后不可恢复，已保存资产不受影响。</span><button type="button" className="danger" disabled={busy} onClick={() => void remove(entry.id, entry.name)}>确认删除</button><button type="button" disabled={busy} onClick={() => setConfirming(null)}>保留</button></div>
            : <div className="material-card-actions"><button type="button" disabled={busy} onClick={() => setConfirming(entry.id)}>删除</button></div>)}
        </div>)}
      </div> : <p className="muted" role="status">正在读取素材…</p>}
    </section>
  </section>;
}
