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
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";
const API_URL = "http://127.0.0.1:8000";

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

function MapFocus({ position }) {
  const map = useMap();

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
      } catch {
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
              {apiStatus === "connected"
                ? "API CONNECTED"
                : apiStatus === "connecting"
                  ? "CONNECTING..."
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
                <span className="status-dot" /> DEMO MAP
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
            </div>

            <div className="map-wrapper">
              <MapContainer
                center={[25.64, 85.17]}
                zoom={10}
                scrollWheelZoom={true}
                className="leaflet-map"
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {activeLayer === "flood" &&
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

                <MapFocus position={[25.64, 85.17]} />
              </MapContainer>
            </div>

            <div className="map-footer">
              <span>
                <i className="legend-dot red" /> High illustrative risk
              </span>
              <span>
                <i className="legend-dot amber" /> Medium illustrative risk
              </span>
              <span>Sources: demo coordinates + OSM basemap</span>
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
