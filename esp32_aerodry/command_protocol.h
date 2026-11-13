#ifndef AERODRY_COMMAND_PROTOCOL_H
#define AERODRY_COMMAND_PROTOCOL_H

#include <ArduinoJson.h>
#include <stdint.h>
#include <string.h>

class CommandReplayGuard {
  struct Entry { char id[48]; uint32_t seen_ms; bool used; };
  Entry entries[16] = {};
public:
  const char* remember(const char* id, uint32_t now) {
    Entry* available = nullptr;
    for (auto& entry : entries) {
      if (entry.used && (uint32_t)(now - entry.seen_ms) < 40000UL) {
        if (!strcmp(entry.id, id)) return "DUPLICATE_COMMAND";
      } else available = &entry;
    }
    if (!available) return "COMMAND_RATE_LIMIT";
    strcpy(available->id, id); available->seen_ms = now; available->used = true;
    return nullptr;
  }
};

// Kept independent of GPIO/FSM so the actual parser can also run on a host PC.
inline const char* validateCommand(JsonVariantConst command, const char* device,
                                   const char* boot, uint32_t epoch, bool synced) {
  if (!command.is<JsonObjectConst>()) return "INVALID_JSON";
  const char* id = command["cmd_id"] | "";
  const size_t length = strlen(id);
  if (length == 0 || length > 47) return "INVALID_CMD_ID";
  for (size_t i = 0; i < length; ++i) {
    const char c = id[i];
    if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
          (c >= '0' && c <= '9') || c == '_' || c == '-')) return "INVALID_CMD_ID";
  }
  if (strcmp(command["device_id"] | "", device) != 0) return "WRONG_DEVICE";
  if (strcmp(command["boot_id"] | "", boot) != 0) return "WRONG_BOOT";
  if (command["is_simulation"].is<bool>() && command["is_simulation"].as<bool>()) return "SIMULATION_ISOLATED";
  if (!synced) return "TIME_NOT_SYNCED";
  if (!command["issued_at"].is<uint32_t>() || !command["ttl_sec"].is<uint32_t>()) return "INVALID_TTL";
  const uint32_t issued = command["issued_at"].as<uint32_t>();
  const uint32_t ttl = command["ttl_sec"].as<uint32_t>();
  if (!ttl || ttl > 30) return "INVALID_TTL";
  if ((uint64_t)issued > (uint64_t)epoch + 5) return "FUTURE_COMMAND";
  if ((uint64_t)epoch >= (uint64_t)issued + ttl) return "COMMAND_TTL_EXPIRED";
  const char* action = command["action"] | "";
  const JsonVariantConst params = command["params"];
  if (!params.is<JsonObjectConst>()) return "INVALID_PARAMS";
  const char* mode = params["mode"] | "";
  const char* state = params["state"] | "";
  if (!strcmp(action, "SET_ROD")) {
    const char* target = params["target"] | "";
    return (!strcmp(target, "EXTENDED") || !strcmp(target, "RETRACTED")) ? nullptr : "INVALID_TARGET";
  }
  if (!strcmp(action, "SET_MODE")) return (!strcmp(mode, "AUTO") || !strcmp(mode, "MANUAL")) ? nullptr : "INVALID_MODE";
  if (!strcmp(action, "SET_FAN")) return (!strcmp(state, "ON") || !strcmp(state, "OFF")) ? nullptr : "INVALID_STATE";
  if (!strcmp(action, "SET_LIGHT")) {
    return (!strcmp(mode, "AUTO") || (!strcmp(mode, "MANUAL") &&
      (!strcmp(state, "ON") || !strcmp(state, "OFF")))) ? nullptr : "INVALID_LIGHT";
  }
  if (!strcmp(action, "RESET_COUNTER")) return nullptr;
  if (!strcmp(action, "SET_DEMO_CONFIG")) return params["demo_fast_dry"].is<bool>() ? nullptr : "INVALID_DEMO_CONFIG";
  return "UNKNOWN_ACTION";
}
#endif
