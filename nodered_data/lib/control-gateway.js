'use strict';

const crypto = require('node:crypto');

// W17: single owner of pending commands and device liveness. No command retries.
class ControlGateway {
  constructor({ deviceId = 'esp32_01', groupId = 'G21_24C11', offlineMs = 25000,
    ackMs = 5000, sessionMs = 3600000, email = '', passwordHash = '',
    verifyIdentity, id = () => `CMD_${crypto.randomUUID()}` } = {}) {
    Object.assign(this, { deviceId, groupId, offlineMs, ackMs, sessionMs, email, passwordHash, id });
    this.verifyIdentity = verifyIdentity || ((user, password) => {
      // Local adapter for integration. Triet can replace with verified Firebase identity.
      if (!email || !passwordHash || user !== email || typeof password !== 'string' || password.length > 256) return false;
      const [salt, expected] = passwordHash.split(':');
      if (!/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(expected || '')) return false;
      return crypto.timingSafeEqual(crypto.scryptSync(password, salt, 64), Buffer.from(expected, 'hex'));
    });
    this.reset();
  }

  reset() {
    this.sessions = new Map();
    this.loginAttempts = new Map();
    this.pending = null;
    this.device = { online: false, lastSeen: 0, bootId: null, connectionId: null, rssi: null, ip: null };
    this.brokerOnline = false;
  }

  connection(now) {
    return { kind: 'connection', device_id: this.deviceId,
      online: this.brokerOnline && this.device.online && now - this.device.lastSeen < this.offlineMs,
      last_seen_ms: this.device.lastSeen || null, rssi: this.device.rssi, ip: this.device.ip };
  }

  result(status, reason, socketid, extra = {}) {
    return { socketid, payload: { kind: 'command_result', status, reason, ...extra } };
  }

  tick(now) {
    const messages = [];
    for (const [socket, session] of this.sessions) if (now >= session.expires) this.sessions.delete(socket);
    for (const [socket, attempt] of this.loginAttempts) if (now - attempt.started >= 60000) this.loginAttempts.delete(socket);
    if (!this.connection(now).online) this.device.online = false;
    if (this.pending && (now >= this.pending.deadline || !this.connection(now).online)) {
      const p = this.pending;
      this.pending = null;
      messages.push(this.result('TIMEOUT', this.connection(now).online ? 'ACK_TIMEOUT' : 'DEVICE_OFFLINE', p.socketid, { cmd_id: p.cmd_id }));
    }
    return messages;
  }

  login(msg, now) {
    const socket = msg.socketid;
    if (!socket) return { payload: { kind: 'auth', ok: false, reason: 'MISSING_SESSION' } };
    if (msg.payload?.action === 'LOGOUT') {
      this.sessions.delete(socket);
      return { socketid: socket, payload: { kind: 'auth', ok: false, reason: 'LOGGED_OUT' } };
    }
    let attempts = this.loginAttempts.get(socket);
    if (!attempts || now - attempts.started >= 60000) attempts = { started: now, count: 0 };
    this.loginAttempts.set(socket, attempts);
    if (++attempts.count > 5) return { socketid: socket, payload: { kind: 'auth', ok: false, reason: 'LOGIN_RATE_LIMIT' } };
    const p = msg.payload || {};
    const ok = this.verifyIdentity(p.email, p.password) === true;
    this.sessions.delete(socket);
    if (ok) this.sessions.set(socket, { expires: now + this.sessionMs, simulation: false });
    return { socketid: socket, payload: { kind: 'auth', ok, reason: ok ? 'OK' : 'INVALID_CREDENTIALS' } };
  }

  heartbeat(msg, now) {
    let p;
    try { p = typeof msg.payload === 'string' ? JSON.parse(msg.payload) : msg.payload; } catch { return false; }
    if (!p || p.device_id !== this.deviceId || p.group_id !== this.groupId || p.is_simulation === true) return false;
    if (p.status === 'OFFLINE') {
      if (p.boot_id === this.device.bootId && p.connection_id === this.device.connectionId) this.device.online = false;
      return true;
    }
    // Retained ONLINE is historical; wait for a live heartbeat after every deploy/reconnect.
    if (msg.retain === true || !this.brokerOnline || p.status !== 'ONLINE' || typeof p.boot_id !== 'string' || !Number.isInteger(p.connection_id)) return false;
    if (p.time_synced && (!Number.isFinite(p.timestamp) || Math.abs(now / 1000 - p.timestamp) > 30)) return false;
    if (this.device.bootId && (p.boot_id !== this.device.bootId || p.connection_id !== this.device.connectionId) && this.pending) {
      this.pending.deadline = now; // A reboot invalidates an in-flight command.
    }
    this.device = { online: true, lastSeen: now, bootId: p.boot_id, connectionId: p.connection_id, rssi: p.rssi, ip: p.ip };
    return true;
  }

  normalize(msg) {
    const p = msg.payload;
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw Error('INVALID_COMMAND');
    let action = p.action, params = p.params || {};
    if (['EXTEND', 'RETRACT'].includes(action)) {
      params = { target: action === 'EXTEND' ? 'EXTENDED' : 'RETRACTED' }; action = 'SET_ROD';
    } else if (action === 'RESET_TIMER') action = 'RESET_COUNTER';
    else if (!action && p.mode !== undefined) { action = 'SET_MODE'; params = { mode: p.mode }; }
    else if (!action && p.fan !== undefined) { action = 'SET_FAN'; params = { state: p.fan === true ? 'ON' : p.fan === false ? 'OFF' : null }; }
    else if (!action && (p.light !== undefined || p.light_mode !== undefined)) {
      action = 'SET_LIGHT'; params = { mode: p.light_mode || 'MANUAL', state: p.light === true ? 'ON' : p.light === false ? 'OFF' : undefined };
    }
    let valid = false;
    switch (action) {
      case 'SET_ROD': valid = ['EXTENDED', 'RETRACTED'].includes(params.target); params = { target: params.target }; break;
      case 'SET_MODE': valid = ['AUTO', 'MANUAL'].includes(params.mode); params = { mode: params.mode }; break;
      case 'SET_FAN': valid = ['ON', 'OFF'].includes(params.state); params = { state: params.state }; break;
      case 'SET_LIGHT': valid = ['AUTO', 'MANUAL'].includes(params.mode) && (params.mode === 'AUTO' || ['ON', 'OFF'].includes(params.state)); params = { mode: params.mode, state: params.state }; break;
      case 'SET_DEMO_CONFIG': valid = typeof params.demo_fast_dry === 'boolean'; params = { demo_fast_dry: params.demo_fast_dry }; break;
      case 'RESET_COUNTER': valid = p.confirmed === true; params = {}; break;
    }
    if (!valid) throw Error(action === 'RESET_COUNTER' ? 'RESET_CONFIRMATION_REQUIRED' : 'INVALID_COMMAND');
    return { action, params };
  }

  command(msg, now) {
    const deny = reason => ({ feedback: this.result('REJECTED', reason, msg.socketid) });
    const session = this.sessions.get(msg.socketid);
    if (!session || now >= session.expires) return deny('UNAUTHENTICATED');
    if (session.simulation || msg.payload?.is_simulation === true || msg.topic?.includes('/sim/')) return deny('SIMULATION_ISOLATED');
    if (!this.connection(now).online) return deny('DEVICE_OFFLINE');
    if (this.pending) return deny('COMMAND_PENDING');
    let command;
    try { command = this.normalize(msg); } catch (e) { return deny(e.message); }
    const cmd_id = this.id();
    const packet = { ...command, cmd_id, device_id: this.deviceId, boot_id: this.device.bootId,
      connection_id: this.device.connectionId, issued_at: Math.floor(now / 1000), ttl_sec: 5 };
    this.pending = { cmd_id, socketid: msg.socketid, deadline: now + this.ackMs, boot_id: this.device.bootId, connection_id: this.device.connectionId };
    return { mqtt: { topic: `aerodry/g21/${this.deviceId}/cmd`, payload: JSON.stringify(packet), qos: '0', retain: false },
      feedback: this.result('PENDING', 'WAITING_ACK', msg.socketid, { cmd_id }) };
  }

  ack(msg, now) {
    let p;
    try { p = typeof msg.payload === 'string' ? JSON.parse(msg.payload) : msg.payload; } catch { return null; }
    const pending = this.pending;
    if (msg.retain === true || !pending || now >= pending.deadline || !this.connection(now).online ||
      !p || p.device_id !== this.deviceId || p.boot_id !== pending.boot_id || p.connection_id !== pending.connection_id || p.cmd_id !== pending.cmd_id ||
      !['ACCEPTED', 'REJECTED', 'EXPIRED'].includes(p.status)) return null;
    this.pending = null;
    return this.result(p.status, p.reason, pending.socketid, { cmd_id: p.cmd_id, resulting_state: p.resulting_state });
  }
}

module.exports = { ControlGateway };
