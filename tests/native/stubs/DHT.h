#pragma once
#define DHT11 11
class DHT {
public:
  DHT(int,int) {}
  void begin() {}
  float readHumidity() { return 60; }
  float readTemperature() { return 30; }
};
