import { lazy } from 'react';
import type { ComponentType } from 'react';
import { routeDef } from './routes';
import type { PageProps } from './routes';
import { Placeholder } from './Placeholder';

const cache = new Map<string, ComponentType<PageProps>>();
/** Page component for a registered route: its lazy module, or the shared placeholder. Stable across renders. */
export function pageFor(name: string): ComponentType<PageProps> {
  let component = cache.get(name);
  if (!component) {
    const load = routeDef(name)?.load;
    component = load ? lazy(load) : Placeholder;
    cache.set(name, component);
  }
  return component;
}
