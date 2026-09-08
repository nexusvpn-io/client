#!/bin/bash
/usr/bin/nexus-service-uninstall

. /etc/os-release

if [ "$ID" = "deepin" ]; then
    if [ -f "/usr/share/applications/nexus-vpn.desktop" ]; then
        echo "Removing deepin desktop file"
        rm -vf "/usr/share/applications/nexus-vpn.desktop"
    fi
fi
