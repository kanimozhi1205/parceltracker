import React, { useEffect, useMemo, useRef, useState } from "react";


const ROUTES = {

  CHN123: {
    trackingId: "CHN123",
    status: "In Transit",
    carrier: "Phoenix Express",
    origin: "Chennai Central",
    destination: "Adyar, Chennai",
    path: [
      [13.0827, 80.2707],
      [13.0604, 80.2496],
      [13.0431, 80.2460],
      [13.0287, 80.2478],
      [13.0214, 80.2526],
      [13.0067, 80.2570],
      [13.0012, 80.2551],
    ],
  },

  BLR555: {
    trackingId: "BLR555",
    status: "Out for Delivery",
    carrier: "SouthLine Logistics",
    origin: "Bengaluru",
    destination: "Mysuru",
    path: [
      [12.9716, 77.5946],
      [12.8000, 77.4000],
      [12.6000, 76.9000],
      [12.4500, 76.6500],
      [12.2958, 76.6394],
    ],
  },

  MUM777: {
    trackingId: "MUM777",
    status: "In Transit",
    carrier: "Western Courier",
    origin: "Mumbai",
    destination: "Pune",
    path: [
      [19.0760, 72.8777],
      [18.9500, 73.1500],
      [18.8000, 73.3000],
      [18.6500, 73.5000],
      [18.5204, 73.8567],
    ],
  },
};


function fetchTracking(trackingId) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const data = ROUTES[trackingId.toUpperCase()];
      if (!data) reject(new Error("Tracking ID not found"));
      else
        resolve({
          ...data,
          lastUpdated: new Date().toISOString(),
        });
    }, 500);
  });
}

/** -------------- Geo + ETA helpers -------------- **/
const toRad = (deg) => (deg * Math.PI) / 180;
function haversineMeters([lat1, lon1], [lat2, lon2]) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
function pathDistanceMeters(path) {
  let d = 0;
  for (let i = 1; i < path.length; i++) d += haversineMeters(path[i - 1], path[i]);
  return d;
}
function formatETA(minutes) {
  if (!isFinite(minutes) || minutes < 0) return "—";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m}m`;
}

/** -------------- Main App -------------- **/
export default function App() {
  const [trackingId, setTrackingId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState(null); // fetched data
  const [idx, setIdx] = useState(0); // current segment index along path
  const [follow, setFollow] = useState(true);

  // Map refs
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const fullLineRef = useRef(null);
  const travelledRef = useRef(null);
  const timerRef = useRef(null);

  // Fixed courier average speed (km/h) for ETA estimation
  const speedKmh = 35;

  const distances = useMemo(() => {
    if (!info) return null;
    const total = pathDistanceMeters(info.path);
    // distance covered up to current point
    const covered = pathDistanceMeters(info.path.slice(0, idx + 1));
    const remaining = Math.max(0, total - covered);
    return { total, covered, remaining };
  }, [info, idx]);

  const etaMinutes = useMemo(() => {
    if (!distances) return null;
    // speedKmh -> m/min
    const metersPerMin = (speedKmh * 1000) / 60;
    return distances.remaining / metersPerMin;
  }, [distances]);

  // Initialize Leaflet map once
  useEffect(() => {
    if (mapRef.current || typeof window === "undefined" || !window.L) return;
    const map = window.L.map("map", { zoomControl: true });
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    }).addTo(map);
    mapRef.current = map;
  }, []);

  // Draw/Update route + marker whenever we have data or index changes
  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    if (!map || !info) return;

    // Clear previous layers
    if (fullLineRef.current) {
      map.removeLayer(fullLineRef.current);
      fullLineRef.current = null;
    }
    if (travelledRef.current) {
      map.removeLayer(travelledRef.current);
      travelledRef.current = null;
    }
    if (markerRef.current) {
      map.removeLayer(markerRef.current);
      markerRef.current = null;
    }

    // Full route
    fullLineRef.current = L.polyline(info.path, { weight: 4, opacity: 0.6 }).addTo(map);

    // Travelled portion up to idx
    const upto = Math.max(1, idx + 1);
    travelledRef.current = L.polyline(info.path.slice(0, upto), { weight: 6 }).addTo(map);

    // Current marker position
    const currentLatLng = info.path[Math.min(idx, info.path.length - 1)];
    markerRef.current = L.marker(currentLatLng, {
      title: `Parcel ${info.trackingId}`,
    }).addTo(map);


    // Fit bounds on first load; later optionally follow
    if (idx === 0) {
      map.fitBounds(fullLineRef.current.getBounds(), { padding: [30, 30] });
    } else if (follow) {
      map.panTo(currentLatLng, { animate: true });
    }
  }, [info, idx, follow]);

  // Start/stop the 15s updater interval
  useEffect(() => {
    if (!info) return;
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setIdx((prev) => {
        const next = Math.min(prev + 1, info.path.length - 1);
        return next;
      });
    }, 15000); // 15s
    return () => clearInterval(timerRef.current);
  }, [info]);

  function handleSearch(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    setInfo(null);
    setIdx(0);
    fetchTracking(trackingId.trim())
      .then((data) => setInfo(data))
      .catch((err) => setError(err.message || "Failed to fetch"))
      .finally(() => setLoading(false));
  }

  function resetAll() {
    setTrackingId("");
    setInfo(null);
    setIdx(0);
    setError("");
    setFollow(true);
    // Clear layers
    const map = mapRef.current;
    if (map) {
      if (fullLineRef.current) { map.removeLayer(fullLineRef.current); fullLineRef.current = null; }
      if (travelledRef.current) { map.removeLayer(travelledRef.current); travelledRef.current = null; }
      if (markerRef.current) { map.removeLayer(markerRef.current); markerRef.current = null; }
    }
    clearInterval(timerRef.current);
  }

  const progressPct = useMemo(() => {
    if (!distances) return 0;
    return Math.min(100, Math.max(0, (distances.covered / distances.total) * 100)) || 0;
  }, [distances]);

  return (
    <div className="app">
      <div className="panel">
        <div>
          <h1>📦 Parcel Tracker</h1>
          <div className="subtle">Enter a tracking ID and watch it move live.</div>
        </div>

        <form className="form" onSubmit={handleSearch}>
          <input
            type="text"
            placeholder="Try CHN123, BLR555, or MUM777"
            value={trackingId}
            onChange={(e) => setTrackingId(e.target.value)}
          />
          <button className="primary" disabled={!trackingId || loading}>
            {loading ? "Fetching..." : "Track"}
          </button>
          <button type="button" onClick={resetAll}>Clear</button>
        </form>

        {error && (
          <div className="timeline" style={{ color: "#ff6b6b", borderColor: "#6b2a2a" }}>
            ⚠ {error}
          </div>
        )}

        {info && (
          <>
            <div className="kpis">
              <div className="kpi">
                <div className="label">Status</div>
                <div className="value">{info.status}</div>
              </div>
              <div className="kpi">
                <div className="label">Carrier</div>
                <div className="value">{info.carrier}</div>
              </div>
              <div className="kpi">
                <div className="label">Origin → Destination</div>
                <div className="value">
                  {info.origin} → {info.destination}
                </div>
              </div>
              <div className="kpi">
                <div className="label">ETA</div>
                <div className="value">{formatETA(etaMinutes)}</div>
              </div>
            </div>

            <div className="controls">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={follow}
                  onChange={(e) => setFollow(e.target.checked)}
                />
                Follow marker
              </label>
              <div className="checkbox" title="Approximate progress">
                Progress: {progressPct.toFixed(0)}%
              </div>
            </div>

            <div className="timeline">
              <div><strong>Last updated:</strong> {new Date().toLocaleString()}</div>
              <div style={{ marginTop: 6 }}>
                The marker advances along the route every <strong>15s</strong>. ETA is estimated from
                remaining distance at ~{speedKmh} km/h.
              </div>
            </div>
          </>
        )}
      </div>

      <div id="map" />
    </div>
  );
}