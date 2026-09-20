---
name: zmk-pin-diag
description: "Meter-less pin-level bus/signal diagnostics for ZMK keyboards — GPIO pull-up/pull-down classification firmware when a multimeter isn't available"
---

# ZMK Pin-Level Diagnostics (meter-less)

When a ZMK board's I²C/SPI peripheral silently fails (no-ACK, init failure) and no multimeter is available, flash a firmware that reads the suspect pins as plain GPIOs and classifies each line electrically. Takes one replug per experiment; the 5 s repeat loop lets you physically manipulate hardware while results stream.

## 1. Diagnostic module

Zephyr module (`zephyr/module.yml` + `CMakeLists.txt` + `src/*.c`), added via `ZMK_EXTRA_MODULES`. Core pattern:

- `SYS_INIT(..., APPLICATION, CONFIG_APPLICATION_INIT_PRIORITY)` spawns a `K_THREAD` at lowest app priority.
- **Sleep 3 s before any output** — the USB CDC enumeration window (~0.9–1.2 s) drops console output and fakes crash loops.
- Loop forever, 5 s period: for each pin, `gpio_pin_configure(port, pin, GPIO_INPUT | pull)` → `k_msleep(2)` (settle through the ~13k internal pull) → `gpio_pin_get_raw` → reconfigure `GPIO_DISCONNECTED`. Test pull-up then pull-down.
- Pair with a config overlay that sets `status = "disabled"` on the peripheral owning the pins (e.g. `&pro_micro_i2c`, `&spi3`) so the diag module owns them.

## 2. Classification table

| Reading (up=with pull-up, dn=with pull-down) | Meaning |
|---|---|
| up=1 dn=0 | floats — healthy open line |
| up=0 dn=0 | stuck/clamped LOW — short to GND, or unpowered-device ESD clamp |
| up=1 dn=1 | driven HIGH — something is actively powering the line |
| dn=1 (up=1) | stuck HIGH — short to rail |

## 3. Signature interpretation

- **Both SDA+SCL stuck low, device connected**: unpowered device clamping the bus through ESD diodes (power not arriving — LDO dead or power contacts not mating), or flex misaligned by one contact onto GND positions. Not an address/pull-up problem.
- **Single line stuck low**: residue/solder bridge on that net.
- **Lines float with the cable out but clamp with it in**: fault rides in on the cable/device — fix seating/orientation (contacts must face socket fingers at BOTH ends), or device power path.
- **Lines stuck low with the cable out**: PCB-side short (under connector, worked pads) — reseat can't fix; wick and inspect.
- **Hand-wired signal as continuity probe**: with the device unpowered, a bonded wire reads up=0 (clamped low); up=1 = wire floats = open joint. Add a pull-down read to separate driven-high (dn=1) from floating (dn=0).

## 4. Build/flash loop gotchas

- `west build -p -s app -b <board> -- -DSHIELD=<shield> -DZMK_CONFIG=<dir> -DZMK_EXTRA_MODULES=<mods;...>` — needs the west venv on PATH (ninja lives there); run from the zmk workspace root.
- Recover the exact invocation of a previous build from the build dir's `CMakeCache.txt` (`CACHED_ZMK_CONFIG`, `ZMK_EXTRA_MODULES`).
- A flash watcher deploys whatever UF2 was staged last — verify the staged image's identity before interpreting "what got flashed". Boot-log banner is the ground truth of what's running.
- Flash copies to bootloader volumes must use `cp -X` (xattr race corrupts); stage via atomic rename so rebuilds never feed the watcher a half-written file.
- `CONFIG_LOG_MODE_IMMEDIATE=y` or a hard fault loses you the evidence. A log ending mid-line at init is often just the CDC re-enumeration drop, not a crash — verify with keypresses before diagnosing firmware faults.
- Don't flash peripheral-enabled firmware before the peripheral is wired (ZMK Cirque builds break keys when the trackpad is absent).
