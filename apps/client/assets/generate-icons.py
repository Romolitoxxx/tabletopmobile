"""Generates the app icon and splash images for Android and iOS.

Run from apps/client:  python3 assets/generate-icons.py   (needs Pillow)
"""
import glob

from PIL import Image, ImageDraw

BG = (27, 58, 42, 255)
SPLASH_BG = (18, 36, 26, 255)


def artwork(size):
    """Card with a heart and a die, transparent background."""
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    card = Image.new('RGBA', (int(size * 0.42), int(size * 0.58)), (0, 0, 0, 0))
    cd = ImageDraw.Draw(card)
    w, h = card.size
    cd.rounded_rectangle((0, 0, w - 1, h - 1), radius=int(w * 0.1), fill=(255, 253, 247, 255),
                         outline=(60, 60, 60, 255), width=max(2, int(size * 0.008)))
    cx, cy, r = w / 2, h / 2, w * 0.18
    red = (198, 40, 40, 255)
    cd.ellipse((cx - 2 * r, cy - 1.6 * r, cx, cy + 0.4 * r), fill=red)
    cd.ellipse((cx, cy - 1.6 * r, cx + 2 * r, cy + 0.4 * r), fill=red)
    cd.polygon([(cx - 1.95 * r, cy - 0.4 * r), (cx + 1.95 * r, cy - 0.4 * r), (cx, cy + 2.1 * r)], fill=red)
    card = card.rotate(-12, expand=True, resample=Image.BICUBIC)
    cw, ch = card.size
    im.alpha_composite(card, (int(size / 2 - cw * 0.62), int(size / 2 - ch / 2)))
    d = ImageDraw.Draw(im)
    ds = int(size * 0.26)
    x, y = int(size / 2 + size * 0.06), int(size / 2 + size * 0.02)
    d.rounded_rectangle((x, y, x + ds, y + ds), radius=int(ds * 0.18), fill=(255, 202, 40, 255),
                        outline=(40, 40, 40, 255), width=max(2, int(size * 0.008)))
    pr = ds * 0.09
    for px, py in [(0.25, 0.25), (0.5, 0.5), (0.75, 0.75)]:
        d.ellipse((x + ds * px - pr, y + ds * py - pr, x + ds * px + pr, y + ds * py + pr), fill=(33, 33, 33, 255))
    return im


def icon(size, scale=1.0, background=BG, round_mask=False):
    im = Image.new('RGBA', (size, size), background)
    art = artwork(int(size * scale))
    im.alpha_composite(art, ((size - art.width) // 2, (size - art.height) // 2))
    if round_mask:
        mask = Image.new('L', (size, size), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
        im.putalpha(mask)
    return im


def splash(w, h):
    im = Image.new('RGBA', (w, h), SPLASH_BG)
    s = int(min(w, h) * 0.3)
    art = artwork(s)
    im.alpha_composite(art, ((w - s) // 2, (h - s) // 2))
    return im.convert('RGB')


RES = 'android/app/src/main/res'
DENSITY = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
for name, k in DENSITY.items():
    folder = f'{RES}/mipmap-{name}'
    icon(int(48 * k)).save(f'{folder}/ic_launcher.png')
    icon(int(48 * k), round_mask=True).save(f'{folder}/ic_launcher_round.png')
    # Adaptive icon foreground: 108dp canvas, artwork inside the 66dp safe zone.
    icon(int(108 * k), scale=0.6, background=(0, 0, 0, 0)).save(f'{folder}/ic_launcher_foreground.png')

with open(f'{RES}/values/ic_launcher_background.xml', 'w') as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
            '    <color name="ic_launcher_background">#1B3A2A</color>\n</resources>\n')

for path in glob.glob(f'{RES}/drawable*/splash.png'):
    with Image.open(path) as old:
        size = old.size
    splash(*size).save(path)

IOS = 'ios/App/App/Assets.xcassets'
icon(1024).convert('RGB').save(f'{IOS}/AppIcon.appiconset/AppIcon-512@2x.png')
for path in glob.glob(f'{IOS}/Splash.imageset/*.png'):
    splash(2732, 2732).save(path)

print('ok')
