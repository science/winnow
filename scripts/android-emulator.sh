#!/usr/bin/env bash
# Android emulator lifecycle for the Android test tier (e2e/android/) and for
# manual runs with `web-ext run -t firefox-android`.
#
#   scripts/android-emulator.sh setup    one-time: SDK packages, AVD, Firefox APK
#   scripts/android-emulator.sh start    headless (test runs)
#   scripts/android-emulator.sh window   with a window on $DISPLAY (manual sign-in)
#   scripts/android-emulator.sh stop | status
#
# The SDK lives in ~/Android/Sdk — deliberately NOT under ~/dev, which is the
# host bind mount; AVD disk images don't belong on it. Needs /dev/kvm.
set -euo pipefail

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_AVD_HOME="${ANDROID_AVD_HOME:-$HOME/.android/avd}"
AVD="winnow"
IMAGE="system-images;android-34;google_apis;x86_64"
# Reviewed constant: the Firefox for Android release the tier is pinned to.
FENIX_VERSION="${FENIX_VERSION:-156.0}"
FENIX_PACKAGE="org.mozilla.firefox"
APK="$HOME/Android/apk/fenix-$FENIX_VERSION-x86_64.apk"
SERIAL="emulator-5554"
LOG="$HOME/Android/emulator.log"

ADB="$ANDROID_HOME/platform-tools/adb"
EMULATOR="$ANDROID_HOME/emulator/emulator"
SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
AVDMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager"

running() { "$ADB" devices 2>/dev/null | grep -q "^$SERIAL[[:space:]]*device$"; }

wait_for_boot() {
  "$ADB" -s "$SERIAL" wait-for-device
  for _ in $(seq 1 180); do
    if [ "$("$ADB" -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then
      return 0
    fi
    sleep 2
  done
  echo "emulator did not finish booting in 6 minutes — see $LOG" >&2
  return 1
}

# boot_completed fires while Android is still settling; a session started
# into that load can time out. Wait until most of the guest's CPU is idle.
wait_for_idle() {
  local idle
  for _ in $(seq 1 60); do
    idle="$("$ADB" -s "$SERIAL" shell "top -bn1 | sed -n 4p" 2>/dev/null | grep -o '[0-9]*%idle' | grep -o '^[0-9]*' || true)"
    if [ "${idle:-0}" -ge 200 ]; then return 0; fi
    sleep 3
  done
  echo "guest never went idle (last: ${idle:-?}%idle of 300%) — see $LOG" >&2
  return 1
}

install_firefox() {
  local have
  have="$("$ADB" -s "$SERIAL" shell dumpsys package "$FENIX_PACKAGE" 2>/dev/null | sed -n 's/.*versionName=//p' | head -1 | tr -d '\r')"
  if [ "$have" = "$FENIX_VERSION" ]; then return 0; fi
  [ -f "$APK" ] || {
    mkdir -p "$(dirname "$APK")"
    curl -fsSL -o "$APK" "https://archive.mozilla.org/pub/fenix/releases/$FENIX_VERSION/android/fenix-$FENIX_VERSION-android-x86_64/fenix-$FENIX_VERSION.multi.android-x86_64.apk"
  }
  "$ADB" -s "$SERIAL" install -r "$APK" >/dev/null
  echo "installed Firefox for Android $FENIX_VERSION"
}

boot() { # $1 = extra emulator flags
  [ -r /dev/kvm ] && [ -w /dev/kvm ] || { echo "/dev/kvm is not accessible — the emulator needs it" >&2; exit 1; }
  if running; then echo "already running"; else
    # shellcheck disable=SC2086
    nohup "$EMULATOR" -avd "$AVD" $1 -no-snapshot -no-boot-anim -no-audio -gpu swiftshader_indirect \
      -netdelay none -netspeed full >"$LOG" 2>&1 &
    wait_for_boot
  fi
  install_firefox
  # A factory-fresh device answers the first fullscreen with a one-time
  # "swipe to exit" confirmation window that takes focus and swallows the
  # next Back press. (Its sibling, the notification-permission prompt, is
  # per-app state that geckodriver wipes each session: see driver.mjs.)
  "$ADB" -s "$SERIAL" shell settings put secure immersive_mode_confirmations confirmed
  wait_for_idle
  echo "ready: $SERIAL"
}

case "${1:-}" in
  setup)
    yes | "$SDKMANAGER" --licenses >/dev/null 2>&1 || true
    "$SDKMANAGER" "platform-tools" "emulator" "$IMAGE" >/dev/null
    if ! "$AVDMANAGER" list avd -c | grep -qx "$AVD"; then
      echo no | "$AVDMANAGER" create avd -n "$AVD" -k "$IMAGE" -d pixel_6 >/dev/null
      cfg="$ANDROID_AVD_HOME/$AVD.avd/config.ini"
    fi
    # There is no GPU here, so every frame is composited in software on the
    # host's CPU. Measured 2026-09-21: at the pixel_6 profile's 1080x2400 a
    # playing video keeps surfaceflinger and the graphics composer spinning
    # until Android's watchdog kills system_server a few sessions in, and
    # giving the guest all 4 host cores makes it worse (it starves the host
    # renderer it is waiting on). A 540x960 @ 240dpi screen is a realistic
    # 360px-wide CSS viewport at about a fifth of the pixels.
    cfg="$ANDROID_AVD_HOME/$AVD.avd/config.ini"
    sed -i -E '/^(hw.ramSize|hw.keyboard|disk.dataPartition.size|hw.cpu.ncore|hw.gpu.enabled|hw.gpu.mode|hw.lcd.width|hw.lcd.height|hw.lcd.density|skin.name|skin.path|showDeviceFrame)=/d' "$cfg"
    cat >>"$cfg" <<'CFG'
hw.ramSize=4096
hw.keyboard=yes
disk.dataPartition.size=6G
hw.cpu.ncore=3
hw.gpu.enabled=no
hw.gpu.mode=off
hw.lcd.width=540
hw.lcd.height=960
hw.lcd.density=240
skin.name=540x960
skin.path=_no_skin
showDeviceFrame=no
CFG
    echo "AVD '$AVD' ready"
    ;;
  start) boot "-no-window" ;;
  window) boot "" ;;
  stop)
    # `emu kill` returns at once; a `start` issued before qemu has really
    # exited sees the dying instance as "already running".
    "$ADB" -s "$SERIAL" emu kill >/dev/null 2>&1 || true
    for _ in $(seq 1 30); do
      pgrep -f "qemu-system.*-avd $AVD" >/dev/null || break
      sleep 1
    done
    pkill -9 -f "qemu-system.*-avd $AVD" 2>/dev/null || true
    echo "stopped"
    ;;
  status)
    if running; then echo "running: $SERIAL"; else echo "not running"; fi
    ;;
  *)
    sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
