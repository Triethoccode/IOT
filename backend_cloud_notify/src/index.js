/**
 * ENTRY POINT & PUBLIC API CHO PHẦN BACKEND CỦA PHONG (W18, W19-Phong, W21)
 *
 * Cách sử dụng:
 * 1. Chạy độc lập như một worker lắng nghe MQTT & cung cấp HTTP API lịch sử 24h cho Triết:
 *    `node src/index.js` (HTTP endpoint: GET http://localhost:3001/api/history/24h?device_id=esp32_01)
 * 2. Hoặc import trực tiếp vào Node-RED / Backend của Triết:
 *    `const { createAeroDryBackend } = require('./src/index');`
 */
const http = require('http');
const url = require('url');
const config = require('./config');
const { FirestoreService } = require('./firestoreService');
const { HistoryQueryService } = require('./historyQueryService');
const { NotificationService } = require('./notificationService');
const { AeroDryMqttWorker } = require('./mqttWorker');

function createAeroDryBackend(customConfig = {}, customDeps = {}) {
  const firestoreService =
    customDeps.firestoreService || new FirestoreService(customConfig, customDeps.db || null);
  const historyQueryService =
    customDeps.historyQueryService || new HistoryQueryService(firestoreService, customConfig);
  const notificationService =
    customDeps.notificationService ||
    new NotificationService(customConfig, customDeps.transports || {});
  const mqttWorker = new AeroDryMqttWorker({
    firestoreService,
    notificationService,
    historyQueryService,
    config: customConfig,
  });

  return {
    config: { ...config, ...customConfig },
    firestoreService,
    historyQueryService,
    notificationService,
    mqttWorker,
    // Hàm gọi nhanh cho W19 (Triết gọi để lấy dữ liệu vẽ biểu đồ 24h & bảng nhật ký)
    getHistory24h: (opts) => historyQueryService.getHistoryLast24Hours(opts),
  };
}

if (require.main === module) {
  const app = createAeroDryBackend();
  app.mqttWorker.startMqttSubscription();

  const port = Number(process.env.HISTORY_API_PORT || 3001);
  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (req.method === 'GET' && parsedUrl.pathname === '/api/history/24h') {
      try {
        const data = await app.getHistory24h({
          deviceId: parsedUrl.query.device_id || config.deviceId,
          hours: Number(parsedUrl.query.hours || 24),
        });
        res.writeHead(200);
        res.end(JSON.stringify(data, null, 2));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ ok: false, error: 'NOT_FOUND' }));
  });

  server.listen(port, () => {
    console.log(
      `[AeroDry-Backend] Dịch vụ W18 (Firestore), W19 (API Lịch sử 24h: http://localhost:${port}/api/history/24h) & W21 (PushSafer/SMTP) đang chạy.`
    );
  });
}

module.exports = {
  createAeroDryBackend,
  FirestoreService,
  HistoryQueryService,
  NotificationService,
  AeroDryMqttWorker,
};
