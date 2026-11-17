#!/usr/bin/env python3
"""Tools/png2webp.py — convert PNG art to WebP, next to the source file, then delete the PNG.

    python3 Tools/png2webp.py lossy    assets/hero/post [--recursive] [--keep]
    python3 Tools/png2webp.py lossless assets/overlay/mvp --recursive

lossy    = quality 90, alpha kept (player photos / hero art — what every existing *_web / *.webp copy uses)
lossless = exact pixels (UI art with hard edges); a WebP that is not smaller than its PNG is discarded.
--keep   = leave the PNG in place (default: delete it after the WebP decodes and the sizes match).
Requires Pillow with WebP support (pip install pillow). New art should be added as WebP only: the pages
no longer have a PNG fallback for hero / MVP / player-photo images (see html/js/hero-web.js, mvSetImg in postgame.html).
"""
import os, sys
from PIL import Image

def main():
    if len(sys.argv) < 3 or sys.argv[1] not in ('lossy', 'lossless'):
        sys.exit(__doc__)
    mode, root = sys.argv[1], sys.argv[2]
    rec, keep = '--recursive' in sys.argv, '--keep' in sys.argv
    files = []
    for dp, _, fn in os.walk(root):
        files += [os.path.join(dp, f) for f in fn if f.lower().endswith('.png')]
        if not rec: break
    saved = done = 0
    for p in sorted(files):
        w = p[:-4] + '.webp'
        im = Image.open(p); im.load()
        if im.mode not in ('RGB', 'RGBA'):
            im = im.convert('RGBA' if ('A' in im.mode or 'transparency' in im.info) else 'RGB')
        if mode == 'lossy': im.save(w, 'WEBP', quality=90, method=6)
        else: im.save(w, 'WEBP', lossless=True, method=6, exact=True)
        chk = Image.open(w); chk.load()
        if chk.size != im.size: os.remove(w); print('size mismatch, skipped', p); continue
        pn, wn = os.path.getsize(p), os.path.getsize(w)
        if mode == 'lossless' and wn >= pn: os.remove(w); print('not smaller, skipped', p); continue
        saved += pn - wn; done += 1
        if not keep: os.remove(p)
    print(f'{root}: converted {done}, saved {saved/1048576:.1f} MB')

if __name__ == '__main__': main()
