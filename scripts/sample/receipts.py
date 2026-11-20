"""
Draws the "scanned" receipts on page 6 of the sample document (public/sample/receipt-*.jpg).

The page is a photo-like scan with no text layer, so OCR, deskew, image extraction,
greyscale and compression have something real to work on. Run it again after changing
the receipt text:

    python3 scripts/sample/receipts.py

Needs Pillow and DejaVu Sans Mono (fonts-dejavu-core on Debian/Ubuntu).
"""
import random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

MONO = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
MONO_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'
OUT = Path(__file__).resolve().parents[2] / 'public' / 'sample'

# A4 at 150 dpi.
W, H = 1240, 1754
WIDTH = 36  # characters per receipt line

RECEIPTS = {
    'en': {
        'head': ['BRANDT BIKE PARTS', 'Mühlenweg 3, Elsterfeld', 'Tel. 0123 456 780'],
        'meta': ('Receipt 2026-0418', '12/11/2026 10:42'),
        'items': [
            ('1 x Chain KMC X9, 116 links', '24.90'),
            ('2 x Brake pads Shimano B05S', '19.60'),
            ('2 x Inner tube 28" Presta', '13.00'),
            ('1 x Gear cable set', '7.50'),
        ],
        'totals': [('Subtotal', '65.00'), ('incl. VAT 19 %', '10.38')],
        'total': ('TOTAL EUR', '65.00'),
        'foot': ['Card payment  **** 4417', '', 'Returns within 14 days', 'with this receipt.', 'Thank you!'],
    },
    'de': {
        'head': ['RADTEILE BRANDT', 'Mühlenweg 3, Elsterfeld', 'Tel. 0123 456 780'],
        'meta': ('Beleg 2026-0418', '12.11.2026 10:42'),
        'items': [
            ('1 x Kette KMC X9, 116 Glieder', '24,90'),
            ('2 x Bremsbel. Shimano B05S', '19,60'),
            ('2 x Schlauch 28" Presta', '13,00'),
            ('1 x Schaltzug-Set', '7,50'),
        ],
        'totals': [('Zwischensumme', '65,00'), ('inkl. MwSt. 19 %', '10,38')],
        'total': ('SUMME EUR', '65,00'),
        'foot': ['Kartenzahlung  **** 4417', '', 'Umtausch innerhalb 14 Tagen', 'nur mit Beleg.', 'Vielen Dank!'],
    },
}


def lines_of(r):
    pad = lambda left, right: left + ' ' * max(1, WIDTH - len(left) - len(right)) + right
    out = [(t.center(WIDTH), True) for t in r['head']]
    out += [('', False), (pad(*r['meta']), False), ('-' * WIDTH, False)]
    out += [(pad(a, b), False) for a, b in r['items']]
    out += [('-' * WIDTH, False)]
    out += [(pad(a, b), False) for a, b in r['totals']]
    out += [(pad(*r['total']), True), ('', False)]
    out += [(t.center(WIDTH), False) for t in r['foot']]
    return out


def receipt(lang, r):
    rng = random.Random(4417)
    font = ImageFont.truetype(MONO, 30)
    bold = ImageFont.truetype(MONO_BOLD, 30)
    lines = lines_of(r)
    char_w = font.getbbox('M')[2]
    pw, ph = char_w * WIDTH + 120, 52 * len(lines) + 160

    # Thermal paper: warm white, a little uneven.
    paper = Image.new('RGB', (pw, ph), (247, 244, 236))
    d = ImageDraw.Draw(paper)
    for _ in range(4000):
        x, y = rng.randrange(pw), rng.randrange(ph)
        g = rng.randint(228, 246)
        d.point((x, y), fill=(g, g - 2, g - 8))
    y = 80
    for text, strong in lines:
        # Thermal print fades a little from line to line.
        ink = rng.randint(28, 60)
        d.text((60, y), text, font=bold if strong else font, fill=(ink, ink, ink + 6))
        y += 52
    # Torn-off bottom edge.
    edge = [(0, ph)]
    for x in range(0, pw + 1, 14):
        edge.append((x, ph - rng.randint(0, 10)))
    edge.append((pw, ph))
    d.polygon(edge, fill=(236, 236, 232))

    # Scanner bed, receipt laid on it slightly crooked.
    bed = Image.new('RGB', (W, H), (236, 236, 232))
    shadow = Image.new('L', (pw, ph), 0)
    shadow_mask = Image.new('L', (pw, ph), 70).rotate(1.6, expand=True, fillcolor=0)
    rotated = paper.rotate(1.6, expand=True, resample=Image.BICUBIC, fillcolor=(236, 236, 232))
    mask = Image.new('L', (pw, ph), 255).rotate(1.6, expand=True, fillcolor=0)
    ox, oy = (W - rotated.width) // 2 + 30, 170
    bed.paste((200, 200, 196), (ox + 6, oy + 8), shadow_mask.filter(ImageFilter.GaussianBlur(8)))
    bed.paste(rotated, (ox, oy), mask)
    del shadow

    # Sensor noise and a soft focus, as a flatbed scanner gives.
    noise = Image.effect_noise((W, H), 6).convert('RGB')
    bed = Image.blend(bed, noise, 0.04).filter(ImageFilter.GaussianBlur(0.6))
    OUT.mkdir(parents=True, exist_ok=True)
    bed.save(OUT / f'receipt-{lang}.jpg', quality=88, dpi=(150, 150))


for lang, r in RECEIPTS.items():
    receipt(lang, r)
    print('wrote', OUT / f'receipt-{lang}.jpg')
