---
name: ffkb-v2-zmk-loop
description: "Build/flash/diagnose the ffkb v2 + nice!nano ZMK build, incl. Cirque trackpad bring-up and I²C no-ACK triage"
---

# ffkb v2 + nice!nano ZMK loop

Source of truth: `~/repos/ffkb-config/AGENTS.md` — read fully before touching anything.

## Build / flash / console

- Build: `bash ~/repos/ffkb-config/build.sh` with **cwd = ~/repos/zmk** (script calls `.venv/bin/west` + `-s app` relative). Exports `ZEPHYR_TOOLCHAIN_VARIANT=zephyr`.
- Before building, `git -C zmk/zephyr status --short` must be empty — a session had 93 silently-deleted files killing CMake configure (`subfolder_list.py` missing); fix: `git -C zmk/zephyr checkout -- .`.
- Flash: hold RST + replug (double-tap flaky). `ffkb-flash` hub daemon watches `/Volumes/NICENANO`, force-mounts, `cp -X`, verifies size. If board won't enter bootloader, try unplugging the FPC first.
- Console: `ffkb-serial` hub daemon (monitor.sh, `/dev/cu.*` only). **Boot-log tail truncates across USB re-enumeration** — a log ending mid-line at kscan init is not a crash; confirm with real keypresses.
- Pre-flight check after any build: keybinding count = 44 (`grep -c 'default_layer_P_bindings_IDX.*_PH ' build/ffkb_v2/zephyr/include/generated/zephyr/devicetree_generated.h` — note `zephyr/` path segment). Catches lost matrix rows.

## Pin map (ffkb v2 PCB silk ≠ pro_micro!)

Silk D-numbers are shifted. Trust GPIO numbers: P0.06 = silk "TX0/D3 (006)" = pro_micro D1 = **Cirque DR target**; silk "D1" = P0.17 = pro_micro D2 = SDA (trap); P0.20 = SCL; P1.06 = pro_micro D9 = matrix col 0. P0.06 is LED-data XOR DR — mutually exclusive (overlay disables spi3).

## Cirque bring-up triage

1. Hardware: trackpad flex → 12-pin 0.5mm FPC → J3 socket (bottom of PCB). Carries SDA/SCL/power/GND; **DR is hand-wired to P0.06 only**. Trackpad power = LDO U2 from 5V rail (bridge 5V↔3.3V through-holes ONLY if U2 removed).
2. **R1 populated on trackpad back = SPI mode = I²C no-ACK.** Remove it for I²C @ 0x2A.
3. Boot log: `pinnacle: Failed to read FirmwareId` = I²C no-ACK (device absent/unpowered/wrong mode). Ruled out in order: R1, cable parity (flip one end), pull-ups.
4. Pull-ups: `&pinctrl { i2c0_default { group1 { bias-pull-up; } } i2c0_sleep { group1 { bias-pull-up; } } };` in config overlay. Verify merge via `bias_pull_up` (underscores) in devicetree_generated.h — hyphenated grep misses it.
5. **No-meter bus diagnosis**: `~/repos/ffkb-config/i2cscan-module` — SYS_INIT(APPLICATION) probes 0x08–0x77 with 1-byte i2c_write, logs ACKs. Build with `ZMK_EXTRA_MODULES` including it; results in boot log. ACK@0x2a = pad alive; nothing = dead bus (seat/cable/rail).
6. Working config lives in `ffkb-config/config/ffkb_v2.overlay` (glidepoint@2a + listener + spi3 off + pulls); `CONFIG_ZMK_RGB_UNDERGLOW=n` + rgb_ug stripped from ADJ; DR soldered last, after bus answers.

## Gotchas

- Flash watcher "size mismatch: dst=" then cp failures = copy actually succeeded (bootloader reboots before verify) — benign.
- `/dev/tty.*` blocks forever; monitor must use `/dev/cu.*`.
- FPC-in occasionally blocks bootloader entry — unexplained; pull FPC to flash if needed.
- HEIC photos: convert with `sips -s format jpeg` before analysis; vision reads of small passives are unreliable — user's eyes on hardware win.
