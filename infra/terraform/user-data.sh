#!/usr/bin/env bash
# cloud-init / EC2 user-data for the Vocion app instance.
#
# Runs once on first boot. Fetches the Vocion secrets bundle from
# Secrets Manager, writes /opt/vocion/infra/aws/.env.production, and
# invokes the existing infra/aws/bootstrap.sh.
#
# Re-running this script (manually via `sudo bash`) is safe — every
# step is idempotent. cloud-init does NOT re-run user-data on reboot
# by design; that's the right behavior here.
#
# Log: /var/log/cloud-init-output.log
#
# Terraform templatefile() interpolation note: only $${VAR} needs the
# double-dollar escape (to render as literal $${VAR} after templating).
# Command substitution $(...) is left bare — there is no { after the $,
# so templatefile leaves it alone.

set -euo pipefail

readonly SECRET_ID="${secret_id}"
readonly REGION="${region}"
readonly REPO_URL="${git_repo}"
readonly GIT_REF="${git_ref}"
readonly REPO_DIR="/opt/vocion"
readonly DATA_DIR="/opt/vocion-data"
readonly ENV_FILE="$${REPO_DIR}/infra/aws/.env.production"

log() { echo "[user-data] $*"; }

# ----- 1. System prereqs needed before bootstrap.sh runs -----
log "installing aws-cli, git, jq"
dnf install -y aws-cli git jq

# ----- 2. Mount the data volume at /opt/vocion-data -----
# Find the data device (any nvme that isn't the root /dev/nvme0n1).
DATA_DEV=$(lsblk -dn -o NAME,TYPE | awk '$2=="disk" && $1!~/nvme0n1/ {print "/dev/"$1; exit}')

if [ -n "$${DATA_DEV}" ] && [ -b "$${DATA_DEV}" ]; then
  if ! blkid "$${DATA_DEV}" >/dev/null 2>&1; then
    log "formatting $${DATA_DEV} as ext4"
    mkfs.ext4 -F "$${DATA_DEV}"
  fi
  mkdir -p "$${DATA_DIR}"
  if ! mountpoint -q "$${DATA_DIR}"; then
    log "mounting $${DATA_DEV} at $${DATA_DIR}"
    mount "$${DATA_DEV}" "$${DATA_DIR}"
    UUID=$(blkid -s UUID -o value "$${DATA_DEV}")
    if ! grep -q "$${UUID}" /etc/fstab; then
      echo "UUID=$${UUID} $${DATA_DIR} ext4 defaults,nofail 0 2" >> /etc/fstab
    fi
  fi
else
  log "WARNING: data volume not present; bootstrap may store data on root volume"
fi

# ----- 3. Clone the Vocion repo -----
if [ ! -d "$${REPO_DIR}/.git" ]; then
  log "cloning $${REPO_URL} -> $${REPO_DIR}"
  mkdir -p "$${REPO_DIR}"
  git clone "$${REPO_URL}" "$${REPO_DIR}"
fi
log "checking out $${GIT_REF}"
git -C "$${REPO_DIR}" fetch --all
git -C "$${REPO_DIR}" checkout "$${GIT_REF}"
git -C "$${REPO_DIR}" pull --ff-only || true

# ----- 4. Fetch secrets -> .env.production -----
log "fetching secret $${SECRET_ID} from region $${REGION}"
SECRET_JSON=$(aws secretsmanager get-secret-value \
  --secret-id "$${SECRET_ID}" \
  --region "$${REGION}" \
  --query SecretString \
  --output text)

if [ -z "$${SECRET_JSON}" ] || [ "$${SECRET_JSON}" = "{}" ]; then
  log "ERROR: secret payload is empty. Update Secrets Manager + re-run /opt/vocion/infra/aws/bootstrap.sh"
  exit 1
fi

log "writing $${ENV_FILE}"
echo "$${SECRET_JSON}" \
  | jq -r 'to_entries | map("\(.key)=\(.value)") | .[]' \
  > "$${ENV_FILE}"
chmod 600 "$${ENV_FILE}"

# ----- 5. Run the Phase F bootstrap -----
log "handing off to infra/aws/bootstrap.sh"
bash "$${REPO_DIR}/infra/aws/bootstrap.sh" "$${GIT_REF}"

log "first-boot complete."
