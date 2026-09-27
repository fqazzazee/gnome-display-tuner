import GLib from 'gi://GLib';

const pct = v => `${Math.round(v * 100)}%`;

// Slider definitions. `neutral` is the value at which the shader does nothing.
export const PARAMS = [
    {
        key: 'vibrance', label: 'Digital Vibrance', min: -1, max: 1, neutral: 0,
        // Match NVIDIA's scale: 0% .. 50% (default) .. 100%
        format: v => `${Math.round(50 + v * 50)}%`,
    },
    {key: 'saturation', label: 'Saturation', min: 0, max: 2, neutral: 1, format: pct},
    {key: 'contrast', label: 'Contrast', min: 0.5, max: 1.5, neutral: 1, format: pct},
    {
        key: 'brightness', label: 'Brightness', min: -0.25, max: 0.25, neutral: 0,
        format: v => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}`,
    },
    {key: 'gamma', label: 'Gamma', min: 0.5, max: 2, neutral: 1, format: v => v.toFixed(2)},
    {
        key: 'temperature', label: 'Color Temperature', min: -1, max: 1, neutral: 0,
        format: v => (Math.abs(v) < 0.005 ? 'Neutral' : `${v > 0 ? 'Warm' : 'Cool'} ${Math.round(Math.abs(v) * 100)}`),
    },
];

// Presets that shortcuts refer to; they can be overwritten but not deleted.
export const BUILTIN_PRESETS = ['Desktop', 'Gaming'];

export const SHORTCUTS = [
    {key: 'shortcut-toggle', label: 'Turn adjustments on/off'},
    {key: 'shortcut-next-preset', label: 'Next preset'},
    {key: 'shortcut-preset-desktop', label: 'Desktop preset', preset: 'Desktop'},
    {key: 'shortcut-preset-gaming', label: 'Gaming preset', preset: 'Gaming'},
];

export function getPresets(settings) {
    return settings.get_value('presets').recursiveUnpack();
}

export function setPresets(settings, presets) {
    settings.set_value('presets', new GLib.Variant('a{sa{sd}}', presets));
}

export function currentValues(settings) {
    return Object.fromEntries(PARAMS.map(p => [p.key, settings.get_double(p.key)]));
}

export function applyPreset(settings, name) {
    const preset = getPresets(settings)[name];
    if (!preset)
        return;
    // Write all values at once so the shader updates in a single step
    settings.delay();
    for (const p of PARAMS)
        settings.set_double(p.key, preset[p.key] ?? p.neutral);
    settings.set_boolean('enabled', true);
    settings.apply();
}

export function savePreset(settings, name) {
    const presets = getPresets(settings);
    presets[name] = currentValues(settings);
    setPresets(settings, presets);
}

// Name of the preset matching the current values, or null if customized.
export function matchingPreset(settings) {
    const values = currentValues(settings);
    for (const [name, preset] of Object.entries(getPresets(settings))) {
        if (PARAMS.every(p => Math.abs((preset[p.key] ?? p.neutral) - values[p.key]) < 1e-3))
            return name;
    }
    return null;
}

export function describePreset(preset) {
    const parts = PARAMS
        .filter(p => Math.abs((preset[p.key] ?? p.neutral) - p.neutral) > 1e-3)
        .map(p => `${p.label.replace('Digital ', '').replace('Color ', '')} ${p.format(preset[p.key])}`);
    return parts.length ? parts.join(' · ') : 'No adjustments';
}
