/* Embedded into ui_stitch_webapp by scripts/build-control-flow.js. */
(function(scope) {
  const state = { online: false, authenticated: false, pending: false, simulation: false,
    temperature: null, humidity: null, rain_percent: null, drying_seconds: 0,
    rack_state: null, fan_active: false, light_active: false, control_mode: 'AUTO', light_mode: 'AUTO' };
  const root = document.getElementById('aerodry-stitch-app');
  if (root && root.parentElement !== document.body) document.body.appendChild(root);
  const el = id => document.getElementById(id);
  const text = (id, value) => { if (el(id)) el(id).textContent = value; };
  let toastTimer, lastConnectionAt = 0;
  window.adShowToast = function(message) {
    text('ad-toast-msg', message);
    if (!el('ad-toast')) return;
    el('ad-toast').style.transform = 'translateY(0)'; el('ad-toast').style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (el('ad-toast')) el('ad-toast').style.opacity = '0'; }, 4000);
  };
  function theme() {
    const dark = localStorage.getItem('aerodry_theme') === 'dark';
    root.classList.toggle('dark-mode', dark);
    root.querySelectorAll('.ad-theme-icon').forEach(e => { e.textContent = dark ? 'dark_mode' : 'light_mode'; });
    root.querySelectorAll('.ad-theme-label').forEach(e => { e.textContent = dark ? 'Tối' : 'Sáng'; });
  }
  window.adToggleTheme = () => { localStorage.setItem('aerodry_theme', root.classList.contains('dark-mode') ? 'light' : 'dark'); theme(); };
  window.adTogglePw = () => { const p = el('ad-login-password'); p.type = p.type === 'password' ? 'text' : 'password'; };
  function send(topic, payload) { scope.send({ topic, payload }); }
  window.adHandleLogin = function(event) {
    if (event) event.preventDefault();
    send('login_action', { action: 'LOGIN', email: el('ad-login-email').value, password: el('ad-login-password').value });
    el('ad-login-password').value = '';
  };
  window.adLogout = () => { state.authenticated = false; render(); send('login_action', { action: 'LOGOUT' }); };
  function command(action, params = {}, confirmed = false) {
    if (!state.authenticated || !state.online || state.pending || state.simulation) {
      window.adShowToast(state.simulation ? 'Mô phỏng: điều khiển thiết bị thật đã khóa' : 'Thiết bị chưa sẵn sàng hoặc đang chờ phản hồi'); return;
    }
    state.pending = true; text('ad-command-status', 'Đang gửi — chờ thiết bị tiếp nhận'); render();
    send('device_command', { action, params, confirmed });
  }
  window.adControlRack = action => {
    if (action === 'RESET_TIMER') { if (window.confirm('Bắt đầu mẻ đồ mới? Lịch sử mẻ cũ được giữ.')) command('RESET_COUNTER', {}, true); }
    else command('SET_ROD', { target: action === 'EXTEND' ? 'EXTENDED' : 'RETRACTED' });
  };
  window.adToggleFan = () => command('SET_FAN', { state: state.fan_active ? 'OFF' : 'ON' });
  window.adToggleLight = () => command('SET_LIGHT', { mode: 'MANUAL', state: state.light_active ? 'OFF' : 'ON' });
  window.adSetLightAuto = () => command('SET_LIGHT', { mode: 'AUTO' });
  window.adToggleAutoMode = () => command('SET_MODE', { mode: state.control_mode === 'AUTO' ? 'MANUAL' : 'AUTO' });
  window.adToggleFastDry = () => command('SET_DEMO_CONFIG', { demo_fast_dry: !state.demo_fast_dry });
  window.adToggleSimMode = () => send('simulation_mode', !state.simulation);
  window.adSimulateWeather = type => {
    if (!state.simulation) return;
    const values = {
      SUNNY: [33.5, 58, 0, 'NANG_RAO'],
      HUMIDITY: [28.0, 88, 0, 'DO_AM_CAO'],
      SHOWER: [28.0, 88, 0, 'DO_AM_CAO'],
      HEAVY_RAIN: [26.0, 90, 82, 'MUA_RAO_LON']
    }[type];
    if (!values) return;
    send('aerodry/g21/sim/esp32_01/telemetry', {
      temp: values[0],
      hum: values[1],
      rain_pct: values[2],
      weather_type: values[3],
      rack_state: state.rack_state ?? 1,
      drying_sec: state.drying_seconds || 4200,
      mode: state.control_mode
    });
  };
  // History/export belongs to W19 UI; never export the old hard-coded sample CSV.
  window.adExportCSV = () => window.adShowToast('Xuất lịch sử cần nối dữ liệu W19 từ backend');
  function formatHms(seconds) {
    return [Math.floor(seconds/3600), Math.floor(seconds/60)%60, Math.floor(seconds)%60].map(n => String(n).padStart(2,'0')).join(':');
  }
  function render() {
    el('view-login').style.display = state.authenticated ? 'none' : 'flex';
    el('view-dashboard').style.display = state.authenticated ? 'block' : 'none';
    text('ad-connection', state.simulation ? 'MÔ PHỎNG — khóa tải thật' : state.online ? 'ONLINE' : 'OFFLINE / dữ liệu cũ');
    text('ad-last-seen', state.last_seen_ms ? new Date(state.last_seen_ms).toLocaleTimeString('vi-VN') : 'Chưa nhận heartbeat');
    text('ad-rssi-val', state.rssi ?? '—'); text('ad-ip-val', state.ip || '—');
    text('ad-temp-val', state.temperature == null ? '—' : Number(state.temperature).toFixed(1)+'°C');
    text('ad-hum-val', state.humidity == null ? '—' : state.humidity+'%');
    text('ad-rain-val', state.rain_percent == null ? '—' : state.rain_percent+'% · '+(state.rain_percent<15 ? 'Khô' : state.rain_percent<50 ? 'Đang ướt' : 'Ướt nhiều'));
    if (el('ad-rain-bar')) el('ad-rain-bar').style.width = (state.rain_percent || 0)+'%';
    for (const [id, value, max, length] of [['ad-rssi-arc',state.rssi == null ? null : state.rssi+100,70,251.3],['ad-temp-arc',state.temperature,50,188.5],['ad-hum-arc',state.humidity,100,188.5]]) {
      if (el(id)) el(id).setAttribute('stroke-dashoffset', length * (1 - Math.max(0, Math.min(1, (value || 0)/max))));
    }
    text('ad-weather-badge', state.simulation ? 'Dữ liệu mô phỏng' : state.temperature == null ? 'Dữ liệu cảm biến chưa hợp lệ' : state.weather_type === 'BAN_DEM' ? 'Tối / ẩm cao' : state.rain_percent>=30 ? 'Cảm biến báo ướt' : 'Theo dõi môi trường');
    text('ad-rack-badge', state.rack_state == null ? 'Chưa có trạng thái' : state.rack_state===1 ? 'Yêu cầu phơi (90°)' : 'Yêu cầu thu (0°)');
    text('ad-timer-clock', formatHms(state.drying_seconds));
    text('ad-ext-time', state.extended_at || '—'); text('ad-ret-time', state.retracted_at || '—');
    text('ad-auto-label', state.control_mode === 'AUTO' ? 'Tự động' : 'Thủ công');
    text('ad-sim-label', state.simulation ? 'Đang bật' : 'Đang tắt');
    text('ad-fan-label', state.fan_active ? 'Đang bật' : 'Đang tắt');
    text('ad-light-label', (state.light_active ? 'Đang bật' : 'Đang tắt')+' · '+state.light_mode);
    text('ad-fast-dry-label', state.demo_fast_dry ? 'Demo: chờ khô 10 giây' : 'Chuẩn: chờ khô 180 giây');
    for (const [id, on] of [['ad-sw-auto',state.control_mode==='AUTO'],['ad-sw-sim',state.simulation],['ad-sw-fan',state.fan_active],['ad-sw-light',state.light_active]]) el(id)?.classList.toggle('on',on);
    el('ad-fan-icon')?.classList.toggle('spin',state.fan_active);
    const locked = !state.authenticated || !state.online || state.pending || state.simulation;
    root.querySelectorAll('[data-device-control]').forEach(e => {
      e.disabled = locked; e.setAttribute('aria-disabled',String(locked)); e.style.pointerEvents = locked ? 'none' : ''; e.style.opacity = locked ? '0.45' : '';
    });
    if (el('ad-sim-panel')) { el('ad-sim-panel').style.opacity = state.simulation ? '1' : '0.4'; el('ad-sim-panel').style.pointerEvents = state.simulation ? 'auto' : 'none'; }
    text('ad-advice-text', state.simulation ? 'Mô phỏng giao diện, không tác động thiết bị thật' : !state.online ? 'Thiết bị Offline. Trạng thái cuối có thể đã cũ.' : 'Vị trí hiển thị là yêu cầu điều khiển; servo không có cảm biến phản hồi.');
  }
  scope.$watch('msg', function(msg) {
    if (!msg?.payload || typeof msg.payload !== 'object') return;
    const p = msg.payload;
    if (p.kind === 'auth') {
      state.authenticated = p.ok === true;
      if (!p.ok) { state.simulation = false; window.adShowToast(p.reason === 'LOGGED_OUT' ? 'Đã đăng xuất' : 'Không đăng nhập được: '+p.reason); }
    } else if (p.kind === 'simulation') {
      state.simulation = p.enabled;
      state.temperature = state.humidity = state.rain_percent = state.rack_state = null;
      state.drying_seconds = 0;
    } else if (p.kind === 'connection') {
      lastConnectionAt = Date.now();
      Object.assign(state, { online: p.online, last_seen_ms: p.last_seen_ms, rssi: p.rssi, ip: p.ip });
      if (!p.online) state.pending = false;
    } else if (p.kind === 'command_result') {
      state.pending = p.status === 'PENDING';
      if (p.reason === 'UNAUTHENTICATED') state.authenticated = false;
      text('ad-command-status', p.status === 'PENDING' ? 'Đang gửi — chờ phản hồi' : p.status === 'ACCEPTED' ? 'Thiết bị đã tiếp nhận lệnh' : p.status+': '+p.reason);
      if (p.status === 'ACCEPTED' && p.resulting_state) {
        const a = p.resulting_state;
        Object.assign(state, { rack_state: a.rod_state==='EXTENDED' ? 1 : 0, fan_active: a.fan_state==='ON',
          light_active: a.light_state==='ON', light_mode: a.light_mode, control_mode: a.control_mode,
          drying_seconds: a.total_drying_sec, demo_fast_dry: a.demo_fast_dry });
      }
    } else if ('temperature' in p && Boolean(p.is_simulation) === state.simulation) {
      Object.assign(state,p);
    }
    render();
  });
  // No invented timer increments while disconnected: display ESP32's reported total.
  const init = setTimeout(() => { theme(); render(); },30);
  // Covers losing the browser-to-Node-RED connection itself, not only ESP32 MQTT.
  const watchdog = setInterval(() => {
    if (state.online && Date.now() - lastConnectionAt > 5000) { state.online = false; state.pending = false; render(); }
  },1000);
  scope.$on('$destroy', () => { clearInterval(watchdog); clearTimeout(init); clearTimeout(toastTimer); root?.remove(); });
})(scope);
