import { useState, useEffect } from "react";

import {
  AlertTriangle,
  Activity,
  MapPin,
  Users,
  ShieldAlert,
  RefreshCw,
  Layers,
  Radio,
  Menu,
  X,
} from "lucide-react";

import {
  MapContainer,
  TileLayer,
  Polygon,
  CircleMarker,
  Popup,
  Polyline,
  ImageOverlay,
  useMap,
} from "react-leaflet";

import "leaflet/dist/leaflet.css";

import "./App.css";
import {
  routeIntersectsHazards,
  routeTouchesEndpointZone,
} from "./floodRouting.js";

const API_URL = "http://127.0.0.1:8000";
const SENTINEL_PREVIEW_BOUNDS = [
  [25.54, 85.08],
  [25.74, 85.28],
];

const incidents = [
  {
    id: 1,

    name: "Flood Risk Zone A",

    severity: "High",

    location: "Patna District, Bihar",

    affected: "12,400 (demo estimate)",

    center: [25.61, 85.14],

    area: [
      [25.64, 85.1],

      [25.66, 85.17],

      [25.61, 85.2],

      [25.58, 85.13],
    ],
  },

  {
    id: 2,

    name: "Flood Risk Zone B",

    severity: "Medium",

    location: "Hajipur Region, Bihar",

    affected: "5,800 (demo estimate)",

    center: [25.69, 85.21],

    area: [
      [25.72, 85.18],

      [25.73, 85.24],

      [25.68, 85.27],

      [25.66, 85.21],
    ],
  },
];

const facilities = [
  {
    name: "Demo Relief Center",

    type: "Shelter",

    position: [25.62, 85.16],
  },

  {
    name: "Demo Medical Point",

    type: "Medical",

    position: [25.67, 85.12],
  },
];

function calculateDistanceKm(pointA, pointB) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;

  const [lat1, lon1] = pointA;
  const [lat2, lon2] = pointB;

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Number((6371 * c).toFixed(2));
}

function MapFocus({ position, focusBounds }) {
  const map = useMap();

  useEffect(() => {
    if (focusBounds) {
      map.fitBounds(focusBounds, { padding: [24, 24], maxZoom: 14 });
    }
  }, [focusBounds, map]);

  return (
    <button
      className="map-focus-control"
      onClick={() => map.flyTo(position, 12)}
      title="Focus on Patna"
    >
      <MapPin size={17} />
    </button>
  );
}

function MapZoomLimit({ maxZoom }) {
  const map = useMap();

  useEffect(() => {
    map.setMaxZoom(maxZoom);
    if (map.getZoom() > maxZoom) map.setZoom(maxZoom);
  }, [map, maxZoom]);

  return null;
}

function StatCard({ icon: Icon, title, value, note, color }) {
  return (
    <article className="stat-card">
      <div className={`stat-icon ${color}`}>
        <Icon size={21} />
      </div>

      <p className="stat-title">{title}</p>

      <h2>{value}</h2>

      <p className="stat-note">{note}</p>
    </article>
  );
}

export default function App() {
  const [activeLayer, setActiveLayer] = useState("flood");
  const [baseMap, setBaseMap] = useState("satellite");

  const [selectedIncident, setSelectedIncident] = useState(incidents[0]);

  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [updated] = useState(
    new Date().toLocaleTimeString([], {
      hour: "2-digit",

      minute: "2-digit",
    }),
  );

  const [apiIncidents, setApiIncidents] = useState([]);

  const [apiStatus, setApiStatus] = useState("connecting");

  const [floodStatus, setFloodStatus] = useState("loading");
  const [floodZones, setFloodZones] = useState([]);
  const [screeningStatus, setScreeningStatus] = useState("idle");
  const [screeningData, setScreeningData] = useState(null);
  const [screeningMessage, setScreeningMessage] = useState("");
  const [screeningRequestId, setScreeningRequestId] = useState(0);
  const [previewStatus, setPreviewStatus] = useState("idle");
  const [previewMessage, setPreviewMessage] = useState("");
  const [satellitePreview, setSatellitePreview] = useState(null);
  const [previewRequestId, setPreviewRequestId] = useState(0);

  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [routeStatus, setRouteStatus] = useState("loading");

  const [routeDistanceKm, setRouteDistanceKm] = useState(null);
  const [routeDurationMin, setRouteDurationMin] = useState(null);

  const displayIncidents =
    apiIncidents.length > 0
      ? apiIncidents.map((item) => {
          const fallback = incidents.find((x) => x.id === item.id);

          return {
            ...fallback,

            ...item,

            severity:
              item.severity.toLowerCase() === "high" ? "High" : "Medium",

            center: [item.latitude, item.longitude],

            affected: `${item.estimated_population.toLocaleString()} (demo estimate)`,

            area: fallback?.area ?? [],
          };
        })
      : incidents;

  const nearestFacility = facilities
    .map((facility) => ({
      ...facility,
      distanceKm: calculateDistanceKm(
        selectedIncident.center,
        facility.position,
      ),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)[0];

  const routeHazards =
    screeningStatus === "available"
      ? screeningData?.geojson?.features ?? []
      : floodZones;

  useEffect(() => {
    let cancelled = false;

    async function loadRoute() {
      setRouteStatus("loading");
      setRouteCoordinates([]);

      const [startLat, startLng] = selectedIncident.center;
      const [endLat, endLng] = nearestFacility.position;

      const url =
        `https://router.project-osrm.org/route/v1/driving/` +
        `${startLng},${startLat};${endLng},${endLat}` +
        `?overview=full&geometries=geojson&alternatives=3`;

      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Route request failed");

        const result = await response.json();
        const routes = result.routes ?? [];
        if (result.code !== "Ok" || !routes.length) {
          throw new Error("No route found");
        }

        const route = routes.find((candidate) => {
          const coordinates = candidate.geometry?.coordinates;
          return (
            coordinates?.length >= 2 &&
            !routeIntersectsHazards(
              coordinates,
              routeHazards,
              [startLng, startLat],
              [endLng, endLat],
            )
          );
        });

        if (!route) {
          if (!cancelled) {
            setRouteCoordinates([]);
            setRouteStatus("blocked");
          }
          return;
        }

        if (!cancelled) {
          setRouteCoordinates(
            route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
          );
          setRouteDistanceKm((route.distance / 1000).toFixed(2));
          setRouteDurationMin(Math.round(route.duration / 60));
          const hasEndpointZone = routeTouchesEndpointZone(
            routeHazards,
            [startLng, startLat],
            [endLng, endLat],
          );
          setRouteStatus(
            hasEndpointZone
              ? "endpoint-zone"
              : routeHazards.length > 0
                ? "avoids-zones"
                : "connected",
          );
        }
      } catch (error) {
        console.error("Route API error:", error);

        if (!cancelled) {
          setRouteStatus("offline");
        }
      }
    }

    loadRoute();

    return () => {
      cancelled = true;
    };
  }, [selectedIncident, nearestFacility.position, routeHazards]);

  useEffect(() => {
    let cancelled = false;

    async function loadIncidents() {
      try {
        const response = await fetch(`${API_URL}/api/incidents`);

        if (!response.ok) {
          throw new Error("API request failed");
        }

        const result = await response.json();

        if (!cancelled) {
          setApiIncidents(result.incidents || []);

          setApiStatus("connected");
        }
      } catch (error) {
        console.error("Incidents API error:", error);

        if (!cancelled) {
          setApiStatus("offline");
        }
      }
    }

    loadIncidents();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (screeningRequestId === 0) return undefined;

    const controller = new AbortController();

    async function loadFloodScreening() {
      try {
        const response = await fetch(`${API_URL}/api/flood-screening`, {
          signal: controller.signal,
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.detail || "Satellite water screening is unavailable.");
        }
        if (controller.signal.aborted) return;
        setScreeningData(result);
        setScreeningMessage("");
        setScreeningStatus("available");
      } catch (error) {
        if (controller.signal.aborted) return;
        setScreeningMessage(error.message || "Satellite water screening is unavailable.");
        setScreeningStatus("unavailable");
      }
    }

    loadFloodScreening();
    return () => controller.abort();
  }, [screeningRequestId]);

  useEffect(() => {
    if (baseMap !== "sentinel-2" || satellitePreview) return undefined;

    const controller = new AbortController();

    async function loadSentinelPreview() {
      try {
        const response = await fetch(`${API_URL}/api/satellite/preview`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          throw new Error(detail.detail || "Sentinel-2 preview is unavailable.");
        }
        const imageUrl = URL.createObjectURL(await response.blob());
        if (controller.signal.aborted) {
          URL.revokeObjectURL(imageUrl);
          return;
        }
        setSatellitePreview({
          url: imageUrl,
          acquisitionTime: response.headers.get("X-Sensing-Date"),
          source: response.headers.get("X-Imaging-Source") || "Copernicus Sentinel-2 L2A",
        });
        setPreviewStatus("available");
      } catch (error) {
        if (controller.signal.aborted) return;
        setPreviewMessage(
          error.message === "Failed to fetch"
            ? "Backend se connect nahi hua. FastAPI ko 127.0.0.1:8000 par start karke Retry karein."
            : error.message || "Sentinel-2 preview is unavailable.",
        );
        setPreviewStatus("unavailable");
      }
    }

    loadSentinelPreview();
    return () => controller.abort();
  }, [baseMap, previewRequestId, satellitePreview]);

  useEffect(
    () => () => {
      if (satellitePreview?.url) URL.revokeObjectURL(satellitePreview.url);
    },
    [satellitePreview],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadFloodZones() {
      try {
        const response = await fetch(`${API_URL}/api/flood-detection`);

        if (!response.ok) {
          throw new Error("Flood detection API failed");
        }

        const result = await response.json();

        const features = result.geojson?.features ?? [];

        if (!cancelled) {
          setFloodZones(features);

          setFloodStatus("connected");
        }
      } catch (error) {
        if (!cancelled) {
          setFloodStatus("offline");
        }

        console.error("Flood detection error:", error);
      }
    }

    loadFloodZones();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (apiIncidents.length > 0) {
      const item = apiIncidents[0];

      const fallback = incidents.find((x) => x.id === item.id);

      setSelectedIncident({
        ...fallback,

        ...item,

        severity: item.severity.toLowerCase() === "high" ? "High" : "Medium",

        center: [item.latitude, item.longitude],

        affected: `${item.estimated_population.toLocaleString()} (demo estimate)`,

        area: fallback?.area ?? [],
      });
    }
  }, [apiIncidents]);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-logo">
            <ShieldAlert size={27} />
          </div>

          <div>
            <h1>ResQSat</h1>

            <p>DISASTER INTELLIGENCE</p>
          </div>

          <button
            className="icon-button close-sidebar"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          >
            <X size={20} />
          </button>
        </div>

        <div className="sidebar-label">WORKSPACE</div>

        <nav className="navigation">
          <button className="nav-item active">
            <Activity size={19} /> Overview
          </button>

          <button
            className="nav-item"
            onClick={() => {
              setActiveLayer("flood");

              setSidebarOpen(false);
            }}
          >
            <Layers size={19} /> Flood Mapping
          </button>

          <button
            className="nav-item"
            onClick={() => {
              setActiveLayer("population");

              setSidebarOpen(false);
            }}
          >
            <Users size={19} /> Population Risk
          </button>

          <button
            className="nav-item"
            onClick={() => {
              setActiveLayer("facilities");

              setSidebarOpen(false);
            }}
          >
            <MapPin size={19} /> Rescue Facilities
          </button>
        </nav>

        <div className="sidebar-label">SYSTEM STATUS</div>

        <div className="system-status">
          <span className="status-dot" />
          Demo environment active
          <span className="demo-label">DEMO</span>
        </div>

        <div className="sidebar-bottom">
          <div className="team-avatar">RS</div>

          <div>
            <strong>ResQSat Team</strong>

            <p>Disaster response workspace</p>
          </div>
        </div>
      </aside>

      {sidebarOpen && (
        <button
          className="sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close menu"
        />
      )}

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
            >
              <Menu size={22} />
            </button>

            <div>
              <p className="eyebrow">DISASTER MANAGEMENT / INDIA</p>

              <h2>Command Center</h2>
            </div>
          </div>

          <div className="topbar-right">
            <span className="live-indicator">
              <span className="status-dot" />

              {apiStatus === "connected" && floodStatus === "connected"
                ? "API CONNECTED"
                : apiStatus === "connecting" || floodStatus === "loading"
                  ? "CONNECTING..."
                  : apiStatus === "connected"
                    ? "PARTIAL API"
                    : "DEMO FALLBACK"}
            </span>

            <div className="updated-label">
              <RefreshCw size={14} /> Updated {updated}
            </div>
          </div>
        </header>

        <section className="welcome-row">
          <div>
            <h2>Disaster Overview</h2>

            <p>Monitor potential flood zones and explore response locations.</p>
          </div>

          <div className="location-chip">
            <MapPin size={16} /> Bihar, India
          </div>
        </section>

        <section className="stats-grid">
          <StatCard
            icon={AlertTriangle}
            title="Potential Risk Zones"
            value={String(
              apiIncidents.length > 0 ? apiIncidents.length : 2,
            ).padStart(2, "0")}
            note={
              apiIncidents.length > 0
                ? "Incidents received from API · demo data"
                : "Illustrative demo zones"
            }
            color="orange"
          />

          <StatCard
            icon={Users}
            title="Population Exposure"
            value={
              apiIncidents.length > 0
                ? (
                    apiIncidents.reduce(
                      (total, item) => total + item.estimated_population,

                      0,
                    ) / 1000
                  ).toFixed(1) + "K"
                : "18.2K"
            }
            note="Bundled demo estimate · not verified"
            color="blue"
          />

          <StatCard
            icon={Activity}
            title="Affected Area"
            value="Demo"
            note="Satellite analysis not connected"
            color="purple"
          />

          <StatCard
            icon={Radio}
            title="Alert Status"
            value="Standby"
            note="No real alerts are being sent"
            color="green"
          />
        </section>

        <section className="content-grid">
          <article className="panel map-panel">
            <div className="panel-header">
              <div>
                <h3>Geospatial Intelligence</h3>

                <p>Patna region · illustrative sample locations</p>
              </div>

              <div className="map-badge">
                <span className="status-dot" />{" "}
                {floodStatus === "connected"
                  ? "API FLOOD DATA"
                  : floodStatus === "loading"
                    ? "LOADING FLOOD DATA"
                    : "DEMO MAP"}
              </div>
            </div>

            <div className="map-toolbar">
              {[
                { id: "flood", label: "Flood zones" },

                { id: "population", label: "Risk markers" },

                { id: "facilities", label: "Facilities" },
              ].map((layer) => (
                <button
                  key={layer.id}
                  className={`layer-button ${
                    activeLayer === layer.id ? "layer-active" : ""
                  }`}
                  onClick={() => setActiveLayer(layer.id)}
                >
                  {layer.label}
                </button>
              ))}

              <button
                className={`layer-button ${baseMap === "satellite" ? "layer-active" : ""}`}
                onClick={() => setBaseMap("satellite")}
              >
                NASA Satellite
              </button>

              <button
                className={`layer-button ${activeLayer === "screening" ? "layer-active" : ""}`}
                onClick={() => {
                  setActiveLayer("screening");
                  if (screeningStatus !== "available") {
                    setScreeningStatus("loading");
                    setScreeningMessage("");
                    setScreeningRequestId((requestId) => requestId + 1);
                  }
                }}
              >
                Satellite Flood Screen
              </button>

              <button
                className={`layer-button ${baseMap === "street" ? "layer-active" : ""}`}
                onClick={() => setBaseMap("street")}
              >
                Street Map
              </button>

              <button
                className={`layer-button ${baseMap === "sentinel-2" ? "layer-active" : ""}`}
                onClick={() => {
                  if (!satellitePreview) {
                    setPreviewStatus("loading");
                    setPreviewMessage("");
                  }
                  setBaseMap("sentinel-2");
                }}
              >
                Sentinel-2 Preview
              </button>
            </div>

            <div className="map-wrapper">
              <MapContainer
                center={[22.5, 79.0]}
                zoom={5}
                maxZoom={22}
                scrollWheelZoom={true}
                className="leaflet-map"
              >
                {baseMap === "street" || baseMap === "sentinel-2" ? (
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    maxNativeZoom={19}
                    maxZoom={22}
                  />
                ) : (
                  <TileLayer
                    attribution='Imagery: <a href="https://www.earthdata.nasa.gov/">NASA GIBS</a>'
                    url="https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi?TIME=2026-10-17&layer=MODIS_Terra_CorrectedReflectance_TrueColor&tilematrixset=GoogleMapsCompatible_Level9&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image%2Fjpeg&TileMatrix={z}&TileCol={x}&TileRow={y}"
                    maxNativeZoom={9}
                    maxZoom={22}
                  />
                )}

                {baseMap === "sentinel-2" && satellitePreview && (
                  <ImageOverlay
                    url={satellitePreview.url}
                    bounds={SENTINEL_PREVIEW_BOUNDS}
                    opacity={0.88}
                    alt="Copernicus Sentinel-2 L2A true-colour preview over Patna"
                  />
                )}

                {activeLayer === "screening" && screeningData?.geojson?.features?.map((feature) => {
                  const geometry = feature.geometry;
                  const polygons = geometry?.type === "Polygon"
                    ? [geometry.coordinates]
                    : geometry?.type === "MultiPolygon"
                      ? geometry.coordinates
                      : [];
                  return polygons.map((rings, index) => {
                    const positions = (rings[0] ?? []).map(([lng, lat]) => [lat, lng]);
                    if (positions.length < 4) return null;
                    return (
                      <Polygon
                        key={`${feature.properties?.id ?? "water-candidate"}-${index}`}
                        positions={positions}
                        pathOptions={{ color: "#31c8e8", fillColor: "#31c8e8", fillOpacity: 0.35, weight: 2 }}
                      >
                        <Popup>
                          <strong>Possible new water signal</strong><br />
                          Estimated area: {feature.properties?.estimated_area_km2 ?? "N/A"} km²<br />
                          Sentinel-2 MNDWI candidate; not a confirmed flood boundary.
                        </Popup>
                      </Polygon>
                    );
                  });
                })}

                {activeLayer === "flood" &&
                  floodZones.flatMap((feature) => {
                    const properties = feature.properties ?? {};
                    const geometry = feature.geometry;

                    if (!geometry?.coordinates) return [];

                    // GeoJSON coordinates are [longitude, latitude].
                    // Leaflet expects [latitude, longitude].
                    const polygonRings =
                      geometry.type === "Polygon"
                        ? [geometry.coordinates]
                        : geometry.type === "MultiPolygon"
                          ? geometry.coordinates
                          : [];

                    const isHigh =
                      String(properties.severity ?? "").toLowerCase() ===
                      "high";

                    return polygonRings.map((rings, polygonIndex) => {
                      const positions = (rings[0] ?? []).map(([lng, lat]) => [
                        lat,
                        lng,
                      ]);

                      if (positions.length < 3) return null;

                      return (
                        <Polygon
                          key={`${properties.id ?? properties.name ?? "flood-zone"}-${polygonIndex}`}
                          positions={positions}
                          pathOptions={{
                            color: isHigh ? "#f05a55" : "#e7a43b",
                            fillColor: isHigh ? "#f05a55" : "#e7a43b",
                            fillOpacity: 0.4,
                            weight: 2,
                          }}
                        >
                          <Popup>
                            <strong>
                              {properties.name ?? "Flood risk zone"}
                            </strong>
                            <br />
                            Severity: {properties.severity ?? "Unspecified"}
                            <br />
                            Estimated area:{" "}
                            {properties.estimated_area_km2 ?? "N/A"} km²
                            <br />
                            Illustrative demo data — not a live warning.
                          </Popup>
                        </Polygon>
                      );
                    });
                  })}

                {activeLayer === "flood" &&
                  floodZones.length === 0 &&
                  displayIncidents

                    .filter((incident) => incident.area?.length >= 3)

                    .map((incident) => (
                      <Polygon
                        key={incident.id}
                        positions={incident.area}
                        pathOptions={{
                          color:
                            incident.severity === "High"
                              ? "#f05a55"
                              : "#e7a43b",

                          fillColor:
                            incident.severity === "High"
                              ? "#f05a55"
                              : "#e7a43b",

                          fillOpacity: 0.35,

                          weight: 2,
                        }}
                        eventHandlers={{
                          click: () => setSelectedIncident(incident),
                        }}
                      >
                        <Popup>
                          <strong>{incident.name}</strong>
                          <br />
                          {incident.location}
                          <br />
                          {incident.affected}
                          <br />
                          Illustrative demo only
                        </Popup>
                      </Polygon>
                    ))}

                {activeLayer === "flood" &&
                  floodZones.length === 0 &&
                  displayIncidents

                    .filter(
                      (incident) => !incident.area || incident.area.length < 3,
                    )

                    .map((incident) => (
                      <CircleMarker
                        key={`marker-${incident.id}`}
                        center={incident.center}
                        radius={10}
                        pathOptions={{
                          color: "#e7a43b",

                          fillColor: "#e7a43b",

                          fillOpacity: 0.85,
                        }}
                        eventHandlers={{
                          click: () => setSelectedIncident(incident),
                        }}
                      >
                        <Popup>
                          <strong>{incident.name}</strong>
                          <br />
                          {incident.location}
                          <br />
                          {incident.affected}
                          <br />
                          Demo incident — boundary not available
                        </Popup>
                      </CircleMarker>
                    ))}

                {activeLayer === "population" &&
                  displayIncidents.map((incident) => (
                    <CircleMarker
                      key={incident.id}
                      center={incident.center}
                      radius={incident.severity === "High" ? 15 : 10}
                      pathOptions={{
                        color: "#b42335",

                        fillColor: "#e5484d",

                        fillOpacity: 0.65,
                      }}
                    >
                      <Popup>
                        Potential exposure: {incident.affected}
                        <br />
                        Synthetic demo estimate
                      </Popup>
                    </CircleMarker>
                  ))}

                {activeLayer === "facilities" &&
                  facilities.map((facility) => (
                    <CircleMarker
                      key={facility.name}
                      center={facility.position}
                      radius={8}
                      pathOptions={{
                        color: "#087f68",

                        fillColor: "#12b886",

                        fillOpacity: 0.9,
                      }}
                    >
                      <Popup>
                        <strong>{facility.name}</strong>
                        <br />
                        {facility.type}
                        <br />
                        Sample location, not verified
                      </Popup>
                    </CircleMarker>
                  ))}

                {activeLayer === "facilities" &&
                  routeCoordinates.length > 0 && (
                    <Polyline
                      positions={routeCoordinates}
                      pathOptions={{
                        color: "#087f68",
                        weight: 5,
                        opacity: 0.9,
                      }}
                    />
                  )}

                <MapZoomLimit
                  maxZoom={baseMap === "sentinel-2" ? 14 : baseMap === "street" ? 19 : 9}
                />

                <MapFocus
                  position={[25.64, 85.17]}
                  focusBounds={baseMap === "sentinel-2" ? SENTINEL_PREVIEW_BOUNDS : null}
                />
              </MapContainer>
              {baseMap === "sentinel-2" && previewStatus !== "available" && (
                <div className="satellite-preview-status" role="status">
                  {previewStatus === "loading" ? (
                    <span>Loading Sentinel-2 imagery…</span>
                  ) : previewStatus === "unavailable" ? (
                    <>
                      <span>{previewMessage}</span>
                      <button
                        type="button"
                        className="preview-retry-button"
                        onClick={() => {
                          setPreviewStatus("loading");
                          setPreviewMessage("");
                          setPreviewRequestId((requestId) => requestId + 1);
                        }}
                      >
                        Retry
                      </button>
                    </>
                  ) : (
                    <span>Sentinel-2 preview loads when selected.</span>
                  )}
                </div>
              )}
              {activeLayer === "screening" && screeningStatus !== "available" && (
                <div className="satellite-preview-status" role="status">
                  {screeningStatus === "loading" ? (
                    <span>Comparing clear Sentinel-2 scenes…</span>
                  ) : screeningStatus === "unavailable" ? (
                    <>
                      <span>{screeningMessage}</span>
                      <button type="button" className="preview-retry-button" onClick={() => {
                        setScreeningStatus("loading");
                        setScreeningRequestId((requestId) => requestId + 1);
                      }}>Retry</button>
                    </>
                  ) : (
                    <span>Select to request Sentinel-2 water-change screening.</span>
                  )}
                </div>
              )}
            </div>

            <div className="map-footer">
              <span>
                <i className="legend-dot red" /> High illustrative risk
              </span>

              <span>
                <i className="legend-dot amber" /> Medium illustrative risk
              </span>

              {baseMap === "sentinel-2" && satellitePreview ? (
                <span>
                  {satellitePreview.source}; sensing time: {satellitePreview.acquisitionTime || "verified by Copernicus catalog"}. Contains modified Copernicus Sentinel data {satellitePreview.acquisitionTime?.slice(0, 4) || "(year unavailable)"} processed by Sentinel Hub.
                </span>
              ) : baseMap === "satellite" ? (
                <span>NASA GIBS MODIS true-colour satellite basemap</span>
              ) : (
                <span>Sources: demo coordinates + OpenStreetMap basemap</span>
              )}
              {activeLayer === "screening" && screeningStatus === "available" && (
                <span>
                  Possible new water screen · current {screeningData.current_sensing_time} · baseline {screeningData.baseline_sensing_time} · {screeningData.zone_count} candidate areas. {screeningData.notice}
                </span>
              )}
            </div>
          </article>

          <aside className="right-column">
            <article className="panel incident-panel">
              <div className="panel-header">
                <div>
                  <h3>Risk Zones</h3>

                  <p>Select a zone to inspect details</p>
                </div>

                <span className="count-badge">
                  {String(displayIncidents.length).padStart(2, "0")}
                </span>
              </div>

              <div className="incident-list">
                {displayIncidents.map((incident) => (
                  <button
                    key={incident.id}
                    className={`incident-item ${
                      selectedIncident.id === incident.id
                        ? "incident-selected"
                        : ""
                    }`}
                    onClick={() => {
                      setSelectedIncident(incident);

                      setActiveLayer("flood");
                    }}
                  >
                    <span
                      className={`incident-icon ${
                        incident.severity === "High" ? "high" : "medium"
                      }`}
                    >
                      <AlertTriangle size={19} />
                    </span>

                    <span className="incident-info">
                      <strong>{incident.name}</strong>

                      <small>{incident.location}</small>

                      <small>{incident.affected}</small>
                    </span>

                    <span
                      className={`severity ${incident.severity.toLowerCase()}`}
                    >
                      {incident.severity}
                    </span>
                  </button>
                ))}
              </div>
            </article>

            <article className="panel detail-panel">
              <div className="panel-header">
                <div>
                  <h3>Selected Zone</h3>

                  <p>Illustrative incident details</p>
                </div>
              </div>

              <div className="detail-content">
                <span
                  className={`severity ${selectedIncident.severity.toLowerCase()}`}
                >
                  {selectedIncident.severity} demo risk
                </span>

                <h4>{selectedIncident.name}</h4>

                <p className="detail-location">
                  <MapPin size={15} /> {selectedIncident.location}
                </p>

                <div className="detail-stat">
                  <span>Estimated exposure</span>

                  <strong>{selectedIncident.affected}</strong>
                </div>

                <button
                  className="primary-button"
                  onClick={() => setActiveLayer("flood")}
                >
                  <div className="detail-stat">
                    <span>Nearest demo facility</span>
                    <strong>{nearestFacility.name}</strong>
                    <small>{nearestFacility.type}</small>
                    <small>
                      Straight-line distance: {nearestFacility.distanceKm} km
                    </small>
                  </div>
                  <div className="detail-stat">
                    <span>Rescue Route</span>
                    {routeStatus === "loading" ? (
                      <small>Calculating road route...</small>
                    ) : ["connected", "avoids-zones", "endpoint-zone"].includes(
                      routeStatus,
                    ) ? (
                      <>
                        <strong>{routeDistanceKm} km</strong>
                        <small>
                          Estimated travel time: {routeDurationMin} min
                        </small>
                      </>
                    ) : (
                      <small>
                        {routeStatus === "blocked"
                          ? "No alternative avoids the mapped polygons; no route drawn."
                          : "Route unavailable. Please try again later."}
                      </small>
                    )}
                    <small>
                      {routeStatus === "endpoint-zone"
                        ? "Origin or destination is inside a mapped zone; other polygons were avoided where alternatives allowed."
                        : routeStatus === "avoids-zones"
                        ? "Avoids mapped polygons only; zones may be illustrative. Not a verified safe route."
                        : "Normal road estimate; flood safety not verified."}
                    </small>

                    <small>
                      {routeStatus === "endpoint-zone"
                        ? "Mapped zone contains an endpoint; route is not safety-verified"
                        : routeStatus === "avoids-zones"
                        ? "Selected route avoids mapped polygons"
                        : routeStatus === "connected"
                          ? "Road route loaded; no hazard polygons were available"
                        : routeStatus === "loading"
                          ? "Loading road route..."
                          : routeStatus === "blocked"
                            ? "No mapped-zone-avoiding route found"
                            : "Road route unavailable"}
                    </small>
                  </div>
                  <Layers size={17} /> View on map
                </button>
              </div>
            </article>

            <article className="disclaimer">
              <ShieldAlert size={20} />

              <div>
                <strong>Prototype disclaimer</strong>

                <p>
                  All incident zones, coordinates and estimates are
                  illustrative. This dashboard is not a live emergency warning
                  service.
                </p>
              </div>
            </article>
          </aside>
        </section>

        <footer className="page-footer">
          <span>ResQSat · AI-Powered Geospatial Disaster Response</span>

          <span>Prototype v0.1 · Bihar flood use case</span>
        </footer>
      </main>
    </div>
  );
}
