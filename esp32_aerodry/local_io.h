#ifndef AERODRY_LOCAL_IO_H
#define AERODRY_LOCAL_IO_H
#include "config.h"
#include "types.h"

struct ButtonDebounce {
  uint8_t pin;
  bool reading;
  bool stable;
  uint32_t changed_ms;
  bool poll(bool next, uint32_t now) {
    if (next != reading) { reading = next; changed_ms = now; }
    if ((uint32_t)(now - changed_ms) >= BTN_DEBOUNCE_MS && next != stable) {
      stable = next;
      return next == LOW;
    }
    return false;
  }
};

inline void buildLcdLines(uint8_t page, const SensorSnapshot& s, const ActuatorStatus& act,
                         uint32_t seconds, bool wifi, char* line1, char* line2) {
  char first[40], second[40];
  if (!page) {
    if (s.dht_valid) snprintf(first,sizeof(first),"T:%.1fC H:%.0f%%",s.temperature_c,s.humidity_pct);
    else snprintf(first,sizeof(first),"DHT11: LOI");
    snprintf(second,sizeof(second),"Uot:%u%% %s",s.wet_percent,wifi ? "WiFi OK" : "OFFLINE");
  } else {
    snprintf(first,sizeof(first),"%s Sao:%s",act.control_mode==MODE_AUTO ? "AUTO" : "MANU",act.rod_state==ROD_EXTENDED ? "PHOI" : "THU");
    snprintf(second,sizeof(second),"Phoi:%lu:%02lu:%02lu",(unsigned long)(seconds/3600UL),
      (unsigned long)((seconds/60UL)%60UL),(unsigned long)(seconds%60UL));
  }
  snprintf(line1,17,"%-16.16s",first); snprintf(line2,17,"%-16.16s",second);
}
#endif
