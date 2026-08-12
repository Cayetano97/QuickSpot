#!/usr/bin/env python3
"""Generate QuickSpot icons (pure stdlib: zlib + struct, no PIL).

- app-icon.png : 1024x1024 app icon (dark disc, hub, orbiting accent dots)
- tray.png     : 32x32 tray glyph (accent donut; on macOS the RGB is
                 ignored and only the shape matters for template mode)
Writes into src-tauri/icons/.
"""
import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "src-tauri", "icons")
os.makedirs(OUT, exist_ok=True)

DISC = (23, 23, 23, 255)        # #171717
ACCENT = (229, 229, 229, 255)   # #e5e5e5
HUB_FILL = (38, 38, 38, 255)    # #262626
HUB_RING = (229, 229, 229, 120)


def png(width, height, rgba_rows):
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + bytes(row) for row in rgba_rows)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def make(size, draw, ss=4):
    """Render at ss*size and box-downsample for cheap antialiasing."""
    big = size * ss
    rows_big = draw(big)
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            r = g = b = a = 0
            for sy in range(ss):
                for sx in range(ss):
                    pr = rows_big[y * ss + sy][x * ss + sx]
                    a += pr[3]
                    r += pr[0] * pr[3]
                    g += pr[1] * pr[3]
                    b += pr[2] * pr[3]
            if a == 0:
                row += b"\x00\x00\x00\x00"
            else:
                row += bytes((r // a, g // a, b // a, a // (ss * ss)))
        rows.append(row)
    return png(size, size, rows)


def app_icon(n):
    """Dark disc + hub + 8 orbiting accent dots (12 o'clock start)."""
    rows = []
    for y in range(n):
        row = []
        for x in range(n):
            u = (x + 0.5) / n
            v = (y + 0.5) / n
            d = ((u - 0.5) ** 2 + (v - 0.5) ** 2) ** 0.5

            c = (0, 0, 0, 0)
            if d <= 0.44:
                c = DISC
            if d <= 0.055:
                c = HUB_FILL
            elif d <= 0.07:
                c = HUB_RING
            else:
                for i in range(8):
                    ang = -math.pi / 2 + i * (2 * math.pi / 8)
                    dot_x = 0.5 + 0.24 * math.cos(ang)
                    dot_y = 0.5 + 0.24 * math.sin(ang)
                    if (u - dot_x) ** 2 + (v - dot_y) ** 2 <= 0.022 ** 2:
                        c = ACCENT
                        break
            row.append(c)
        rows.append(row)
    return rows


def tray_icon(n):
    """Accent donut: visible on dark and light taskbars alike."""
    rows = []
    for y in range(n):
        row = []
        for x in range(n):
            u = (x + 0.5) / n
            v = (y + 0.5) / n
            d = ((u - 0.5) ** 2 + (v - 0.5) ** 2) ** 0.5
            row.append(ACCENT if 0.32 <= d <= 0.47 else (0, 0, 0, 0))
        rows.append(row)
    return rows


with open(os.path.join(OUT, "app-icon.png"), "wb") as f:
    f.write(make(1024, app_icon))
with open(os.path.join(OUT, "tray.png"), "wb") as f:
    f.write(make(32, tray_icon))
print("wrote app-icon.png (1024) and tray.png (32) to", OUT)
