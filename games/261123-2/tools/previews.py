# Makes the small start-up textures assets/preview/*.webp from assets/*.webp (run after changing an asset):
#   python3 tools/previews.py
import os
from PIL import Image
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SIZE = {  # name: (long edge px, webp quality)
    'backdrop': (320, 62), 'ground': (256, 60), 'leaflitter': (192, 62), 'leaves': (384, 70), 'branch': (320, 55),
    'bark': (128, 65), 'stone': (96, 65), 'weave': (64, 70), 'zaru': (160, 65), 'potato_skin': (128, 70),
    'ash': (96, 65), 'potato_roast': (96, 65), 'flesh_yellow': (96, 70), 'flesh_purple': (96, 70), 'flesh_orange': (96, 70)}
os.makedirs(os.path.join(ROOT, 'assets/preview'), exist_ok=True)
for n, (L, q) in SIZE.items():
    im = Image.open(os.path.join(ROOT, f'assets/{n}.webp'))
    w, h = im.size
    sc = L / max(w, h)
    im = im.resize((max(1, round(w * sc)), max(1, round(h * sc))), Image.LANCZOS)
    im.save(os.path.join(ROOT, f'assets/preview/{n}.webp'), 'WEBP', quality=q, method=6,
            **({'alpha_quality': 50} if im.mode == 'RGBA' else {}))
