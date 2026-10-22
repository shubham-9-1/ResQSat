"""Small, bounded Sentinel-2 L2A preview client for Copernicus Data Space."""

from __future__ import annotations

import json
import math
import os
import threading
import zlib
from collections import deque
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


BASE_DIR = Path(__file__).resolve().parent
TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
CATALOG_URL = "https://sh.dataspace.copernicus.eu/catalog/v1/search"
PROCESS_URL = "https://sh.dataspace.copernicus.eu/process/v1"
COLLECTION = "sentinel-2-l2a"
PATNA_BBOX = (85.08, 25.54, 85.28, 25.74)
MAX_BBOX_SPAN = 0.25
# Keep each dimension below the documented 2500 px Process API limit while
# retaining Sentinel-2's 10 m visible-band detail across the Patna demo AOI.
MAX_IMAGE_SIDE = 2048
SCREENING_SIZE = 512
MNDWI_THRESHOLD = 0.2
REQUEST_TIMEOUT_SECONDS = 90
TOKEN_REFRESH_MARGIN_SECONDS = 60

_token: str | None = None
_token_expires_at = 0.0
_token_lock = threading.Lock()
_preview_cache: dict[tuple[Any, ...], tuple[float, bytes, str]] = {}
_preview_lock = threading.Lock()
_screening_cache: dict[tuple[Any, ...], tuple[float, dict[str, Any]]] = {}
_screening_lock = threading.Lock()


class SatelliteServiceError(Exception):
    """An expected, safe-to-report integration error."""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def _load_local_env() -> None:
    """Load only the two supported keys from backend/.env without logging them."""
    env_path = BASE_DIR / ".env"
    if not env_path.is_file():
        return
    try:
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("\"'")
            if key in {"COPERNICUS_CLIENT_ID", "COPERNICUS_CLIENT_SECRET"}:
                os.environ.setdefault(key, value)
    except OSError:
        # Status will report unconfigured if variables are not in the process.
        return


def configuration_status() -> dict[str, Any]:
    _load_local_env()
    missing = [
        key
        for key in ("COPERNICUS_CLIENT_ID", "COPERNICUS_CLIENT_SECRET")
        if not os.environ.get(key)
    ]
    return {
        "configured": not missing,
        "missing_variables": missing,
        "collection": COLLECTION,
        "provider": "Copernicus Data Space Sentinel Hub",
        "service_status": "not_checked",
        "notice": (
            "Credentials are stored only in backend/.env or backend process environment. "
            "Service availability is checked when a preview is requested."
        ),
    }


def _request_json(url: str, payload: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    request = Request(url, data=body, headers=headers, method="POST")
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            return json.loads(response.read())
    except HTTPError as error:
        if error.code == 401:
            raise SatelliteServiceError("Copernicus authentication failed. Check the configured OAuth client.", 502) from None
        if error.code == 429:
            raise SatelliteServiceError("Copernicus rate limit reached. Please retry later.", 503) from None
        if error.code in (400, 422):
            raise SatelliteServiceError("Copernicus rejected the bounded preview request.", 422) from None
        raise SatelliteServiceError("Copernicus request failed. The demo dashboard remains available.", 502) from None
    except (TimeoutError, URLError, OSError, json.JSONDecodeError):
        raise SatelliteServiceError("Copernicus is unavailable or timed out. The demo dashboard remains available.", 503) from None


def _get_access_token() -> str:
    global _token, _token_expires_at
    _load_local_env()
    client_id = os.environ.get("COPERNICUS_CLIENT_ID")
    client_secret = os.environ.get("COPERNICUS_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise SatelliteServiceError(
            "Copernicus credentials are not configured. Add COPERNICUS_CLIENT_ID and COPERNICUS_CLIENT_SECRET to backend/.env.",
            503,
        )

    with _token_lock:
        now = datetime.now(timezone.utc).timestamp()
        if _token and now < _token_expires_at - TOKEN_REFRESH_MARGIN_SECONDS:
            return _token
        form = urlencode({
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
        }).encode("utf-8")
        request = Request(
            TOKEN_URL,
            data=form,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                token_response = json.loads(response.read())
        except HTTPError as error:
            if error.code in (400, 401):
                raise SatelliteServiceError("Copernicus authentication failed. Check the configured OAuth client.", 502) from None
            raise SatelliteServiceError("Copernicus authentication service is unavailable.", 503) from None
        except (TimeoutError, URLError, OSError, json.JSONDecodeError):
            raise SatelliteServiceError("Copernicus authentication service timed out or is unavailable.", 503) from None
        access_token = token_response.get("access_token")
        if not access_token:
            raise SatelliteServiceError("Copernicus returned an invalid authentication response.", 502)
        _token = access_token
        _token_expires_at = now + int(token_response.get("expires_in", 300))
        return _token


def _validate_bbox(bbox: tuple[float, float, float, float]) -> None:
    west, south, east, north = bbox
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise SatelliteServiceError("bbox must be west,south,east,north with valid geographic coordinates.", 422)
    if east - west > MAX_BBOX_SPAN or north - south > MAX_BBOX_SPAN:
        raise SatelliteServiceError(f"Preview area is limited to {MAX_BBOX_SPAN} degrees per side.", 422)


def _catalog_acquisition(token: str, bbox: tuple[float, float, float, float], date_from: date, date_to: date) -> str:
    catalog = _request_json(
        CATALOG_URL,
        {
            "collections": [COLLECTION],
            "datetime": f"{date_from.isoformat()}T00:00:00Z/{date_to.isoformat()}T23:59:59Z",
            "bbox": list(bbox),
            "limit": 100,
        },
        {"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    features = catalog.get("features") or []
    if not features:
        raise SatelliteServiceError("No Sentinel-2 L2A acquisition was found for this area and date interval.", 404)
    latest_feature = max(
        features,
        key=lambda feature: feature.get("properties", {}).get("datetime", ""),
    )
    acquired = latest_feature.get("properties", {}).get("datetime")
    if not acquired:
        raise SatelliteServiceError("Catalog result did not include a verifiable acquisition time.", 502)
    return acquired


EVALSCRIPT = """//VERSION=3
function setup() {
  return {
    input: ["B04", "B03", "B02", "dataMask"],
    output: { bands: 4, sampleType: "AUTO" }
  };
}
function evaluatePixel(sample) {
  if (sample.dataMask === 0) return [0, 0, 0, 0];
  return [2.5 * sample.B04, 2.5 * sample.B03, 2.5 * sample.B02, 1];
}
"""


WATER_MASK_EVALSCRIPT = f"""//VERSION=3
function setup() {{
  return {{
    input: ["B03", "B11", "SCL", "dataMask"],
    output: {{ bands: 4, sampleType: "UINT8" }}
  }};
}}
function evaluatePixel(sample) {{
  var invalidScl = [0, 1, 3, 8, 9, 10, 11];
  if (sample.dataMask !== 1 || invalidScl.indexOf(sample.SCL) !== -1) {{
    return [0, 0, 0, 0];
  }}
  var denominator = sample.B03 + sample.B11;
  if (denominator <= 0) return [0, 0, 0, 255];
  var mndwi = (sample.B03 - sample.B11) / denominator;
  return [mndwi > {MNDWI_THRESHOLD} ? 255 : 0, 0, 0, 255];
}}
"""


def _process_preview(token: str, bbox: tuple[float, float, float, float], acquired: str) -> tuple[bytes, str]:
    acquired_dt = datetime.fromisoformat(acquired.replace("Z", "+00:00"))
    day = acquired_dt.date()
    payload = {
        "input": {
            "bounds": {
                "bbox": list(bbox),
                "properties": {
                    "crs": "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
                },
            },
            "data": [{
                "type": COLLECTION,
                "dataFilter": {
                    "timeRange": {
                        "from": f"{day.isoformat()}T00:00:00Z",
                        "to": f"{day.isoformat()}T23:59:59Z",
                    },
                },
            }],
        },
        "output": {
            "width": MAX_IMAGE_SIDE,
            "height": MAX_IMAGE_SIDE,
            "responses": [
                {"identifier": "default", "format": {"type": "image/png"}},
            ],
        },
        "evalscript": EVALSCRIPT,
    }
    request = Request(
        PROCESS_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "image/png",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            image_bytes = response.read()
    except HTTPError as error:
        if error.code == 401:
            raise SatelliteServiceError("Copernicus rejected the access token. Please retry the preview.", 502) from None
        if error.code == 429:
            raise SatelliteServiceError("Copernicus rate limit reached. Please retry later.", 503) from None
        if error.code in (400, 422):
            raise SatelliteServiceError("Copernicus could not process imagery for this request.", 422) from None
        raise SatelliteServiceError("Copernicus image processing failed. The demo dashboard remains available.", 502) from None
    except (TimeoutError, URLError, OSError):
        raise SatelliteServiceError("Copernicus image processing timed out or is unavailable.", 503) from None

    if not image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        raise SatelliteServiceError("Copernicus did not return a valid PNG image.", 502)
    return image_bytes, acquired


def _decode_png_rgba(image_bytes: bytes) -> tuple[int, int, bytes]:
    """Decode 8-bit RGB/RGBA PNG pixels using only the Python standard library."""
    if not image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        raise SatelliteServiceError("Copernicus returned an invalid water-screen image.", 502)

    width = height = bit_depth = color_type = None
    compressed = bytearray()
    offset = 8
    while offset + 12 <= len(image_bytes):
        chunk_length = int.from_bytes(image_bytes[offset:offset + 4], "big")
        chunk_type = image_bytes[offset + 4:offset + 8]
        chunk_start = offset + 8
        chunk_end = chunk_start + chunk_length
        if chunk_end + 4 > len(image_bytes):
            raise SatelliteServiceError("Copernicus returned a truncated water-screen image.", 502)
        chunk = image_bytes[chunk_start:chunk_end]
        if chunk_type == b"IHDR":
            width = int.from_bytes(chunk[0:4], "big")
            height = int.from_bytes(chunk[4:8], "big")
            bit_depth, color_type = chunk[8], chunk[9]
            if chunk[10:13] != b"\x00\x00\x00":
                raise SatelliteServiceError("Copernicus returned an unsupported PNG encoding.", 502)
        elif chunk_type == b"IDAT":
            compressed.extend(chunk)
        elif chunk_type == b"IEND":
            break
        offset = chunk_end + 4

    if not width or not height or bit_depth != 8 or color_type not in (2, 6):
        raise SatelliteServiceError("Copernicus returned an unsupported water-screen image format.", 502)

    channels = 4 if color_type == 6 else 3
    bytes_per_row = width * channels
    try:
        decoded = zlib.decompress(compressed)
    except zlib.error:
        raise SatelliteServiceError("Copernicus water-screen image could not be decoded.", 502) from None
    if len(decoded) != height * (bytes_per_row + 1):
        raise SatelliteServiceError("Copernicus returned incomplete water-screen pixels.", 502)

    rows: list[bytearray] = []
    cursor = 0
    previous = bytearray(bytes_per_row)
    for _ in range(height):
        filter_type = decoded[cursor]
        cursor += 1
        source = decoded[cursor:cursor + bytes_per_row]
        cursor += bytes_per_row
        row = bytearray(bytes_per_row)
        for index, raw in enumerate(source):
            left = row[index - channels] if index >= channels else 0
            above = previous[index]
            upper_left = previous[index - channels] if index >= channels else 0
            if filter_type == 0:
                predictor = 0
            elif filter_type == 1:
                predictor = left
            elif filter_type == 2:
                predictor = above
            elif filter_type == 3:
                predictor = (left + above) // 2
            elif filter_type == 4:
                estimate = left + above - upper_left
                distance_left = abs(estimate - left)
                distance_above = abs(estimate - above)
                distance_upper_left = abs(estimate - upper_left)
                predictor = (
                    left if distance_left <= distance_above and distance_left <= distance_upper_left
                    else above if distance_above <= distance_upper_left
                    else upper_left
                )
            else:
                raise SatelliteServiceError("Copernicus returned an unsupported PNG filter.", 502)
            row[index] = (raw + predictor) & 255
        rows.append(row)
        previous = row

    if channels == 4:
        return width, height, b"".join(rows)

    rgba = bytearray(width * height * 4)
    for pixel_index in range(width * height):
        source_index = pixel_index * 3
        target_index = pixel_index * 4
        rgba[target_index:target_index + 3] = rows[pixel_index // width][
            source_index % bytes_per_row:source_index % bytes_per_row + 3
        ]
        rgba[target_index + 3] = 255
    return width, height, bytes(rgba)


def _process_water_mask(
    token: str,
    bbox: tuple[float, float, float, float],
    acquired: str,
) -> tuple[int, int, bytes]:
    day = datetime.fromisoformat(acquired.replace("Z", "+00:00")).date()
    payload = {
        "input": {
            "bounds": {
                "bbox": list(bbox),
                "properties": {"crs": "http://www.opengis.net/def/crs/OGC/1.3/CRS84"},
            },
            "data": [{
                "type": COLLECTION,
                "dataFilter": {
                    "timeRange": {
                        "from": f"{day.isoformat()}T00:00:00Z",
                        "to": f"{day.isoformat()}T23:59:59Z",
                    },
                },
            }],
        },
        "output": {
            "width": SCREENING_SIZE,
            "height": SCREENING_SIZE,
            "responses": [{"identifier": "default", "format": {"type": "image/png"}}],
        },
        "evalscript": WATER_MASK_EVALSCRIPT,
    }
    request = Request(
        PROCESS_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "image/png",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            image_bytes = response.read()
    except HTTPError as error:
        if error.code == 401:
            raise SatelliteServiceError("Copernicus rejected the access token. Please retry screening.", 502) from None
        if error.code == 429:
            raise SatelliteServiceError("Copernicus rate limit reached. Please retry later.", 503) from None
        if error.code in (400, 422):
            raise SatelliteServiceError("Copernicus rejected the water-screen request.", 422) from None
        raise SatelliteServiceError("Copernicus water screening failed. Demo data remains available.", 502) from None
    except (TimeoutError, URLError, OSError):
        raise SatelliteServiceError("Copernicus water screening timed out or is unavailable.", 503) from None

    width, height, rgba = _decode_png_rgba(image_bytes)
    if width != SCREENING_SIZE or height != SCREENING_SIZE:
        raise SatelliteServiceError("Copernicus returned unexpected water-screen dimensions.", 502)
    return width, height, rgba


def _catalog_acquisition_near_date(
    token: str,
    bbox: tuple[float, float, float, float],
    target: date,
) -> str:
    catalog_from = target - timedelta(days=15)
    catalog_to = target + timedelta(days=15)
    catalog = _request_json(
        CATALOG_URL,
        {
            "collections": [COLLECTION],
            "datetime": f"{catalog_from.isoformat()}T00:00:00Z/{catalog_to.isoformat()}T23:59:59Z",
            "bbox": list(bbox),
            "limit": 100,
        },
        {"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    features = catalog.get("features") or []
    if not features:
        raise SatelliteServiceError("No same-season Sentinel-2 baseline scene was found.", 404)

    def distance(feature: dict[str, Any]) -> int:
        value = feature.get("properties", {}).get("datetime")
        if not value:
            return 10**9
        acquired_day = datetime.fromisoformat(value.replace("Z", "+00:00")).date()
        return abs((acquired_day - target).days)

    latest_feature = min(features, key=distance)
    acquired = latest_feature.get("properties", {}).get("datetime")
    if not acquired:
        raise SatelliteServiceError("Baseline catalog result did not include a sensing time.", 502)
    return acquired


def _changed_water_features(
    current_rgba: bytes,
    baseline_rgba: bytes,
    bbox: tuple[float, float, float, float],
) -> tuple[list[dict[str, Any]], float, int]:
    west, south, east, north = bbox
    width = height = SCREENING_SIZE
    total = width * height
    changed = bytearray(total)
    clear_pairs = 0

    for pixel_index in range(total):
        offset = pixel_index * 4
        current_clear = current_rgba[offset + 3] > 0
        baseline_clear = baseline_rgba[offset + 3] > 0
        if current_clear and baseline_clear:
            clear_pairs += 1
            changed[pixel_index] = int(
                current_rgba[offset] >= 128 and baseline_rgba[offset] < 128
            )

    clear_fraction = clear_pairs / total
    if clear_fraction < 0.05:
        raise SatelliteServiceError("Too few clear pixels overlap the current and baseline scenes.", 422)

    visited = bytearray(total)
    components: list[list[int]] = []
    for seed in range(total):
        if not changed[seed] or visited[seed]:
            continue
        queue = deque([seed])
        visited[seed] = 1
        component: list[int] = []
        while queue:
            current = queue.popleft()
            component.append(current)
            row, column = divmod(current, width)
            for next_row in range(max(0, row - 1), min(height, row + 2)):
                for next_column in range(max(0, column - 1), min(width, column + 2)):
                    neighbor = next_row * width + next_column
                    if changed[neighbor] and not visited[neighbor]:
                        visited[neighbor] = 1
                        queue.append(neighbor)
        if len(component) >= 4:
            components.append(component)

    degrees_per_latitude_km = 111.32
    pixel_width_km = (east - west) * degrees_per_latitude_km * math.cos(
        math.radians((north + south) / 2)
    ) / width
    pixel_height_km = (north - south) * degrees_per_latitude_km / height
    pixel_area_km2 = pixel_width_km * pixel_height_km
    features: list[dict[str, Any]] = []

    def add_rectangle(column_start: int, column_end: int, row_start: int, row_end: int) -> None:
        west_edge = west + (column_start / width) * (east - west)
        east_edge = west + (column_end / width) * (east - west)
        north_edge = north - (row_start / height) * (north - south)
        south_edge = north - (row_end / height) * (north - south)
        feature_id = len(features) + 1
        pixel_count = (column_end - column_start) * (row_end - row_start)
        ring = [
            [west_edge, south_edge],
            [east_edge, south_edge],
            [east_edge, north_edge],
            [west_edge, north_edge],
            [west_edge, south_edge],
        ]
        features.append({
            "type": "Feature",
            "properties": {
                "id": f"s2-water-change-{feature_id}",
                "name": "Possible new water signal",
                "severity": "candidate",
                "method": "Sentinel-2 L2A MNDWI seasonal-baseline differencing",
                "threshold": MNDWI_THRESHOLD,
                "pixel_count": pixel_count,
                "estimated_area_km2": round(pixel_count * pixel_area_km2, 4),
                "is_demo": False,
            },
            "geometry": {"type": "Polygon", "coordinates": [ring]},
        })

    for component in components:
        columns_by_row: dict[int, list[int]] = {}
        for index in component:
            row, column = divmod(index, width)
            columns_by_row.setdefault(row, []).append(column)

        active: dict[tuple[int, int], tuple[int, int]] = {}
        for row in sorted(columns_by_row):
            columns = sorted(columns_by_row[row])
            intervals: list[tuple[int, int]] = []
            first = previous = columns[0]
            for column in columns[1:]:
                if column == previous + 1:
                    previous = column
                    continue
                intervals.append((first, previous + 1))
                first = previous = column
            intervals.append((first, previous + 1))

            interval_set = set(intervals)
            for interval, (start_row, end_row) in list(active.items()):
                if interval not in interval_set or row != end_row:
                    add_rectangle(interval[0], interval[1], start_row, end_row)
                    active.pop(interval)
            for interval in intervals:
                if interval not in active:
                    active[interval] = (row, row + 1)
                else:
                    active[interval] = (active[interval][0], row + 1)

        for interval, (start_row, end_row) in active.items():
            add_rectangle(interval[0], interval[1], start_row, end_row)

    changed_pixels = sum(len(component) for component in components)
    return features, round(clear_fraction, 4), changed_pixels


def get_flood_screening(
    bbox: tuple[float, float, float, float] = PATNA_BBOX,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict[str, Any]:
    """Screen for possible newly wet pixels using clear Sentinel-2 MNDWI deltas."""
    _validate_bbox(bbox)
    today = datetime.now(timezone.utc).date()
    date_to = date_to or today
    date_from = date_from or (date_to - timedelta(days=30))
    if date_from > date_to or date_to > today or (date_to - date_from).days > 31:
        raise SatelliteServiceError("Use a past date interval no longer than 31 days.", 422)

    cache_key = (*bbox, date_from.isoformat(), date_to.isoformat())
    now = datetime.now(timezone.utc).timestamp()
    with _screening_lock:
        cached = _screening_cache.get(cache_key)
        if cached and cached[0] > now:
            return cached[1]

    token = _get_access_token()
    current_date = _catalog_acquisition(token, bbox, date_from, date_to)
    current_day = datetime.fromisoformat(current_date.replace("Z", "+00:00")).date()
    try:
        baseline_target = current_day.replace(year=current_day.year - 1)
    except ValueError:
        baseline_target = current_day.replace(year=current_day.year - 1, day=28)
    baseline_date = _catalog_acquisition_near_date(token, bbox, baseline_target)

    width, height, current_mask = _process_water_mask(token, bbox, current_date)
    baseline_width, baseline_height, baseline_mask = _process_water_mask(token, bbox, baseline_date)
    if (width, height) != (baseline_width, baseline_height):
        raise SatelliteServiceError("Current and baseline images have incompatible dimensions.", 502)

    features, clear_fraction, changed_pixels = _changed_water_features(
        current_mask,
        baseline_mask,
        bbox,
    )
    pixel_width_km = (bbox[2] - bbox[0]) * 111.32 * math.cos(
        math.radians((bbox[3] + bbox[1]) / 2)
    ) / width
    pixel_height_km = (bbox[3] - bbox[1]) * 111.32 / height
    total_area_km2 = round(changed_pixels * pixel_width_km * pixel_height_km, 4)
    result = {
        "status": "success",
        "data_source": "Copernicus Sentinel-2 L2A",
        "detection_method": "Clear-pixel MNDWI current-scene versus same-season prior-year baseline",
        "screen_type": "possible_new_water",
        "is_demo": False,
        "current_sensing_time": current_date,
        "baseline_sensing_time": baseline_date,
        "threshold": MNDWI_THRESHOLD,
        "clear_pixel_fraction": clear_fraction,
        "candidate_pixel_count": changed_pixels,
        "estimated_candidate_area_km2": total_area_km2,
        "zone_count": len(features),
        "geojson": {"type": "FeatureCollection", "features": features},
        "notice": (
            "Possible newly wet surface signatures only. This threshold-based screen can include "
            "seasonal or land-cover changes and is not a verified flood boundary or safety warning."
        ),
    }
    with _screening_lock:
        _screening_cache[cache_key] = (now + 3600, result)
    return result


def get_preview(
    bbox: tuple[float, float, float, float] = PATNA_BBOX,
    date_from: date | None = None,
    date_to: date | None = None,
) -> tuple[bytes, str]:
    _validate_bbox(bbox)
    today = datetime.now(timezone.utc).date()
    date_to = date_to or today
    date_from = date_from or (date_to - timedelta(days=30))
    if date_from > date_to or date_to > today or (date_to - date_from).days > 31:
        raise SatelliteServiceError("Use a past date interval no longer than 31 days.", 422)
    key = (*bbox, date_from.isoformat(), date_to.isoformat())
    now = datetime.now(timezone.utc).timestamp()
    with _preview_lock:
        cached = _preview_cache.get(key)
        if cached and cached[0] > now:
            return cached[1], cached[2]

    token = _get_access_token()
    acquired = _catalog_acquisition(token, bbox, date_from, date_to)
    image_bytes, verified_date = _process_preview(token, bbox, acquired)
    with _preview_lock:
        _preview_cache[key] = (now + 3600, image_bytes, verified_date)
    return image_bytes, verified_date
