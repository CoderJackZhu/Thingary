"""WCAG 2.x contrast of theme text tokens on their backgrounds, read from the real CSS (later file wins)."""
import re, pathlib
def tokens(sel):
    t = {}
    for f in ['src/style.css', 'src/app-layout.css']:
        for block in re.findall(re.escape(sel) + r'\{([^}]*)\}', pathlib.Path(f).read_text()):
            t.update(re.findall(r'--([\w-]+):(#[0-9a-fA-F]{3,6})', block))
    return t
def lum(h):
    h = h.lstrip('#'); h = ''.join(c * 2 for c in h) if len(h) == 3 else h
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= .03928 else ((x + .055) / 1.055) ** 2.4 for x in c]
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]
def ratio(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True); return (la + .05) / (lb + .05)
light = tokens(':root'); dark = {**light, **tokens(':root[data-theme=dark]')}
worst = []
for name, t in [('light', light), ('dark', dark)]:
    for fg in ['text', 'muted', 'accent', 'error', 'positive']:
        for bg in ['bg', 'side', 'card', 'soft', 'selected']:
            if fg in t and bg in t:
                r = ratio(t[fg], t[bg]); print(f'{name:5} {fg:8} on {bg:8} {r:5.2f}' + ('  < 4.5' if r < 4.5 else ''))
                worst.append((r, name, fg, bg))
print('min', min(worst))
