#!/usr/bin/env bash
set -Eeuo pipefail

print_usage() {
  cat <<'EOF'
Usage:
  ./deploy.sh [options]

Options:
  --app-dir <path>             Project directory (default: directory of this script)
  --branch <name>              Deploy a specific git branch (default: current branch)
  --service <1panel|command|supervisor|docker|pm2|systemd>
                               Restart method (default: command)
  --runtime-name <name>        1Panel runtime name, required when --service 1panel
  --runtime-type <type>        1Panel runtime type (default: node)
  --runtime-compose <path>     Explicit 1Panel runtime docker-compose.yml path
  --panel-base-dir <path>      1Panel BASE_DIR, default reads /usr/local/bin/1pctl
  --restart-cmd <command>      1Panel/custom restart command, required when --service command
  --supervisor-program <name>  Supervisor program name, required when --service supervisor
  --docker-container <name>    Docker container name/id, required when --service docker
  --pm2-name <name>            PM2 app name (default: package name or project directory)
  --systemd-service <name>     systemd service name, required when --service systemd
  --allow-dirty                Allow running when git working tree has local changes
  --skip-pull                  Skip git pull step
  --skip-install               Skip npm install step
  --skip-build                 Skip npm build step
  --restart-only               Do not pull/install/build; only restart service
  --restart-on-no-change       Restart even when git pull has no new commits
  -h, --help                   Show this help

Environment overrides:
  APP_DIR, SERVICE_TYPE, PANEL_RUNTIME_NAME, PANEL_RUNTIME_TYPE, PANEL_COMPOSE_FILE,
  PANEL_BASE_DIR, RESTART_CMD, SUPERVISOR_PROGRAM, DOCKER_CONTAINER, PM2_NAME,
  SYSTEMD_SERVICE, INSTALL_CMD, BUILD_CMD
EOF
}

log() {
  printf '[deploy] %s\n' "$*"
}

die() {
  echo "Error: $*" >&2
  exit 1
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    die "command not found: $1"
  fi
}

read_package_name() {
  if [[ -f package.json ]] && command -v node >/dev/null 2>&1; then
    node -e "const p=require('./package.json'); if (p.name) console.log(p.name)" 2>/dev/null || true
  fi
}

restart_pm2() {
  require_cmd pm2

  if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
    log "Restarting PM2 app: $PM2_NAME"
    pm2 restart "$PM2_NAME" --update-env
  else
    log "PM2 app not found, starting: $PM2_NAME"
    pm2 start npm --name "$PM2_NAME" -- start
  fi

  pm2 save >/dev/null 2>&1 || true
}

restart_systemd() {
  [[ -n "$SYSTEMD_SERVICE" ]] || die "--systemd-service is required when --service systemd"
  require_cmd systemctl

  log "Restarting systemd service: $SYSTEMD_SERVICE"
  systemctl restart "$SYSTEMD_SERVICE"
  systemctl --no-pager --full status "$SYSTEMD_SERVICE" || true
}

restart_command() {
  [[ -n "$RESTART_CMD" ]] || die "--restart-cmd is required when --service command"

  log "Running custom restart command"
  bash -lc "$RESTART_CMD"
}

restart_supervisor() {
  [[ -n "$SUPERVISOR_PROGRAM" ]] || die "--supervisor-program is required when --service supervisor"
  require_cmd supervisorctl

  log "Restarting supervisor program: $SUPERVISOR_PROGRAM"
  supervisorctl restart "$SUPERVISOR_PROGRAM"
}

restart_docker() {
  [[ -n "$DOCKER_CONTAINER" ]] || die "--docker-container is required when --service docker"
  require_cmd docker

  log "Restarting docker container: $DOCKER_CONTAINER"
  docker restart "$DOCKER_CONTAINER"
}

read_1panel_base_dir() {
  if [[ -n "$PANEL_BASE_DIR" ]]; then
    printf '%s\n' "$PANEL_BASE_DIR"
    return
  fi

  [[ -f /usr/local/bin/1pctl ]] || die "/usr/local/bin/1pctl not found. Use --panel-base-dir or --runtime-compose."

  while IFS='=' read -r key value; do
    if [[ "$key" == "BASE_DIR" ]]; then
      value="${value%\"}"
      value="${value#\"}"
      value="${value%\'}"
      value="${value#\'}"
      printf '%s\n' "$value"
      return
    fi
  done < /usr/local/bin/1pctl
}

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE=(docker-compose)
  else
    die "neither 'docker compose' nor 'docker-compose' is available"
  fi
}

restart_1panel_runtime() {
  require_cmd docker
  compose_cmd

  local compose_file="$PANEL_COMPOSE_FILE"
  if [[ -z "$compose_file" ]]; then
    [[ -n "$PANEL_RUNTIME_NAME" ]] || die "--runtime-name is required when --service 1panel"
    local base_dir
    base_dir="$(read_1panel_base_dir)"
    [[ -n "$base_dir" ]] || die "failed to read 1Panel BASE_DIR"
    compose_file="$base_dir/1panel/runtime/$PANEL_RUNTIME_TYPE/$PANEL_RUNTIME_NAME/docker-compose.yml"
  fi

  [[ -f "$compose_file" ]] || die "1Panel runtime compose file not found: $compose_file"

  log "Restarting 1Panel runtime with compose: $compose_file"
  "${COMPOSE[@]}" -f "$compose_file" down --remove-orphans
  "${COMPOSE[@]}" -f "$compose_file" up -d
  "${COMPOSE[@]}" -f "$compose_file" ps
}

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${APP_DIR:-$SCRIPT_DIR}"

BRANCH=""
SERVICE_TYPE="${SERVICE_TYPE:-command}"
PANEL_RUNTIME_NAME="${PANEL_RUNTIME_NAME:-}"
PANEL_RUNTIME_TYPE="${PANEL_RUNTIME_TYPE:-node}"
PANEL_COMPOSE_FILE="${PANEL_COMPOSE_FILE:-}"
PANEL_BASE_DIR="${PANEL_BASE_DIR:-}"
SUPERVISOR_PROGRAM="${SUPERVISOR_PROGRAM:-}"
DOCKER_CONTAINER="${DOCKER_CONTAINER:-}"
PM2_NAME="${PM2_NAME:-}"
SYSTEMD_SERVICE="${SYSTEMD_SERVICE:-}"
RESTART_CMD="${RESTART_CMD:-}"
INSTALL_CMD="${INSTALL_CMD:-npm ci}"
BUILD_CMD="${BUILD_CMD:-npm run build}"

ALLOW_DIRTY=0
SKIP_PULL=0
SKIP_INSTALL=0
SKIP_BUILD=0
RESTART_ONLY=0
RESTART_ON_NO_CHANGE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir)
      REPO_DIR="${2:-}"
      [[ -n "$REPO_DIR" ]] || die "--app-dir requires a value"
      shift 2
      ;;
    --branch)
      BRANCH="${2:-}"
      [[ -n "$BRANCH" ]] || die "--branch requires a value"
      shift 2
      ;;
    --service)
      SERVICE_TYPE="${2:-}"
      [[ -n "$SERVICE_TYPE" ]] || die "--service requires a value"
      shift 2
      ;;
    --runtime-name)
      PANEL_RUNTIME_NAME="${2:-}"
      [[ -n "$PANEL_RUNTIME_NAME" ]] || die "--runtime-name requires a value"
      shift 2
      ;;
    --runtime-type)
      PANEL_RUNTIME_TYPE="${2:-}"
      [[ -n "$PANEL_RUNTIME_TYPE" ]] || die "--runtime-type requires a value"
      shift 2
      ;;
    --runtime-compose)
      PANEL_COMPOSE_FILE="${2:-}"
      [[ -n "$PANEL_COMPOSE_FILE" ]] || die "--runtime-compose requires a value"
      shift 2
      ;;
    --panel-base-dir)
      PANEL_BASE_DIR="${2:-}"
      [[ -n "$PANEL_BASE_DIR" ]] || die "--panel-base-dir requires a value"
      shift 2
      ;;
    --pm2-name)
      PM2_NAME="${2:-}"
      [[ -n "$PM2_NAME" ]] || die "--pm2-name requires a value"
      shift 2
      ;;
    --systemd-service)
      SYSTEMD_SERVICE="${2:-}"
      [[ -n "$SYSTEMD_SERVICE" ]] || die "--systemd-service requires a value"
      shift 2
      ;;
    --restart-cmd)
      RESTART_CMD="${2:-}"
      [[ -n "$RESTART_CMD" ]] || die "--restart-cmd requires a value"
      shift 2
      ;;
    --supervisor-program)
      SUPERVISOR_PROGRAM="${2:-}"
      [[ -n "$SUPERVISOR_PROGRAM" ]] || die "--supervisor-program requires a value"
      shift 2
      ;;
    --docker-container)
      DOCKER_CONTAINER="${2:-}"
      [[ -n "$DOCKER_CONTAINER" ]] || die "--docker-container requires a value"
      shift 2
      ;;
    --allow-dirty)
      ALLOW_DIRTY=1
      shift
      ;;
    --skip-pull)
      SKIP_PULL=1
      shift
      ;;
    --skip-install)
      SKIP_INSTALL=1
      shift
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --restart-only)
      RESTART_ONLY=1
      SKIP_PULL=1
      SKIP_INSTALL=1
      SKIP_BUILD=1
      shift
      ;;
    --restart-on-no-change)
      RESTART_ON_NO_CHANGE=1
      shift
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

require_cmd git

cd "$REPO_DIR"

if [[ -z "$PM2_NAME" ]]; then
  PM2_NAME="$(read_package_name)"
fi
PM2_NAME="${PM2_NAME:-$(basename "$REPO_DIR")}"

case "$SERVICE_TYPE" in
  1panel|command|supervisor|docker|pm2|systemd) ;;
  *) die "--service must be one of: 1panel, command, supervisor, docker, pm2, systemd" ;;
esac

if [[ "$SERVICE_TYPE" == "1panel" ]]; then
  SKIP_INSTALL=1
  SKIP_BUILD=1
  if [[ -z "$PANEL_RUNTIME_NAME" && -n "$DOCKER_CONTAINER" ]]; then
    PANEL_RUNTIME_NAME="$DOCKER_CONTAINER"
  fi
fi

if [[ $RESTART_ONLY -eq 0 ]] && { [[ $SKIP_INSTALL -eq 0 ]] || [[ $SKIP_BUILD -eq 0 ]]; }; then
  require_cmd npm
fi

if [[ $ALLOW_DIRTY -eq 0 ]]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    die "git working tree is not clean. Commit/stash changes or use --allow-dirty."
  fi
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
TARGET_BRANCH="$CURRENT_BRANCH"
if [[ -n "$BRANCH" ]]; then
  TARGET_BRANCH="$BRANCH"
fi

OLD_REV="$(git rev-parse HEAD)"
NEW_REV="$OLD_REV"

log "Repository: $REPO_DIR"
log "Branch: $TARGET_BRANCH"
log "Service type: $SERVICE_TYPE"

if [[ $RESTART_ONLY -eq 0 && $SKIP_PULL -eq 0 ]]; then
  log "Fetching latest code..."
  git fetch --all --prune

  if [[ "$CURRENT_BRANCH" != "$TARGET_BRANCH" ]]; then
    log "Checking out branch: $TARGET_BRANCH"
    git checkout "$TARGET_BRANCH"
  fi

  log "Pulling latest commits..."
  git pull --ff-only origin "$TARGET_BRANCH"
  NEW_REV="$(git rev-parse HEAD)"
else
  log "Skipping git pull"
fi

if [[ $RESTART_ONLY -eq 0 && "$OLD_REV" == "$NEW_REV" && $RESTART_ON_NO_CHANGE -eq 0 ]]; then
  log "No new commits. Nothing to deploy."
  exit 0
fi

if [[ $RESTART_ONLY -eq 0 && $SKIP_INSTALL -eq 0 ]]; then
  if [[ "$OLD_REV" != "$NEW_REV" ]] && git diff --name-only "$OLD_REV" "$NEW_REV" -- package.json package-lock.json | grep -q .; then
    log "Dependencies changed. Running: $INSTALL_CMD"
    bash -lc "$INSTALL_CMD"
  else
    log "Dependencies unchanged. Skipping npm install."
  fi
fi

if [[ $RESTART_ONLY -eq 0 && $SKIP_BUILD -eq 0 ]]; then
  log "Building app: $BUILD_CMD"
  bash -lc "$BUILD_CMD"
fi

case "$SERVICE_TYPE" in
  1panel)
    restart_1panel_runtime
    ;;
  command)
    restart_command
    ;;
  supervisor)
    restart_supervisor
    ;;
  docker)
    restart_docker
    ;;
  pm2)
    restart_pm2
    ;;
  systemd)
    restart_systemd
    ;;
esac

log "Deploy completed successfully."
