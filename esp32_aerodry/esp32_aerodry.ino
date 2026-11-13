// W12/W13/W14: loop owns FSM/hardware, network task owns MQTT/WiFiManager.
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <PubSubClient.h>
#include <ESP32Servo.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <ArduinoJson.h>
#include <time.h>
#include <atomic>
#include "config.h"
#include "types.h"
#include "sensors.h"
#include "drying_tracker.h"
#include "state_machine.h"
#include "mqtt_contract.h"
#include "command_protocol.h"
#include "local_io.h"

AeroDrySensors g_sensors;
AeroDryDryingTracker g_tracker;
AeroDryStateMachine g_fsm(g_tracker);
AeroDryMqttContract g_contract;
WiFiClient g_wifiClient;
PubSubClient g_mqtt(g_wifiClient);
Servo g_servo;
LiquidCrystal_I2C g_lcd(LCD_I2C_ADDR, 16, 2);
char g_boot_id[24];
std::atomic<uint32_t> g_connection_id{0};
struct TxPacket { char topic[80]; char payload[3072]; uint32_t queued_ms; bool retained; };
struct RxPacket { char payload[768]; };
ButtonDebounce g_buttons[] = {{PIN_BTN_EXTEND,HIGH,HIGH,0}, {PIN_BTN_RETRACT,HIGH,HIGH,0}, {PIN_BTN_RESET,HIGH,HIGH,0}};
QueueHandle_t g_events, g_acks, g_telemetry, g_state, g_commands;
std::atomic<bool> g_portal_requested{false};
std::atomic<bool> g_publish_state_requested{false};
uint32_t g_last_lcd_ms = 0, g_last_telemetry_ms = 0;
uint8_t g_lcd_page = 1;
CommandReplayGuard g_replay_guard;
// Main-task scratch buffers avoid nested 3 KB stack allocations on loopTask.
char g_json[3072];

uint32_t getCurrentEpoch(bool& synced) {
  time_t now = time(nullptr);
  synced = now > 1700000000L;
  return synced ? (uint32_t)now : 0;
}

void queuePacket(QueueHandle_t queue, const char* topic, const char* json, bool retained, bool latest = false) {
  static TxPacket packet;
  strlcpy(packet.topic, topic, sizeof(packet.topic));
  strlcpy(packet.payload, json, sizeof(packet.payload));
  packet.queued_ms = millis(); packet.retained = retained;
  if (latest) xQueueOverwrite(queue, &packet);
  else if (xQueueSend(queue, &packet, 0) != pdTRUE) Serial.printf("[QUEUE_FULL] dropped %s\n", topic);
}

void onHardwareActuatorChange(const ActuatorStatus& act) {
  // Update relay BEFORE servo motion (fan must be off before extending).
  digitalWrite(PIN_RELAY_FAN, act.fan_on ? RELAY_ACTIVE_LEVEL : RELAY_INACTIVE_LEVEL);
  digitalWrite(PIN_LED_LIGHT, act.light_on ? HIGH : LOW);
  g_servo.write(act.servo_target_deg);
}
void onSessionEventGenerated(const SessionRecord& record) {
  g_contract.buildSessionJson(record, g_json, sizeof(g_json));
  queuePacket(g_events, TOPIC_SESSION, g_json, false);
}
void onAlertEventGenerated(const AlertEventRecord& record) {
  g_contract.buildAlertEventJson(record, g_json, sizeof(g_json));
  queuePacket(g_events, TOPIC_ALERT, g_json, false);
}
void sendAck(const char* id, const char* status, const char* reason, uint32_t now, uint32_t epoch) {
  char json[1024];
  g_contract.buildAckJson(id, now, epoch, status, reason, g_fsm, g_tracker, json, sizeof(json));
  JsonDocument ack;
  if (deserializeJson(ack, json)) return;
  ack["boot_id"] = g_boot_id;
  ack["connection_id"] = (uint32_t)g_connection_id;
  serializeJson(ack, json, sizeof(json));
  queuePacket(g_acks, TOPIC_CTRL_ACK, json, false);
}

void processCommand(const RxPacket& packet, uint32_t now, uint32_t epoch, bool synced) {
  JsonDocument doc;
  if (deserializeJson(doc, packet.payload, DeserializationOption::NestingLimit(4))) {
    sendAck("", "REJECTED", "INVALID_JSON", now, epoch); return;
  }
  const char* reason = validateCommand(doc.as<JsonVariantConst>(), DEVICE_ID, g_boot_id, epoch, synced);
  if (!reason && (!doc["connection_id"].is<uint32_t>() || doc["connection_id"].as<uint32_t>() != g_connection_id)) reason = "WRONG_CONNECTION";
  const char* id = reason && !strcmp(reason, "INVALID_CMD_ID") ? "" : (doc["cmd_id"] | "");
  if (reason) {
    sendAck(id, !strcmp(reason,"COMMAND_TTL_EXPIRED") ? "EXPIRED" : "REJECTED", reason, now, epoch); return;
  }
  reason = g_replay_guard.remember(id, now);
  if (reason) { sendAck(id,"REJECTED",reason,now,epoch); return; }
  const char* action = doc["action"];
  JsonVariantConst p = doc["params"];
  const SensorSnapshot& s = g_sensors.getSnapshot();
  if (!strcmp(action,"SET_ROD")) {
    if (!strcmp(p["target"],"EXTENDED")) g_fsm.commandExtendRod(now,epoch,synced,REASON_MANUAL_WEB,s);
    else g_fsm.commandRetractRod(now,epoch,synced,REASON_MANUAL_WEB,s);
  } else if (!strcmp(action,"SET_MODE")) {
    g_fsm.commandSetControlMode(!strcmp(p["mode"],"AUTO") ? MODE_AUTO : MODE_MANUAL,now,epoch,synced,g_sensors);
  } else if (!strcmp(action,"SET_FAN")) {
    if (!g_fsm.commandSetFan(!strcmp(p["state"],"ON"))) reason = "CANNOT_TURN_ON_FAN_WHILE_ROD_EXTENDED";
  } else if (!strcmp(action,"SET_LIGHT")) {
    g_fsm.commandSetLight(!strcmp(p["mode"],"AUTO") ? MODE_AUTO : MODE_MANUAL,!strcmp(p["state"] | "OFF","ON"),s);
  } else if (!strcmp(action,"RESET_COUNTER")) g_fsm.commandResetCounter(now,epoch,synced,s);
  else if (!strcmp(action,"SET_DEMO_CONFIG")) g_fsm.setDemoFastDry(p["demo_fast_dry"].as<bool>());
  sendAck(id,reason ? "REJECTED" : "ACCEPTED",reason ? reason : "OK",now,epoch);
}

void onMqttMessageReceived(char* topic, byte* payload, unsigned int length) {
  if (strcmp(topic,TOPIC_COMMAND)) return;
  RxPacket packet = {};
  if (!length || length >= sizeof(packet.payload)) { Serial.println("[CMD] invalid length"); return; }
  memcpy(packet.payload,payload,length);
  if (xQueueSend(g_commands,&packet,0) != pdTRUE) Serial.println("[CMD] queue full");
}

// Network task only: do not remove an event until publish succeeds.
// Queue is bounded RAM; reboot or overflow can lose events (logged on Serial).
void flushQueue(QueueHandle_t queue, bool transient) {
  TxPacket packet;
  if (queue==g_telemetry || queue==g_state) {
    // Receive before publish: the main task can overwrite this one-slot mailbox.
    // On failure, put back only if no newer snapshot has arrived in the meantime.
    if (xQueueReceive(queue,&packet,0)!=pdTRUE) return;
    if ((uint32_t)(millis()-packet.queued_ms)<=5000 && !g_mqtt.publish(packet.topic,packet.payload,packet.retained)) {
      xQueueSend(queue,&packet,0);
    }
    return;
  }
  if (xQueuePeek(queue,&packet,0) != pdTRUE) return;
  if ((transient && (uint32_t)(millis()-packet.queued_ms)>5000) ||
      g_mqtt.publish(packet.topic,packet.payload,packet.retained)) xQueueReceive(queue,&packet,0);
}
void publishHeartbeat() {
  bool synced; const uint32_t epoch = getCurrentEpoch(synced);
  JsonDocument doc;
  doc["group_id"]=GROUP_ID; doc["device_id"]=DEVICE_ID; doc["boot_id"]=g_boot_id; doc["status"]="ONLINE";
  doc["connection_id"]=(uint32_t)g_connection_id;
  doc["rssi"]=WiFi.RSSI(); doc["ip"]=WiFi.localIP().toString(); doc["uptime_sec"]=millis()/1000UL;
  doc["timestamp"]=epoch; doc["time_synced"]=synced;
  char json[384]; serializeJson(doc,json,sizeof(json));
  g_mqtt.publish(TOPIC_HEARTBEAT,json,true);
}
void networkTask(void*) {
  WiFiManager manager;
  manager.setConfigPortalBlocking(false); manager.setConfigPortalTimeout(WIFI_PORTAL_TIMEOUT_SEC);
  manager.setConnectTimeout(10); WiFi.setAutoReconnect(true);
  manager.autoConnect("AeroDry_Config_AP");
  configTime(0,0,"pool.ntp.org","time.nist.gov");
  g_mqtt.setServer(MQTT_BROKER_DEFAULT,MQTT_PORT_DEFAULT); g_mqtt.setBufferSize(4096);
  g_mqtt.setSocketTimeout(2); g_mqtt.setKeepAlive(15); g_mqtt.setCallback(onMqttMessageReceived);
  uint32_t last_retry=millis()-5000UL, last_wifi_retry=millis(), last_heartbeat=0;
  for (;;) {
    manager.process();
    if (g_portal_requested.exchange(false)) {
      if (!manager.getConfigPortalActive()) manager.startConfigPortal("AeroDry_Config_AP");
    }
    const uint32_t now=millis();
    if (WiFi.status()!=WL_CONNECTED) {
      if (g_mqtt.connected()) g_mqtt.disconnect();
      if (!manager.getConfigPortalActive() && (uint32_t)(now-last_wifi_retry)>=10000UL) { last_wifi_retry=now; WiFi.reconnect(); }
    } else if (!g_mqtt.connected()) {
      if ((uint32_t)(now-last_retry)>=5000UL) {
        last_retry=now;
        g_connection_id=esp_random();
        char will[192];
        snprintf(will,sizeof(will),"{\"group_id\":\"%s\",\"device_id\":\"%s\",\"boot_id\":\"%s\",\"connection_id\":%lu,\"status\":\"OFFLINE\"}",GROUP_ID,DEVICE_ID,g_boot_id,(unsigned long)g_connection_id);
        const String client=String("AeroDry-")+DEVICE_ID+"-"+g_boot_id;
        if (g_mqtt.connect(client.c_str(),MQTT_USER_DEFAULT,MQTT_PASS_DEFAULT,TOPIC_HEARTBEAT,0,true,will)) {
          g_mqtt.subscribe(TOPIC_COMMAND,0); publishHeartbeat(); last_heartbeat=now;
          g_publish_state_requested.store(true);
        }
      }
    } else {
      g_mqtt.loop();
      if ((uint32_t)(now-last_heartbeat)>=HEARTBEAT_INTERVAL_MS) { publishHeartbeat(); last_heartbeat=now; }
      flushQueue(g_acks,true); flushQueue(g_events,false); flushQueue(g_state,true); flushQueue(g_telemetry,true);
    }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

bool isButtonPressedEdge(ButtonDebounce& button,uint32_t now) {
  return button.poll(digitalRead(button.pin),now);
}
void pollPhysicalButtons(uint32_t now,uint32_t epoch,bool synced) {
  const SensorSnapshot& s=g_sensors.getSnapshot();
  if (isButtonPressedEdge(g_buttons[0],now)) g_fsm.commandExtendRod(now,epoch,synced,REASON_MANUAL_BTN,s);
  if (isButtonPressedEdge(g_buttons[1],now)) g_fsm.commandRetractRod(now,epoch,synced,REASON_MANUAL_BTN,s);
  if (isButtonPressedEdge(g_buttons[2],now)) g_fsm.commandResetCounter(now,epoch,synced,s);
}
void printLcdLine(uint8_t row,const char* text) {
  char padded[17]; snprintf(padded,sizeof(padded),"%-16.16s",text); g_lcd.setCursor(0,row); g_lcd.print(padded);
}
void updateLocalLcd(uint32_t now) {
  if ((uint32_t)(now-g_last_lcd_ms)<LCD_PAGE_SWITCH_MS) return;
  g_last_lcd_ms=now; g_lcd_page=(g_lcd_page+1)%2;
  char line1[17],line2[17];
  buildLcdLines(g_lcd_page,g_sensors.getSnapshot(),g_fsm.getActuators(),g_tracker.getTotalDryingSec(now),WiFi.status()==WL_CONNECTED,line1,line2);
  printLcdLine(0,line1); printLcdLine(1,line2);
}

void setup() {
  Serial.begin(115200);
  snprintf(g_boot_id,sizeof(g_boot_id),"%08lx%08lx",(unsigned long)esp_random(),(unsigned long)esp_random());
  g_events=xQueueCreate(16,sizeof(TxPacket)); g_acks=xQueueCreate(4,sizeof(TxPacket));
  g_telemetry=xQueueCreate(1,sizeof(TxPacket)); g_state=xQueueCreate(1,sizeof(TxPacket)); g_commands=xQueueCreate(4,sizeof(RxPacket));
  configASSERT(g_events && g_acks && g_telemetry && g_state && g_commands);
  pinMode(PIN_RELAY_FAN,OUTPUT); digitalWrite(PIN_RELAY_FAN,RELAY_INACTIVE_LEVEL);
  pinMode(PIN_LED_LIGHT,OUTPUT); digitalWrite(PIN_LED_LIGHT,LOW);
  for (const auto& b:g_buttons) pinMode(b.pin,INPUT_PULLUP);
  g_servo.setPeriodHertz(50); g_servo.attach(PIN_SERVO,500,2400); g_servo.write(SERVO_ANGLE_RETRACTED);
  Wire.begin(PIN_I2C_SDA,PIN_I2C_SCL); Wire.setTimeOut(20); g_lcd.init(); g_lcd.backlight();
  printLcdLine(0,"AeroDry G21"); printLcdLine(1,"Khoi dong...");
  g_sensors.begin(); g_sensors.update(millis());
  g_tracker.setSessionCallback(onSessionEventGenerated); g_fsm.setAlertCallback(onAlertEventGenerated);
  g_fsm.setHardwareCallback(onHardwareActuatorChange);
  bool synced; const uint32_t epoch=getCurrentEpoch(synced);
  g_tracker.begin(epoch,synced,g_sensors.getSnapshot()); g_fsm.begin();
  configASSERT(xTaskCreatePinnedToCore(networkTask,"aerodry-network",12288,nullptr,1,nullptr,0)==pdPASS);
  Serial.println("Local control ready. Serial P opens WiFi portal for 120s.");
}
void loop() {
  const uint32_t now=millis(); bool synced; const uint32_t epoch=getCurrentEpoch(synced);
  g_sensors.update(now); pollPhysicalButtons(now,epoch,synced);
  RxPacket command;
  if (xQueueReceive(g_commands,&command,0)==pdTRUE) processCommand(command,now,epoch,synced);
  g_fsm.evaluate(now,epoch,synced,g_sensors); updateLocalLcd(now);
  if (Serial.available()) { const char c=Serial.read(); if (c=='P'||c=='p') g_portal_requested=true; }
  const bool state_dirty=g_fsm.consumeStateDirty();
  const bool republish=g_publish_state_requested.exchange(false);
  const bool dirty=state_dirty || republish;
  if (dirty || (uint32_t)(now-g_last_telemetry_ms)>=TELEMETRY_INTERVAL_MS) {
    g_last_telemetry_ms=now; const String ip=WiFi.localIP().toString();
    g_contract.buildTelemetryJson(now,epoch,synced,WiFi.RSSI(),ip.c_str(),g_sensors.getSnapshot(),g_fsm,g_tracker,g_json,sizeof(g_json));
    queuePacket(g_telemetry,TOPIC_TELEMETRY,g_json,false,true);
    if (dirty) queuePacket(g_state,TOPIC_STATE,g_json,true,true);
  }
  delay(1);
}
