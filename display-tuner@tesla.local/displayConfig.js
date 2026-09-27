import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const COLOR_MODES = [
    [0, 'Standard (SDR)'],
    [2, 'Native gamut (wide color)'],
    [1, 'HDR (BT.2100)'],
];

export const RGB_RANGES = [
    [1, 'Automatic'],
    [2, 'Full (0-255)'],
    [3, 'Limited (16-235)'],
];

const DisplayConfigIface = `
<node>
  <interface name="org.gnome.Mutter.DisplayConfig">
    <method name="GetCurrentState">
      <arg name="serial" direction="out" type="u"/>
      <arg name="monitors" direction="out" type="a((ssss)a(siiddada{sv})a{sv})"/>
      <arg name="logical_monitors" direction="out" type="a(iiduba(ssss)a{sv})"/>
      <arg name="properties" direction="out" type="a{sv}"/>
    </method>
    <method name="ApplyMonitorsConfig">
      <arg name="serial" direction="in" type="u"/>
      <arg name="method" direction="in" type="u"/>
      <arg name="logical_monitors" direction="in" type="a(iiduba(ssa{sv}))"/>
      <arg name="properties" direction="in" type="a{sv}"/>
    </method>
    <signal name="MonitorsChanged"/>
  </interface>
</node>`;
export const DisplayConfigProxy = Gio.DBusProxy.makeProxyWrapper(DisplayConfigIface);

const STATE_TYPE = '(ua((ssss)a(siiddada{sv})a{sv})a(iiduba(ssss)a{sv})a{sv})';

// GetCurrentState result -> plain JS [serial, monitors, logicalMonitors, props]
export function unpackState(result) {
    return new GLib.Variant(STATE_TYPE, result).recursiveUnpack();
}

// Re-apply the current layout unchanged, except for one monitor property.
// Method 2 = persistent (written to monitors.xml, same as GNOME Settings).
export function applyMonitorOption(proxy, state, targetConnector, option, value, callback) {
    const [serial, monitors, logicalMonitors, globalProps] = state;

    const monitorInfo = new Map(monitors.map(([[connector], modes, props]) => {
        const current = modes.find(m => m[6]['is-current']);
        return [connector, {mode: current?.[0], props}];
    }));

    const logical = logicalMonitors.map(([x, y, scale, transform, primary, lmMonitors]) => [
        x, y, scale, transform, primary,
        lmMonitors.map(([connector]) => {
            const info = monitorInfo.get(connector);
            const options = {};
            for (const key of ['color-mode', 'rgb-range']) {
                let v = info.props[key];
                if (connector === targetConnector && key === option)
                    v = value;
                if (v !== undefined)
                    options[key] = new GLib.Variant('u', v);
            }
            return [connector, info.mode, options];
        }),
    ]);

    const props = {};
    if (globalProps['supports-changing-layout-mode'] && 'layout-mode' in globalProps)
        props['layout-mode'] = new GLib.Variant('u', globalProps['layout-mode']);

    proxy.ApplyMonitorsConfigRemote(serial, 2, logical, props, (_r, error) => callback(error));
}
