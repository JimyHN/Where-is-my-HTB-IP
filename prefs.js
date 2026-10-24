// SPDX-FileCopyrightText: 2026 JimyHN
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {drawCube, hexToRgb} from './cube.js';

const GREEN = '#9fef00';
const MAX_INDEX = 50;
// HTB App Tokens are JWTs: three base64url blocks separated by dots, starting with "eyJ"
const TOKEN_RE = /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/;

const COLORS = [
    [GREEN, 'Green'],
    ['#00e5ff', 'Cyan'],
    ['#4d9fff', 'Blue'],
    ['#b266ff', 'Purple'],
    ['#ff5fd2', 'Pink'],
    ['#ff4d4d', 'Red'],
    ['#ff9f1a', 'Orange'],
    ['#ffe14d', 'Yellow'],
    ['#ffffff', 'White'],
    ['#aab4c0', 'Gray'],
];

const POSITIONS = [
    ['left', 'Left'],
    ['center', 'Center'],
    ['right', 'Right'],
];

function comboRow(settings, key, title, options, {painted = false, onChange = null} = {}) {
    const row = new Adw.ComboRow({
        title,
        model: Gtk.StringList.new(options.map(([, label]) => _(label))),
    });

    if (painted) {
        // Each color name is drawn in its own color
        const colorByLabel = new Map(options.map(([value, label]) => [_(label), value]));
        const factory = new Gtk.SignalListItemFactory();
        factory.connect('setup', (_f, item) => {
            item.set_child(new Gtk.Label({xalign: 0}));
        });
        factory.connect('bind', (_f, item) => {
            const label = item.get_item().get_string();
            const value = colorByLabel.get(label) ?? '#ffffff';
            item.get_child().set_markup(
                `<span foreground="${value}" weight="bold">${GLib.markup_escape_text(label, -1)}</span>`);
        });
        row.factory = factory;
    }

    const current = settings.get_string(key);
    const index = options.findIndex(([value]) => value === current);
    row.selected = index >= 0 ? index : 0;

    row.connect('notify::selected', () => {
        onChange?.();
        settings.set_string(key, options[row.selected][0]);
    });
    return row;
}

export default class WhereIsMyHtbIpPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: _('Settings'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        // Title and big cube
        const header = new Adw.PreferencesGroup();
        const headerBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 12,
            margin_bottom: 6,
        });
        headerBox.append(new Gtk.Label({
            use_markup: true,
            label: `<span foreground="${GREEN}" size="xx-large" weight="bold">Where is my HTB IP?</span>`,
        }));
        const cube = new Gtk.DrawingArea({
            content_width: 96,
            content_height: 96,
            halign: Gtk.Align.CENTER,
        });
        cube.set_draw_func((_area, cr, w, h) => drawCube(cr, w, h, hexToRgb(GREEN), 6));
        headerBox.append(cube);
        header.add(headerBox);
        page.add(header);

        const colors = new Adw.PreferencesGroup({title: _('Colors')});
        colors.add(comboRow(settings, 'logo-color', _('Logo color'), COLORS, {painted: true}));
        colors.add(comboRow(settings, 'ip-color', _('IP color'), COLORS, {painted: true}));
        page.add(colors);

        const placement = new Adw.PreferencesGroup({title: _('Position')});
        placement.add(comboRow(settings, 'position', _('Position in the top bar'), POSITIONS, {
            onChange: () => settings.set_int('position-index', 0),
        }));

        const move = new Adw.ActionRow({title: _('Move inside that area')});
        const left = Gtk.Button.new_from_icon_name('go-previous-symbolic');
        const right = Gtk.Button.new_from_icon_name('go-next-symbolic');
        for (const button of [left, right])
            button.valign = Gtk.Align.CENTER;
        left.connect('clicked', () => {
            settings.set_int('position-index', Math.max(0, settings.get_int('position-index') - 1));
        });
        right.connect('clicked', () => {
            settings.set_int('position-index', Math.min(MAX_INDEX, settings.get_int('position-index') + 1));
        });
        move.add_suffix(left);
        move.add_suffix(right);
        placement.add(move);
        page.add(placement);

        const account = new Adw.PreferencesGroup({
            title: _('Hack The Box'),
            description: _('Create an App Token in Labs > Account Settings > App Tokens and paste it here, then press Enter.'),
        });
        const token = new Adw.PasswordEntryRow({
            title: _('App Token'),
            show_apply_button: true,
        });
        token.text = settings.get_string('api-token');
        token.connect('apply', () => {
            settings.set_string('api-token', token.text.trim());
        });
        account.add(token);

        const tokenError = new Gtk.Label({
            label: _('Invalid App Token'),
            halign: Gtk.Align.CENTER,
            margin_top: 6,
            visible: false,
        });
        tokenError.add_css_class('error');
        account.add(tokenError);

        // Still saves an invalid token, it just won't work
        const validate = () => {
            const text = token.text.trim();
            const bad = text !== '' && !TOKEN_RE.test(text);
            tokenError.visible = bad;
            if (bad)
                token.add_css_class('error');
            else
                token.remove_css_class('error');
        };
        token.connect('notify::text', validate);
        validate();

        page.add(account);
    }
}
