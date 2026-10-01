---
name: "zmk-firmware-config"
description: "Create/debug ZMK firmware config repos for custom keyboards on nice!nano — flat config layout, build.sh with toolchain workaround, pro_micro pin map, OLED/encoder/keymap API for 2026 ZMK main; use when writing keyboard firmware or hitting SHIELD/devicetree build errors"
---

# ZMK firmware config repo (nice!nano, local west builds)

## When
Creating or debugging a ZMK config for a handwired/custom keyboard on nice!nano (v2/BLE) — new build, adding encoders/OLED, or "invalid SHIELD"/devicetree errors. Local `~/repos/zmk` (checkout pinned-ish on main) with `.venv` + zephyr-sdk 0.17 is the working toolchain; `~/repos/ffkb-config` is the reference repo style.

## Procedure
1. **Repo layout (flat config, matches ffkb-config)**: `config/<board>.overlay`, `<board>.keymap`, `<board>.conf` + `build.sh` + `README.md` (wiring). Board-named files auto-apply — **`-DSHIELD=<name>` only works for shields registered in a module** (boards/shields/<name>/*.zmk.yml); for a handwired one-off, name files after the BOARD (`nice_nano.*`) and drop SHIELD entirely. Unregistered shield name → cmake "Invalid SHIELD".
2. **Board string for nice!nano v2 (HWMv2)**: `-b 'nice_nano//zmk'` (board//variant; revision 2.0.0 is default). The dts files on disk are `nice_nano_nrf52840_zmk*`.
3. **build.sh essentials**: `export ZEPHYR_TOOLCHAIN_VARIANT=zephyr` FIRST (Zephyr 4.1's FindZephyr-sdk.cmake has an unquoted var that hard-errors under CMake 4.x); `PATH=/Users/luke/repos/zmk/.venv/bin:$PATH`; then from $ZMK: `.venv/bin/west build -p -s app -d build/<name> -b 'nice_nano//zmk' -- -DZMK_CONFIG=<repo>/config [-DZMK_EXTRA_MODULES="a;b"]`. Copy `zephyr/zmk.uf2` to `staged-zmk.uf2` (atomic mv) for the flash watcher. Flash: double-tap RST → `/Volumes/NICEBOOT`.
4. **pro_micro pin references**: `&pro_micro N` with N = the blue Arduino number; map lives in `app/module/boards/nicekeyboards/nice_nano/arduino_pro_micro_pins.dtsi` (0→P0.08, 1→P0.06, 4→P0.22, 7→P0.11, 16→P0.10, 18→P1.15, 19→P0.02, …). **I²C0 is hard-pinctrl'd to D2/D3 (P0.17 SDA / P0.20 SCL)** — the OLED must live there: `&pro_micro_i2c { status="okay"; oled: ssd1306@3c { compatible="solomon,ssd1306fb"; …128x32: height=<32>, multiplex-ratio=<31>; 128x64: 64/63 … }; }` + `chosen { zephyr,display = &oled; }`.
5. **Matrix**: `zmk,kscan-gpio-matrix`, `diode-direction = "col2row"` (diode stripe/cathode → ROW wire), rows = ACTIVE_HIGH|PULL_DOWN, cols = ACTIVE_HIGH. Skip matrix-transform boilerplate by shipping an identity `RC(r,c)` map; **physical-layout node REQUIRES a `transform = <&…>` property** (build error otherwise).
6. **Encoders**: `compatible = "alps,ec11"`, a/b-gpios with `GPIO_ACTIVE_LOW | GPIO_PULL_UP`, `steps = <80>`; collect in `sensors { compatible = "zmk,keymap-sensors"; sensors = <&enc1 &enc2>; triggers-per-rotation = <20>; }`. Conf: `CONFIG_EC11=y` + `CONFIG_EC11_TRIGGER_GLOBAL_THREAD=y`.
7. **Keymap API (2026 main)**: `&cp` is REMOVED — encoder sensor-bindings use `&inc_dec_kp C_VOL_UP C_VOL_DN` (consumer codes live in key-press now; `&kp C_VOLUME_UP` also fine for keys). sensor-bindings are PER-LAYER, order matches the sensors list. Display: `CONFIG_ZMK_DISPLAY=y` + widget CONFIGs (battery/output/layer on, wpm/peripheral off for small panels).
8. **Verify by building** — a config that compiles is ~correct; flash is UF2-drag. Memory: OLED+encoders+BT ≈ 40% of 792KB flash on nRF52840.
