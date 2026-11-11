
#!/bin/bash
set -euo pipefail

echo "=================================="
echo " Docker Engine Installation"
echo "=================================="

# Check root privileges
if [[ $EUID -ne 0 ]]; then
    echo "Please run this script as root or using sudo."
    exit 1
fi

# Detect Linux distribution
if [[ ! -f /etc/os-release ]]; then
    echo "Cannot detect Linux distribution."
    exit 1
fi

source /etc/os-release

case "${ID}" in
    rhel|rocky|almalinux|centos|ol)
        echo "Detected: ${PRETTY_NAME}"
        ;;
    *)
        echo "Unsupported distribution: ${ID}"
        exit 1
        ;;
esac

# Remove incorrect Docker repository
echo "[1/6] Removing incorrect Docker repository..."

rm -f /etc/yum.repos.d/docker.com.repo

# Install required tools
echo "[2/6] Installing DNF plugins..."

dnf install -y dnf-plugins-core

# Add official Docker repository
echo "[3/6] Configuring official Docker repository..."

dnf config-manager --add-repo \
https://download.docker.com/linux/rhel/docker-ce.repo

# Clean repository cache
echo "[4/6] Cleaning DNF cache..."

dnf clean all
dnf makecache

# Install Docker packages
echo "[5/6] Installing Docker Engine..."

dnf install -y \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin

# Enable and start Docker
echo "[6/6] Starting Docker service..."

systemctl enable --now docker

# Verify installation
echo ""
echo "=================================="
echo " Docker Installation Verification"
echo "=================================="

docker --version
docker compose version
systemctl status docker --no-pager

echo ""
echo "Testing Docker installation..."

docker run hello-world

echo ""
echo "=================================="
echo " Docker installed successfully!"
echo "=================================="
