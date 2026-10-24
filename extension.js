// SPDX-FileCopyrightText: 2026 JimyHN
// SPDX-License-Identifier: GPL-3.0-or-later

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Cairo from 'cairo';
import Soup from 'gi://Soup?version=3.0';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {drawCube, hexToRgb} from './cube.js';

const API_BASE = 'https://labs.hackthebox.com/api/v4/';
const VPN_CHECK_SECONDS = 2;
const API_POLL_USEC = 10 * 1000 * 1000;
const SETTLE_SECONDS = 10;
const RIPPLE_MS = 450;
const DEFAULT_COLOR = '#9fef00';
const BOXES = ['left', 'center', 'right'];

const colorOrDefault = value =>
    /^#[0-9a-fA-F]{6}$/.test(value) ? value : DEFAULT_COLOR;

const lighten = ([r, g, b]) =>
    [r + (1 - r) * 0.45, g + (1 - g) * 0.45, b + (1 - b) * 0.45];

const HtbIndicator = GObject.registerClass(
class HtbIndicator extends PanelMenu.Button {
    _init(extension) {
        // No menu: a click copies the IP
        super._init(0.0, extension.metadata.name, true);

        this._ip = null;
        this._logoColor = DEFAULT_COLOR;
        this._ipColor = DEFAULT_COLOR;
        this._progress = 1; // 1 = no ripple running
        this._rippleId = 0;

        const stack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });

        this._ripple = new St.DrawingArea({x_expand: true, y_expand: true});
        this._ripple.connect('repaint', area => this._drawRipple(area));

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._cube = new St.DrawingArea({
            width: 18,
            height: 18,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._cube.connect('repaint', area => this._drawCube(area));
        this._label = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._cube);
        box.add_child(this._label);

        stack.add_child(this._ripple);
        stack.add_child(box);
        this.add_child(stack);

        this.connect('button-press-event', () => {
            this._onClick();
            return Clutter.EVENT_STOP;
        });
        this.connect('touch-event', (_actor, event) => {
            if (event.type() !== Clutter.EventType.TOUCH_BEGIN)
                return Clutter.EVENT_PROPAGATE;
            this._onClick();
            return Clutter.EVENT_STOP;
        });
        this.connect('destroy', () => this._stopRipple());
    }

    update({ip, logoColor, ipColor}) {
        this._ip = ip;
        this._logoColor = logoColor;
        this._ipColor = ipColor;

        this._label.text = ip ?? '';
        this._label.set_style(`color: ${ipColor}; font-weight: bold; margin-left: 6px;`);
        this._cube.queue_repaint();
        this.visible = !!ip;
    }

    _onClick() {
        if (!this._ip)
            return;
        const clipboard = St.Clipboard.get_default();
        clipboard.set_text(St.ClipboardType.CLIPBOARD, this._ip);
        clipboard.set_text(St.ClipboardType.PRIMARY, this._ip);
        this._startRipple();
    }

    _startRipple() {
        this._stopRipple();
        const start = GLib.get_monotonic_time();
        this._progress = 0;
        this._rippleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            this._progress = Math.min(1, (GLib.get_monotonic_time() - start) / (RIPPLE_MS * 1000));
            this._ripple.queue_repaint();
            if (this._progress >= 1) {
                this._rippleId = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopRipple() {
        if (this._rippleId) {
            GLib.source_remove(this._rippleId);
            this._rippleId = 0;
        }
        this._progress = 1;
    }

    _drawCube(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        drawCube(cr, w, h, hexToRgb(this._logoColor), 1.6);
        cr.$dispose();
    }

    _drawRipple(area) {
        const cr = area.get_context();
        const p = this._progress;
        if (p >= 1) {
            cr.$dispose();
            return;
        }

        const [w, h] = area.get_surface_size();
        const [areaX] = area.get_transformed_position();
        const [labelX] = this._label.get_transformed_position();
        // Left of this x is the cube (logo color), right of it the IP (ip color)
        const split = Math.max(0, Math.min(w, labelX - areaX - 3));

        const cx = w / 2;
        const cy = h / 2;
        const radius = Math.hypot(cx, cy) * (0.2 + 0.8 * p);
        const alpha = 0.6 * (1 - p);

        const paint = (x, width, rgb) => {
            if (width <= 0)
                return;
            cr.save();
            cr.rectangle(x, 0, width, h);
            cr.clip();
            const gradient = new Cairo.RadialGradient(cx, cy, 0, cx, cy, radius);
            gradient.addColorStopRGBA(0, rgb[0], rgb[1], rgb[2], alpha);
            gradient.addColorStopRGBA(0.6, rgb[0], rgb[1], rgb[2], alpha * 0.6);
            gradient.addColorStopRGBA(1, rgb[0], rgb[1], rgb[2], 0);
            cr.setSource(gradient);
            cr.paint();
            cr.restore();
        };

        paint(0, split, lighten(hexToRgb(this._logoColor)));
        paint(split, w - split, lighten(hexToRgb(this._ipColor)));
        cr.$dispose();
    }
});

export default class WhereIsMyHtbIpExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._session = new Soup.Session({timeout: 10});
        this._cancellable = new Gio.Cancellable();
        this._vpnUp = false;
        this._ip = null;
        this._lastPoll = 0;

        this._indicator = new HtbIndicator(this);
        this._indicator.visible = false;
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, this._boxName());
        this._place(false);

        this._settingsIds = [
            this._settings.connect('changed::position', () => this._place(true)),
            this._settings.connect('changed::position-index', () => this._place(true)),
            this._settings.connect('changed::logo-color', () => this._render()),
            this._settings.connect('changed::ip-color', () => this._render()),
            this._settings.connect('changed::api-token', () => this._poll()),
        ];

        // Other extensions load after this one and can push it around:
        // put it back once they have all had time to load.
        this._settleId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SETTLE_SECONDS, () => {
            this._settleId = null;
            this._place(false);
            return GLib.SOURCE_REMOVE;
        });

        this._tick();
        this._timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, VPN_CHECK_SECONDS, () => {
                this._tick();
                return GLib.SOURCE_CONTINUE;
            });
    }

    disable() {
        for (const id of [this._timeoutId, this._settleId]) {
            if (id)
                GLib.source_remove(id);
        }
        this._timeoutId = null;
        this._settleId = null;

        for (const id of this._settingsIds ?? [])
            this._settings.disconnect(id);
        this._settingsIds = null;

        this._cancellable?.cancel();
        this._cancellable = null;
        this._session?.abort();
        this._session = null;

        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }

    _boxName() {
        const position = this._settings.get_string('position');
        return BOXES.includes(position) ? position : 'right';
    }

    // Moves the indicator to its box and index. userChange=true also writes
    // back the real index when the requested one is past the end of the box.
    _place(userChange) {
        if (!this._indicator)
            return;

        const box = Main.panel[`_${this._boxName()}Box`];
        const container = this._indicator.container;
        const parent = container.get_parent();
        if (parent !== box) {
            parent?.remove_child(container);
            box.add_child(container);
        }

        const wanted = this._settings.get_int('position-index');
        const index = Math.min(wanted, box.get_n_children() - 1);
        box.set_child_at_index(container, index);

        if (userChange && index !== wanted)
            this._settings.set_int('position-index', index);
    }

    _render() {
        if (!this._indicator)
            return;
        this._indicator.update({
            ip: this._vpnUp ? this._ip : null,
            logoColor: colorOrDefault(this._settings.get_string('logo-color')),
            ipColor: colorOrDefault(this._settings.get_string('ip-color')),
        });
    }

    _detectVpn() {
        for (const kind of ['tun', 'tap']) {
            for (let i = 0; i < 10; i++) {
                if (GLib.file_test(`/sys/class/net/${kind}${i}`, GLib.FileTest.EXISTS))
                    return true;
            }
        }
        return false;
    }

    _resetRequest() {
        this._cancellable.cancel();
        this._cancellable = new Gio.Cancellable();
    }

    _tick() {
        const up = this._detectVpn();

        if (up !== this._vpnUp) {
            this._vpnUp = up;
            this._resetRequest();
            if (up)
                this._poll();
            else
                this._setResult(null);
            return;
        }

        if (up && GLib.get_monotonic_time() - this._lastPoll >= API_POLL_USEC)
            this._poll();
    }

    _setResult(ip) {
        const appeared = ip && !this._ip;
        this._ip = ip;
        this._render();
        if (appeared)
            this._place(false);
    }

    _fail(err) {
        console.warn(`[Where is my HTB IP?] ${err.code} ${err.status ?? ''}`);
        // Keep what is shown on transient errors, drop it if the token is rejected
        if (err.code === 'auth')
            this._setResult(null);
    }

    _poll() {
        if (!this._vpnUp)
            return;

        this._lastPoll = GLib.get_monotonic_time();

        const token = this._settings.get_string('api-token').trim();
        if (!token) {
            this._setResult(null);
            return;
        }

        this._resetRequest();
        const cancellable = this._cancellable;

        this._get('machine/active', token, cancellable, (err, data) => {
            if (err)
                return this._fail(err);

            const info = data?.info;
            if (!info)
                return this._setResult(null);
            if (info.ip)
                return this._setResult(info.ip);
            if (!Number.isInteger(info.id))
                return this._setResult(null);

            // The active endpoint may not carry the IP; the profile one does.
            return this._get(`machine/profile/${info.id}`, token, cancellable, (err2, data2) => {
                if (err2)
                    return this._fail(err2);
                return this._setResult(data2?.info?.ip ?? null);
            });
        });
    }

    _get(path, token, cancellable, callback) {
        const msg = Soup.Message.new('GET', `${API_BASE}${path}`);
        const headers = msg.get_request_headers();
        headers.append('Authorization', `Bearer ${token}`);
        headers.append('Accept', 'application/json');
        headers.append('User-Agent', 'where-is-my-htb-ip-gnome-extension');

        this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, cancellable, (session, res) => {
            let err = null;
            let data = null;
            try {
                const bytes = session.send_and_read_finish(res);
                const status = msg.get_status();
                if (status === 401 || status === 403)
                    err = {code: 'auth'};
                else if (status !== Soup.Status.OK)
                    err = {code: 'http', status};
                else
                    data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
            } catch (e) {
                if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    return;
                err = {code: 'net'};
            }
            callback(err, data);
        });
    }
}
