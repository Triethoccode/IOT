/**
 * W21 – MODULE THÔNG BÁO ĐẨY PUSHSAFER & EMAIL SMTP (Chống gửi trùng & Thử lại có giới hạn)
 * Phụ trách: Tạ Bỉnh Phong (24127100) – Nhận từ Triết
 */
const https = require('https');
const querystring = require('querystring');
const defaultConfig = require('./config');
const { formatDurationHMS } = require('./historyQueryService');

class NotificationService {
  constructor(customConfig = {}, customTransports = {}) {
    this.config = {
      ...defaultConfig,
      ...customConfig,
      pushsafer: { ...defaultConfig.pushsafer, ...(customConfig.pushsafer || {}) },
      smtp: { ...defaultConfig.smtp, ...(customConfig.smtp || {}) },
      alerts: { ...defaultConfig.alerts, ...(customConfig.alerts || {}) },
    };

    // Cho phép tiêm (inject) hàm gửi giả lập trong kiểm thử W06
    this.customPushSender = customTransports.pushSender || null;
    this.customEmailSender = customTransports.emailSender || null;

    // Bộ nhớ chống gửi trùng (Deduplication theo event_id & Cooldown theo loại sự kiện)
    this.processedEventIds = new Set();
    this.lastSentByEventKey = new Map();
    this.errorLogs = [];
  }

  /**
   * [W21 - F21, F22] Xử lý bản tin sự kiện từ ESP32 và gửi PushSafer / Email SMTP:
   * - AUTO_RAIN_RETRACT: Thu tự động do mưa -> Gửi PushSafer + Email
   * - MANUAL_RAIN_WARNING: Đang ở Manual ngoài trời mà mưa -> Gửi PushSafer + Email
   * - HIGH_HUMIDITY_PROLONGED: Độ ẩm cao kéo dài -> Gửi Email nhắc kiểm tra đồ phơi & bật quạt
   */
  async processAlertEvent(eventPayload, nowMs = Date.now()) {
    if (!eventPayload || typeof eventPayload !== 'object') {
      return { dispatched: false, status: 'INVALID_EVENT' };
    }

    // Mục 3.9: Không gửi cảnh báo thật cho dữ liệu từ Simulation Mode
    if (eventPayload.is_simulation === true) {
      return { dispatched: false, status: 'SIMULATION_SKIPPED' };
    }

    const eventCode = eventPayload.event_code || '';
    const supportedAlertCodes = [
      'AUTO_RAIN_RETRACT',
      'MANUAL_RAIN_WARNING',
      'HIGH_HUMIDITY_PROLONGED',
    ];

    if (!supportedAlertCodes.includes(eventCode)) {
      return {
        dispatched: false,
        status: 'LOG_ONLY_NO_NOTIFICATION',
        event_code: eventCode,
      };
    }

    const eventId = eventPayload.event_id || `EVT_${nowMs}`;
    const deviceId = eventPayload.device_id || this.config.deviceId;
    const cooldownKey = `${deviceId}:${eventCode}`;

    // 1. Chống gửi trùng cùng một mã sự kiện (event_id)
    if (this.processedEventIds.has(eventId)) {
      return {
        dispatched: false,
        status: 'SUPPRESSED_DUPLICATE_EVENT_ID',
        event_id: eventId,
      };
    }

    // 2. Chống gửi lặp theo khoảng thời gian chờ (Cooldown - Mục 3.8)
    const lastSentMs = this.lastSentByEventKey.get(cooldownKey) || 0;
    const cooldownMs = this.config.alerts.cooldownMs;
    if (lastSentMs > 0 && nowMs - lastSentMs < cooldownMs) {
      return {
        dispatched: false,
        status: 'SUPPRESSED_COOLDOWN',
        event_code: eventCode,
        cooldown_remaining_ms: cooldownMs - (nowMs - lastSentMs),
      };
    }

    // Đánh dấu thời điểm gửi để khóa trùng lặp ngay lập tức
    this.processedEventIds.add(eventId);
    this.lastSentByEventKey.set(cooldownKey, nowMs);

    // 3. Chuẩn bị nội dung thông báo chuẩn theo Mục 3.8:
    // Gồm: Mã nhóm, Thiết bị, Nguyên nhân, Thời điểm và Tổng thời gian đã phơi
    const content = this.buildNotificationContent(eventPayload, nowMs);

    const needPush =
      eventCode === 'AUTO_RAIN_RETRACT' || eventCode === 'MANUAL_RAIN_WARNING';
    const needEmail =
      eventCode === 'AUTO_RAIN_RETRACT' ||
      eventCode === 'MANUAL_RAIN_WARNING' ||
      eventCode === 'HIGH_HUMIDITY_PROLONGED';

    const results = {
      dispatched: true,
      status: 'DISPATCHED',
      event_id: eventId,
      event_code: eventCode,
      pushsafer: needPush ? await this._sendWithRetry('PUSHSAFER', () => this.sendPushSafer(content)) : { skipped: true },
      email: needEmail ? await this._sendWithRetry('EMAIL_SMTP', () => this.sendEmailSmtp(content)) : { skipped: true },
    };

    return results;
  }

  /**
   * Tạo nội dung thông báo đẩy PushSafer và Email cảnh báo theo đúng yêu cầu Mục 3.8
   */
  buildNotificationContent(eventPayload, nowMs = Date.now()) {
    const groupId = eventPayload.group_id || this.config.groupId;
    const deviceId = eventPayload.device_id || this.config.deviceId;
    const eventCode = eventPayload.event_code;
    const totalSec = Number(eventPayload.total_drying_sec || 0);
    const formattedDryingTime = eventPayload.formatted_time || formatDurationHMS(totalSec);
    const sensors = eventPayload.sensors || {};
    const eventTimeMs =
      eventPayload.time_synced && Number(eventPayload.timestamp) > 1700000000
        ? Number(eventPayload.timestamp) * 1000
        : nowMs;
    const timeStrVi = new Date(eventTimeMs).toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
    });

    let reasonText = 'Thu sào tự động do phát hiện mưa';
    let subject = `[AeroDry IoT - ${groupId}] Cảnh báo thu sào tự động do mưa`;
    let actionAdvice = 'Sào phơi đã được tự động đưa vào dưới mái hiên an toàn.';

    if (eventCode === 'MANUAL_RAIN_WARNING') {
      reasonText = 'Phát hiện mưa trong lúc sào đang mở ở chế độ Thủ công (Manual)';
      subject = `[AeroDry IoT - ${groupId}] CẢNH BÁO: Đang mưa nhưng sào ở chế độ Manual!`;
      actionAdvice =
        'Vui lòng mở Dashboard AeroDry để thu sào hoặc chuyển lại chế độ Tự động (Auto) ngay.';
    } else if (eventCode === 'HIGH_HUMIDITY_PROLONGED') {
      reasonText = `Độ ẩm môi trường duy trì ở mức cao (${sensors.humidity_pct ?? '--'}%) kéo dài`;
      subject = `[AeroDry IoT - ${groupId}] Nhắc nhở: Độ ẩm cao kéo dài - Cân nhắc bật quạt`;
      actionAdvice =
        'Người dùng vui lòng kiểm tra đồ phơi dưới mái hiên và cân nhắc bật quạt hỗ trợ làm khô trên Website.';
    }

    const pushTitle = `AeroDry (${groupId}): ${eventPayload.title_vi || reasonText}`;
    const pushMessage = [
      `Nhóm: ${groupId} | Thiết bị: ${deviceId}`,
      `Nguyên nhân: ${reasonText}`,
      `Mức ướt: ${sensors.wet_percent ?? 0}% | Độ ẩm: ${sensors.humidity_pct ?? '--'}% | Nhiệt độ: ${sensors.temperature_c ?? '--'}°C`,
      `Tổng thời gian đã phơi (mẻ ${eventPayload.batch_id || 'hiện tại'}): ${formattedDryingTime}`,
      `Thời điểm: ${timeStrVi}`,
      actionAdvice,
    ].join('\n');

    const emailBodyText = [
      '=== THÔNG BÁO TỪ HỆ THỐNG GIÀN PHƠI THÔNG MINH AERODRY IoT ===',
      `• Mã nhóm: ${groupId} (Nhóm 21 - Lớp 24C11)`,
      `• Mã thiết bị: ${deviceId}`,
      `• Mã sự kiện: ${eventCode} (${eventPayload.event_id || 'N/A'})`,
      `• Nguyên nhân: ${reasonText}`,
      `• Thời điểm ghi nhận: ${timeStrVi}`,
      `• Mẻ đồ hiện tại: ${eventPayload.batch_id || 'N/A'} (Phiên #${eventPayload.session_id ?? 0})`,
      `• Tổng thời gian đã phơi của mẻ đồ: ${formattedDryingTime} (${totalSec} giây)`,
      `• Thông số môi trường: Nhiệt độ ${sensors.temperature_c ?? '--'}°C | Độ ẩm ${sensors.humidity_pct ?? '--'}% | Mức ướt ${sensors.wet_percent ?? 0}%`,
      '',
      `Khuyến nghị: ${actionAdvice}`,
    ].join('\n');

    return {
      subject,
      pushTitle,
      pushMessage,
      emailBodyText,
      metadata: {
        groupId,
        deviceId,
        eventCode,
        formattedDryingTime,
        timeStrVi,
      },
    };
  }

  /**
   * Thực thi gửi thông báo kèm thử lại có giới hạn (Bounded Retry - Mục 3.8)
   * Không ném ngoại lệ làm chặn luồng điều khiển thiết bị.
   */
  async _sendWithRetry(channelName, sendFn) {
    const maxRetries = Math.max(1, Number(this.config.alerts.maxRetries || 3));
    const retryDelayMs = Number(this.config.alerts.retryDelayMs || 1000);
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await sendFn(attempt);
        return {
          ok: true,
          channel: channelName,
          attempts: attempt,
          response,
        };
      } catch (err) {
        lastError = err.message || String(err);
        this.errorLogs.push({
          timestamp_ms: Date.now(),
          channel: channelName,
          attempt,
          max_retries: maxRetries,
          error: lastError,
        });

        if (attempt < maxRetries && retryDelayMs > 0) {
          await new Promise((r) => setTimeout(r, retryDelayMs));
        }
      }
    }

    return {
      ok: false,
      channel: channelName,
      attempts: maxRetries,
      error: lastError,
    };
  }

  /**
   * Gửi thông báo đẩy qua PushSafer API (https://www.pushsafer.com/api)
   */
  async sendPushSafer(content) {
    if (this.customPushSender) {
      return this.customPushSender(content);
    }

    if (!this.config.pushsafer.privateKey) {
      throw new Error('PUSHSAFER_PRIVATE_KEY_NOT_CONFIGURED');
    }

    const postData = querystring.stringify({
      k: this.config.pushsafer.privateKey,
      d: this.config.pushsafer.deviceId || 'a',
      i: this.config.pushsafer.icon || '11',
      s: this.config.pushsafer.sound || '10',
      v: this.config.pushsafer.vibration || '2',
      t: content.pushTitle,
      m: content.pushMessage,
    });

    return new Promise((resolve, reject) => {
      const req = https.request(
        'https://www.pushsafer.com/api',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
          },
          timeout: 8000,
        },
        (res) => {
          let raw = '';
          res.on('data', (chunk) => (raw += chunk));
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const parsed = JSON.parse(raw);
                if (parsed.status === 1) {
                  resolve(parsed);
                } else {
                  reject(new Error(`PushSafer API rejected: ${raw}`));
                }
              } catch (_) {
                resolve({ status: res.statusCode, raw });
              }
            } else {
              reject(new Error(`PushSafer HTTP ${res.statusCode}: ${raw}`));
            }
          });
        }
      );

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('PushSafer request timeout'));
      });
      req.write(postData);
      req.end();
    });
  }

  /**
   * Gửi Email cảnh báo qua SMTP sử dụng Nodemailer
   */
  async sendEmailSmtp(content) {
    if (this.customEmailSender) {
      return this.customEmailSender(content);
    }

    if (!this.config.smtp.user || !this.config.smtp.pass || !this.config.smtp.recipientEmail) {
      throw new Error('SMTP_CREDENTIALS_OR_RECIPIENT_NOT_CONFIGURED');
    }

    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: this.config.smtp.host,
      port: this.config.smtp.port,
      secure: this.config.smtp.secure,
      auth: {
        user: this.config.smtp.user,
        pass: this.config.smtp.pass,
      },
    });

    const info = await transporter.sendMail({
      from: `"AeroDry IoT - Nhóm 21" <${this.config.smtp.user}>`,
      to: this.config.smtp.recipientEmail,
      subject: content.subject,
      text: content.emailBodyText,
    });

    return { messageId: info.messageId };
  }
}

module.exports = { NotificationService };
