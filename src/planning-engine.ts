/** Transport for the rebuilt Rust kernel; product input compilation and presentation stay in TypeScript. */
import { invoke } from '@tauri-apps/api/core';
import { planningEngineWasm, planningEngineSourceHash } from './planning-engine-wasm.ts';
import type { Plan, Projection } from './plan-ledger.ts';
import { t } from './i18n.ts';
export const planningModelVersion = `rust-${planningEngineSourceHash.slice(0, 12)}`;
type Exports = {
  memory: WebAssembly.Memory;
  alloc: (length: number) => number;
  release: (pointer: number, length: number) => void;
  evaluate: (pointer: number, length: number) => number;
  result_len: () => number;
};
let engine: Exports | undefined;
function runtime(): Exports {
  if (!engine) {
    const bytes = Uint8Array.from(atob(planningEngineWasm), ch => ch.charCodeAt(0));
    engine = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports as unknown as Exports;
  }
  return engine;
}

/** Preserve unknowns and reject non-finite numbers before JSON could turn them into null. */
function jsonInput(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw new RangeError('测算输入包含非有限数值');
    if (item instanceof Float64Array) return Array.from(item);
    return item;
  });
}

export function engineRequest<T>(request: Record<string, unknown>): T {
  const bytes = new TextEncoder().encode(jsonInput(request));
  if (bytes.length > 64 * 1024 * 1024) throw new RangeError('测算输入过大');
  const wasm = runtime();
  const pointer = wasm.alloc(bytes.length) >>> 0;
  if (!pointer) throw new Error(t('计算引擎无法分配输入内存'));
  try {
    new Uint8Array(wasm.memory.buffer, pointer, bytes.length).set(bytes);
    const resultPointer = wasm.evaluate(pointer, bytes.length) >>> 0;
    const length = wasm.result_len() >>> 0;
    const result = JSON.parse(new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, resultPointer, length))) as
      { ok: true; value: T } | { ok: false; error: string };
    if (!result.ok) throw new RangeError(result.error);
    return result.value;
  } finally {
    wasm.release(pointer, bytes.length);
  }
}

/** Native batches run off the UI thread. A cancelled/late batch never publishes a result. */
export async function engineRequestAsync<T>(request: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  let result: T;
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    signal?.throwIfAborted();
    result = await invoke<T>('planning_engine_evaluate', { request: JSON.parse(jsonInput(request)) });
  } else {
    // The preview and Node acceptance use the same Rust binary compiled to WASM.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    signal?.throwIfAborted();
    result = engineRequest<T>(request);
  }
  signal?.throwIfAborted();
  return result;
}

/** Whitelist computational inputs. UI records and provenance metadata stay outside the kernel. */
export function enginePlan(plan: Plan): Record<string, unknown> {
  const n = plan.horizon_months - plan.now_months;
  if (!Number.isInteger(n) || n < 0 || n > 1440) throw new RangeError('测算期限超出范围');
  const pensions = plan.input_mode === 'basic'
    ? [plan.pension_at(plan.target_months)]
    : Array.from({ length: n + 1 }, (_, i) => plan.pension_at(plan.now_months + i));
  return {
    now_months: plan.now_months, horizon_months: plan.horizon_months,
    target_months: plan.target_months, search_cap_months: plan.search_cap_months,
    mode: plan.mode, input_mode: plan.input_mode, assets_cents: plan.assets_cents,
    saving_cents: plan.saving_cents, saving_growth_hundredths: plan.saving_growth_hundredths,
    saving_phases: plan.saving_phases, saving_flows: plan.saving_flows, spend_flows: plan.spend_flows,
    r_before_hundredths: plan.r_before_hundredths, r_after_hundredths: plan.r_after_hundredths,
    inflation_hundredths: plan.inflation_hundredths, volatility_hundredths: plan.volatility_hundredths,
    items: plan.items, incomes: plan.incomes, future_incomes: plan.future_incomes,
    spends: plan.spends, transfers: plan.transfers, loans: plan.loans, pensions,
    anchor_date: plan.anchor_date, calculation_date: plan.calculation_date,
    monetary_basis_date: plan.monetary_basis_date, basis_factor: plan.basis_factor,
    first_month_fraction: plan.first_month_fraction, age_reference: plan.age_reference,
  };
}

export function engineProjection(projection: Projection): Record<string, unknown> {
  return { ...projection, assets: Array.from(projection.assets), debt: Array.from(projection.debt),
    withdrawn: Array.from(projection.withdrawn), unfunded: Array.from(projection.unfunded) };
}
