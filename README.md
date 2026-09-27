# Display Tuner

NVIDIA-control-panel style color controls for GNOME Shell: **digital vibrance**, saturation, contrast, brightness, gamma and color temperature. You get them as sliders in Quick Settings, with presets and keyboard shortcuts. It also lets you switch your monitor's **color mode** (SDR / wide gamut / HDR) and **RGB range** (full / limited).

It works on **Wayland** and with **any GPU**. It was written because NVIDIA's digital vibrance (`nvidia-settings`, vibrantLinux, …) only works on X11.

## Features

- **Quick Settings tile** with a menu containing:
  - **Digital Vibrance**, on NVIDIA's scale (0–100%, 50% = neutral). It boosts muted colors more than already vivid ones, so skin tones and saturated colors don't clip.
  - **Saturation, Contrast, Brightness, Gamma, Color Temperature** (warm/cool).
  - **Presets.** The built-in *Desktop* and *Gaming* presets are included, and you can create your own.
  - **Color Mode:** Standard (SDR), Native gamut (wide color), or HDR (BT.2100). Only the modes your monitor supports are shown.
  - **RGB Range:** Automatic, Full (0–255), or Limited (16–235).
- **Settings window** (Extensions app → Display Tuner → Settings). It has the same controls, plus preset management and a shortcut editor.
- **Keyboard shortcuts**, all customizable. Each one shows an on-screen popup when used:

  | Shortcut | Action |
  |---|---|
  | <kbd>Super</kbd>+<kbd>Alt</kbd>+<kbd>V</kbd> | Turn adjustments on/off |
  | <kbd>Super</kbd>+<kbd>Alt</kbd>+<kbd>P</kbd> | Next preset |
  | <kbd>Super</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd> | Desktop preset |
  | <kbd>Super</kbd>+<kbd>Alt</kbd>+<kbd>G</kbd> | Gaming preset |

## Requirements

- GNOME Shell **50**
- Wayland or X11, any GPU (NVIDIA, AMD, Intel)

## Installation

```bash
git clone https://github.com/fqazzazee/gnome-display-tuner.git
cd gnome-display-tuner
./install.sh
```

Then **log out and back in**. On Wayland, GNOME Shell only picks up new extensions at login. Afterwards you'll find the **Display Tuner** tile in Quick Settings (top-right menu).

<details>
<summary>Manual installation</summary>

```bash
cp -r display-tuner@tesla.local ~/.local/share/gnome-shell/extensions/
glib-compile-schemas ~/.local/share/gnome-shell/extensions/display-tuner@tesla.local/schemas
# log out and back in, then:
gnome-extensions enable display-tuner@tesla.local
```
</details>

## Usage

- **Click the tile** to turn the adjustments on or off. **Click the arrow** to open the sliders.
- **Sliders snap to neutral** when you drag them near the midpoint.
- **To tune a preset:** adjust the sliders, then open *Settings → Presets & Shortcuts* and click the save icon next to the preset. Type a name in *Save current values as new preset…* to create a new one.
- **The tile's subtitle** shows the active preset, or *Custom* if the sliders don't match any preset.
- **To change a shortcut:** click it in Settings and press the new key combination. <kbd>Esc</kbd> cancels, <kbd>Backspace</kbd> turns the shortcut off.

## How it works

- **Color adjustments** are a GLSL shader (`Clutter.ShaderEffect`) applied to GNOME Shell's main UI group. That makes it independent of the GPU driver.
- **Color mode and RGB range** are changed through Mutter's `org.gnome.Mutter.DisplayConfig` D-Bus API, the same one GNOME Settings and `gdctl` use. These changes are saved to `monitors.xml`.

## Limitations

- **Screenshots and screen recordings** include the adjusted colors, because it's a compositor effect rather than a hardware setting. The mouse pointer is not affected.
- **Performance while the filter is active:** fullscreen apps can't use direct scanout while any slider is away from neutral, which costs a little performance in games. When every slider is neutral (e.g. the *Desktop* preset) or the adjustments are off, the shader is removed completely, so there's no cost.
- **Games that capture the keyboard:** some fullscreen games inhibit system shortcuts. If you allow that, the shortcuts won't work inside the game.
- **No YCbCr output format:** Mutter doesn't expose it.

## Uninstall

```bash
gnome-extensions uninstall display-tuner@tesla.local
```

## License

[GPL-2.0-or-later](LICENSE)
