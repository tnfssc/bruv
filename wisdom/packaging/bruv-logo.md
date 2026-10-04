# bruv CLI logo (2026-10-04)

- Asset: [assets/brand/bruv-icon.svg](../../assets/brand/bruv-icon.svg).
- Integration: root README displays the icon at 96 px above the unchanged
  **bruv CLI** heading. Existing product prose stays intact.
- Worktree: /home/tnfssc/.bruv/worktrees/t3code-49177b47-5442693331ce-task_41b7b567
- Branch: bruv/add-bruv-logo-41b7b567. Parent owns review and integration.

## Design and scope

Original geometric lowercase **b** with a terminal **>** cut into its counter.
A thick stem and generous chevron stay legible small. Mint (#66e3c4) and ink
(#102c31) are fixed on a rounded tile, so the same self-contained SVG works on
light and dark backgrounds. No fonts, scripts, linked resources, dependencies,
or theme-specific duplicates. Accessible title/description and README alt text
name the mark. No extra wordmark: the existing heading already names the product.

Read values and the nearby name/rename wisdom. Inspected CLI startup
(src/ui/startup.ts), Pi asset preparation (scripts/prepare-assets.ts), and T3
integration ownership (integrations/t3/README.md). Quiet terminal startup stays
quiet; upstream Pi assets and T3 branding stay unchanged. This is documentation
branding, not a bundled application icon or broad rebrand.

## Checks

- Python XML/HTML checks passed: SVG namespace/viewBox/accessibility IDs,
  self-contained geometry, README relative image path/dimensions/alt text,
  and unchanged heading/body.
- librsvg rendered at 16, 24, 32, 96 and 192 px. Visually inspected an ImageMagick
  contact sheet on white and #111827 backgrounds; the b and prompt remain clear.
- Pandoc GFM rendering preserved the image before the bruv CLI h1.
- git diff --check passed. No runtime code changed; no full build/test run needed.

Local, ignored evidence: artifacts/bruv-logo/{preview.png,check.py,render.sh,
readme.html}. Rerun with python3 artifacts/bruv-logo/check.py,
bash artifacts/bruv-logo/render.sh, and
pandoc --from=gfm --to=html README.md. Renderer scripts use /tmp for scratch output. GitHub-hosted/browser
README rendering was not tested. Initial shell-loop attempts failed under Fish;
the saved Bash render script passed. Mise reports this worktree config untrusted;
system Python/librsvg/ImageMagick/Pandoc and Git checks still ran successfully.

Values unchanged: existing small-scope and rendered-proof guidance covers this
work; no new repeated lesson.

## Parent integration

Parent reviewed the SVG and rendered light/dark size sheet, then cherry-picked
the asset, README, and this note into t3code/add-logo. git diff --check passed
and the tree was clean. Browser preview was attempted but this thread has no
browser preview capability. The short-lived asset server was stopped.
