// Reads for the 总览 page. Every command is the one the desktop overview already uses.
import { invoke } from '@tauri-apps/api/core';
import type { Page } from '../../asset';
import { loadConsideringWishes } from '../../plan-data';
import type { Review } from '../../review';
import type { DemoStatus } from '../../library-mode';
import type { WishDue } from './model';

export type LibraryCounts = { generation: string; all: number; active: number; covered: number; retired: number; sold: number };
export type Gate = { demo: DemoStatus; counts: LibraryCounts };
/** Which first screen applies: the library identity, how many items it holds and whether the sample is open. */
export async function readGate(): Promise<Gate> {
  const [demo, counts] = await Promise.all([invoke<DemoStatus>('demo_status'), invoke<LibraryCounts>('asset_counts')]);
  return { demo, counts };
}

export const readReview = (planning: boolean) => invoke<Review>('review_overview', { year: null, planning });
/** Items whose protection ends within 30 days (the desktop 即将到期 warranty filter). */
export const readExpiringWarranties = () => invoke<Page>('list_assets', { query: { search: '', filter: 'held', category: { mode: 'all' }, sort: 'created', descending: true, offset: 0, warranty: 'expiring' } });
export const readConsideringWishes = (): Promise<WishDue[]> => loadConsideringWishes();
