# trees: sources

| File | Source | Licence |
|---|---|---|
| Bark012_color.jpg, Bark012_normal.jpg (512 px, cut down from 1K) | ambientCG "Bark 012", https://ambientcg.com/a/Bark012 (via ../../../../../../assets-scout/ambientcg/foliage/) | CC0 1.0 |
| Bark014_color.jpg, Bark014_normal.jpg (512 px, cut down from 1K) | ambientCG "Bark 014", https://ambientcg.com/a/Bark014 (same path) | CC0 1.0 |
| Ground048_color.jpg (1K), Ground048_normal.jpg (512 px) | ambientCG "Ground 048" (compost / mulch), https://ambientcg.com/a/Ground048, fetched Nov 9 2026 | CC0 1.0 |
| feet.json (three trunk feet, 650-1,560 triangles each, with the scans' UVs) and foot_island_tree_01_normal.webp, foot_island_tree_02_normal.webp, foot_jacaranda_tree_normal.webp (the trunks' own scanned normal maps, 1K, as packed by assets-scout; the script also writes the colour maps, which the game does not use); rebuilt by lanes/streets/tools/trees_mkfeet.mjs | Poly Haven "Island Tree 01", "Island Tree 02", "Jacaranda Tree" (https://polyhaven.com/a/island_tree_01, /a/island_tree_02, /a/jacaranda_tree), lowest 0.5-0.9 m of each trunk, taken from ../../../../../../assets-scout/polyhaven/trees/*.glb | CC0 1.0 |
| ph_woodchips_diff.webp (2K), ph_woodchips_nor.webp, ph_woodchips_disp.webp (1K) | Poly Haven "Wood Chips" (eye-candy.xyz), https://polyhaven.com/a/wood_chips, scanned 2 x 2 m | CC0 1.0 |
| ph_parkdirt_diff.webp, ph_parkdirt_nor.webp (1K) | Poly Haven "Park Dirt" (Christopher Melani), https://polyhaven.com/a/park_dirt, 3 x 3 m | CC0 1.0 |
| ph_barkbrown02_diff.webp, ph_barkbrown02_nor.webp (1K) | Poly Haven "Bark Brown 02" (Rob Tuytel), https://polyhaven.com/a/bark_brown_02, 1 x 1 m | CC0 1.0 |
| ph_barkplatanus_diff.webp, ph_barkplatanus_nor.webp (1K) | Poly Haven "Bark Platanus" (Dimitrios Savva), https://polyhaven.com/a/bark_platanus, 1.5 x 1.5 m | CC0 1.0 |
| spray_ovate_c.webp, spray_ovate_n.webp (2K atlases, 4 x 4 leaf sprays: twig + leaves; colour with cut-out, and per-leaf tilt + shade), built by lanes/streets/tools/trees_mksprays.py | leaves: ambientCG "Leaf Set 024", https://ambientcg.com/a/LeafSet024 (via assets-scout/ambientcg/foliage/) | CC0 1.0 |
| spray_fan_c.webp, spray_fan_n.webp (ginkgo: fan-shaped leaves cut by the script out of the scanned leaf surface of Leaf Set 024; the fan outline itself is drawn in code) | ambientCG "Leaf Set 024" (same) | CC0 1.0 |
| spray_plane_c.webp, spray_plane_n.webp (London plane: maple-like leaves) | ambientCG "Leaf Set 010", https://ambientcg.com/a/LeafSet010 | CC0 1.0 |
| spray_frond_c.webp, spray_frond_n.webp (honey locust / pagoda tree: pinnate fronds) | Poly Haven "Jacaranda Tree" leaf atlas, https://polyhaven.com/a/jacaranda_tree (from assets-scout/polyhaven/trees/jacaranda_tree.glb) | CC0 1.0 |
| boughs_jacaranda.bin, boughs_jacaranda.json (six whole boughs cut from the scan: the limb's own branch mesh, its twig stems and every frond as the scan's own curved mesh thinned to ~14 triangles, scaled 0.7), bough_jacaranda_leaf.webp (2K, the scan's frond atlas with the cut-out in alpha), bough_jacaranda_leaf_n.webp, bough_jacaranda_wood.webp, bough_jacaranda_wood_n.webp (1K); built by lanes/streets/tools/trees_mkboughs.py from the full-resolution model (fetched Nov 10 2026 with assets-scout/scripts/fetch_polyhaven_models.py 2k jacaranda_tree) | Poly Haven "Jacaranda Tree", https://polyhaven.com/a/jacaranda_tree | CC0 1.0 |
| scan_small02.bin (4.2 MB, was 17.6), scan_small02.json: a whole scanned young tree in a compact form (round 16). The scan's 1.94 M leaf triangles are 30,221 copies of 29 small meshes (sprays of leaflets, single leaves, green shoots): the file keeps the 29 meshes at four cuts (three thinned by tools/trees_qem.py for `?crown=twigs`, and the round-13 3 x 4 grid cut, which is the one drawn by default) and one 36-byte record per copy (place, turn, size, tone, shade), twice: the scan as it is (drawn by default: the kept round-13 crown) and the round-16 re-setting of its single leaves on twigs (`?crown=twigs`, off by default). Also: the trunk-and-limb scan mesh whole with the same root flare as round 13 (16-bit positions), every twig, a thinned trunk, the round-13 shadow crown (tools/trees_scan_small02_proxy_r13.npz). Textures: scan_small02_leaf.webp (2K RGBA), scan_small02_leaf_n.webp (1K), scan_small02_wood.webp (4096x2048: trunk atlas, twig atlas), scan_small02_wood_n.webp (2048x1024). Built by lanes/streets/tools/trees_mkscan.py (the round-13 tool is kept as trees_mkscan_v1.py) from the full-resolution model (fetched Nov 10 2026 with assets-scout/scripts/fetch_polyhaven_models.py 2k tree_small_02) | Poly Haven "Tree Small 02", https://polyhaven.com/a/tree_small_02 | CC0 1.0 |
| ph_chippath_diff.webp (2K), ph_chippath_nor.webp, ph_chippath_disp.webp (1K): a coarser mulch scan, colour and height normalised to the Wood Chips scan's; drawn only with `?mulch=path` (round 18: judged worse, off) | Poly Haven "Wood Chip Path", https://polyhaven.com/a/wood_chip_path, 2.1 x 2.1 m, fetched Nov 10 2026 | CC0 1.0 |
| sprays.json (per atlas: mean leaf colour, cell size in metres, filled box of each cell) | written by the same script | ours |
| hero_census.json | NYC Parks 2015 Street Tree Census, NYC Open Data dataset uvpi-gqnh (https://data.cityofnewyork.us/Environment/2015-Street-Tree-Census-Tree-Data/uvpi-gqnh): the 62 living street trees between W 26th / E 22nd St and 6th / Madison Ave: position, species, trunk diameter, guard | NYC Open Data (public, free to use) |

Everything else in this part is made in code at load: tree skeletons, twigs and leaves (`game/src/streets/trees_gen.js`, seeded),
the London plane's mottled bark, pit relief, clods, weeds, litter, rim stones, dirt apron and iron guards (`game/src/streets/trees.js`).

## Round 28 (Nov 11)
- `acg_woodchips003_{color,normal,da}.webp`: ambientCG "WoodChips003" (2K), CC0, https://ambientcg.com/a/WoodChips003 (da = height r/b, ambient occlusion g).
- `ph_barkwillow02_{diff,nor,da}.webp`: Poly Haven "Bark Willow 02" (2K), CC0, https://polyhaven.com/a/bark_willow_02 (da = height r/b, ambient occlusion g).

## Round 30-33 (Nov 12)
- `twignet_small02.{bin,json}` (1.4 MB): the grown twig tier of the scanned young tree: thin twigs grown in code (`lanes/streets/tools/trees_mktwignet.py`)
  from the limbs of the scan already credited above (`scan_small02.*`, CC0) out to each of its leaf places. No new source: derived from the CC0 scan only.
- Tried and OUT, no file of theirs is in this folder or in the game: Wikimedia Commons "2008-08-12 Mulch.jpg" (Specious, CC BY-SA 4.0) and
  "Wood Chip Mulch Texture DTXR-WD-CP-1.jpg" (Shadowmeld Photography, CC BY-SA 4.0), tried as mulch photographs in rounds 30-32 (`?mulch=photo|sun`,
  switch removed). The cut-down trial copies sit outside the game in `lanes/streets/items/trees/out-assets/`.

## The fetched set (Nov 12, download trim)
This folder is what a player downloads: written by `lanes/streets/tools/trees_pack.py` from the master files in `lanes/streets/items/trees/full-assets/`
(the files named above at their first size). Same sources and licences as above; nothing new. What changed: the 2K sets (`acg_woodchips003_*`,
`ph_barkwillow02_*`, `spray_*`, `bough_jacaranda_leaf`) are 1K, `scan_small02_wood` is 2048x1024 and its normal map 1024x512, all webp at quality 76
(colour) / 72 (normal, height); `scan_small02`, `twignet_small02` and `boughs_jacaranda` are packed (`*.pk.bin` + a "pack" list in the json; `trees.js`
unpackBin rebuilds the first layout); `scan_small02_*` and `bough_jacaranda_*` textures are stored turned top to bottom (no flipY = false in the code any
more). Not in this folder because the default trees never fetch them: the three `foot_*_normal.webp` (the lead's copies stay where they are),
`ph_woodchips_*`, `ph_chippath_*`, `ph_barkplatanus_*`, the two source `.glb` scans.
Credit line for the page (the one source that is not CC0): `Street trees: positions and species from the NYC Parks 2015 Street Tree Census, NYC Open Data (https://data.cityofnewyork.us/Environment/2015-Street-Tree-Census-Tree-Data/uvpi-gqnh).`
