import { useSyncExternalStore } from 'react';
import type { Query } from '../../asset';
import { changeQuery, initialQuery } from './list-model';
let query=initialQuery();
const listeners=new Set<()=>void>();
export function setItemQuery(change: Partial<Query>) { query=changeQuery(query,change); listeners.forEach(fn=>fn()); }
export function resetItemQuery() { query=initialQuery(); listeners.forEach(fn=>fn()); }
export function useItemQuery() { return useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},()=>query); }
