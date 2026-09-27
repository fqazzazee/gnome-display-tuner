import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {COLOR_MODES, RGB_RANGES, DisplayConfigProxy, applyMonitorOption, unpackState} from './displayConfig.js';
import {
    BUILTIN_PRESETS, PARAMS, SHORTCUTS,
    applyPreset, describePreset, getPresets, matchingPreset, savePreset, setPresets,
} from './params.js';

export default class DisplayTunerPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;
        window.set_default_size(520, 720);

        const page = new Adw.PreferencesPage({title: 'Color', icon_name: 'preferences-color-symbolic'});
        window.add(page);

        const colorGroup = new Adw.PreferencesGroup({
            title: 'Color Adjustments',
            description: 'Applied to the whole desktop as a GPU shader.',
        });
        page.add(colorGroup);

        const enabledRow = new Adw.SwitchRow({title: 'Enable adjustments'});
        settings.bind('enabled', enabledRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        colorGroup.add(enabledRow);

        for (const p of PARAMS)
            colorGroup.add(this._sliderRow(p, settings));

        const resetButton = new Gtk.Button({
            label: 'Reset to Defaults',
            halign: Gtk.Align.END,
            margin_top: 12,
            css_classes: ['destructive-action'],
        });
        resetButton.connect('clicked', () => PARAMS.forEach(p => settings.reset(p.key)));
        colorGroup.add(resetButton);

        this._displayGroup = new Adw.PreferencesGroup({
            title: 'Display Output',
            description: 'Same as GNOME Settings › Displays. Changes are saved permanently.',
        });
        page.add(this._displayGroup);
        this._displayRows = [];

        this._proxy = new DisplayConfigProxy(Gio.DBus.session,
            'org.gnome.Mutter.DisplayConfig', '/org/gnome/Mutter/DisplayConfig',
            (_proxy, error) => {
                if (!error)
                    this._refreshMonitors(window);
            });
        const signalId = this._proxy.connectSignal('MonitorsChanged', () => this._refreshMonitors(window));

        const presetsPage = new Adw.PreferencesPage({title: 'Presets & Shortcuts', icon_name: 'view-list-symbolic'});
        window.add(presetsPage);
        this._buildPresetsGroup(presetsPage, settings, window);
        this._buildShortcutsGroup(presetsPage, settings, window);
        window.connect('close-request', () => {
            this._proxy.disconnectSignal(signalId);
            return false;
        });
    }

    _sliderRow(p, settings) {
        const row = new Adw.ActionRow({title: p.label});
        const valueLabel = new Gtk.Label({width_chars: 8, xalign: 1, css_classes: ['dim-label', 'numeric']});
        const scale = new Gtk.Scale({
            adjustment: new Gtk.Adjustment({lower: p.min, upper: p.max, step_increment: (p.max - p.min) / 100}),
            draw_value: false,
            hexpand: true,
            width_request: 220,
            valign: Gtk.Align.CENTER,
        });
        scale.add_mark(p.neutral, Gtk.PositionType.BOTTOM, null);
        row.add_suffix(scale);
        row.add_suffix(valueLabel);

        const sync = () => {
            const v = settings.get_double(p.key);
            if (Math.abs(scale.get_value() - v) > 1e-6)
                scale.set_value(v);
            valueLabel.label = p.format(v);
        };
        scale.connect('value-changed', () => {
            let v = scale.get_value();
            // Snap to neutral so it's easy to get back to "off"
            if (Math.abs(v - p.neutral) < (p.max - p.min) * 0.015)
                v = p.neutral;
            settings.set_double(p.key, v);
        });
        settings.connect(`changed::${p.key}`, sync);
        sync();
        return row;
    }

    _buildPresetsGroup(page, settings, window) {
        const group = new Adw.PreferencesGroup({
            title: 'Presets',
            description: 'Apply a preset, or save the current slider values into one.',
        });
        page.add(group);

        const newRow = new Adw.EntryRow({title: 'Save current values as new preset…', show_apply_button: true});
        newRow.connect('apply', () => {
            const name = newRow.text.trim();
            if (!name)
                return;
            if (name in getPresets(settings)) {
                window.add_toast(new Adw.Toast({title: `A preset named “${name}” already exists`}));
                return;
            }
            savePreset(settings, name);
            newRow.text = '';
        });

        let rows = [];
        const rebuild = () => {
            rows.forEach(r => group.remove(r));
            rows = [];
            const active = matchingPreset(settings);

            for (const [name, preset] of Object.entries(getPresets(settings))) {
                const row = new Adw.ActionRow({title: name, subtitle: describePreset(preset)});
                const check = new Gtk.Image({icon_name: 'object-select-symbolic', visible: name === active});
                row.add_prefix(check);

                const apply = new Gtk.Button({label: 'Apply', valign: Gtk.Align.CENTER, sensitive: name !== active});
                apply.connect('clicked', () => applyPreset(settings, name));
                row.add_suffix(apply);

                const save = new Gtk.Button({
                    icon_name: 'document-save-symbolic', valign: Gtk.Align.CENTER,
                    tooltip_text: 'Overwrite with the current slider values', css_classes: ['flat'],
                });
                save.connect('clicked', () => {
                    savePreset(settings, name);
                    window.add_toast(new Adw.Toast({title: `Saved “${name}”`}));
                });
                row.add_suffix(save);

                if (!BUILTIN_PRESETS.includes(name)) {
                    const del = new Gtk.Button({
                        icon_name: 'user-trash-symbolic', valign: Gtk.Align.CENTER,
                        tooltip_text: 'Delete preset', css_classes: ['flat'],
                    });
                    del.connect('clicked', () => {
                        const presets = getPresets(settings);
                        delete presets[name];
                        setPresets(settings, presets);
                    });
                    row.add_suffix(del);
                }
                group.add(row);
                rows.push(row);
            }
            // Keep the "new preset" entry last
            rows.push(newRow);
            group.add(newRow);
        };

        // Rebuild when presets change, or when slider changes alter which preset is active
        let lastActive = matchingPreset(settings);
        settings.connect('changed', (_s, key) => {
            const active = matchingPreset(settings);
            if (key === 'presets' || active !== lastActive) {
                lastActive = active;
                rebuild();
            }
        });
        rebuild();
    }

    _buildShortcutsGroup(page, settings, window) {
        const group = new Adw.PreferencesGroup({
            title: 'Keyboard Shortcuts',
            description: 'Click a shortcut to change it.',
        });
        page.add(group);

        for (const shortcut of SHORTCUTS) {
            const row = new Adw.ActionRow({title: shortcut.label, activatable: true});
            const label = new Gtk.ShortcutLabel({disabled_text: 'Disabled', valign: Gtk.Align.CENTER});
            row.add_suffix(label);

            const sync = () => {
                label.accelerator = settings.get_strv(shortcut.key)[0] ?? '';
            };
            settings.connect(`changed::${shortcut.key}`, sync);
            sync();

            row.connect('activated', () => this._captureShortcut(window, settings, shortcut));
            group.add(row);
        }

        const reset = new Gtk.Button({label: 'Reset Shortcuts', halign: Gtk.Align.END, margin_top: 12});
        reset.connect('clicked', () => SHORTCUTS.forEach(s => settings.reset(s.key)));
        group.add(reset);
    }

    _captureShortcut(window, settings, shortcut) {
        const dialog = new Adw.AlertDialog({
            heading: shortcut.label,
            body: 'Press a key combination.\nEsc to cancel, Backspace to disable.',
        });
        dialog.add_response('cancel', 'Cancel');

        const controller = new Gtk.EventControllerKey({propagation_phase: Gtk.PropagationPhase.CAPTURE});
        controller.connect('key-pressed', (_c, keyval, keycode, state) => {
            const mods = state & Gtk.accelerator_get_default_mod_mask();
            keyval = Gdk.keyval_to_lower(keyval);

            if (!mods && keyval === Gdk.KEY_Escape) {
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            if (!mods && keyval === Gdk.KEY_BackSpace) {
                settings.set_strv(shortcut.key, []);
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            // Wait for a real key, not just a modifier on its own
            if (!Gtk.accelerator_valid(keyval, mods))
                return Gdk.EVENT_STOP;

            settings.set_strv(shortcut.key, [Gtk.accelerator_name_with_keycode(null, keyval, keycode, mods)]);
            dialog.close();
            return Gdk.EVENT_STOP;
        });
        dialog.add_controller(controller);
        dialog.present(window);
    }

    _refreshMonitors(window) {
        this._proxy.GetCurrentStateRemote((result, error) => {
            if (error)
                return;
            const state = unpackState(result);
            this._displayRows.forEach(r => this._displayGroup.remove(r));
            this._displayRows = [];

            const [, monitors] = state;
            const multi = monitors.length > 1;
            for (const [[connector], , props] of monitors) {
                const name = props['display-name'] ?? connector;
                const suffix = multi ? ` · ${name}` : '';
                const supported = props['supported-color-modes'] ?? [];

                if (supported.length > 1) {
                    const modes = COLOR_MODES.filter(([m]) => supported.includes(m));
                    this._addCombo(window, state, connector, `Color Mode${suffix}`, 'color-mode', modes, props['color-mode']);
                }
                if ('rgb-range' in props)
                    this._addCombo(window, state, connector, `RGB Range${suffix}`, 'rgb-range', RGB_RANGES, props['rgb-range']);
            }
        });
    }

    _addCombo(window, state, connector, title, option, choices, current) {
        const row = new Adw.ComboRow({
            title,
            model: Gtk.StringList.new(choices.map(([, label]) => label)),
            selected: Math.max(0, choices.findIndex(([v]) => v === current)),
        });
        row.connect('notify::selected', () => {
            const value = choices[row.selected][0];
            if (value === current)
                return;
            applyMonitorOption(this._proxy, state, connector, option, value, error => {
                if (error) {
                    window.add_toast(new Adw.Toast({title: `Could not change ${option}: ${error.message}`}));
                    this._refreshMonitors(window);
                }
            });
        });
        this._displayGroup.add(row);
        this._displayRows.push(row);
    }
}
