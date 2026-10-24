// SPDX-FileCopyrightText: 2026 JimyHN
// SPDX-License-Identifier: GPL-3.0-or-later

// Generic hexagonal cube outline (hexagon + inner "Y"), drawn with Cairo.
// Shared by the top bar indicator and the preferences window.

export const hexToRgb = hex =>
    [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);

export function drawCube(cr, w, h, rgb, lineWidth) {
    cr.setSourceRGB(rgb[0], rgb[1], rgb[2]);
    cr.setLineWidth(lineWidth);
    cr.setLineJoin(1); // round

    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) / 2 - lineWidth;
    const vertex = k => {
        const a = (-90 + 60 * k) * Math.PI / 180;
        return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    };

    for (let k = 0; k < 6; k++) {
        const [x, y] = vertex(k);
        if (k === 0)
            cr.moveTo(x, y);
        else
            cr.lineTo(x, y);
    }
    cr.closePath();

    for (const k of [1, 5, 3]) {
        const [x, y] = vertex(k);
        cr.moveTo(cx, cy);
        cr.lineTo(x, y);
    }
    cr.stroke();
}
