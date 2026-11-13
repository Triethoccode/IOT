#pragma once
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <math.h>
#include <algorithm>
#include <string>
using String = std::string;
constexpr int INPUT=0, HIGH=1, LOW=0;
inline void pinMode(int,int) {}
inline void analogReadResolution(int) {}
inline int analogRead(int) { return 4095; }
template<class T> T constrain(T value,T lower,T upper) { return std::max(lower,std::min(upper,value)); }
