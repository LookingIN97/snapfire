#!/usr/bin/env python3
"""Procedurally draw the lava / milk cannonball sprites (16x16 logical pixels
scaled to 64x64) since they are simple enough to not need AI generation."""
import os
import math
from PIL import Image

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")
N = 16          # logical grid
SCALE = 4       # output 64x64
CX = CY = (N - 1) / 2
R = 7.2

LAVA = {
    "bands": [(90, 30, 16), (147, 41, 15), (212, 83, 27), (240, 127, 31), (255, 182, 62)],
    "hi": (255, 233, 160),
    "outline": (41, 14, 8),
    "crack": (58, 18, 10),
}
MILK = {
    "bands": [(179, 166, 143), (207, 195, 172), (232, 221, 200), (246, 239, 224), (252, 248, 238)],
    "hi": (255, 253, 245),
    "outline": (110, 99, 83),
    "crack": None,  # milk is smooth
}

# hand-placed crust cracks (logical coords), only used for lava
CRACKS = [
    (4, 8), (5, 9), (6, 9), (7, 10), (8, 10), (9, 11),
    (10, 5), (11, 6), (11, 7),
    (6, 4), (7, 4), (5, 12), (9, 3),
]
EMBERS = [(6, 6), (10, 9), (8, 12)]


def draw(pal, embers):
    im = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    px = im.load()
    for y in range(N):
        for x in range(N):
            d = math.hypot(x - CX, y - CY)
            if d > R:
                continue
            # light from upper-left
            lx, ly = (x - CX) / R, (y - CY) / R
            shade = 0.5 - 0.42 * (lx + ly) / 1.414 - 0.25 * d / R
            band = max(0, min(len(pal["bands"]) - 1, int(shade * len(pal["bands"]) + 0.5)))
            c = pal["bands"][band]
            if d > R - 1.0:
                c = pal["outline"]
            elif pal["crack"] and (x, y) in CRACKS:
                c = pal["crack"]
            elif embers and (x, y) in EMBERS:
                c = pal["hi"]
            elif shade > 0.92 and d < R - 1.5:
                c = pal["hi"]
            px[x, y] = (c[0], c[1], c[2], 255)
    return im.resize((N * SCALE, N * SCALE), Image.NEAREST)


draw(LAVA, True).save(os.path.join(OUT, "ball_lava.png"), optimize=True)
draw(MILK, False).save(os.path.join(OUT, "ball_milk.png"), optimize=True)
print("ball_lava.png / ball_milk.png written")
