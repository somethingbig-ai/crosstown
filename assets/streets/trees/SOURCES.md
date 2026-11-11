# trees: sources

| File | Source | Licence |
|---|---|---|
| Bark012_color.jpg, Bark012_normal.jpg (512 px, cut down from 1K) | ambientCG "Bark 012", https://ambientcg.com/a/Bark012 (via ../../../../../../assets-scout/ambientcg/foliage/) | CC0 1.0 |
| Bark014_color.jpg, Bark014_normal.jpg (512 px, cut down from 1K) | ambientCG "Bark 014", https://ambientcg.com/a/Bark014 (same path) | CC0 1.0 |
| Ground048_color.jpg (1K), Ground048_normal.jpg (512 px) | ambientCG "Ground 048" (compost / mulch), https://ambientcg.com/a/Ground048, fetched Nov 9 2026 | CC0 1.0 |
| feet.json (three trunk feet, 650-1,560 triangles each, with the scans' UVs) and foot_island_tree_01_normal.webp, foot_island_tree_02_normal.webp, foot_jacaranda_tree_normal.webp (the trunks' own scanned normal maps, 1K, as packed by assets-scout; the script also writes the colour maps, which the game does not use); rebuilt by lanes/streets/tools/trees_mkfeet.mjs | Poly Haven "Island Tree 01", "Island Tree 02", "Jacaranda Tree" (https://polyhaven.com/a/island_tree_01, /a/island_tree_02, /a/jacaranda_tree), lowest 0.5-0.9 m of each trunk, taken from ../../../../../../assets-scout/polyhaven/trees/*.glb | CC0 1.0 |

Everything else in this part is made in code at load: tree skeletons, twigs and leaves (`game/src/streets/trees_gen.js`, seeded),
the London plane's mottled bark, pit relief, clods, weeds, litter, rim stones, dirt apron and iron guards (`game/src/streets/trees.js`).
