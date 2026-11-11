sudo rm -f /etc/yum.repos.d/docker.com.repo
sudo dnf clean all
sudo rm -rf /var/cache/dnf
sudo dnf config-manager --add-repo https://docker.com
sudo dnf install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo systemctl status docker
