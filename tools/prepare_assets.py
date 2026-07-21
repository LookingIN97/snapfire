#!/usr/bin/env python3
"""One-shot pipeline: chroma-key the AI-generated magenta sheets, split them
into individual sprites via connected components clustered along x, crop,
downscale, and write the final game assets into assets/.

Raw inputs are the images generated during development (not committed):
  ~/.cursor/projects/home-lookingin-snapfire/assets/*.png
"""
import os
import numpy as np
from PIL import Image

RAW = os.path.expanduser("~/.cursor/projects/home-lookingin-snapfire/assets")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")

# sheet -> (list of output sprite names left-to-right, target height px)
SHEETS = {
    "cn_tower.png": (["tower"], 1000),
    "landmarks1.png": (["rogers", "cityhall", "ocad", "rom"], 420),
    "landmarks2.png": (["flatiron", "sign", "condo", "brick"], 420),
    # the third sprite (iron ball) is superseded by tools/make_balls.py output
    "actors.png": (["snapfire", "cannon", "ball"], None),  # per-sprite heights below
    "heroes_f1.png": (["cm", "lina", "wr", "mirana"], 200),
    "heroes_f2.png": (["luna", "drow", "qop", "pa"], 200),
    "heroes_f3.png": (["ta", "venge", "lc", "marci"], 200),
    "heroes_f4.png": (["dawn", "muerta", "willow", "ww"], 200),
    "heroes_m1.png": (["axe", "pudge", "invoker", "am"], 200),
    "heroes_m2.png": (["jugg", "kunkka", "zeus", "brew"], 200),
}
ACTOR_HEIGHTS = {"snapfire": 240, "cannon": 200, "ball": 64}
DOWN = 4  # component labeling runs on a block-max downscaled mask


def key_mask(rgb):
    """True where pixel is background magenta (tolerates hue drift)."""
    r = rgb[:, :, 0].astype(np.int32)
    g = rgb[:, :, 1].astype(np.int32)
    b = rgb[:, :, 2].astype(np.int32)
    return (r > 150) & (b > 150) & (g < 130) & (np.abs(r - b) < 90) & ((r - g) > 60) & ((b - g) > 60)


def block_max(mask, k):
    h, w = mask.shape
    hh, ww = h // k, w // k
    return mask[: hh * k, : ww * k].reshape(hh, k, ww, k).any(axis=(1, 3))


def label_components(mask):
    """8-connectivity labeling via BFS on a small boolean array."""
    labels = np.zeros(mask.shape, dtype=np.int32)
    comps = []
    h, w = mask.shape
    nxt = 0
    for sy in range(h):
        for sx in range(w):
            if mask[sy, sx] and labels[sy, sx] == 0:
                nxt += 1
                stack = [(sy, sx)]
                labels[sy, sx] = nxt
                cells = []
                while stack:
                    y, x = stack.pop()
                    cells.append((y, x))
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            ny, nx_ = y + dy, x + dx
                            if 0 <= ny < h and 0 <= nx_ < w and mask[ny, nx_] and labels[ny, nx_] == 0:
                                labels[ny, nx_] = nxt
                                stack.append((ny, nx_))
                cells = np.array(cells)
                comps.append({
                    "id": nxt,
                    "area": len(cells),
                    "cx": float(cells[:, 1].mean()),
                    "y0": int(cells[:, 0].min()), "y1": int(cells[:, 0].max()) + 1,
                    "x0": int(cells[:, 1].min()), "x1": int(cells[:, 1].max()) + 1,
                })
    return labels, comps


def cluster_1d(comps, n):
    """Weighted 1D k-means on component x-centroids -> list of id-sets."""
    comps = [c for c in comps if c["area"] >= 8]
    xs = np.array([c["cx"] for c in comps])
    ws = np.array([float(c["area"]) for c in comps])
    lo, hi = xs.min(), xs.max()
    centers = lo + (hi - lo) * (np.arange(n) + 0.5) / n
    assign = None
    for _ in range(50):
        d = np.abs(xs[:, None] - centers[None, :])
        new_assign = d.argmin(axis=1)
        if assign is not None and (new_assign == assign).all():
            break
        assign = new_assign
        for k in range(n):
            sel = assign == k
            if sel.any():
                centers[k] = (xs[sel] * ws[sel]).sum() / ws[sel].sum()
    order = np.argsort(centers)
    groups = []
    for k in order:
        groups.append({c["id"] for c, a in zip(comps, assign) if a == k})
    return groups


def resize_rgba(img_np, target_h):
    h, w = img_np.shape[:2]
    if target_h is None or h <= target_h:
        return img_np
    tw = max(1, round(w * target_h / h))
    rgb = img_np[:, :, :3].copy()
    a = img_np[:, :, 3]
    rgb[a == 0] = 0  # avoid magenta halos bleeding into the resample
    rgb_im = Image.fromarray(rgb).resize((tw, target_h), Image.LANCZOS)
    a_im = Image.fromarray(a).resize((tw, target_h), Image.LANCZOS)
    return np.dstack([np.asarray(rgb_im), np.asarray(a_im)])


def main():
    os.makedirs(OUT, exist_ok=True)

    sky = Image.open(os.path.join(RAW, "sky.png")).convert("RGB")
    if sky.width > 1280:
        sky = sky.resize((1280, round(sky.height * 1280 / sky.width)), Image.LANCZOS)
    sky.save(os.path.join(OUT, "sky.png"), optimize=True)
    print("sky.png", sky.size)

    for sheet, (names, target_h) in SHEETS.items():
        rgb = np.asarray(Image.open(os.path.join(RAW, sheet)).convert("RGB"))
        fg = ~key_mask(rgb)
        small = block_max(fg, DOWN)
        labels, comps = label_components(small)
        groups = cluster_1d(comps, len(names))
        for name, ids in zip(names, groups):
            gmask_small = np.isin(labels, list(ids))
            gmask = np.kron(gmask_small, np.ones((DOWN, DOWN), dtype=bool))
            gh, gw = gmask.shape
            full = np.zeros(fg.shape, dtype=bool)
            full[:gh, :gw] = gmask
            full &= fg
            ys, xs = np.where(full)
            y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
            crop_rgb = rgb[y0:y1, x0:x1]
            alpha = np.where(full[y0:y1, x0:x1], 255, 0).astype(np.uint8)
            rgba = np.dstack([crop_rgb, alpha])
            th = ACTOR_HEIGHTS.get(name, target_h)
            rgba = resize_rgba(rgba, th)
            out_im = Image.fromarray(rgba)
            out_im.save(os.path.join(OUT, name + ".png"), optimize=True)
            print(f"{name}.png {out_im.size}")


if __name__ == "__main__":
    main()
