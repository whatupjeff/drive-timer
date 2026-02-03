import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Clock, Navigation, RotateCw, StopCircle, Play, Search, Map as MapIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapContainer, TileLayer, Polyline, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import './App.css';

// Fix for default marker icons in Leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Helper component to update map view
function MapUpdater({ center, bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [50, 50] });
    } else if (center) {
      map.setView(center, map.getZoom());
    }
  }, [center, bounds, map]);
  return null;
}

// Map Event Listener for selection
function MapSelectionEvents({ onSelect }) {
  useMapEvents({
    click: async (e) => {
      const { lat, lng } = e.latlng;
      onSelect(lat, lng);
    },
  });
  return null;
}

function App() {
  const [isActive, setIsActive] = useState(false);
  const [destination, setDestination] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [arrivalTime, setArrivalTime] = useState({ hh: '', mm: '', ss: '', ampm: 'PM' });
  const [currentPos, setCurrentPos] = useState({ lat: 34.0522, lon: -118.2437 }); // Default LA
  const [destCoords, setDestCoords] = useState(null);
  const [routePolyline, setRoutePolyline] = useState([]);
  const [distance, setDistance] = useState(0);
  const [requiredSpeed, setRequiredSpeed] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [nextRefresh, setNextRefresh] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showSetupMap, setShowSetupMap] = useState(false);

  const watchId = useRef(null);
  const refreshTimer = useRef(null);
  const countdownTimer = useRef(null);
  const suggestionTimeout = useRef(null);

  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setCurrentPos({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        (err) => console.log("Using default location.")
      );
    }
    return () => {
      clearInterval(refreshTimer.current);
      clearTimeout(refreshTimer.current);
      clearInterval(countdownTimer.current);
    };
  }, []);

  // Fetch Suggestions
  useEffect(() => {
    if (destination.length > 3 && !destCoords) {
      clearTimeout(suggestionTimeout.current);
      suggestionTimeout.current = setTimeout(async () => {
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(destination)}&limit=5`);
          const data = await res.json();
          setSuggestions(data);
        } catch (e) { }
      }, 500);
    } else {
      setSuggestions([]);
    }
  }, [destination, destCoords]);

  const handleSuggestionClick = (s) => {
    setDestination(s.display_name);
    setDestCoords({ lat: parseFloat(s.lat), lon: parseFloat(s.lon) });
    setSuggestions([]);
  };

  const handleMapSelect = async (lat, lon) => {
    setDestCoords({ lat, lon });
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
      const data = await res.json();
      setDestination(data.display_name || `${lat.toFixed(4)}, ${lon.toFixed(4)}`);
    } catch (e) {
      setDestination(`${lat.toFixed(4)}, ${lon.toFixed(4)}`);
    }
    setSuggestions([]);
  };

  const getRouteData = async (start, end) => {
    try {
      const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson`);
      const data = await response.json();
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        setDistance(route.distance / 1000);
        const poly = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);
        setRoutePolyline(poly);
        return route.distance / 1000;
      }
      return 0;
    } catch (err) {
      return 0;
    }
  };

  const calculateTargetTime = () => {
    const now = new Date();
    let hours = parseInt(arrivalTime.hh);
    const minutes = parseInt(arrivalTime.mm) || 0;
    const seconds = parseInt(arrivalTime.ss) || 0;

    if (arrivalTime.ampm === 'PM' && hours < 12) hours += 12;
    if (arrivalTime.ampm === 'AM' && hours === 12) hours = 0;

    const target = new Date();
    target.setHours(hours, minutes, seconds, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target;
  };

  const handleStart = async () => {
    setError(null);
    setIsLoading(true);
    try {
      let finalDest = destCoords;
      if (!finalDest) {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(destination)}&limit=1`);
        const data = await res.json();
        if (data.length > 0) {
          finalDest = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
          setDestCoords(finalDest);
        } else {
          throw new Error("Address not found.");
        }
      }

      const target = calculateTargetTime();
      const dist = await getRouteData(currentPos, finalDest);
      if (dist === 0) throw new Error("Could not calculate route.");

      setIsActive(true);
      startTracking(finalDest, target);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const startTracking = (targetCoords, arrivalTarget) => {
    countdownTimer.current = setInterval(() => {
      const now = new Date();
      const diff = Math.max(0, (arrivalTarget.getTime() - now.getTime()) / 1000);
      setTimeLeft(diff);
      if (diff <= 0) handleStop();
    }, 1000);

    const refresh = async () => {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const nowPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setCurrentPos(nowPos);
        const dist = await getRouteData(nowPos, targetCoords);
        const remaining = (arrivalTarget.getTime() - new Date().getTime()) / 1000;
        if (remaining > 0) setRequiredSpeed(dist / (remaining / 3600));
      });

      const remaining = (arrivalTarget.getTime() - new Date().getTime()) / 1000;
      let next = 30;
      if (remaining <= 60) next = 1;
      else if (remaining <= 120) next = 3;
      else if (remaining <= 300) next = 5;

      setNextRefresh(next);
      refreshTimer.current = setTimeout(refresh, next * 1000);
    };

    refresh();
  };

  const handleStop = () => {
    setIsActive(false);
    clearTimeout(refreshTimer.current);
    clearInterval(countdownTimer.current);
  };

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="app-container">
      <AnimatePresence mode="wait">
        {!isActive ? (
          <motion.div key="setup" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="glass-card">
            <h1>DRIVING TIMER</h1>

            <div className="input-group">
              <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span><MapPin size={14} /> Destination</span>
                <button
                  onClick={() => setShowSetupMap(!showSetupMap)}
                  style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.7rem' }}
                >
                  {showSetupMap ? 'CLOSE MAP' : 'SELECT ON MAP'}
                </button>
              </label>

              <div className="suggestions-container">
                <input
                  type="text"
                  placeholder="Street, City, or Zip..."
                  value={destination}
                  onChange={(e) => { setDestination(e.target.value); setDestCoords(null); }}
                />
                {suggestions.length > 0 && (
                  <ul className="suggestions-list">
                    {suggestions.map((s, i) => (
                      <li key={i} className="suggestion-item" onClick={() => handleSuggestionClick(s)}>
                        {s.display_name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {showSetupMap && (
                <>
                  <div className="setup-map">
                    <MapContainer center={[currentPos.lat, currentPos.lon]} zoom={13} zoomControl={false} attributionControl={false} style={{ height: '100%' }}>
                      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                      <MapSelectionEvents onSelect={handleMapSelect} />
                      <MapUpdater center={[currentPos.lat, currentPos.lon]} />
                      {destCoords && <Marker position={[destCoords.lat, destCoords.lon]} />}
                    </MapContainer>
                  </div>
                  <p className="map-hint">Tap anywhere on the map to set destination</p>
                </>
              )}
            </div>

            <div className="input-group">
              <label><Clock size={14} /> Arrival Time</label>
              <div className="time-inputs">
                <input type="number" placeholder="HH" value={arrivalTime.hh} onChange={(e) => setArrivalTime({ ...arrivalTime, hh: e.target.value })} />
                <input type="number" placeholder="MM" value={arrivalTime.mm} onChange={(e) => setArrivalTime({ ...arrivalTime, mm: e.target.value })} />
                <input type="number" placeholder="SS" value={arrivalTime.ss} onChange={(e) => setArrivalTime({ ...arrivalTime, ss: e.target.value })} />
                <div className="ampm-toggle">
                  <button className={`ampm-btn ${arrivalTime.ampm === 'AM' ? 'active' : ''}`} onClick={() => setArrivalTime({ ...arrivalTime, ampm: 'AM' })}>AM</button>
                  <button className={`ampm-btn ${arrivalTime.ampm === 'PM' ? 'active' : ''}`} onClick={() => setArrivalTime({ ...arrivalTime, ampm: 'PM' })}>PM</button>
                </div>
              </div>
            </div>

            {error && <div style={{ color: 'var(--accent-red)', fontSize: '0.8rem' }}>{error}</div>}

            <button className="btn-primary" onClick={handleStart} disabled={isLoading || !destination || !arrivalTime.hh}>
              {isLoading ? 'CALCULATING...' : 'START TRIP'}
            </button>
          </motion.div>
        ) : (
          <motion.div key="tracking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card tracking-view">
            <div className="speed-display">
              <label>REQUIRED SPEED</label>
              <div className="speed-value">{requiredSpeed.toFixed(1)}</div>
              <div className="speed-unit">KM/H</div>
            </div>

            <div className="stats-grid">
              <div className="stat-item">
                <span className="stat-label">Arrival In</span>
                <span className="stat-value">{formatTime(timeLeft)}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Distance</span>
                <span className="stat-value">{distance.toFixed(1)} km</span>
              </div>
            </div>

            <div className="map-wrapper">
              <MapContainer center={[currentPos.lat, currentPos.lon]} zoom={13} zoomControl={false} attributionControl={false}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                {routePolyline.length > 0 && <Polyline positions={routePolyline} color="var(--primary)" weight={4} />}
                <Marker position={[currentPos.lat, currentPos.lon]} />
                {destCoords && <Marker position={[destCoords.lat, destCoords.lon]} />}
                <MapUpdater bounds={routePolyline.length > 0 ? L.polyline(routePolyline).getBounds() : null} />
              </MapContainer>
            </div>

            <div className="refresh-indicator">
              <div className="pulse"></div>
              Refreshing in {nextRefresh}s
            </div>

            <button className="btn-primary btn-stop" onClick={handleStop}>STOP TRACKING</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
