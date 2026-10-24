Where is my HTB IP?

GNOME Shell extension that shows the IP of your active Hack The Box machine in the top bar. Click it to copy.

Tired of switching windows just to look up your target IP? Here it is, always at the top of your screen. It also tells you at a glance when the connection drops: the IP disappears.

Usage
1. Connect to the HTB VPN.
2. Open the extension settings and paste your App Token (HTB Labs > Account Settings > App Tokens).
3. Spawn a machine: a cube and its IP appear in the top bar.

Install from source
gnome-extensions pack --force --extra-source=cube.js --out-dir=/tmp .
gnome-extensions install --force /tmp/my-htb-ip@jimyhn.shell-extension.zip
gnome-session-quit --logout --no-prompt

License: GPL-3.0-or-later
