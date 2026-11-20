# assets/park: sources and licences (park lane)

| file | from | licence | URL |
|---|---|---|---|
| tex/rock.jpg | Poly Haven "Rock Boulder Dry" (rock_boulder_dry, diffuse, 1k JPG as published; the shader takes most of its colour out and tints it to Manhattan schist) | CC0 1.0 | https://polyhaven.com/a/rock_boulder_dry |
| index.json, c_*.json, c_*.h.bin, c_*.trees.bin | made by lanes/park/pipeline from: the 2017 New York City topobathymetric lidar (City of New York / NYS, distributed by NOAA Office for Coastal Management, Digital Coast data set 9306; public); OpenStreetMap (paths, drives, water, rock, bridges, lamps, benches: ODbL 1.0, © OpenStreetMap contributors); the NYC 2015 street tree census (NYC Parks, NYC Open Data; public). The full credit lines are in index.json `credits`. | as named | https://coast.noaa.gov/htdata/lidar2_z/geoid18/data/9306/ https://www.openstreetmap.org/copyright https://data.cityofnewyork.us/Environment/2015-Street-Tree-Census-Tree-Data/uvpi-gqnh |

Everything drawn in the park that is not listed here (bridges, lamps, benches, bins, walls, water, the tree models) is made by code in src/park/ (the trees by
the street layer's generator, src/streets/trees_gen_next.js). The lawn, leaf-litter, dirt and asphalt pictures are the ones the game already has
(assets/streets/grass/SOURCES.md, assets/tex). No reference photograph (lanes/park/refs) is used in any file.

| lamps.json | made by lanes/park/tools/mklamps.py from the files above: the 121 lamps OpenStreetMap maps, plus posts PLACED BY RULE (not surveyed) every 32 m along the ways OpenStreetMap tags as lit, the paved footpaths and the drives, about the real park's count of 1,600 | ODbL 1.0 for the OSM part | https://www.openstreetmap.org/copyright |
