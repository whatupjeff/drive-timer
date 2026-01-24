import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Clock, Navigation, RotateCw, StopCircle, Play } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import './App.css';

// Constants for the refresh intervals (in seconds)
const REFRESH_LEVELS = [
  { threshold: 300, interval: 5 },  // Last 5 minutes -> 5s
  { threshold: 120, interval: 3 },  // Last 2 minutes -> 3s
  { threshold: 60, interval: 1 },   // Last 1 minute -> 1s
  { threshold: 0, interval: 30 },   // Default -> 30s
];

function App() {
  const [isActive, setIsActive] = useState(false);
  const [destination, setDestination] = useState('');
  const [arrivalTime, setArrivalTime] = useState({ hh: '', mm: '', ss: '' });
  const [currentPos, setCurrentPos] = useState(null);
  const [destCoords, setDestCoords] = useState(null);
  const [distance, setDistance] = useState(0); // in km
  const [requiredSpeed, setRequiredSpeed] = useState(0); // in km/h
  const [timeLeft, setTimeLeft] = useState(0); // in seconds
  const [nextRefresh, setNextRefresh] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const watchId = useRef(null);
  const refreshTimer = useRef(null);
  const countdownTimer = useRef(null);

  // Get current position on mount
  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setCurrentPos({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        (err) => setError("Geolocation access denied. Please enable location services.")
      );
    } else {
      setError("Geolocation is not supported by your browser.");
    }

    return () => {
      if (watchId.current) navigator.geolocation.clearWatch(watchId.current);
      clearInterval(refreshTimer.current);
      clearInterval(countdownTimer.current);
    };
  }, []);

  const geocodeAddress = async (address) => {
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`);
      const data = await response.json();
      if (data && data.length > 0) {
        return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
      }
      throw new Error("Address not found.");
    } catch (err) {
      throw err;
    }
  };

  const getRoutingDistance = async (start, end) => {
    try {
      // Using OSRM Public API
      const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${start.lon},${start.lat};${end.lon},${end.lat}?overview=false`);
      const data = await response.json();
      if (data.routes && data.routes.length > 0) {
        return data.routes[0].distance / 1000; // convert meters to km
      }
      // Fallback to Haversine
      return calculateHaversine(start.lat, start.lon, end.lat, end.lon);
    } catch (err) {
      return calculateHaversine(start.lat, start.lon, end.lat, end.lon);
    }
  };

  const calculateHaversine = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  const handleStart = async () => {
    setError(null);
    setIsLoading(true);
    try {
      const coords = await geocodeAddress(destination);
      setDestCoords(coords);

      const now = new Date();
      const target = new Date();
      target.setHours(parseInt(arrivalTime.hh), parseInt(arrivalTime.mm), parseInt(arrivalTime.ss));
      
      // If target time is earlier than now, assume it's tomorrow
      if (target <= now) {
        target.setDate(target.getDate() + 1);
      }

      const diff = Math.max(0, (target.getTime() - now.getTime()) / 1000);
      setTimeLeft(diff);

      // Initial calculation
      await refreshData(coords, diff);

      setIsActive(true);
      startTracking(coords, target);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshData = async (targetCoords, currentRemainingTime) => {
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const start = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      setCurrentPos(start);
      
      const dist = await getRoutingDistance(start, targetCoords);
      setDistance(dist);

      const hoursLeft = currentRemainingTime / 3600;
      if (hoursLeft > 0) {
        setRequiredSpeed(dist / hoursLeft);
      } else {
        setRequiredSpeed(0);
      }
    });
  };

  const startTracking = (targetCoords, arrivalTarget) => {
    // 1. Precise Countdown Timer (1s)
    countdownTimer.current = setInterval(() => {
      const now = new Date();
      const diff = Math.max(0, (arrivalTarget.getTime() - now.getTime()) / 1000);
      setTimeLeft(diff);
      
      if (diff <= 0) {
        handleStop();
      }
    }, 1000);

    // 2. Dynamic Refresh Logic
    const scheduleNextRefresh = () => {
      const remaining = (arrivalTarget.getTime() - new Date().getTime()) / 1000;
      
      let interval = 30; // default
      if (remaining <= 60) interval = 1;
      else if (remaining <= 120) interval = 3;
      else if (remaining <= 300) interval = 5;

      setNextRefresh(interval);

      refreshTimer.current = setTimeout(async () => {
        await refreshData(targetCoords, remaining);
        scheduleNextRefresh();
      }, interval * 1000);
    };

    scheduleNextRefresh();
  };

  const handleStop = () => {
    setIsActive(false);
    clearInterval(refreshTimer.current);
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
          <motion.div 
            key="setup"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            className="glass-card"
          >
            <div className="header">
              <h1>DRIVING TIMER</h1>
              <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                Arrive exactly when you want.
              </p>
            </div>

            <div className="input-group">
              <label><MapPin size={14} style={{ marginRight: 6 }} /> Destination</label>
              <input 
                type="text" 
                placeholder="Enter address..." 
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              />
            </div>

            <div className="input-group">
              <label><Clock size={14} style={{ marginRight: 6 }} /> Arrival Time</label>
              <div className="time-inputs">
                <input 
                  type="number" placeholder="HH" maxLength="2"
                  value={arrivalTime.hh}
                  onChange={(e) => setArrivalTime({ ...arrivalTime, hh: e.target.value })}
                />
                <input 
                  type="number" placeholder="MM" maxLength="2"
                  value={arrivalTime.mm}
                  onChange={(e) => setArrivalTime({ ...arrivalTime, mm: e.target.value })}
                />
                <input 
                  type="number" placeholder="SS" maxLength="2"
                  value={arrivalTime.ss}
                  onChange={(e) => setArrivalTime({ ...arrivalTime, ss: e.target.value })}
                />
              </div>
            </div>

            {error && <p style={{ color: 'var(--accent-red)', fontSize: '0.85rem' }}>{error}</p>}

            <button 
              className="btn-primary" 
              onClick={handleStart}
              disabled={isLoading || !destination || !arrivalTime.hh}
            >
              {isLoading ? 'CALCULATING...' : 'START TRIP'}
              <Play size={18} style={{ marginLeft: 8, verticalAlign: 'middle' }} />
            </button>
          </motion.div>
        ) : (
          <motion.div 
            key="tracking"
            initial={{ opacity: 0, scale: 1.1 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="glass-card tracking-view"
          >
            <div className="header">
              <label>REQUIRED SPEED</label>
              <div className="speed-display">
                <div className="speed-value">{requiredSpeed.toFixed(1)}</div>
                <div className="speed-unit">KM/H</div>
              </div>
            </div>

            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-label">Remaining Time</div>
                <div className="stat-value">{formatTime(timeLeft)}</div>
              </div>
              <div className="stat-item">
                <div className="stat-label">Distance</div>
                <div className="stat-value">{distance.toFixed(2)} km</div>
              </div>
            </div>

            <div className="refresh-indicator">
              <div className="pulse"></div>
              Refreshing in {nextRefresh}s
            </div>

            <button className="btn-primary btn-stop" onClick={handleStop}>
              <StopCircle size={18} style={{ marginRight: 8, verticalAlign: 'middle' }} />
              STOP TRIP
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
