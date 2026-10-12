// In-process event bus. The simulator and alert engine publish here; the Socket.IO layer
// subscribes and decides who receives what. Keeps business logic free of transport code.
import { EventEmitter } from 'node:events';

export const bus = new EventEmitter();
bus.setMaxListeners(50);

// Event names (also documented in docs/api_spec.md):
export const EVENTS = {
  TELEMETRY: 'telemetry',        // one replayed snapshot
  ALERT: 'alert',                // a rule fired
  ALERT_ACK: 'alert:ack',        // someone acknowledged an alert
  SIMULATOR: 'simulator:status', // simulator started / stopped / cycled
};
