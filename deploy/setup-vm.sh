#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu 24.04 VM. Run it once as your admin user:
#
#   curl -fsSL https://raw.githubusercontent.com/vedantterse/XyloSync/main/deploy/setup-vm.sh | bash
#
# It installs Docker, adds a swap file (important on 1 GB VMs), turns on the firewall,
# caps Docker's log size and prepares /opt/xylosync.
set -euo pipefail

if ! command -v docker >/dev/null; then
    echo "==> Installing Docker"
    curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER"

echo "==> Docker log rotation"
sudo mkdir -p /etc/docker
echo '{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }' | sudo tee /etc/docker/daemon.json >/dev/null
sudo systemctl restart docker

if ! swapon --show | grep -q /swapfile; then
    echo "==> 2 GB swap file"
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile >/dev/null
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
    echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf >/dev/null
    sudo sysctl -p /etc/sysctl.d/99-swappiness.conf >/dev/null
fi

echo "==> Firewall: SSH, HTTP, HTTPS only"
sudo ufw allow OpenSSH >/dev/null
sudo ufw allow 80/tcp >/dev/null
sudo ufw allow 443 >/dev/null
sudo ufw --force enable >/dev/null

echo "==> /opt/xylosync"
sudo mkdir -p /opt/xylosync
sudo chown "$USER":"$USER" /opt/xylosync

echo
echo "Done. Log out and back in (so the docker group applies), then put your .env in /opt/xylosync."
