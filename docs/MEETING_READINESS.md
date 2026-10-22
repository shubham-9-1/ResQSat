# ResQSat — Meeting Readiness

**Project:** ResQSat — Geospatial disaster response prototype  
**Status date:** 22 October 2026

## Problem and proposed solution

Flood response teams need a fast way to view reported risk areas, response locations, and available geographic context. ResQSat is a student prototype that brings these pieces into one map dashboard for a Bihar flood-use-case demonstration. It is not an operational emergency warning or dispatch system.

## Target users

The prototype is intended for a hackathon demonstration to faculty, judges, and disaster-response planners. It is not validated or deployed for use by real responders.

## Architecture

- **Frontend:** React 19, Vite, React Leaflet, Leaflet, and CSS.
- **Backend:** FastAPI with SQLAlchemy and SQLite.
- **Map sources:** OpenStreetMap street tiles, the existing NASA GIBS MODIS layer, and an optional bounded Copernicus Sentinel-2 L2A preview.
- **Satellite flow:** Backend-only OAuth Client Credentials, Sentinel Hub Catalog search, Process API true-colour image (B04/B03/B02), plus opt-in clear-pixel MNDWI current-scene versus same-season prior-year screening. Access tokens are cached until shortly before expiry.
- **Database:** Existing `backend/resqsat.db`; no migration or database rewrite was added.

## Features already present in the project

- Dashboard cards, incident selection, and API-backed incident list.
- SQLite-backed incident GET and POST endpoints.
- Explicitly illustrative flood polygons and demo metadata.
- Risk and facility markers, map focus control, and street/NASA map selection.
- OSRM standard-road route estimate with mapped-polygon intersection screening. It is not a safe-route result: source polygons may be illustrative or threshold-derived candidates, and road/flood safety has not been independently validated.
- Responsive layout and prototype disclaimers.

## Added in this implementation phase

- `GET /api/satellite/status` reports whether the two backend credential variables are configured without exposing their values.
- `GET /api/satellite/preview` searches the Sentinel-2 L2A catalog for the bounded area/date interval, selects the latest returned acquisition, and requests a 2048×2048 true-colour image. The request declares CRS84 and uses SIMPLE mosaicking for single-scene pixels.
- `GET /api/flood-screening` compares clear Sentinel-2 L2A MNDWI pixels against a nearby same-season scene from the prior year, masks invalid/cloud/shadow classes, and returns georeferenced candidate polygons with scene dates, clear-pixel fraction, and a non-warning disclaimer.
- **Satellite Flood Screen** displays candidate polygons on the map. When available, those polygons are used as route-screening hazards; existing demo polygons remain the fallback layer.
- OSRM requests up to three route alternatives. The frontend selects one that does not intersect mapped hazard polygons, permits an initial exit from a source polygon and final approach to a destination polygon, and draws no route if every alternative intersects. The result remains unverified; OSRM may return fewer alternatives.
- The React map has an opt-in Sentinel-2 Preview choice. Its image overlay is aligned to the fixed Patna bounds; loading, error, and retry states are displayed. Existing street and NASA layers remain available.
- Preview requests are cached in process for one hour. The service rejects areas wider than 0.25 degrees per side and date windows longer than 31 days.
- `backend/.env.example` contains placeholders only. Put real credentials in the ignored `backend/.env` file.

## Verification record

Verification run on 22 October 2026:

- Frontend production build passed. `npm run lint` exited successfully with warnings and no errors. Warnings cover existing date/effect patterns, `App1.jsx`, and the route-effect dependency.
- Backend files passed Python compile checks. Synthetic checks passed for RGBA PNG decoding, generation of a georeferenced polygon from a four-pixel changed-water component, and rejection when clear-pixel overlap is too small. Route geometry checks passed for hazard crossing, source-zone exit, re-entry, and endpoint-zone labeling.
- FastAPI restarted with the modified source; health returned `healthy` and OpenAPI exposed `/api/flood-screening` and `/api/satellite/preview`.
- Live `GET /api/flood-screening` succeeded using Copernicus Sentinel-2 L2A scenes from `2026-10-21T05:11:36.532Z` and `2025-10-21T05:11:36.7Z`. It reported 0.6899 clear-pixel overlap, 2,915 candidate pixels, and 851 generated candidate polygons. These are algorithm outputs, not confirmed flood areas.
- Live `GET /api/satellite/preview` returned `200 image/png` at 2048×2048 with the same sensing time. Pixel inspection found 69.08% opaque pixels and 172,875 distinct RGB values, confirming the returned image is not transparent/blank.
- Browser visual check on `http://localhost:5174/` showed the Satellite Flood Screen control, blue candidate polygons, both scene dates, and the route disclaimer in the running app. This confirms rendering, not geospatial accuracy.
- Existing incident and flood API results remain present. Verification used GET requests only; no incident was created or updated. Do not infer that demo polygons were derived from the returned satellite image.
- `git diff --check` reported no whitespace errors. Git printed only its existing LF-to-CRLF normalization notices for `App.jsx` and `App.css`.

The Sentinel-2 image and candidate-water screening are live-verified, but the prototype is not an operational flood analysis system:

- Satellite true-colour imagery and MNDWI candidate-water screening are live. The threshold and prior-year comparison are heuristic; seasonal or land-cover differences can create false positives or missed water. They do not validate flood boundaries.
- Existing sample flood polygons, exposure values, incident coordinates, and facility locations are illustrative, not satellite-derived or independently verified.
- The route filter checks OSRM geometry against available polygons only. It does not know road surface conditions, bridges, water depth, closures, or response constraints; it cannot certify safety.
- No population dataset analysis, shelter validation, trapped-person count, or building damage estimate is implemented.
- The browser display rendered candidate overlays. Their geographic accuracy still requires comparison with independent reference data.

## Copernicus integration and attribution

The implementation follows Copernicus Data Space documentation for OAuth Client Credentials, the Sentinel-2 L2A collection identifier, the Catalog search endpoint, the Process API, and evalscript true-colour output. A successful preview must be verified from the returned image and `X-Sensing-Date`; the date shown in a browser screenshot is not treated as proof of the live response.

Sentinel Hub use is subject to account request and processing quotas. The preview is capped at 2048×2048 (below the documented 2500-pixel Process API dimension limit) and successful responses are cached for one hour. Larger outputs use more processing than 512×512 previews. The displayed attribution is “Contains modified Copernicus Sentinel data [year] processed by Sentinel Hub.” Confirm the applicable current account terms and usage quota before a public or repeated demo.

## Demo script (about two minutes)

1. Open the dashboard and explain that the listed flood zones and population figures are illustrative demo records.
2. Switch between Street Map and NASA Satellite to show the existing geographic context.
3. Select Sentinel-2 Preview to show the live Patna scene and returned sensing date.
4. Select Satellite Flood Screen to show candidate new-water signatures and both sensing dates. State that this is heuristic screening, not a confirmed flood boundary or warning.
5. Select a risk zone and show the route estimate. Explain that its geometry is checked against available polygons but this cannot establish flood-safe roads.
6. Show facility markers and note that the sample locations are not verified shelters. The prototype is not an operational response system.

## Likely judge questions

1. **Is this a live flood warning system?** No. Incidents and flood polygons are bundled demo data; this prototype does not issue verified warnings.
2. **Is the Copernicus image real?** The latest live request returned a nonblank Sentinel-2 L2A image and a Catalog-derived sensing time.
3. **Does the route avoid flooded roads?** It screens OSRM alternatives against mapped polygons. It cannot verify flooded roads or certify route safety.
4. **How were affected population numbers calculated?** They are synthetic demo estimates, not outputs from a documented population dataset.
5. **What would be needed for real response use?** Validated satellite/time-series analysis, trusted population and facility datasets, hazard-aware routing, field verification, security review, reliability monitoring, and responder testing.

## Next milestones

1. Visually confirm Sentinel-2 and water-screen overlays in the browser; add repeatable tests for provider failures, no-data responses, and caching.
2. Calibrate and validate water-change screening against independent flood reference data; assess cloud, seasonal, and land-cover error.
3. Integrate documented population and verified facility data with source/date metadata.
4. Add route-network hazard data, closures, and independent validation before making any safety claim.
5. Prepare a repeatable non-production demo environment with secret rotation, quota monitoring, and startup checks.

## Start and verify

Backend (PowerShell):

```powershell
cd "D:\work space\ResQSat\backend"
if (!(Test-Path .env)) { Copy-Item .env.example .env }
# Edit backend/.env locally; do not paste or commit the secret.
.\.venv\Scripts\Activate.ps1
python -m uvicorn main:app --reload --port 8000
```

Frontend (second terminal):

```powershell
cd "D:\work space\ResQSat\frontend"
npm run dev
```

Check `http://127.0.0.1:8000/api/satellite/status`. Select **Sentinel-2 Preview** for the image or **Satellite Flood Screen** for heuristic water-change candidates. If provider requests fail, the UI shows a retryable error. Do not describe candidate polygons or the polygon-filtered route as a verified warning or safe route.

## References

- [Copernicus Sentinel Hub authentication](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Overview/Authentication.html)
- [Sentinel-2 L2A collection and Catalog access](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/S2L2A.html)
- [Sentinel-2 L2A Process API example](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Process/Examples/S2L2A.html)
- [Evalscript true-colour examples](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Evalscript/Examples.html)
- [Copernicus Data Space quotas](https://documentation.dataspace.copernicus.eu/Quotas.html)
