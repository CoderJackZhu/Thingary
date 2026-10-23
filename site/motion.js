/* Page motion: local only, no libraries, no network. Everything is visible without it. */
(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const root = document.documentElement;
  root.classList.add('motion');

  // Hero headline and reveal-on-enter blocks.
  requestAnimationFrame(() => root.classList.add('motion-ready'));
  const reveal = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); reveal.unobserve(e.target); }
  }, { rootMargin: '0px 0px -10% 0px' });
  document.querySelectorAll('.showcase, .feature-art, .feature-copy, .start-section, #privacy, .download')
    .forEach(el => { el.classList.add('reveal'); reveal.observe(el); });

  // Hero screenshot grows slightly as it scrolls into view.
  const shot = document.querySelector('.hero .showcase-frame');
  const grow = () => {
    if (!shot) return;
    const r = shot.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, 1 - r.top / innerHeight));
    shot.style.setProperty('--grow', (0.94 + 0.06 * t).toFixed(3));
  };
  addEventListener('scroll', grow, { passive: true });
  grow();

  // Hero particles: drifting dots, thin links, gentle pull toward the pointer.
  const hero = document.querySelector('.hero');
  if (!hero) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'hero-particles';
  canvas.setAttribute('aria-hidden', 'true');
  hero.prepend(canvas);
  const ctx = canvas.getContext('2d');
  const dots = Array.from({ length: 100 }, () => ({ x: Math.random(), y: Math.random(), vx: (Math.random() - .5) * 2e-4, vy: (Math.random() - .5) * 2e-4 }));
  const pointer = { x: -1, y: -1 };
  let w = 0, h = 0, dpr = 1, running = true, color = '';
  const resize = () => {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    color = getComputedStyle(root).getPropertyValue('--accent').trim() || '#5553b8';
  };
  new ResizeObserver(resize).observe(canvas);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', resize);
  hero.addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect();
    pointer.x = (e.clientX - r.left) / r.width; pointer.y = (e.clientY - r.top) / r.height;
  });
  hero.addEventListener('pointerleave', () => { pointer.x = pointer.y = -1; });
  document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) frame(); });
  const link = 110;
  function frame() {
    if (!running) return;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = ctx.strokeStyle = color;
    for (const d of dots) {
      d.x += d.vx; d.y += d.vy;
      if (d.x < 0 || d.x > 1) d.vx *= -1;
      if (d.y < 0 || d.y > 1) d.vy *= -1;
      if (pointer.x >= 0) { d.x += (pointer.x - d.x) * 6e-4; d.y += (pointer.y - d.y) * 6e-4; }
    }
    for (let i = 0; i < dots.length; i++) {
      const a = dots[i], ax = a.x * w, ay = a.y * h;
      ctx.globalAlpha = .6; ctx.beginPath(); ctx.arc(ax, ay, 1.4, 0, 6.283); ctx.fill();
      for (let j = i + 1; j < dots.length; j++) {
        const bx = dots[j].x * w, by = dots[j].y * h, dist = Math.hypot(ax - bx, ay - by);
        if (dist < link) { ctx.globalAlpha = .3 * (1 - dist / link); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); }
      }
    }
    requestAnimationFrame(frame);
  }
  resize();
  frame();
})();
