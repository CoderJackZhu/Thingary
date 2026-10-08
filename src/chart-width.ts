import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
/** SVG text scales with the chart; reserve a fixed pixel gap between labels. */
export function useChartScale(ref: RefObject<SVGSVGElement | SVGGElement | null>, width: number, height: number) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const node = ref.current, svg = node instanceof SVGSVGElement ? node : node?.ownerSVGElement;
    if (!svg) return;
    const measure = () => { const box = svg.getBoundingClientRect(); setScale(Math.min(box.width / width, box.height / height) || 1); };
    measure(); const observer = new ResizeObserver(measure); observer.observe(svg);
    return () => observer.disconnect();
  }, [ref, width, height]);
  return scale;
}
