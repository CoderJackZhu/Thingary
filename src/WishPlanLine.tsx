import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { money } from './asset';
import { loadPlanContext, wishLike } from './plan-data';
import { buildRetireCalc } from './plan-retire-calc';
import { classifyWishes, impactOf, impactSentence, isReady } from './plan-wishes';
import type { Modules } from './modules';
import { readCapabilities } from './planning-basic-port';
import { readPlanningSources } from './planning-service';
import { needsContribution, SAVE_CONTRIBUTION_HINT } from './planning-basic-view';
import type { WishlistItem } from './wishlist';

/** 心愿详情里的只读一行：这笔支出对 FIRE 日期的影响。规划关闭或资料不全时不显示；不改变心愿状态。 */
export function WishPlanLine({ item, today }: { item: WishlistItem; today: string }) {
  const [text, setText] = useState('');
  useEffect(() => {
    let live = true; setText('');
    (async () => {
      const modules = await invoke<Modules>('modules_get').catch(() => null);
      if (modules && !modules.planning) return;
      const ctx = await loadPlanContext();
      if (!ctx.profile.saved) return;
      if (ctx.profile.saved.profile.retire.basic) {
        // Basic plans: the impact needs an explicit contribution; say so instead of staying silent.
        const [spend] = classifyWishes([wishLike(item)], today);
        if (!spend || spend.status === 'expired' || spend.status === 'no_price') return;
        const found = readCapabilities(await readPlanningSources({ planning: true, wealth: modules?.wealth ?? true }));
        if (live && found.status === 'ready' && needsContribution(found.caps)) setText(SAVE_CONTRIBUTION_HINT + '：在目标详情里填写预计每月投入。');
        return;
      }
      const calc = buildRetireCalc(ctx.profile.saved, ctx.snapshot, ctx.review, ctx.incomes, today);
      const [spend] = classifyWishes([wishLike(item)], today);
      if (!spend || !isReady(calc)) return;
      const sentence = impactSentence(spend, impactOf(calc, [spend]), calc.r.emergency_months, c => money(String(Math.round(c))));
      if (live) setText(sentence);
    })().catch(() => { /* 规划读取失败时不影响心愿详情 */ });
    return () => { live = false; };
  }, [item.id, item.fields.estimated_price_cents, item.fields.target_date, item.decision_state, today]);
  return text ? <p className="muted small wish-plan-line" role="note">规划：{text}</p> : null;
}
