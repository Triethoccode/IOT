/**
 * Cấu hình trung tâm cho phần Backend của Phong (W18, W19-Phong, W21)
 */
try {
  require('dotenv').config();
} catch (_) {
  // Cho phép chạy độc lập kể cả khi chưa cài gói dotenv
}

module.exports = {
  groupId: process.env.GROUP_ID || 'G21_24C11',
  deviceId: process.env.DEVICE_ID || 'esp32_01',

  mqtt: {
    brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://broker.hivemq.com:1883',
    username: process.env.MQTT_USERNAME || '',
    password: process.env.MQTT_PASSWORD || '',
    topicPrefix: `aerodry/g21/${process.env.DEVICE_ID || 'esp32_01'}`,
  },

  firestore: {
    serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './serviceAccountKey.json',
    projectId: process.env.FIREBASE_PROJECT_ID || 'aerodry-iot-g21',
    // Mục 3.7: Mẫu cảm biến lưu định kỳ dự kiến mỗi 60 giây (60000 ms), độc lập với chu kỳ 2.5s của web
    sampleSaveIntervalMs: Number(process.env.SENSOR_SAMPLE_SAVE_INTERVAL_MS || 60000),
    collections: {
      devices: 'devices',
      sensorSamples: 'sensor_samples',
      batches: 'batches',
      dryingSessions: 'drying_sessions',
      events: 'events',
    },
  },

  pushsafer: {
    apiUrl: 'https://www.pushsafer.com/api',
    privateKey: process.env.PUSHSAFER_PRIVATE_KEY || '',
    deviceId: process.env.PUSHSAFER_DEVICE_ID || 'a',
    icon: process.env.PUSHSAFER_ICON || '11',
    sound: process.env.PUSHSAFER_SOUND || '10',
    vibration: process.env.PUSHSAFER_VIBRATION || '2',
  },

  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    recipientEmail: process.env.ALERT_RECIPIENT_EMAIL || '',
  },

  alerts: {
    // Mục 3.8: Thời gian chờ giữa các cảnh báo cùng loại để hạn chế gửi trùng (mặc định 15 phút)
    cooldownMs: Number(process.env.ALERT_COOLDOWN_MS || 15 * 60 * 1000),
    // Mục 3.8: Gửi lỗi được ghi nhận và thử lại có giới hạn (mặc định tối đa 3 lần)
    maxRetries: Number(process.env.NOTIFY_MAX_RETRIES || 3),
    retryDelayMs: Number(process.env.NOTIFY_RETRY_DELAY_MS || 2000),
  },
};
