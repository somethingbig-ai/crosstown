# streets/grass assets: sources and licences

| file | from | licence | URL |
|---|---|---|---|
| lawn_a.webp, lawn_a_n.webp | ambientCG Grass004 (Color, NormalGL), 2K cut to 1024 | CC0 1.0 | https://ambientcg.com/a/Grass004 |
| lawn_b.webp | ambientCG Grass001 (Color), 2K cut to 1024 | CC0 1.0 | https://ambientcg.com/a/Grass001 |
| worn.webp | ambientCG Ground037 (Color) | CC0 1.0 | https://ambientcg.com/a/Ground037 |
| dirt.webp | Poly Haven grass_path_3 (diff), 2k cut to 1024 | CC0 1.0 | https://polyhaven.com/a/grass_path_3 |
| litter.webp | fallen leaves cut from ambientCG LeafSet030, LeafSet027, LeafSet010 (the asset scout's copies in assets-scout/ambientcg/foliage), scattered into a tileable 3 m tile by pipeline/grass/prep_tex.py | CC0 1.0 | https://ambientcg.com/a/LeafSet030 https://ambientcg.com/a/LeafSet027 https://ambientcg.com/a/LeafSet010 |
| sward.webp | blades and tufts cut from the texture atlases of Poly Haven grass_medium_02 and grass_bermuda_01 (diff + alpha, 2k), planted into four side-view strips by pipeline/grass/prep_sward.py; only read with ?gcard=1 | CC0 1.0 | https://polyhaven.com/a/grass_medium_02 https://polyhaven.com/a/grass_bermuda_01 |
| means.json | mean linear colour of each albedo above (pipeline/grass/prep_tex.py) | ours | |
| parks.json | park paths, sand areas and building footprints inside each park of city.json, from the OpenStreetMap extract data/osm2.json (pipeline/grass/layout.py) | OpenStreetMap, ODbL 1.0, © OpenStreetMap contributors | https://www.openstreetmap.org/copyright |

No photograph from `gauntlet/ref/index.json` or from `items/grass/refs/judge/` is used in any file here.
Raw downloads: only the files the pipeline reads are kept in `items/grass/raw/` (the unused 2K sets were deleted Nov 11; all were CC0 and can be fetched again).
