ARG UBUNTU_IMAGE
FROM ${UBUNTU_IMAGE}
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ENV DEBIAN_FRONTEND=noninteractive
# Ubuntu 26.04 defaults to uutils; the collector needs GNU stat/sha256sum flags.
ARG CAPTURE_TOOLS="bash coreutils gnu-coreutils findutils acl attr libcap2-bin e2fsprogs curl zip unzip ca-certificates xz-utils binutils jq"
# The updated system, including these inspection tools, is the shared baseline.
RUN set -eux; \
    mkdir -p /usr/local/share/capture; \
    rm -f /etc/apt/apt.conf.d/docker-clean; \
    apt-get update; \
    apt-get --print-uris -y dist-upgrade > /usr/local/share/capture/upgrade-uris.txt; \
    apt-get -y --download-only dist-upgrade; \
    find /var/cache/apt/archives -name '*.deb' -exec sha256sum {} + > /usr/local/share/capture/upgrade-sha256.txt; \
    apt-get -y dist-upgrade; \
    apt-get --print-uris -y install --no-install-recommends $CAPTURE_TOOLS > /usr/local/share/capture/tools-uris.txt; \
    apt-get -y --download-only install --no-install-recommends $CAPTURE_TOOLS; \
    find /var/cache/apt/archives -name '*.deb' -exec sha256sum {} + > /usr/local/share/capture/tools-sha256.txt; \
    apt-get -y install --no-install-recommends $CAPTURE_TOOLS; \
    dpkg-query -W -f='${Package}\t${Version}\t${Architecture}\n' > /usr/local/share/capture/packages.tsv; \
    apt-cache policy > /usr/local/share/capture/apt-policy.txt; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/*
CMD ["bash"]
