/**
 * WORKER KẾT NỐI MQTT TỪ ESP32 -> LƯU FIRESTORE (W18) & GỬI CẢNH BÁO PUSHSAFER/EMAIL (W21)
 * Phụ trách: Tạ Bỉnh Phong (24127100)
 */
const defaultConfig = require('./config');

class AeroDryMqttWorker {
  constructor({ firestoreService, notificationService, historyQueryService, config = {} }) {
    this.firestoreService = firestoreService;
    this.notificationService = notificationService;
    this.historyQueryService = historyQueryService;
    this.config = { ...defaultConfig, ...config };
    this.client = null;
  }

  /**
   * Xử lý một bản tin MQTT nhận được từ ESP32 (hỗ trợ gọi trực tiếp từ Node-RED hoặc MQTT client)
   */
  async routeIncomingMqttPacket(topic, rawPayload, nowMs = Date.now()) {
    let payload = rawPayload;
    if (typeof rawPayload === 'string' || Buffer.isBuffer(rawPayload)) {
      try {
        payload = JSON.parse(rawPayload.toString('utf8'));
      } catch (err) {
        return { ok: false, error: 'INVALID_JSON', topic };
      }
    }

    // Tuyệt đối cách ly nhánh Simulation Mode (`aerodry/g21/sim/...` hoặc `is_simulation: true`)
    if (topic.includes('/sim/') || payload.is_simulation === true) {
      return { ok: true, skipped: true, reason: 'SIMULATION_MODE_ISOLATED', topic };
    }

    if (topic.endsWith('/telemetry')) {
      const res = await this.firestoreService.handleTelemetry(payload, nowMs);
      return { ok: true, type: 'TELEMETRY', ...res };
    }

    if (topic.endsWith('/session')) {
      const res = await this.firestoreService.handleSessionPacket(payload, nowMs);
      return { ok: true, type: 'SESSION', ...res };
    }

    if (topic.endsWith('/event') || topic.endsWith('/emergency')) {
      // Hỗ trợ chuẩn hóa cả gói alert rút gọn (type, message) và gói event đầy đủ
      if (!payload.event_code && payload.type) {
        payload.event_code =
          payload.type === 'RAIN_DETECTED' ? 'AUTO_RAIN_RETRACT' : payload.type;
      }
      // 1. Gửi cảnh báo PushSafer & Email SMTP (W21 - có chống gửi trùng & retry)
      const notifyRes = await this.notificationService.processAlertEvent(payload, nowMs);
      // 2. Lưu sự kiện kèm kết quả gửi thông báo vào Firestore (W18)
      const storeRes = await this.firestoreService.handleAlertEvent(payload, notifyRes, nowMs);
      return { ok: true, type: 'EVENT', notification: notifyRes, firestore: storeRes };
    }

    return { ok: true, type: 'IGNORED_TOPIC', topic };
  }

  /**
   * Kết nối trực tiếp tới MQTT Broker khi chạy độc lập bằng Node.js
   */
  startMqttSubscription() {
    const mqtt = require('mqtt');
    const prefix = this.config.mqtt.topicPrefix;
    this.client = mqtt.connect(this.config.mqtt.brokerUrl, {
      username: this.config.mqtt.username || undefined,
      password: this.config.mqtt.password || undefined,
    });

    this.client.on('connect', () => {
      const topics = [`${prefix}/telemetry`, `${prefix}/session`, `${prefix}/event`];
      this.client.subscribe(topics, { qos: 0 });
      console.log(`[AeroDry-Worker] Đã kết nối MQTT & đăng ký nhận:`, topics);
    });

    this.client.on('message', async (topic, message) => {
      try {
        await this.routeIncomingMqttPacket(topic, message);
      } catch (err) {
        console.error(`[AeroDry-Worker] Lỗi xử lý bản tin trên topic ${topic}:`, err.message);
      }
    });

    return this.client;
  }
}

module.exports = { AeroDryMqttWorker };
