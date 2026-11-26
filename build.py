"""
Zero-dependency build & packaging script for PureClip · 素笺.
Generates crisp PNG icons via Pillow and builds warning-free MV3 outputs for:
  - dist/chromium/  + dist/pureclip-chromium.zip
  - dist/firefox/   + dist/pureclip-firefox.zip
"""

from __future__ import annotations

import json
import shutil
import zipfile
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
DIST = ROOT / "dist"
ICONS_DIR = SRC / "icons"

COMMON_MANIFEST = {
    "manifest_version": 3,
    "name": "PureClip · 素笺",
    "version": "1.0.0",
    "homepage_url": "https://github.com/studioj2y/PureClip",
    "description": "纯净网页剪藏与高可读性排版归档工具：实时提取、剔除广告与冗余代码、三色高亮批注、本地分类保存（HTML / Markdown / 矢量 PDF）。",
    "icons": {
        "16": "icons/icon-16.png",
        "48": "icons/icon-48.png",
        "128": "icons/icon-128.png",
    },
    "action": {
        "default_title": "PureClip · 素笺 — 剪藏并排版当前网页",
        "default_icon": {
            "16": "icons/icon-16.png",
            "48": "icons/icon-48.png",
            "128": "icons/icon-128.png",
        },
    },
    "permissions": [
        "activeTab",
        "tabs",
        "scripting",
        "storage",
        "downloads",
        "contextMenus",
    ],
    "host_permissions": ["<all_urls>"],
    "web_accessible_resources": [
        {
            "resources": ["ui/*", "shared/*", "icons/*"],
            "matches": ["<all_urls>"],
        }
    ],
}


def generate_icons() -> None:
    """Generates anti-aliased 16x16, 48x48, and 128x128 PNG icons using 4x supersampling."""
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    for size in (16, 48, 128):
        scale = 4
        s = size * scale
        img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)

        pad = max(2, s // 16)
        radius = s // 4
        # Deep teal-emerald rounded base
        draw.rounded_rectangle(
            [pad, pad, s - pad - 1, s - pad - 1],
            radius=radius,
            fill=(15, 118, 110, 255),
        )

        # Warm ivory stationery sheet
        left = int(s * 0.25)
        top = int(s * 0.19)
        right = int(s * 0.75)
        bottom = int(s * 0.81)
        fold = int(s * 0.16)
        sheet_poly = [
            (left, top),
            (right - fold, top),
            (right, top + fold),
            (right, bottom),
            (left, bottom),
        ]
        draw.polygon(sheet_poly, fill=(250, 247, 239, 255))

        # Folded corner accent
        fold_poly = [
            (right - fold, top),
            (right, top + fold),
            (right - fold, top + fold),
        ]
        draw.polygon(fold_poly, fill=(204, 251, 241, 255))

        # Amber highlighter stripe & text rule lines
        line_h = max(3, int(s * 0.065))
        draw.rounded_rectangle(
            [int(s * 0.33), int(s * 0.42), int(s * 0.65), int(s * 0.42) + line_h],
            radius=max(1, line_h // 2),
            fill=(245, 158, 11, 255),
        )
        draw.rounded_rectangle(
            [int(s * 0.33), int(s * 0.56), int(s * 0.67), int(s * 0.56) + line_h],
            radius=max(1, line_h // 2),
            fill=(41, 37, 36, 220),
        )
        draw.rounded_rectangle(
            [int(s * 0.33), int(s * 0.69), int(s * 0.56), int(s * 0.69) + line_h],
            radius=max(1, line_h // 2),
            fill=(41, 37, 36, 175),
        )

        out = img.resize((size, size), Image.Resampling.LANCZOS)
        out.save(ICONS_DIR / f"icon-{size}.png", format="PNG")


def copy_src_to(target_dir: Path) -> None:
    if target_dir.exists():
        shutil.rmtree(target_dir)
    shutil.copytree(SRC, target_dir)


def zip_directory(folder: Path, zip_path: Path) -> None:
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for file_path in sorted(folder.rglob("*")):
            if file_path.is_file():
                arcname = file_path.relative_to(folder).as_posix()
                zf.write(file_path, arcname=arcname)


def build_all() -> None:
    generate_icons()
    DIST.mkdir(parents=True, exist_ok=True)

    # 1. Chromium MV3
    chromium_dir = DIST / "chromium"
    copy_src_to(chromium_dir)
    chromium_manifest = {
        **COMMON_MANIFEST,
        "background": {
            "service_worker": "background/service-worker.js",
            "type": "module",
        },
    }
    (chromium_dir / "manifest.json").write_text(
        json.dumps(chromium_manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    zip_directory(chromium_dir, DIST / "pureclip-chromium.zip")

    # 2. Firefox MV3
    firefox_dir = DIST / "firefox"
    copy_src_to(firefox_dir)
    firefox_manifest = {
        **COMMON_MANIFEST,
        "background": {
            "scripts": ["background/service-worker.js"],
            "type": "module",
        },
        "browser_specific_settings": {
            "gecko": {
                "id": "pureclip@sujian.org",
                "strict_min_version": "115.0",
            }
        },
    }
    (firefox_dir / "manifest.json").write_text(
        json.dumps(firefox_manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    zip_directory(firefox_dir, DIST / "pureclip-firefox.zip")

    print("Built PureClip · 素笺 for Chromium and Firefox:")
    print(f"  - {chromium_dir}")
    print(f"  - {firefox_dir}")
    print(f"  - {DIST / 'pureclip-chromium.zip'}")
    print(f"  - {DIST / 'pureclip-firefox.zip'}")


if __name__ == "__main__":
    build_all()
