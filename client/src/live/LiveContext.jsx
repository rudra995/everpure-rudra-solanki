// One Socket.IO connection for the whole app, opened after login.
//
// The server decides what each user receives (rooms per role), so this file just
// listens: 'alert' and 'alert:ack' for users with alert permissions, 'telemetry' for
// the replayed snapshots, and 'simulator:status' for the replay state.
// Every alert the server sends is kept; grouping happens only in the UI.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, tokenStore } from '../api/http.js';
import { useAuth, P } from '../auth/AuthContext.jsx';

const LiveContext = createContext(null);
const MAX_ALERTS = 1000;
const MAX_TELEMETRY = 40;

export function LiveProvider({ children }) {
  const { user, can } = useAuth();
  const [connected, setConnected] = useState(false);
  const [simulator, setSimulator] = useState(null);
  const [alerts, setAlerts] = useState([]);           // newest first
  const [received, setReceived] = useState(0);        // alerts received over the socket this session
  const [unseen, setUnseen] = useState(0);            // badge in the sidebar
  const [telemetry, setTelemetry] = useState([]);     // newest first
  const [toasts, setToasts] = useState([]);
  const [toastsOn, setToastsOn] = useState(true);
  const toastsOnRef = useRef(toastsOn);
  toastsOnRef.current = toastsOn;
  const socketRef = useRef(null);

  const receivesAlerts = can([P.ALERTS_READ_ALL, P.ALERTS_READ_OWN]);

  const dismissToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  useEffect(() => {
    if (!user) return undefined;

    // Load recent history first so the feed isn't empty on page open.
    if (receivesAlerts) {
      api.get('/api/alerts?limit=300').then((r) => setAlerts(r.alerts)).catch(() => {});
    }

    const socket = io({ auth: { token: tokenStore.get() }, transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on('welcome', (w) => setSimulator(w.simulator));
    socket.on('simulator:status', setSimulator);

    socket.on('telemetry', (t) => {
      setTelemetry((list) => [t, ...list].slice(0, MAX_TELEMETRY));
      setSimulator((s) => (s ? { ...s, last_seq: t.snapshot_seq, cycle: t.cycle } : s));
    });

    socket.on('alert', (a) => {
      setAlerts((list) => (list.some((x) => x.id === a.id) ? list : [{ ...a, fresh: true }, ...list].slice(0, MAX_ALERTS)));
      setReceived((n) => n + 1);
      setUnseen((n) => n + 1);
      if (a.severity === 'CRITICAL' && toastsOnRef.current) {
        const toast = { id: `${a.id}`, alert: a };
        setToasts((t) => [toast, ...t].slice(0, 2));
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== toast.id)), 5000);
      }
    });

    socket.on('alert:ack', (a) => setAlerts((list) => list.map((x) => (x.id === a.id ? { ...x, ...a } : x))));

    return () => {
      socket.close();
      socketRef.current = null;
      setConnected(false);
      setAlerts([]);
      setTelemetry([]);
      setReceived(0);
      setUnseen(0);
    };
  }, [user, receivesAlerts]);

  const acknowledge = useCallback(async (id) => {
    const { alert } = await api.post(`/api/alerts/${id}/ack`);
    setAlerts((list) => list.map((x) => (x.id === alert.id ? { ...x, ...alert } : x)));
  }, []);

  const value = {
    connected, simulator, setSimulator, alerts, received, unseen,
    clearUnseen: () => setUnseen(0),
    telemetry, acknowledge, receivesAlerts,
    toasts, dismissToast, toastsOn, setToastsOn,
  };
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export const useLive = () => useContext(LiveContext);
