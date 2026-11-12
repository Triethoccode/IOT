#ifndef AERODRY_SENSORS_H
#define AERODRY_SENSORS_H

#include <Arduino.h>
#include <DHT.h>
#include "config.h"
#include "types.h"

// ============================================================================
// MODULE QUẢN LÝ CẢM BIẾN (W02: DHT11 + LDR, W03: Cảm biến mưa + Ngưỡng trễ)
// Phụ trách: Tạ Bỉnh Phong (24127100)
// ============================================================================

class AeroDrySensors {
private:
  DHT            _dht;
  SensorSnapshot _snap;

  // Hệ số hiệu chỉnh ADC cảm biến mưa (cho phép hiệu chỉnh động khi thử mô hình)
  uint16_t       _rain_adc_dry;
  uint16_t       _rain_adc_wet;

  // Ngưỡng trễ (Hysteresis) sáng/tối theo % ánh sáng
  uint8_t        _light_dark_enter_pct;
  uint8_t        _light_bright_exit_pct;

  // Bộ lọc trung bình trượt 4 mẫu cho ADC mưa và LDR để chống nhiễu xung điện
  uint16_t       _rain_buf[4];
  uint16_t       _ldr_buf[4];
  uint8_t        _adc_idx;
  bool           _adc_primed;

  // Cờ thông báo lỗi DHT11 mới phát sinh (để StateMachine phát sự kiện 1 lần mỗi đợt lỗi)
  bool           _dht_error_alert_pending;
  bool           _dht_error_alert_sent;

public:
  AeroDrySensors()
    : _dht(PIN_DHT11, DHT11),
      _rain_adc_dry(RAIN_ADC_DRY_DEFAULT),
      _rain_adc_wet(RAIN_ADC_WET_DEFAULT),
      _light_dark_enter_pct(LIGHT_DARK_ENTER_PCT),
      _light_bright_exit_pct(LIGHT_BRIGHT_EXIT_PCT),
      _adc_idx(0),
      _adc_primed(false),
      _dht_error_alert_pending(false),
      _dht_error_alert_sent(false) {
    memset(&_snap, 0, sizeof(_snap));
    _snap.dht_valid        = false;
    _snap.temperature_c    = NAN;
    _snap.humidity_pct     = NAN;
    _snap.wet_level        = WET_LEVEL_DRY;
    _snap.is_dark          = false;
  }

  void begin() {
    _dht.begin();
    pinMode(PIN_RAIN_ADC, INPUT);
    pinMode(PIN_LDR_ADC, INPUT);
    analogReadResolution(12); // ESP32 ADC 12-bit (0..4095)
  }

  // Hiệu chỉnh mốc khô / ướt thực tế của tấm cảm biến mưa (W03)
  void setRainCalibration(uint16_t adc_dry, uint16_t adc_wet) {
    if (adc_dry > adc_wet + 100) {
      _rain_adc_dry = adc_dry;
      _rain_adc_wet = adc_wet;
    }
  }

  // Hiệu chỉnh ngưỡng trễ sáng/tối của LDR (W02)
  void setLightHysteresis(uint8_t dark_enter_pct, uint8_t bright_exit_pct) {
    if (dark_enter_pct < bright_exit_pct && bright_exit_pct <= 100) {
      _light_dark_enter_pct  = dark_enter_pct;
      _light_bright_exit_pct = bright_exit_pct;
    }
  }

  // Vòng lặp cập nhật cảm biến không chặn (Non-blocking)
  void update(uint32_t now_ms) {
    // 1. Đọc nhanh cảm biến mưa và LDR (mỗi 250ms) để ưu tiên phát hiện mưa tức thời (Mục 3.3)
    if (now_ms - _snap.last_fast_read_ms >= FAST_SENSOR_INTERVAL_MS || !_adc_primed) {
      _snap.last_fast_read_ms = now_ms;
      readRainAndLdrHardware();
    }

    // 2. Đọc DHT11 mỗi 2.5 giây (2500ms) và kiểm tra tính hợp lệ (Mục 3.1 - W02)
    if (now_ms - _snap.last_dht_read_ms >= DHT_READ_INTERVAL_MS || _snap.last_dht_read_ms == 0) {
      _snap.last_dht_read_ms = now_ms;
      readDht11Hardware();
    }
  }

  // [W02] Đọc và kiểm tra lỗi dữ liệu DHT11 (Không thay bằng giá trị môi trường giả)
  void readDht11Hardware() {
    float h = _dht.readHumidity();
    float t = _dht.readTemperature();

    bool valid = !isnan(h) && !isnan(t) &&
                 (h >= 0.0f && h <= 100.0f) &&
                 (t >= -10.0f && t <= 65.0f);

    applyDhtReading(t, h, valid);
  }

  // Áp dụng kết quả đọc DHT11 (dùng chung cho phần cứng thật và kịch bản kiểm thử W06)
  void applyDhtReading(float t, float h, bool valid) {
    if (!valid) {
      _snap.dht_valid     = false;
      _snap.temperature_c = NAN; // Đánh dấu không hợp lệ, tuyệt đối không gán số giả
      _snap.humidity_pct  = NAN;
      _snap.dht_error_streak++;

      if (_snap.dht_error_streak >= DHT_ERROR_ALERT_COUNT && !_dht_error_alert_sent) {
        _dht_error_alert_pending = true;
        _dht_error_alert_sent    = true;
      }
    } else {
      _snap.dht_valid        = true;
      _snap.temperature_c    = t;
      _snap.humidity_pct     = h;
      _snap.dht_error_streak = 0;
      _dht_error_alert_sent  = false;
    }
  }

  // [W02, W03] Đọc ADC cảm biến mưa & LDR với bộ lọc trung bình trượt
  void readRainAndLdrHardware() {
    uint16_t raw_rain = analogRead(PIN_RAIN_ADC);
    uint16_t raw_ldr  = analogRead(PIN_LDR_ADC);

    if (!_adc_primed) {
      for (uint8_t i = 0; i < 4; i++) {
        _rain_buf[i] = raw_rain;
        _ldr_buf[i]  = raw_ldr;
      }
      _adc_primed = true;
    } else {
      _rain_buf[_adc_idx] = raw_rain;
      _ldr_buf[_adc_idx]  = raw_ldr;
      _adc_idx = (_adc_idx + 1) % 4;
    }

    uint32_t sum_rain = 0, sum_ldr = 0;
    for (uint8_t i = 0; i < 4; i++) {
      sum_rain += _rain_buf[i];
      sum_ldr  += _ldr_buf[i];
    }

    applyRainAndLdrAdc((uint16_t)(sum_rain / 4), (uint16_t)(sum_ldr / 4));
  }

  // [W03] Quy đổi ADC mưa -> mức ướt 0..100% & phân vùng ngưỡng; [W02] LDR Hysteresis
  void applyRainAndLdrAdc(uint16_t rain_adc, uint16_t ldr_adc) {
    _snap.rain_adc = rain_adc;
    _snap.ldr_adc  = ldr_adc;

    // 1. Quy đổi mức ướt tương đối 0..100% theo 2 mốc hiệu chỉnh RAIN_ADC_DRY và RAIN_ADC_WET
    int32_t wet_pct = 0;
    if (rain_adc >= _rain_adc_dry) {
      wet_pct = 0;
    } else if (rain_adc <= _rain_adc_wet) {
      wet_pct = 100;
    } else {
      wet_pct = (int32_t)(_rain_adc_dry - rain_adc) * 100L /
                (int32_t)(_rain_adc_dry - _rain_adc_wet);
    }
    _snap.wet_percent = (uint8_t)constrain(wet_pct, 0, 100);

    // Phân vùng mức ướt theo Bảng 3.1:
    // < 15%: Khô (DRY)
    // 15% .. <30%: Vùng chuyển tiếp (TRANSITION)
    // 30% .. <50%: Phát hiện ướt (WET)
    // >= 50%: Ướt nhiều (HEAVY_WET)
    if (_snap.wet_percent >= WET_THRESHOLD_HEAVY_PCT) {
      _snap.wet_level = WET_LEVEL_HEAVY;
    } else if (_snap.wet_percent >= WET_THRESHOLD_RETRACT_PCT) {
      _snap.wet_level = WET_LEVEL_WET;
    } else if (_snap.wet_percent >= WET_THRESHOLD_DRY_MAX_PCT) {
      _snap.wet_level = WET_LEVEL_TRANSITION;
    } else {
      _snap.wet_level = WET_LEVEL_DRY;
    }

    // 2. Quy đổi ADC ánh sáng LDR -> % độ sáng (0..100%)
    int32_t light_pct = 0;
    int32_t clamped_ldr = constrain((int32_t)ldr_adc, (int32_t)LDR_ADC_MIN, (int32_t)LDR_ADC_MAX);
    if (LDR_DARK_HIGHER_ADC) {
      light_pct = (int32_t)(LDR_ADC_MAX - clamped_ldr) * 100L / (int32_t)(LDR_ADC_MAX - LDR_ADC_MIN);
    } else {
      light_pct = (int32_t)(clamped_ldr - LDR_ADC_MIN) * 100L / (int32_t)(LDR_ADC_MAX - LDR_ADC_MIN);
    }
    _snap.light_percent = (uint8_t)constrain(light_pct, 0, 100);

    // Áp dụng khoảng trễ sáng/tối (Hysteresis) để tránh đèn và sào đóng/mở liên tục gần ngưỡng
    if (!_snap.is_dark && _snap.light_percent <= _light_dark_enter_pct) {
      _snap.is_dark = true;  // Chuyển sang Trời tối
    } else if (_snap.is_dark && _snap.light_percent >= _light_bright_exit_pct) {
      _snap.is_dark = false; // Chuyển sang Trời sáng
    }
  }

  // Kiểm tra và lấy cờ sự kiện lỗi DHT11
  bool consumeDhtErrorAlert() {
    if (_dht_error_alert_pending) {
      _dht_error_alert_pending = false;
      return true;
    }
    return false;
  }

  const SensorSnapshot& getSnapshot() const {
    return _snap;
  }
};

#endif // AERODRY_SENSORS_H
