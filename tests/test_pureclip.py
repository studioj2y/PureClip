import json
import re
import unittest
import zipfile
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
DIST = ROOT / "dist"


class PureClipBuildAndComplianceTests(unittest.TestCase):
    def test_icons_exist_with_exact_dimensions(self):
        for size in (16, 48, 128):
            icon_path = SRC / "icons" / f"icon-{size}.png"
            self.assertTrue(icon_path.exists(), f"Missing icon: {icon_path}")
            with Image.open(icon_path) as img:
                self.assertEqual(img.size, (size, size), f"Icon size mismatch for {icon_path}")

    def test_chromium_and_firefox_manifests_valid(self):
        cr_dir = DIST / "chromium"
        fx_dir = DIST / "firefox"
        self.assertTrue((cr_dir / "manifest.json").exists(), "Run build.py first")
        self.assertTrue((fx_dir / "manifest.json").exists(), "Run build.py first")

        cr = json.loads((cr_dir / "manifest.json").read_text(encoding="utf-8"))
        fx = json.loads((fx_dir / "manifest.json").read_text(encoding="utf-8"))

        self.assertEqual(cr["manifest_version"], 3)
        self.assertIn("service_worker", cr["background"])
        self.assertNotIn("browser_specific_settings", cr)

        self.assertEqual(fx["manifest_version"], 3)
        self.assertIn("scripts", fx["background"])
        self.assertIn("gecko", fx["browser_specific_settings"])
        self.assertNotIn("service_worker", fx["background"])

        for base_dir, mf in ((cr_dir, cr), (fx_dir, fx)):
            for rel_icon in mf["icons"].values():
                self.assertTrue((base_dir / rel_icon).exists(), f"Missing icon {rel_icon} in {base_dir}")
            sw_list = (
                [mf["background"]["service_worker"]]
                if "service_worker" in mf["background"]
                else mf["background"]["scripts"]
            )
            for sw_file in sw_list:
                self.assertTrue((base_dir / sw_file).exists(), f"Missing background {sw_file}")

    def test_zip_packages_use_posix_paths_and_exclude_store_docs(self):
        for zip_name in ("pureclip-chromium.zip", "pureclip-firefox.zip"):
            zp = DIST / zip_name
            self.assertTrue(zp.exists(), f"Missing package {zp}")
            with zipfile.ZipFile(zp, "r") as zf:
                names = zf.namelist()
                self.assertIn("manifest.json", names)
                for name in names:
                    self.assertNotIn("\\", name, f"Backslash path in {zip_name}: {name}")
                    self.assertFalse(name.endswith("CHROMEWEBSTORE.md"))
                    self.assertFalse(name.startswith(".git"))

    def test_mv3_csp_and_static_safety(self):
        for html_file in SRC.rglob("*.html"):
            text = html_file.read_text(encoding="utf-8")
            # No inline <script> bodies
            for m in re.finditer(r"<script\b([^>]*)>(.*?)</script>", text, re.I | re.S):
                attrs, body = m.group(1), m.group(2).strip()
                self.assertIn("src=", attrs, f"Inline script without src in {html_file}")
                self.assertEqual(body, "", f"Non-empty inline script body in {html_file}")
            # No inline event attributes like onclick=
            self.assertIsNone(
                re.search(r"\bon(?:click|load|change|input|submit|keydown)\s*=", text, re.I),
                f"Inline event handler in {html_file}",
            )
            # Verify local script & css references exist
            for ref in re.findall(r'(?:src|href)="([^"]+)"', text):
                if ref.startswith(("http://", "https://", "#")):
                    continue
                target = (html_file.parent / ref).resolve()
                self.assertTrue(target.exists(), f"Broken HTML reference {ref} in {html_file}")

        for js_file in SRC.rglob("*.js"):
            text = js_file.read_text(encoding="utf-8")
            self.assertNotIn("eval(", text, f"Forbidden eval() in {js_file}")
            self.assertNotIn("new Function(", text, f"Forbidden new Function() in {js_file}")
            self.assertNotIn("windows.query", text, f"Invalid windows.query in {js_file}")
            self.assertNotIn("openPanelOnActionIconClick", text, f"Typo in {js_file}")
            self.assertNotIn("fromCharCode(...", text, f"Unsafe spread Base64 in {js_file}")

    def test_content_scripts_are_classic_idempotent_scripts(self):
        for cs_file in (SRC / "content").glob("*.js"):
            text = cs_file.read_text(encoding="utf-8")
            self.assertIsNone(
                re.search(r"^\s*(?:import|export)\b", text, re.M),
                f"Content script {cs_file.name} must not use ES module import/export",
            )
            self.assertIn("__PureClip", text, f"Missing idempotency guard in {cs_file.name}")

    def test_noise_regex_does_not_drop_legitimate_article_classes(self):
        extractor_text = (SRC / "content" / "extractor.js").read_text(encoding="utf-8")
        m = re.search(r"NOISE_TOKEN_RE\s*=\s*/([^/]+)/i", extractor_text)
        self.assertIsNotNone(m, "NOISE_TOKEN_RE not found in extractor.js")
        pattern = re.compile(m.group(1), re.I)

        must_keep = [
            "article-header",
            "read-more-content",
            "markdown-body",
            "thread-content",
            "lead-paragraph",
            "thead",
            "download-guide",
            "padding-box",
            "rich_media_content",
        ]
        for token in must_keep:
            self.assertIsNone(pattern.search(token), f"False positive noise match on '{token}'")

        must_drop = [
            "ad-banner",
            "google_ads",
            "sponsor-box",
            "comment-list",
            "related-posts",
            "sidebar",
            "social-share",
        ]
        for token in must_drop:
            self.assertIsNotNone(pattern.search(token), f"Missed noise match on '{token}'")


if __name__ == "__main__":
    unittest.main()
