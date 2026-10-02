---
name: "zmk"
description: "ZMK keyboard firmware on nice!nano — create/debug config repos (flat config layout, build.sh with toolchain workaround, pro_micro pin map, OLED/encoder/keymap API for 2026 ZMK main, SHIELD/devicetree build errors), the ffkb v2 board overlay (build/flash loop, Cirque trackpad bring-up, I²C no-ACK triage), and meter-less pin-level bus/signal diagnostics via GPIO pull-up/pull-down classification firmware. Use when writing keyboard firmware, hitting SHIELD or devicetree build errors, flashing nice_nano, bringing up an I²C/SPI peripheral with no multimeter, or diagnosing the ffkb v2 specifically."
---

# ZMK firmware (nice!nano): config recipe · ffkb v2 overlay · pin diagnostics

One home for ZMK knowledge in three parts: **§1** generic config-repo recipe (any handwired/custom board) · **§2** ffkb v2 board overlay · **§3** meter-less pin diagnostics. Local toolchain: `~/repos/zmk` (checkout pinned-ish on main) with `.venv` + zephyr-sdk 0.17; `~/repos/ffkb-config` is the reference repo style.

## 1. Config repo recipe (generic — any handwired board)

Creating or debugging a ZMK config for a handwired/custom keyboard on nice!nano (v2/BLE) — new build, adding encoders/OLED, or "invalid SHIELD"/devicetree errors.

1. **Repo layout (flat config, matches ffkb-config)**: `config/<board>.overlay`, `<board>.keymap`, `<board>.conf` + `build.sh` + `README.md` (wiring). Board-named files auto-apply — **`-DSHIELD=<name>` only works for shields registered in a module** (boards/shields/<name>/*.zmk.yml); for a handwired one-off, name files after the BOARD (`nice_nano.*`) and drop SHIELD entirely. Unregistered shield name → cmake "Invalid SHIELD".
2. **Board string for nice!nano v2 (HWMv2)**: `-b 'nice_nano//zmk'` (board//variant; revision 2.0.0 is default). The dts files on disk are `nice_nano_nrf52840_zmk*`.
3. **build.sh essentials**: `export ZEPHYR_TOOLCHAIN_VARIANT=zephyr` FIRST (Zephyr 4.1's FindZephyr-sdk.cmake has an unquoted var that hard-errors under CMake 4.x); `PATH=/Users/luke/repos/zmk/.venv/bin:$PATH`; then from $ZMK: `.venv/bin/west build -p -s app -d build/<name> -b 'nice_nano//zmk' -- -DZMK_CONFIG=<repo>/config [-DZMK_EXTRA_MODULES="a;b"]`. Copy `zephyr/zmk.uf2` to `staged-zmk.uf2` (atomic mv) for the flash watcher. Flash: double-tap RST → `/Volumes/NICEBOOT`.
4. **pro_micro pin references**: `&pro_micro N` with N = the blue Arduino number; map lives in `app/module/boards/nicekeyboards/nice_nano/arduino_pro_micro_pins.dtsi` (0→P0.08, 1→P0.06, 4→P0.22, 7→P0.11, 16→P0.10, 18→P1.15, 19→P0.02, …). **I²C0 is hard-pinctrl'd to D2/D3 (P0.17 SDA / P0.20 SCL)** — the OLED must live there: `&pro_micro_i2c { status="okay"; oled: ssd1306@3c { compatible="solomon,ssd1306fb"; …128x32: height=<32>, multiplex-ratio=<31>; 128x64: 64/63 … }; }` + `chosen { zephyr,display = &oled; }`.
5. **Matrix**: `zmk,kscan-gpio-matrix`, `diode-direction = "col2row"` (diode stripe/cathode → ROW wire), rows = ACTIVE_HIGH|PULL_DOWN, cols = ACTIVE_HIGH. Skip matrix-transform boilerplate by shipping an identity `RC(r,c)` map; **physical-layout node REQUIRES a `transform = <&…>` property** (build error otherwise).
6. **Encoders**: `compatible = "alps,ec11"`, a/b-gpios with `GPIO_ACTIVE_LOW | GPIO_PULL_UP`, `steps = <80>`; collect in `sensors { compatible = "zmk,keymap-sensors"; sensors = <&enc1 &enc2>; triggers-per-rotation = <20>; }`. Conf: `CONFIG_EC11=y` + `CONFIG_EC11_TRIGGER_GLOBAL_THREAD=y`.
7. **Keymap API (2026 main)**: `&cp` is REMOVED — encoder sensor-bindings use `&inc_dec_kp C_VOL_UP C_VOL_DN` (consumer codes live in key-press now; `&kp C_VOLUME_UP` also fine for keys). sensor-bindings are PER-LAYER, order matches the sensors list. Display: `CONFIG_ZMK_DISPLAY=y` + widget CONFIGs (battery/output/layer on, wpm/peripheral off for small panels).
8. **Verify by building** — a config that compiles is ~correct; flash is UF2-drag. Memory: OLED+encoders+BT ≈ 40% of 792KB flash on nRF52840.

## 2. Board overlay: ffkb v2 + nice!nano (build/flash/Cirque loop)

Source of truth: `~/repos/ffkb-config/AGENTS.md` — read fully before touching anything.

### Build / flash / console

- Build: `bash ~/repos/ffkb-config/build.sh` with **cwd = ~/repos/zmk** (script calls `.venv/bin/west` + `-s app` relative). Exports `ZEPHYR_TOOLCHAIN_VARIANT=zephyr`.
- Before building, `git -C zmk/zephyr status --short` must be empty — a session had 93 silently-deleted files killing CMake configure (`subfolder_list.py` missing); fix: `git -C zmk/zephyr checkout -- .`.
- Flash: hold RST + replug (double-tap flaky). `ffkb-flash` hub daemon watches `/Volumes/NICENANO`, force-mounts, `cp -X`, verifies size. If board won't enter bootloader, try unplugging the FPC first.
- Console: `ffkb-serial` hub daemon (monitor.sh, `/dev/cu.*` only). **Boot-log tail truncates across USB re-enumeration** — a log ending mid-line at kscan init is not a crash; confirm with real keypresses.
- Pre-flight check after any build: keybinding count = 44 (`grep -c 'default_layer_P_bindings_IDX.*_PH ' build/ffkb_v2/zephyr/include/generated/zephyr/devicetree_generated.h` — note `zephyr/` path segment). Catches lost matrix rows.

### Pin map (ffkb v2 PCB silk ≠ pro_micro!)

Silk D-numbers are shifted. Trust GPIO numbers: P0.06 = silk "TX0/D3 (006)" = pro_micro D1 = **Cirque DR target**; silk "D1" = P0.17 = pro_micro D2 = SDA (trap); P0.20 = SCL; P1.06 = pro_micro D9 = matrix col 0. P0.06 is LED-data XOR DR — mutually exclusive (overlay disables spi3).

### Cirque bring-up triage

1. Hardware: trackpad flex → 12-pin 0.5mm FPC → J3 socket (bottom of PCB). Carries SDA/SCL/power/GND; **DR is hand-wired to P0.06 only**. Trackpad power = LDO U2 from 5V rail (bridge 5V↔3.3V through-holes ONLY if U2 removed).
2. **R1 populated on trackpad back = SPI mode = I²C no-ACK.** Remove it for I²C @ 0x2A.
3. Boot log: `pinnacle: Failed to read FirmwareId` = I²C no-ACK (device absent/unpowered/wrong mode). Ruled out in order: R1, cable parity (flip one end), pull-ups.
4. Pull-ups: `&pinctrl { i2c0_default { group1 { bias-pull-up; } } i2c0_sleep { group1 { bias-pull-up; } } };` in config overlay. Verify merge via `bias_pull_up` (underscores) in devicetree_generated.h — hyphenated grep misses it.
5. **No-meter bus diagnosis (address-level)**: `~/repos/ffkb-config/i2cscan-module` — SYS_INIT(APPLICATION) probes 0x08–0x77 with 1-byte i2c_write, logs ACKs. Build with `ZMK_EXTRA_MODULES` including it; results in boot log. ACK@0x2a = pad alive; nothing = dead bus (seat/cable/rail). Sibling to §3's GPIO classification — that answers *what each line is doing electrically*.
6. Working config lives in `ffkb-config/config/ffkb_v2.overlay` (glidepoint@2a + listener + spi3 off + pulls); `CONFIG_ZMK_RGB_UNDERGLOW=n` + rgb_ug stripped from ADJ; DR soldered last, after bus answers.

### Gotchas

- Flash watcher "size mismatch: dst=" then cp failures = copy actually succeeded (bootloader reboots before verify) — benign.
- `/dev/tty.*` blocks forever; monitor must use `/dev/cu.*`.
- FPC-in occasionally blocks bootloader entry — unexplained; pull FPC to flash if needed.
- HEIC photos: convert with `sips -s format jpeg` before analysis; vision reads of small passives are unreliable — user's eyes on hardware win.

## 3. Meter-less pin-level diagnostics (GPIO classification)

When a ZMK board's I²C/SPI peripheral silently fails (no-ACK, init failure) and no multimeter is available, flash a firmware that reads the suspect pins as plain GPIOs and classifies each line electrically. Takes one replug per experiment; the 5 s repeat loop lets you physically manipulate hardware while results stream. (Companion to §2.5's i2cscan probe: that finds *which addresses ACK*, this finds *why the bus is dead*.)

### 3.1 Diagnostic module

Zephyr module (`zephyr/module.yml` + `CMakeLists.txt` + `src/*.c`), added via `ZMK_EXTRA_MODULES`. Core pattern:

- `SYS_INIT(..., APPLICATION, CONFIG_APPLICATION_INIT_PRIORITY)` spawns a `K_THREAD` at lowest app priority.
- **Sleep 3 s before any output** — the USB CDC enumeration window (~0.9–1.2 s) drops console output and fakes crash loops.
- Loop forever, 5 s period: for each pin, `gpio_pin_configure(port, pin, GPIO_INPUT | pull)` → `k_msleep(2)` (settle through the ~13k internal pull) → `gpio_pin_get_raw` → reconfigure `GPIO_DISCONNECTED`. Test pull-up then pull-down.
- Pair with a config overlay that sets `status = "disabled"` on the peripheral owning the pins (e.g. `&pro_micro_i2c`, `&spi3`) so the diag module owns them.

### 3.2 Classification table

| Reading (up=with pull-up, dn=with pull-down) | Meaning |
|---|---|
| up=1 dn=0 | floats — healthy open line |
| up=0 dn=0 | stuck/clamped LOW — short to GND, or unpowered-device ESD clamp |
| up=1 dn=1 | driven HIGH — something is actively powering the line |
| dn=1 (up=1) | stuck HIGH — short to rail |

### 3.3 Signature interpretation

- **Both SDA+SCL stuck low, device connected**: unpowered device clamping the bus through ESD diodes (power not arriving — LDO dead or power contacts not mating), or flex misaligned by one contact onto GND positions. Not an address/pull-up problem.
- **Single line stuck low**: residue/solder bridge on that net.
- **Lines float with the cable out but clamp with it in**: fault rides in on the cable/device — fix seating/orientation (contacts must face socket fingers at BOTH ends), or device power path.
- **Lines stuck low with the cable out**: PCB-side short (under connector, worked pads) — reseat can't fix; wick and inspect.
- **Hand-wired signal as continuity probe**: with the device unpowered, a bonded wire reads up=0 (clamped low); up=1 = wire floats = open joint. Add a pull-down read to separate driven-high (dn=1) from floating (dn=0).

### 3.4 Build/flash loop gotchas

- `west build -p -s app -b <board> -- -DSHIELD=<shield> -DZMK_CONFIG=<dir> -DZMK_EXTRA_MODULES=<mods;...>` — needs the west venv on PATH (ninja lives there); run from the zmk workspace root.
- Recover the exact invocation of a previous build from the build dir's `CMakeCache.txt` (`CACHED_ZMK_CONFIG`, `ZMK_EXTRA_MODULES`).
- A flash watcher deploys whatever UF2 was staged last — verify the staged image's identity before interpreting "what got flashed". Boot-log banner is the ground truth of what's running.
- Flash copies to bootloader volumes must use `cp -X` (xattr race corrupts); stage via atomic rename so rebuilds never feed the watcher a half-written file.
- `CONFIG_LOG_MODE_IMMEDIATE=y` or a hard fault loses you the evidence. A log ending mid-line at init is often just the CDC re-enumeration drop, not a crash — verify with keypresses before diagnosing firmware faults.
- Don't flash peripheral-enabled firmware before the peripheral is wired (ZMK Cirque builds break keys when the trackpad is absent).
