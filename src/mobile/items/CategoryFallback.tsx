import type { CategoryIcon } from '../../taxonomy';
import { Icon } from '../ui';
import type { IconName } from '../ui';

const glyphs: Record<CategoryIcon, IconName> = {
  box: 'box',
  computer: 'laptop',
  phone: 'phone',
  camera: 'camera',
  audio: 'headphones',
  home: 'sofa',
};

/** A quiet category glyph for items without a user photo or chosen material. */
export function CategoryFallback({ icon }: { icon?: CategoryIcon | null }) {
  return <span className="mi-category-fallback" aria-hidden="true"><Icon name={glyphs[icon ?? 'box']} size={24} strokeWidth={1.8}/></span>;
}
