#pragma once
#include "Arduino.h"
// Host test only; hardware NVS persistence is explicitly not verified here.
class Preferences {
public:
  bool begin(const char*,bool) { return false; }
  void putUInt(const char*,uint32_t) {}
  void putString(const char*,const char*) {}
  void putBool(const char*,bool) {}
  uint32_t getUInt(const char*,uint32_t fallback) { return fallback; }
  String getString(const char*,const char* fallback) { return fallback; }
  bool getBool(const char*,bool fallback) { return fallback; }
};
