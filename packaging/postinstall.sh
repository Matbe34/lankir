#!/bin/bash
# Post-installation script for Lankir

# Update desktop database
if command -v update-desktop-database &> /dev/null; then
    update-desktop-database -q /usr/share/applications || true
fi

# Update icon cache. Lankir 1.0 and earlier built a stray one in /usr/share/pixmaps.
rm -f /usr/share/pixmaps/icon-theme.cache
if command -v gtk-update-icon-cache &> /dev/null; then
    gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
fi

echo "Lankir has been installed successfully!"
echo "You can now run it from your applications menu or by typing 'lankir' in the terminal."
