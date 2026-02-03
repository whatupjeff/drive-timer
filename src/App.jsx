import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Clock, Navigation, RotateCw, StopCircle, Play, Search, Map as MapIcon, Star, History, Settings } from 'lucide-react';
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
  const [currentAddress, setCurrentAddress] = useState('');
  const [destCoords, setDestCoords] = useState(null);
  const [routePolyline, setRoutePolyline] = useState([]);

  // Units: 'imperial' (miles) or 'metric' (km)
  const [units, setUnits] = useState('imperial');

  const [distance, setDistance] = useState(0); // Always in km
  const [requiredSpeed, setRequiredSpeed] = useState(0); // Always in km/h
  const [timeLeft, setTimeLeft] = useState(0);
  const [nextRefresh, setNextRefresh] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showSetupMap, setShowSetupMap] = useState(false);

  // History State
  const [savedDestinations, setSavedDestinations] = useState([]);
  const [recentDestinations, setRecentDestinations] = useState([]);

  const watchId = useRef(null);
  const refreshTimer = useRef(null);
  const countdownTimer = useRef(null);
  const suggestionTimeout = useRef(null);
  const arrivalTargetRef = useRef(null); // Ref to hold target time for async callbacks

  // Initialize Data
  useEffect(() => {
    // 1. Get Location & Reverse Geocode
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          setCurrentPos({ lat, lon });

          try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
            const data = await res.json();
            const addr = data.address;
            const shortAddr = [addr.house_number, addr.road, addr.city || addr.town].filter(Boolean).join(' ');
            setCurrentAddress(shortAddr || "Current Location Detected");
          } catch (e) {
            setCurrentAddress("Current Location Detected");
          }
        },
        (err) => console.log("Using default location.")
      );
    }

    // 2. Smart Time Prepopulation (Next Hour + 5s)
    const now = new Date();
    // Move to next hour
    now.setHours(now.getHours() + 1);
    now.setMinutes(0);
    now.setSeconds(5);

    let hours = now.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'

    setArrivalTime({
      hh: hours.toString(),
      mm: '00',
      ss: '05',
      ampm: ampm
    });

    // 3. Load History
    const saved = localStorage.getItem('driveTimer_saved');
    const recent = localStorage.getItem('driveTimer_recent');
    const savedUnits = localStorage.getItem('driveTimer_units');
    if (saved) setSavedDestinations(JSON.parse(saved));
    if (recent) setRecentDestinations(JSON.parse(recent));
    if (savedUnits) setUnits(savedUnits);

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

  const toggleUnits = () => {
    const newUnits = units === 'imperial' ? 'metric' : 'imperial';
    setUnits(newUnits);
    localStorage.setItem('driveTimer_units', newUnits);
  };

  const getDistanceDisplay = (km) => {
    if (units === 'imperial') {
      return (km * 0.621371).toFixed(1) + ' mi';
    }
    return km.toFixed(1) + ' km';
  };

  const getSpeedDisplay = (kmh) => {
    if (units === 'imperial') {
      return { val: (kmh * 0.621371).toFixed(1), unit: 'MPH' };
    }
    return { val: kmh.toFixed(1), unit: 'KM/H' };
  };

  const addToRecent = (name, coords) => {
    const newItem = { name, coords, id: Date.now() };
    // Remove if duplicate name
    const filtered = recentDestinations.filter(i => i.name !== name);
    const updated = [newItem, ...filtered].slice(0, 5); // Keep top 5
    setRecentDestinations(updated);
    localStorage.setItem('driveTimer_recent', JSON.stringify(updated));
  };

  const saveDestination = () => {
    if (!destination || !destCoords) return;
    const newItem = { name: destination, coords: destCoords, id: Date.now() };
    const updated = [...savedDestinations, newItem];
    setSavedDestinations(updated);
    localStorage.setItem('driveTimer_saved', JSON.stringify(updated));
  };

  const removeSaved = (e, id) => {
    e.stopPropagation();
    const updated = savedDestinations.filter(i => i.id !== id);
    setSavedDestinations(updated);
    localStorage.setItem('driveTimer_saved', JSON.stringify(updated));
  };

  const loadHistoryItem = (item) => {
    setDestination(item.name);
    setDestCoords(item.coords);
    setShowSetupMap(false);
  };

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

    // If target is in the past (e.g. it's 11:50PM and user sets 12:05AM), add a day.
    // The previous simple check (target <= now) works for same day past, but for transition to tomorrow:
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
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

      // Save to recent
      addToRecent(destination, finalDest);

      const target = calculateTargetTime();
      arrivalTargetRef.current = target; // Store in ref for async access

      const dist = await getRouteData(currentPos, finalDest);
      // dist is handled in getRouteData, fallback is 0 if error.
      // We allow starting even if dist is 0, user might just want the timer.

      // Initial speed calculation
      const now = new Date();
      const diff = Math.max(0, (target.getTime() - now.getTime()) / 1000);
      setTimeLeft(diff);

      if (diff > 0 && dist > 0) {
        setRequiredSpeed(dist / (diff / 3600));
      }

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

        const now = new Date();
        const remainingSeconds = (arrivalTarget.getTime() - now.getTime()) / 1000;

        if (remainingSeconds > 0 && dist > 0) {
          const speedKmh = dist / (remainingSeconds / 3600);
          setRequiredSpeed(speedKmh);
        } else {
          setRequiredSpeed(0);
        }
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
            <div style={{ position: 'relative' }}>
              <h1>DRIVING TIMER</h1>
              <div
                className="unit-toggle"
                onClick={toggleUnits}
              >
                <div className={`unit-option ${units === 'imperial' ? 'active' : ''}`}>mi</div>
                <div className={`unit-option ${units === 'metric' ? 'active' : ''}`}>km</div>
              </div>
            </div>

            {currentAddress && (
              <div className="current-location-display">
                <MapPin size={12} className="icon-pulse" />
                <span>{currentAddress}</span>
              </div>
            )}

            <div className="input-group">
              <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Destination</span>
                <button
                  onClick={() => setShowSetupMap(!showSetupMap)}
                  style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.7rem' }}
                >
                  {showSetupMap ? 'CLOSE MAP' : 'SELECT ON MAP'}
                </button>
              </label>

              <div className="destination-row">
                <div style={{ position: 'relative', flex: 1 }}>
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
                </div>
                <button
                  className="save-btn"
                  onClick={saveDestination}
                  title="Save Destination"
                  disabled={!destination || !destCoords}
                >
                  <Star size={18} />
                </button>
              </div>

              {(savedDestinations.length > 0 || recentDestinations.length > 0) && (
                <div className="history-pills">
                  {savedDestinations.map(item => (
                    <div key={item.id} className="history-pill saved" onClick={() => loadHistoryItem(item)}>
                      <Star size={10} fill="currentColor" />
                      <span>{item.name.split(',')[0]}</span>
                      <span className="remove-pill" onClick={(e) => removeSaved(e, item.id)}>×</span>
                    </div>
                  ))}
                  {recentDestinations.map(item => (
                    <div key={item.id} className="history-pill recent" onClick={() => loadHistoryItem(item)}>
                      <History size={10} />
                      <span>{item.name.split(',')[0]}</span>
                    </div>
                  ))}
                </div>
              )}

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
              <div className="speed-value">{getSpeedDisplay(requiredSpeed).val}</div>
              <div className="speed-unit">{getSpeedDisplay(requiredSpeed).unit}</div>
            </div>

            <div className="stats-grid">
              <div className="stat-item">
                <span className="stat-label">Arrival In</span>
                <span className="stat-value">{formatTime(timeLeft)}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Distance</span>
                <span className="stat-value">{getDistanceDisplay(distance)}</span>
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
