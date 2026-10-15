# grid-area-frankfurt.json

© OpenStreetMap contributors. Data available under the Open Database Licence (ODbL) 1.0,
https://opendatacommons.org/licenses/odbl/1-0/ — this derived file stays under ODbL.

What it is: an **approximation** of the NRM Netzdienste Rhein-Main electricity grid area, drawn from the sentence in the
Mainova price sheet (BSV, 01.05.2024): "Frankfurt am Main ohne die Stadtteile Höchst, Nied, Sindlingen, Sossenheim,
Unterliederbach und Zeilsheim"
(https://mainova.de/resource/blob/137504/ae75493a6122c1c4ceedb1a9b5b481fc/preisblatt-bsv-01-05-2024-data.pdf).
It is **not** an official balancing-area (Bilanzierungsgebiet) boundary.

- Feature `nrm`: OSM relation 62400 (Frankfurt am Main) minus the union of the six districts below.
- Feature `syna`: union of OSM relations Höchst 4209939, Nied 4209941, Sindlingen 3870359, Sossenheim 4209943,
  Unterliederbach 4209944, Zeilsheim 3870360 (admin_level 10 inside relation 62400, checked via Overpass).
  Syna GmbH operates these districts; for Nied and Sossenheim a transfer to NRM is agreed, date not confirmed
  (Mainova/Süwag press release 14.02.2025,
  https://mainova.de/resource/blob/147230/c2bb9581986a66d2383323a980339cd7/20250214-pm-mainova-suewag-kooperation-data.pdf).

How it was made (2026-10-15, once): relation geometries from polygons.openstreetmap.fr (raw, params=0), union and
difference with @turf/turf 7.2.0 in a throwaway script outside the repo, simplified (tolerance 0.0008° NRM,
0.0006° Syna, ~60–90 m), coordinates rounded to 5 decimals: 161 + 68 points. Area check: 217.7 + 29.8 km²
= 247.5 km² (city relation).
