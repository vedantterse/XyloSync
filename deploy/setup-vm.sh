#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu 22.04/24.04 server (Oracle Cloud Always Free, or any VPS).
# Run it once as your admin user:
#
#   curl -fsSL https://raw.githubusercontent.com/vedantterse/XyloSync/main/deploy/setup-vm.sh | bash
#
# It installs Docker, adds swap on small machines, opens ports 80/443 in the server's firewall,
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

# Swap only matters on small machines (under 2 GB of RAM).
mem_mb=$(awk '/MemTotal/ { print int($2 / 1024) }' /proc/meminfo)
if [ "$mem_mb" -lt 2048 ] && ! swapon --show | grep -q /swapfile; then
    echo "==> 2 GB swap file (${mem_mb} MB of RAM)"
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile >/dev/null
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
    echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf >/dev/null
    sudo sysctl -p /etc/sysctl.d/99-swappiness.conf >/dev/null
fi

if [ -f /etc/iptables/rules.v4 ]; then
    # Oracle Cloud's Ubuntu images ship their own iptables rules that reject everything but SSH.
    # Open HTTP and HTTPS (HTTP/3 uses UDP 443) just above that reject rule, then save.
    echo "==> Firewall (iptables): opening 80 and 443"
    open_port() {
        local proto=$1 port=$2
        if ! sudo iptables -C INPUT -p "$proto" -m state --state NEW --dport "$port" -j ACCEPT 2>/dev/null; then
            local at
            at=$(sudo iptables -L INPUT --line-numbers -n | awk '/REJECT/ { print $1; exit }')
            sudo iptables -I INPUT "${at:-1}" -p "$proto" -m state --state NEW --dport "$port" -j ACCEPT
        fi
    }
    open_port tcp 80
    open_port tcp 443
    open_port udp 443
    if ! dpkg -s netfilter-persistent >/dev/null 2>&1; then
        sudo apt-get update -qq
        sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq netfilter-persistent iptables-persistent >/dev/null
    fi
    sudo netfilter-persistent save >/dev/null
else
    echo "==> Firewall (ufw): SSH, HTTP, HTTPS only"
    sudo ufw allow OpenSSH >/dev/null
    sudo ufw allow 80/tcp >/dev/null
    sudo ufw allow 443 >/dev/null
    sudo ufw --force enable >/dev/null
fi

echo "==> /opt/xylosync"
sudo mkdir -p /opt/xylosync
sudo chown "$USER":"$USER" /opt/xylosync

echo
echo "Done. Log out and back in (so the docker group applies), then put your .env in /opt/xylosync."
