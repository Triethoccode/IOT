#define ARDUINOJSON_ENABLE_ARDUINO_STRING 0
#define ARDUINOJSON_ENABLE_ARDUINO_STREAM 0
#include <assert.h>
#include <iostream>
#include "command_protocol.h"
#include "mqtt_contract.h"
#include "local_io.h"

int main() {
  ButtonDebounce button={1,HIGH,HIGH,0};
  assert(!button.poll(LOW,10)); assert(!button.poll(HIGH,20));
  assert(!button.poll(LOW,30)); assert(!button.poll(LOW,79)); assert(button.poll(LOW,80));
  assert(!button.poll(LOW,1000)); assert(!button.poll(HIGH,1001)); assert(!button.poll(HIGH,1051));
  assert(!button.poll(LOW,1100)); assert(button.poll(LOW,1150));
  ButtonDebounce rollover={1,HIGH,HIGH,0}; assert(!rollover.poll(LOW,UINT32_MAX-20)); assert(rollover.poll(LOW,30));
  JsonDocument doc;
  deserializeJson(doc,R"({"cmd_id":"CMD_1","device_id":"esp32_01","boot_id":"boot1","issued_at":1800000000,"ttl_sec":5,"action":"SET_ROD","params":{"target":"RETRACTED"}})");
  auto validate=[&](uint32_t epoch=1800000001,bool synced=true) { return validateCommand(doc.as<JsonVariantConst>(),"esp32_01","boot1",epoch,synced); };
  assert(!validate()); assert(!strcmp(validate(1800000005),"COMMAND_TTL_EXPIRED"));
  assert(!strcmp(validate(1800000001,false),"TIME_NOT_SYNCED"));
  doc["params"]["target"]="WRONG"; assert(!strcmp(validate(),"INVALID_TARGET"));
  doc["action"]="UNKNOWN"; assert(!strcmp(validate(),"UNKNOWN_ACTION"));
  doc["cmd_id"]="bad\"id"; assert(!strcmp(validate(),"INVALID_CMD_ID"));
  CommandReplayGuard guard;
  assert(!guard.remember("CMD_1",0)); assert(!strcmp(guard.remember("CMD_1",1),"DUPLICATE_COMMAND"));
  for(int i=2;i<=16;i++) { char id[20]; snprintf(id,sizeof(id),"CMD_%d",i); assert(!guard.remember(id,1)); }
  assert(!strcmp(guard.remember("CMD_17",2),"COMMAND_RATE_LIMIT"));
  assert(!guard.remember("CMD_17",40001));
  CommandReplayGuard wrap; assert(!wrap.remember("WRAP",UINT32_MAX-100));
  assert(!strcmp(wrap.remember("WRAP",100),"DUPLICATE_COMMAND"));

  AeroDrySensors sensors; sensors.begin(); sensors.update(2500);
  AeroDryDryingTracker tracker; tracker.begin(1800000000,true,sensors.getSnapshot());
  AeroDryStateMachine fsm(tracker); fsm.begin();
  assert(fsm.getActuators().rod_state==ROD_RETRACTED && !fsm.getActuators().fan_on);
  assert(fsm.commandSetFan(true));
  fsm.commandExtendRod(1000,1800000001,true,REASON_MANUAL_BTN,sensors.getSnapshot());
  assert(!fsm.getActuators().fan_on && fsm.getActuators().control_mode==MODE_MANUAL);
  assert(!fsm.commandSetFan(true));
  assert(!fsm.commandExtendRod(1100,1800000001,true,REASON_MANUAL_WEB,sensors.getSnapshot()));
  fsm.commandSetLight(MODE_MANUAL,true,sensors.getSnapshot());
  fsm.evaluate(2000,1800000002,true,sensors);
  assert(fsm.getActuators().light_on && fsm.getActuators().light_mode==MODE_MANUAL);
  fsm.commandResetCounter(5000,1800000005,true,sensors.getSnapshot());
  assert(tracker.getTotalDryingSec(5000)==0 && tracker.isSessionOpen());
  fsm.commandRetractRod(6000,1800000006,true,REASON_MANUAL_BTN,sensors.getSnapshot());
  assert(tracker.getTotalDryingSec(6000)==1);
  char line1[17],line2[17];
  auto snapshot=sensors.getSnapshot();
  snapshot.temperature_c=-10; snapshot.humidity_pct=100; snapshot.wet_percent=100;
  for(int page=0;page<2;page++) {
    buildLcdLines(page,snapshot,fsm.getActuators(),UINT32_MAX,false,line1,line2);
    assert(strlen(line1)==16 && strlen(line2)==16);
  }
  snapshot.dht_valid=false; buildLcdLines(0,snapshot,fsm.getActuators(),0,false,line1,line2);
  assert(strstr(line1,"LOI"));

  AeroDryMqttContract mqtt;
  char json[3072];
  mqtt.buildTelemetryJson(6000,1800000006,true,-56,"192.168.1.2",sensors.getSnapshot(),fsm,tracker,json,sizeof(json));
  assert(!deserializeJson(doc,json)); assert(doc["device_id"]=="esp32_01");
  mqtt.buildAckJson("CMD_2",6000,1800000006,"ACCEPTED","OK",fsm,tracker,json,sizeof(json));
  assert(!deserializeJson(doc,json)); assert(doc["resulting_state"]["rod_state"]=="RETRACTED");
  // Exercise every UTF-8 alert: original 768-byte buffers could truncate JSON.
  for(int code=1;code<=8;code++) {
    AlertEventRecord event={}; event.event_code=(AlertEventCode)code; event.sensors=sensors.getSnapshot();
    strcpy(event.event_id,"EVT_test");
    mqtt.buildAlertEventJson(event,json,sizeof(json)); assert(!deserializeJson(doc,json));
  }
  std::cout << "PASS: actual buttons/debounce/rollover, LCD, parser, replay guard, FSM, timer, telemetry, ACK and 8 UTF-8 events\n";
}
