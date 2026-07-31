#!/usr/bin/env python3
"""
Motion-Renderer: Zeitmessung + Qualitaetstore an einem echten Flyer.

    python3 scripts/motion_bench.py <flyer.png> [--short-edge 720] [--presets atem,licht]

Gibt pro Format die Renderzeit, die Nahtmessung und den Schaerfeverlust aus.
Dieselbe Messung laeuft spaeter auf der Render-Instanz — die lokale Zahl ist die
Referenz, gegen die der Cloud-Wert gehalten wird.
"""

from __future__ import annotations

import argparse
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import motion_render as m  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("flyer", type=Path)
    parser.add_argument("--short-edge", type=int, default=m.DEFAULT_SHORT_EDGE)
    parser.add_argument("--presets", default=",".join(m.DEFAULT_PRESETS))
    parser.add_argument("--formats", default=",".join(m.ALL_FORMATS))
    parser.add_argument("--duration", type=float, default=m.DEFAULT_DURATION)
    parser.add_argument("--keep", type=Path, default=None,
                        help="Zielordner, in den die fertigen MP4s kopiert werden")
    args = parser.parse_args()

    src = m.probe_source(args.flyer)
    print(f"Quelle      {args.flyer.name}  {src.width}×{src.height}  (Seitenverhältnis {src.aspect:.3f})")
    print(f"16:9-Verlust {m.banner_crop_loss(src) * 100:.0f} % der Bildhöhe\n")

    req = m.RenderRequest(
        presets=tuple(p.strip() for p in args.presets.split(",") if p.strip()),
        formats=tuple(f.strip() for f in args.formats.split(",") if f.strip()),
        duration=args.duration,
        short_edge=args.short_edge,
    )

    with tempfile.TemporaryDirectory(prefix="motion-bench-") as raw_tmp:
        tmp = Path(raw_tmp)
        started = time.monotonic()
        clips = m.render_all(args.flyer, tmp, req, measure=True)
        total = time.monotonic() - started

        print(f"{'Format':8s} {'Größe':11s} {'Zeit':>7s} {'Datei':>9s} "
              f"{'Naht':>8s} {'Referenz':>9s} {'Schnellst':>10s} {'Verh.':>7s} {'Schärfe':>8s}")
        print("─" * 88)
        failures: list[str] = []
        for c in clips:
            ratio = c.seam["ratio"]
            retained = c.sharpness["retained"]
            print(
                f"{c.fmt:8s} {c.width}×{c.height:<6d} {c.seconds_spent:6.1f}s "
                f"{c.path.stat().st_size / 1024:8.0f}K "
                f"{c.seam['seam']:8.5f} {c.seam['reference']:9.5f} "
                f"{c.seam['fastest_step']:10.5f} "
                f"{ratio:6.2f}x {retained * 100:7.1f}%"
            )
            if ratio > m.SEAM_RATIO_LIMIT:
                failures.append(f"{c.fmt}: Naht {ratio:.2f}× schlechter als die Bildmitte")
            if retained < 0.75:
                failures.append(f"{c.fmt}: Schärfe auf {retained * 100:.0f} % gefallen")

            if args.keep:
                args.keep.mkdir(parents=True, exist_ok=True)
                dest = args.keep / c.path.name
                dest.write_bytes(c.path.read_bytes())

        print("─" * 88)
        print(f"Gesamt {total:.1f}s für {len(clips)} Format(e) bei {args.short_edge}p")

        if args.keep:
            print(f"Videos abgelegt in {args.keep}")

        if failures:
            print("\nFEHLGESCHLAGEN:")
            for f in failures:
                print(f"  ✗ {f}")
            return 1

        print("\nAlle Qualitätstore grün.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
