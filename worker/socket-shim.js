// Drop-in replacement for socket.io-client, speaking to the Cloudflare
// Worker's Hub Durable Object over a plain WebSocket. Supports the subset
// of the socket.io API that online.js actually uses:
//   io(url, { autoConnect: false }) -> socket
//   socket.connect() / socket.on(event, cb) / socket.once(event, cb) / socket.emit(event, data)
function io(url, opts) {
  opts = opts || {};
  const listeners = {};
  const wsUrl = url.replace(/^http/, 'ws') + '/ws';
  let ws = null;
  let queue = [];

  const socket = {
    on(event, cb) {
      (listeners[event] = listeners[event] || []).push(cb);
      return socket;
    },
    once(event, cb) {
      const wrapper = (data) => { socket.off(event, wrapper); cb(data); };
      return socket.on(event, wrapper);
    },
    off(event, cb) {
      if (listeners[event]) listeners[event] = listeners[event].filter(fn => fn !== cb);
      return socket;
    },
    emit(event, data) {
      const payload = JSON.stringify({ event, data: data || {} });
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(payload);
      else queue.push(payload);
      return socket;
    },
    connect() {
      ws = new WebSocket(wsUrl);
      ws.addEventListener('open', () => {
        queue.forEach(p => ws.send(p));
        queue = [];
        (listeners['connect'] || []).forEach(fn => fn());
      });
      ws.addEventListener('message', (msg) => {
        try {
          const { event, data } = JSON.parse(msg.data);
          (listeners[event] || []).forEach(fn => fn(data));
        } catch (e) { console.error('[socket-shim] bad message', e); }
      });
      ws.addEventListener('close', () => (listeners['disconnect'] || []).forEach(fn => fn()));
      ws.addEventListener('error', (e) => console.error('[socket-shim] ws error', e));
      return socket;
    },
    disconnect() {
      if (ws) ws.close();
      return socket;
    }
  };

  if (opts.autoConnect !== false) socket.connect();
  return socket;
}