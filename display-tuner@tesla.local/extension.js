import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import {COLOR_MODES, RGB_RANGES, DisplayConfigProxy, applyMonitorOption, unpackState} from './displayConfig.js';
import {PARAMS, SHORTCUTS, applyPreset, getPresets, matchingPreset} from './params.js';

const FRAGMENT_SHADER = `
uniform sampler2D tex;
uniform float vibrance;
uniform float saturation;
uniform float contrast;
uniform float brightness;
uniform float gamma;
uniform float temperature;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

void main() {
    vec4 c = texture2D(tex, cogl_tex_coord_in[0].st);
    vec3 rgb = c.rgb;

    // Color temperature: warm boosts red / cuts blue, cool does the opposite.
    rgb *= vec3(1.0 + 0.10 * temperature, 1.0 + 0.02 * temperature, 1.0 - 0.18 * temperature);

    rgb = (rgb - 0.5) * contrast + 0.5 + brightness;

    float l = dot(rgb, LUMA);
    rgb = mix(vec3(l), rgb, saturation);

    // Vibrance: like saturation, but weighted toward muted colors so already
    // vivid colors (and skin tones) don't clip. This is what NVIDIA's
    // "Digital Vibrance" does.
    float mx = max(rgb.r, max(rgb.g, rgb.b));
    float mn = min(rgb.r, min(rgb.g, rgb.b));
    float sat = clamp(mx - mn, 0.0, 1.0);
    l = dot(rgb, LUMA);
    rgb = mix(vec3(l), rgb, 1.0 + vibrance * (1.0 - sat));

    rgb = pow(clamp(rgb, 0.0, 1.0), vec3(1.0 / gamma));
    cogl_color_out = vec4(rgb, 1.0) * c.a;
}
`;

function floatValue(v) {
    const value = new GObject.Value();
    value.init(GObject.TYPE_FLOAT);
    value.set_float(v);
    return value;
}

const SliderItem = GObject.registerClass(
class SliderItem extends PopupMenu.PopupBaseMenuItem {
    constructor(param, settings) {
        super({activate: false, style_class: 'display-tuner-row'});
        this._param = param;
        this._settings = settings;

        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        const header = new St.BoxLayout({x_expand: true});
        header.add_child(new St.Label({text: param.label, x_expand: true}));
        this._valueLabel = new St.Label({style_class: 'display-tuner-value'});
        header.add_child(this._valueLabel);
        box.add_child(header);

        this._slider = new Slider(0);
        this._slider.x_expand = true;
        box.add_child(this._slider);
        this.add_child(box);

        this._slider.connect('notify::value', () => {
            if (this._syncing)
                return;
            let v = param.min + this._slider.value * (param.max - param.min);
            // Snap to neutral so it's easy to get back to "off"
            if (Math.abs(v - param.neutral) < (param.max - param.min) * 0.015)
                v = param.neutral;
            this._settings.set_double(param.key, v);
        });
        this.sync();
    }

    sync() {
        const p = this._param;
        const v = this._settings.get_double(p.key);
        this._syncing = true;
        this._slider.value = (v - p.min) / (p.max - p.min);
        this._syncing = false;
        this._valueLabel.text = p.format(v);
    }
});

const DisplayTunerToggle = GObject.registerClass(
class DisplayTunerToggle extends QuickMenuToggle {
    constructor(extension) {
        super({
            title: 'Display Tuner',
            iconName: 'preferences-color-symbolic',
            toggleMode: true,
        });
        this._settings = extension.getSettings();
        this._settings.bind('enabled', this, 'checked', Gio.SettingsBindFlags.DEFAULT);

        this.menu.setHeader('preferences-color-symbolic', 'Display Tuner', 'Color adjustments');

        this._presetSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._presetSection);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._sliders = PARAMS.map(p => {
            const item = new SliderItem(p, this._settings);
            this.menu.addMenuItem(item);
            return item;
        });

        const reset = new PopupMenu.PopupMenuItem('Reset color adjustments');
        reset.connect('activate', () => {
            for (const p of PARAMS)
                this._settings.reset(p.key);
        });
        this.menu.addMenuItem(reset);

        this._monitorSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(this._monitorSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const prefs = new PopupMenu.PopupMenuItem('Presets & Shortcuts…');
        prefs.connect('activate', () => extension.openPreferences());
        this.menu.addMenuItem(prefs);

        this._settings.connectObject('changed', (_s, key) => {
            if (key === 'presets')
                this._buildPresetSection();
            this._sliders.forEach(s => s.sync());
            this._updateSubtitle();
        }, this);
        this._buildPresetSection();
        this._updateSubtitle();

        this._displayConfig = new DisplayConfigProxy(Gio.DBus.session,
            'org.gnome.Mutter.DisplayConfig', '/org/gnome/Mutter/DisplayConfig',
            (_proxy, error) => {
                if (error)
                    logError(error, 'Display Tuner: DisplayConfig proxy');
                else
                    this._refreshMonitors();
            });
        this._monitorsChangedId = this._displayConfig.connectSignal('MonitorsChanged',
            () => this._refreshMonitors());
    }

    _updateSubtitle() {
        const active = matchingPreset(this._settings);
        this.subtitle = active ?? 'Custom';
        for (const [name, item] of this._presetItems)
            item.setOrnament(name === active ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
    }

    _buildPresetSection() {
        this._presetSection.removeAll();
        this._addHeader(this._presetSection, 'Preset');
        this._presetItems = new Map();
        for (const name of Object.keys(getPresets(this._settings))) {
            const item = new PopupMenu.PopupMenuItem(name);
            item.connect('activate', () => applyPreset(this._settings, name));
            this._presetSection.addMenuItem(item);
            this._presetItems.set(name, item);
        }
    }

    _refreshMonitors() {
        this._displayConfig.GetCurrentStateRemote((result, error) => {
            if (error) {
                logError(error, 'Display Tuner: GetCurrentState');
                return;
            }
            this._state = unpackState(result);
            this._buildMonitorSection();
        });
    }

    _buildMonitorSection() {
        this._monitorSection.removeAll();
        const [, monitors] = this._state;
        const multi = monitors.length > 1;

        for (const [[connector], , props] of monitors) {
            const name = props['display-name'] ?? connector;
            const supported = props['supported-color-modes'] ?? [];

            if (supported.length > 1) {
                this._addHeader(this._monitorSection, multi ? `Color Mode · ${name}` : 'Color Mode');
                for (const [mode, label] of COLOR_MODES) {
                    if (!supported.includes(mode))
                        continue;
                    this._addChoice(this._monitorSection, label, props['color-mode'] === mode,
                        () => this._applyMonitorOption(connector, 'color-mode', mode));
                }
            }

            if ('rgb-range' in props) {
                this._addHeader(this._monitorSection, multi ? `RGB Range · ${name}` : 'RGB Range');
                for (const [range, label] of RGB_RANGES) {
                    this._addChoice(this._monitorSection, label, props['rgb-range'] === range,
                        () => this._applyMonitorOption(connector, 'rgb-range', range));
                }
            }
        }
    }

    _addHeader(section, text) {
        const item = new PopupMenu.PopupMenuItem(text, {reactive: false, can_focus: false});
        item.label.add_style_class_name('display-tuner-header');
        section.addMenuItem(item);
    }

    _addChoice(section, label, active, callback) {
        const item = new PopupMenu.PopupMenuItem(label);
        item.setOrnament(active ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
        item.connect('activate', () => {
            if (!active)
                callback();
        });
        section.addMenuItem(item);
    }

    _applyMonitorOption(connector, option, value) {
        applyMonitorOption(this._displayConfig, this._state, connector, option, value, error => {
            if (error) {
                Main.notifyError('Display Tuner', `Could not change ${option}: ${error.message}`);
                this._refreshMonitors();
            }
        });
    }

    destroy() {
        this._displayConfig.disconnectSignal(this._monitorsChangedId);
        this._displayConfig = null;
        super.destroy();
    }
});

const DisplayTunerIndicator = GObject.registerClass(
class DisplayTunerIndicator extends SystemIndicator {
    constructor(extension) {
        super();
        this.toggle = new DisplayTunerToggle(extension);
        this.quickSettingsItems.push(this.toggle);
    }

    destroy() {
        this.quickSettingsItems.forEach(item => item.destroy());
        super.destroy();
    }
});

export default class DisplayTunerExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._effect = new Clutter.ShaderEffect();
        this._effect.set_shader_source(FRAGMENT_SHADER);
        this._effectAttached = false;

        this._indicator = new DisplayTunerIndicator(this);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);

        this._settings.connectObject('changed', () => this._updateEffect(), this);
        this._updateEffect();

        for (const shortcut of SHORTCUTS) {
            Main.wm.addKeybinding(shortcut.key, this._settings, Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                () => this._onShortcut(shortcut));
        }
    }

    disable() {
        for (const shortcut of SHORTCUTS)
            Main.wm.removeKeybinding(shortcut.key);
        this._settings.disconnectObject(this);
        this._detachEffect();
        this._effect = null;
        this._indicator.destroy();
        this._indicator = null;
        this._settings = null;
    }

    _onShortcut(shortcut) {
        const settings = this._settings;
        let message;
        if (shortcut.key === 'shortcut-toggle') {
            const enabled = !settings.get_boolean('enabled');
            settings.set_boolean('enabled', enabled);
            message = `Display Tuner ${enabled ? 'On' : 'Off'}`;
        } else {
            let name = shortcut.preset;
            if (!name) {
                const names = Object.keys(getPresets(settings));
                const current = names.indexOf(matchingPreset(settings));
                name = names[(current + 1) % names.length];
            }
            applyPreset(settings, name);
            message = name;
        }
        Main.osdWindowManager.showAll(Gio.ThemedIcon.new('preferences-color-symbolic'), message, null, null);
    }

    _updateEffect() {
        const values = Object.fromEntries(PARAMS.map(p => [p.key, this._settings.get_double(p.key)]));
        const neutral = PARAMS.every(p => Math.abs(values[p.key] - p.neutral) < 1e-4);

        // Only keep the shader attached when it actually does something, so
        // fullscreen apps keep direct scanout when everything is neutral.
        if (!this._settings.get_boolean('enabled') || neutral) {
            this._detachEffect();
            return;
        }

        for (const [key, v] of Object.entries(values))
            this._effect.set_uniform_value(key, floatValue(v));

        if (!this._effectAttached) {
            Main.layoutManager.uiGroup.add_effect_with_name('display-tuner', this._effect);
            this._effectAttached = true;
        }
        this._effect.queue_repaint();
    }

    _detachEffect() {
        if (this._effectAttached) {
            Main.layoutManager.uiGroup.remove_effect(this._effect);
            this._effectAttached = false;
        }
    }
}
