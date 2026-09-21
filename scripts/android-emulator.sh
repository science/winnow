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
    nohup "$EMULATOR" -avd "$AVD" $1 -no-snapshot -no-boot-anim -no-audio \
      -gpu swiftshader_indirect -netdelay none -netspeed full >"$LOG" 2>&1 &
    wait_for_boot
  fi
  install_firefox
  echo "ready: $SERIAL"
}

case "${1:-}" in
  setup)
    yes | "$SDKMANAGER" --licenses >/dev/null 2>&1 || true
    "$SDKMANAGER" "platform-tools" "emulator" "$IMAGE" >/dev/null
    if ! "$AVDMANAGER" list avd -c | grep -qx "$AVD"; then
      echo no | "$AVDMANAGER" create avd -n "$AVD" -k "$IMAGE" -d pixel_6 >/dev/null
      cfg="$ANDROID_AVD_HOME/$AVD.avd/config.ini"
      sed -i '/^hw.ramSize/d;/^hw.keyboard/d;/^disk.dataPartition.size/d' "$cfg"
      printf 'hw.ramSize=3072\nhw.keyboard=yes\ndisk.dataPartition.size=6G\n' >>"$cfg"
    fi
    echo "AVD '$AVD' ready"
    ;;
  start) boot "-no-window" ;;
  window) boot "" ;;
  stop)
    if running; then "$ADB" -s "$SERIAL" emu kill >/dev/null; echo "stopped"; else echo "not running"; fi
    ;;
  status)
    if running; then echo "running: $SERIAL"; else echo "not running"; fi
    ;;
  *)
    sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
