import { useEffect, useRef } from 'react';
import { CloseButton } from './CloseButton';
import { SupportPanel } from './SupportPanel';

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="editor about-dialog" aria-labelledby="about-heading" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="about-frame">
      <header className="about-title"><h2 id="about-heading">关于物谱</h2><CloseButton aria-label="关闭关于物谱" onClick={onClose}/></header>
      <div className="about-body"><SupportPanel mode="about"/></div>
      <footer><button type="button" className="ui-btn" onClick={onClose}>关闭</button></footer>
    </div>
  </dialog>;
}
