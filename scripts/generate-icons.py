"""Generate Budget PWA icons (flat Nordic brand mark) with no dependencies."""

import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

PRIMARY = (0x26, 0x3B, 0xAA)
ACCENT = (0x8F, 0xA8, 0xBE)
WHITE = (0xFF, 0xFF, 0xFF)
SS = 4  # supersampling factor


def write_png(path: Path, width: int, height: int, pixels: bytes) -> None:
    raw = b"".join(
        b"\x00" + pixels[y * width * 4 : (y + 1) * width * 4] for y in range(height)
    )
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def rounded_rect_coverage(x: float, y: float, radius: float) -> float:
    """Signed coverage for a unit square [0,1]^2 with rounded corners."""
    cx = min(max(x, radius), 1 - radius)
    cy = min(max(y, radius), 1 - radius)
    dx = x - cx
    dy = y - cy
    if dx * dx + dy * dy <= radius * radius:
        return 1.0
    return 0.0


def segment_distance(px, py, ax, ay, bx, by) -> float:
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    length_sq = vx * vx + vy * vy
    t = 0.0 if length_sq == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / length_sq))
    projx, projy = ax + t * vx, ay + t * vy
    return ((px - projx) ** 2 + (py - projy) ** 2) ** 0.5


CHECK = [(0.28, 0.52), (0.44, 0.68), (0.73, 0.34)]


def check_coverage(x: float, y: float, scale: float, offset: float, stroke: float) -> float:
    px = (x - offset) / scale
    py = (y - offset) / scale
    best = min(
        segment_distance(px, py, *CHECK[0], *CHECK[1]),
        segment_distance(px, py, *CHECK[1], *CHECK[2]),
    )
    return 1.0 if best <= stroke / 2 else 0.0


def render(size: int, rounded: bool, maskable: bool) -> bytes:
    hi = size * SS
    out = bytearray()
    radius = 0.22
    # Maskable icons keep a 20% safe margin; normal icons use the full square.
    content_scale = 0.62 if maskable else 0.78
    offset = (1 - content_scale) / 2

    for y in range(size):
        for x in range(size):
            r = g = b = a = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    ux = (x + (sx + 0.5) / SS) / size
                    uy = (y + (sy + 0.5) / SS) / size

                    inside = 1.0 if (maskable or not rounded) else rounded_rect_coverage(ux, uy, radius)
                    if inside == 0.0:
                        continue

                    # Soft accent halo behind the checkmark.
                    halo = check_coverage(ux, uy, content_scale, offset, 0.22)
                    check = check_coverage(ux, uy, content_scale, offset, 0.105)

                    base = PRIMARY
                    if halo > 0:
                        base = ACCENT
                    if check > 0:
                        base = WHITE

                    r += base[0] / 255
                    g += base[1] / 255
                    b += base[2] / 255
                    a += inside

            samples = SS * SS
            out += bytes(
                (
                    int(round(255 * r / samples)),
                    int(round(255 * g / samples)),
                    int(round(255 * b / samples)),
                    int(round(255 * a / samples)),
                )
            )

    return bytes(out)


def main() -> None:
    targets = [
        ("icon-192.png", 192, True, False),
        ("icon-512.png", 512, True, False),
        ("maskable-512.png", 512, False, True),
    ]
    for name, size, rounded, maskable in targets:
        pixels = render(size, rounded, maskable)
        write_png(OUT / name, size, size, pixels)
        print(f"wrote {OUT / name}")


if __name__ == "__main__":
    main()
