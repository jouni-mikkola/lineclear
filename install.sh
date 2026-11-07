#!/bin/sh
# Installs Lineclear, and updates it when run again:
#   curl -fsSL https://raw.githubusercontent.com/jouni-mikkola/lineclear/main/install.sh | sh
# LINECLEAR_REF picks a branch, tag or full commit id (default: main). LINECLEAR_REPO picks another repository.
# Every version is built once in ~/.lineclear/builds/<name> (the release number, or the commit for a branch), with no .git.
# An update points builds/current at the new build, with the build before it as builds/previous; a failed update points
# current back. The service and the command run from builds/current.
# The work is in functions and runs on the last line, so a cut download does nothing.
set -eu

say() { printf '%s\n' "$*"; }
die() { printf 'install: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# Adds system packages. This is the only place that asks for sudo.
system_install() {
  if [ "$(id -u)" -eq 0 ]; then sudo=; elif have sudo; then sudo=sudo; else
    die "need root to install $*. Install it, then run this again."
  fi
  say "Installing $* with the system package manager (may ask for your sudo password)"
  if have apt-get; then $sudo apt-get update -qq >/dev/null && $sudo apt-get install -y "$@" >/dev/null
  elif have dnf; then $sudo dnf install -y "$@" >/dev/null
  elif have pacman; then $sudo pacman -S --noconfirm "$@" >/dev/null
  elif have zypper; then $sudo zypper --non-interactive install "$@" >/dev/null
  elif have apk; then $sudo apk add "$@" >/dev/null
  else die "no known package manager. Install $*, then run this again."; fi
}

# quiet <command...>: one plain line per step, so a tool's own progress is shown only when it fails
quiet() {
  log=$(mktemp)
  if "$@" >"$log" 2>&1; then rm -f "$log"; else
    cat "$log" >&2
    rm -f "$log"
    return 1
  fi
}

link() { # link <target> <path>: points path at target, and touches nothing when it already does
  [ "$(readlink "$2" 2>/dev/null || true)" = "$1" ] && return 0
  if [ -e "$2" ] && [ ! -L "$2" ]; then die "$2 exists and is not a link made by Lineclear. Move it away, then run this again."; fi
  mkdir -p "$(dirname "$2")"
  ln -sfn "$1" "$2"
}

# extension_file <app> <path>: writes pi's lineclear.ts, an import of the extension by its full path (src/paths.ts,
# extensionFile, holds the same text). Not a link: pi resolves an extension's imports from the link's folder.
extension_file() {
  want=$(printf '%s\n' "// Lineclear's pi extension, written by install.sh. It imports the real one, so its own imports resolve." "export { default } from \"$1/pi/extension.ts\";")
  if [ ! -L "$2" ] && [ -f "$2" ]; then
    [ "$(cat "$2")" = "$want" ] && return 0
    head -n 1 "$2" | grep -q "^// Lineclear's pi extension" || die "$2 exists and was not written by Lineclear. Move it away, then run this again."
  elif [ -e "$2" ] && [ ! -L "$2" ]; then
    die "$2 exists and was not written by Lineclear. Move it away, then run this again."
  fi
  mkdir -p "$(dirname "$2")"
  rm -f "$2" # a link from an older install
  printf '%s\n' "$want" >"$2.tmp" && mv -f "$2.tmp" "$2"
}

# drop_old_extensions <extensions folder>: removes pi's quota-switch and api-guard, which an older tool left there. The
# account fallback is in Lineclear's own extension now (pi/account-fallback.ts), over the project's model lists.
drop_old_extensions() {
  rm -f "$1/quota-switch.ts" "$1/quota-switch.json" "$1/api-guard.ts"
}

# The commit a ref names on the remote, or nothing when the ref is not a branch or tag there.
remote_commit() {
  git ls-remote "$repo" "refs/heads/$ref" "refs/tags/$ref" "refs/tags/$ref^{}" |
    awk '{ if ($2 ~ /\^\{\}$/) peeled = $1; else first = (first == "" ? $1 : first) } END { print (peeled != "" ? peeled : first) }'
}

# unzip_shim <dir>: Bun's installer needs unzip; busybox or Python can stand in for it, so no sudo is needed.
unzip_shim() {
  if have busybox && busybox --list 2>/dev/null | grep -qx unzip; then
    printf '#!/bin/sh\nexec busybox unzip "$@"\n' >"$1/unzip"
  elif have python3; then
    # Bun's installer runs `unzip -oqd <dir> <file>`
    printf '#!/bin/sh\nexec python3 -c "import sys, zipfile; zipfile.ZipFile(sys.argv[2]).extractall(sys.argv[1])" "$2" "$3"\n' >"$1/unzip"
  else return 1; fi
  chmod +x "$1/unzip"
}

node_ok() {
  have node && have npm && node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 19) ? 0 : 1)'
}

install_tools() {
  have curl || die "curl is needed to run this. Install curl, then run this again."
  if have git; then say "git: found"; else system_install git; fi
  if have bun; then say "Bun: found"; else
    shim=$(mktemp -d)
    have unzip || unzip_shim "$shim" || system_install unzip
    say "Bun: installing"
    PATH="$shim:$PATH" quiet sh -c "curl -fsSL https://bun.sh/install | bash"
    rm -rf "$shim"
  fi
  have bun || die "Bun did not install. See https://bun.sh"
  if have herdr; then say "herdr: found"; else
    say "herdr: installing"
    quiet sh -c "curl -fsSL https://herdr.dev/install.sh | sh"
  fi
  have herdr || die "herdr did not install. See https://herdr.dev"
  if have pi; then say "pi: found"; else
    node_ok || die "pi needs Node.js 22.19 or newer and npm, and they are not here. Install them, then run this again."
    say "pi: installing"
    # setsid drops the terminal, so pi's installer takes its defaults instead of asking
    if have setsid; then detach="setsid -w"; else detach=; fi
    quiet sh -c "curl -fsSL https://pi.dev/install.sh | $detach sh" || die "pi did not install. See https://pi.dev"
  fi
  have pi || die "pi did not install. See https://pi.dev"
}

# A promotion has just installed and built this commit in the cache's next clone (it says so in .lineclear-built): copy that
# work into the build folder $1 when next is at $head and its lockfiles match, so the same commit is not built twice.
# Returns 1 (nothing copied) otherwise.
reuse_next() {
  next=${XDG_CACHE_HOME:-$HOME/.cache}/lineclear/next
  [ "$next" != "$1" ] && [ -d "$next/ui/web/dist" ] && [ -d "$next/node_modules" ] && [ -d "$next/server/node_modules" ] || return 1
  [ "$(git -C "$next" rev-parse HEAD 2>/dev/null || true)" = "$head" ] && [ "$(cat "$next/.lineclear-built" 2>/dev/null || true)" = "$head" ] || return 1
  cmp -s "$next/bun.lock" "$1/bun.lock" && cmp -s "$next/server/bun.lock" "$1/server/bun.lock" || return 1
  say "Lineclear: reusing the build of $(printf %.7s "$head")"
  cp -a "$next/node_modules" "$1/node_modules" && cp -a "$next/server/node_modules" "$1/server/node_modules" \
    && cp -a "$next/ui/web/dist" "$1/ui/web/dist" || { rm -rf "$1/node_modules" "$1/server/node_modules" "$1/ui/web/dist"; return 1; }
}

# Installs the dependencies and builds the web pages of the fresh checkout $1 (of commit $head).
build_deps() {
  reuse_next "$1" && return 0
  (cd "$1" && bun install --frozen-lockfile --silent) || return 1
  # the fork's push code, which sends the Inbox alerts, needs its own packages
  (cd "$1/server" && bun install --frozen-lockfile --silent) || return 1
  say "Lineclear: building the web pages"
  (cd "$1" && quiet bun run web:build)
}

# A release is a version tag made by `bun run release`.
is_release() { printf '%s' "$ref" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; }
builds_dir() { printf '%s/builds' "$(data_dir)"; }

# point <target> <link>: points the link at the target in one step, so no reader ever finds it missing.
point() {
  rm -f "$2.new"
  ln -s "$1" "$2.new" && mv -fT "$2.new" "$2"
}

# install_build: builds the wanted version once in builds/<name> and points builds/current at it, builds/previous at the
# build it replaces. Its .built file is written last, so a folder without one is an unfinished build and is made again.
# A release build also has .release, which doctor looks for; a build of a branch does not, so doctor still asks for a release.
# Sets changed=1 when current moved, and arms the rollback when a running service was on an earlier build.
install_build() {
  mkdir -p "$builds"
  want=$(remote_commit)
  if is_release; then name=${ref#v}; else name=$(printf '%.12s' "${want:-$ref}"); fi
  dest=$builds/$name
  if [ -f "$dest/.built" ] || [ -f "$dest/.release" ]; then
    say "Lineclear: $name is built already"
  else
    say "Lineclear: installing $name"
    rm -rf "$dest"
    mkdir -p "$dest"
    git -C "$dest" init -q && git -C "$dest" remote add origin "$repo" && git -C "$dest" fetch -q --depth 1 origin "$ref" \
      && git -C "$dest" checkout -q -f --detach FETCH_HEAD || { rm -rf "$dest"; die "could not get $ref from $repo"; }
    head=$(git -C "$dest" rev-parse HEAD)
    build_deps "$dest" || { rm -rf "$dest"; die "building $name failed"; }
    rm -rf "$dest/.git"
    if is_release; then printf '%s\n' "$name" >"$dest/.release"; fi
    printf '%s\n' "$name" >"$dest/.built"
  fi
  was=$(readlink "$builds/current" 2>/dev/null || true)
  # an install made before builds/ ran from a checkout in $app: it is the build to go back to
  if [ -z "$was" ] && [ -d "$app/.git" ]; then was=$app; fi
  [ "$was" != "$dest" ] || return 0
  if [ -n "$was" ]; then
    point "$was" "$builds/previous"
    if [ "$active" -eq 1 ]; then armed=1; fi
  fi
  point "$dest" "$builds/current"
  changed=1
}

# Removes the builds that are neither current nor previous.
prune_builds() {
  keep_now=$(readlink "$builds/current" 2>/dev/null || true)
  keep_was=$(readlink "$builds/previous" 2>/dev/null || true)
  for old in "$builds"/*; do
    [ -d "$old" ] && [ ! -L "$old" ] || continue
    [ "$old" = "$keep_now" ] || [ "$old" = "$keep_was" ] || rm -rf "$old"
  done
}

# write_unit <file> <description> <command>: writes a user unit when its text changed. Sets changed=1 when it did.
write_unit() {
  new=$(mktemp)
  cat >"$new" <<UNIT
[Unit]
Description=$2

[Service]
Environment="PATH=$PATH"
ExecStart=$3
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
UNIT
  if cmp -s "$new" "$1" 2>/dev/null; then
    rm -f "$new"
  else
    mkdir -p "$(dirname "$1")"
    mv "$new" "$1"
    chmod 644 "$1"
    systemctl --user daemon-reload
    changed=1
  fi
}

# The board's port: the one its data folder records, else 7421.
board_port() {
  board=$(sed -n 's/.*"port": *\([0-9][0-9]*\).*/\1/p' "${LINECLEAR_HOME:-${LINECLEAR_HOME:-$HOME/.lineclear}}/server.json" 2>/dev/null || true)
  echo "${board:-7421}"
}

# Task links open the web pages and the board from your phone, so the server's one port must be published on the tailnet.
publish_ports() {
  command -v tailscale >/dev/null 2>&1 || return 0
  port=$(board_port)
  tailscale serve --bg --https="$port" "http://127.0.0.1:$port" >/dev/null 2>&1 \
    || say "Tailscale: port $port was not published. Run 'tailscale serve --bg --https=$port http://127.0.0.1:$port'."
}

# Node, npm and pnpm write their compile cache to /tmp, which is RAM on many machines. This puts it on disk for every user service and session.
install_compile_cache() {
  file=${XDG_CONFIG_HOME:-$HOME/.config}/environment.d/60-lineclear.conf
  line="NODE_COMPILE_CACHE=${XDG_CACHE_HOME:-$HOME/.cache}/lineclear/node-compile-cache"
  if [ "$(cat "$file" 2>/dev/null)" != "$line" ]; then
    mkdir -p "$(dirname "$file")"
    printf '%s\n' "$line" >"$file"
    changed=1
  fi
  systemctl --user set-environment "$line" >/dev/null 2>&1 || true
}

install_service() {
  if ! systemctl --user show-environment >/dev/null 2>&1; then
    say "Service: this machine has no systemd user services, so nothing starts Lineclear for you."
    say "Start it with 'lineclear run' and keep that terminal open (in herdr or tmux, say)."
    return 0
  fi
  units=$(dirname "$unit")
  install_compile_cache
  write_unit "$unit" Lineclear "$(command -v bun) $code/bin/lineclear run --port $(board_port)"
  # One process serves the rules, the web pages and the board, so an older separate board unit goes.
  for old in "$units"/lineclear-serve-*.service; do
    [ -f "$old" ] || continue
    systemctl --user disable --now "$(basename "$old")" >/dev/null 2>&1 || true
    rm -f "$old"
    changed=1
  done
  publish_ports
  # herdr (the agents' terminals) gets a unit unless one runs
  if [ ! -f "$units/lineclear-herdr.service" ] && ! herdr status server 2>/dev/null | grep -q 'status: running'; then
    write_unit "$units/lineclear-herdr.service" "herdr server for Lineclear's agents" "$(command -v herdr) server"
    systemctl --user enable --now lineclear-herdr.service >/dev/null 2>&1 || say "Service: herdr did not start. See 'systemctl --user status lineclear-herdr.service'."
  fi
  systemctl --user enable --now lineclear.service >/dev/null 2>&1 || die "the service did not start. Run 'systemctl --user status lineclear.service'."
  if [ "$changed" -eq 1 ]; then restart_all; fi
  say "Service: lineclear.service is started; the check after an update waits for it"
}

projects_dir() { printf '%s/projects' "${LINECLEAR_CONFIG:-$HOME/.config/lineclear}"; }

# Each project's settings as they are before the update, in the folder $1: whether it is Running or Paused, and the rest.
save_projects() {
  for f in "$(projects_dir)"/*/settings.json; do
    [ -f "$f" ] || continue
    n=$(basename "$(dirname "$f")")
    mkdir -p "$1/$n" && cp "$f" "$1/$n/settings.json"
  done
  return 0
}

# Sets restarted, the time in seconds: the smoke check wants a tick of the rule loop after it.
restart_all() {
  restarted=$(date +%s)
  systemctl --user restart lineclear.service
}

# The settings as they were before the update, put back so a broken version cannot leave a project Running or Paused.
restore_projects() {
  [ -n "${projects_before:-}" ] && [ -d "$projects_before" ] || return 0
  for f in "$projects_before"/*/settings.json; do
    [ -f "$f" ] || continue
    n=$(basename "$(dirname "$f")")
    if [ -d "$(projects_dir)/$n" ]; then cp "$f" "$(projects_dir)/$n/settings.json"; fi
  done
  return 0
}

# Whether the Lineclear API answers now (so a machine that does not run it is not rolled back for lacking it).
api_up() {
  port=$(sed -n 's/.*"port": *\([0-9][0-9]*\).*/\1/p' "${LINECLEAR_HOME:-$HOME/.lineclear}/server.json" 2>/dev/null || true)
  curl -fsS -m 3 -o /dev/null "http://127.0.0.1:${port:-7421}/api/snapshot" >/dev/null 2>&1
}

data_dir() { printf '%s' "${LINECLEAR_HOME:-$HOME/.lineclear}"; }
copies_dir() { printf '%s' "${LINECLEAR_STORE_COPIES:-$app/store-copies}"; }

# store_tasks <data folder>: how many tasks it holds (the live rows of store.sqlite, or in an older folder the hot ones and the cold log's ids).
store_tasks() {
  bun -e 'const fs = require("fs"), d = process.argv[process.argv.length - 1]; let n = 0;
try { n += JSON.parse(fs.readFileSync(d + "/tasks.json", "utf8")).tasks.length; } catch {}
try { const ids = new Set(); for (const l of fs.readFileSync(d + "/tasks-cold.jsonl", "utf8").split("\n")) { try { const r = JSON.parse(l); if (typeof r.gone === "string") ids.delete(r.gone); else if (typeof r.id === "string") ids.add(r.id); } catch {} } n += ids.size; } catch {}
try { const { Database } = require("bun:sqlite"); const db = new Database(d + "/store.sqlite", { readonly: true }); n += db.query("select count(*) as n from tasks where retired = 0").get().n; db.close(); } catch {}
console.log(n);' "$1" 2>/dev/null || echo 0
}

# The task store copied aside before anything changes, so that no version can take the tasks with it. Plain shell and cp,
# so it works from any version of Lineclear. Sets store_copy and tasks_before. A copy that fails stops the update.
save_store() {
  store_copy=; tasks_before=0
  src=$(data_dir)
  [ -d "$src" ] || return 0
  tasks_before=$(store_tasks "$src")
  root=$(copies_dir)
  store_copy=$root/update-$(date -u +%Y-%m-%dT%H-%M-%S)
  rm -rf "$store_copy.part"
  mkdir -p "$store_copy.part" || die "could not make $store_copy.part for the copy of the store"
  for f in "$src"/*; do
    [ -f "$f" ] || continue
    case $f in *.tmp) continue ;; esac
    cp -p "$f" "$store_copy.part/" || die "could not copy $f aside; not updating"
  done
  printf '%s\n' "$src" > "$store_copy.part/source"
  last=$(ls -1d "$root"/update-* 2>/dev/null | grep -v '\.part$' | sort | tail -n 1)
  if [ -n "$last" ] && diff -rq "$last" "$store_copy.part" >/dev/null 2>&1; then
    rm -rf "$store_copy.part"; store_copy=$last # nothing changed since the last copy
    return 0
  fi
  rm -rf "$store_copy"
  mv "$store_copy.part" "$store_copy" || die "could not finish the copy of the store"
  for old in $(ls -1d "$root"/update-* 2>/dev/null | grep -v '\.part$' | sort -r | tail -n +11); do rm -rf "$old"; done
  say "Lineclear: the store ($tasks_before tasks) is copied to $store_copy"
}

# Whether the store holds fewer tasks than before the update.
store_lost() {
  [ "${tasks_before:-0}" -gt 0 ] || return 1
  now=$(store_tasks "$(data_dir)")
  [ "$now" -lt "$tasks_before" ]
}

# Puts the copy made before the update back over the data folder, with the board stopped.
restore_store() {
  [ -n "${store_copy:-}" ] && [ -d "$store_copy" ] || return 1
  systemctl --user stop lineclear.service 2>/dev/null || true
  for f in "$store_copy"/*; do
    [ "$(basename "$f")" = source ] || cp -p "$f" "$(data_dir)/" || return 1
  done
  rm -f "$(data_dir)/store-refused.txt"
}

# The single way back. It posts the Inbox item, points builds/current at builds/previous, puts the projects' settings and
# a store that lost tasks back, and restarts the service on the old build.
rollback() {
  armed=0
  was=$(readlink "$builds/previous" 2>/dev/null || true)
  say "Lineclear: the update failed ($1)."
  if [ -z "$was" ] || [ ! -d "$was" ]; then
    say "Lineclear: there is no earlier build to go back to. Run 'lineclear doctor'."
    exit 1
  fi
  short=$(basename "$was")
  say "Lineclear: putting $short back."
  point "$was" "$builds/current"
  rm -f "$builds/previous"
  rm -rf "$dest" # a failed build is made again next time
  problems=
  restore_projects && restart_all || problems="the service did not restart"
  if store_lost; then
    if restore_store && restart_all; then say "Lineclear: the update had lost tasks; the store is back ($tasks_before tasks)"; else problems="$problems; the store lost tasks and could not be put back from $store_copy"; fi
  fi
  if store_lost; then problems="$problems; the store holds fewer than the $tasks_before tasks from before"; fi
  problems=$(printf '%s' "$problems" | sed 's/^; //')
  if [ -n "$problems" ]; then
    say "Lineclear: after putting $short back: $problems. Run 'lineclear doctor'."
  else
    say "Lineclear: back on $short"
  fi
  exit 1
}

on_exit() {
  status=$?
  trap - EXIT
  rm -rf "${projects_before:-}"
  if [ "$armed" -eq 1 ] && [ "$status" -ne 0 ]; then rollback "the install stopped before it finished"; fi
  exit "$status"
}

# After the restart: the web pages, the Lineclear API and a chat message must work, the rule loop must tick, and each
# project must be Running or Paused as it was. The smoke check ends when they do.
smoke() {
  say "Lineclear: checking the new version"
  failed=$(bun "$code/scripts/smoke.ts" check "$projects_before" "$api_before" "$restarted" 2>&1) ||
    rollback "$(printf '%s' "$failed" | tr '\n' ';' | sed 's/;$//;s/;/; /g')"
  if store_lost; then
    rollback "the task store holds $(store_tasks "$(data_dir)") tasks, it held $tasks_before before the update"
  fi
  say "Lineclear: the new version works"
}

# Lingering starts the user service at boot with no login. Where it needs root, the one command is printed instead.
enable_linger() {
  have loginctl || return 0
  me=$(id -un)
  [ "$(loginctl show-user "$me" --property=Linger 2>/dev/null || true)" = "Linger=yes" ] && return 0
  if loginctl enable-linger "$me" >/dev/null 2>&1 || { [ "$(id -u)" -ne 0 ] && have sudo && sudo -n loginctl enable-linger "$me" >/dev/null 2>&1; }; then
    say "Boot: lingering is on, so Lineclear starts at boot with no login"
  else
    say "Boot: Lineclear starts at boot only with lingering on. Run this once: sudo loginctl enable-linger $me"
  fi
}


main() {
  repo=${LINECLEAR_REPO:-https://github.com/jouni-mikkola/lineclear.git}
  ref=${LINECLEAR_REF:-main}
  [ -n "${HOME:-}" ] || die "HOME is not set"
  app=${XDG_DATA_HOME:-$HOME/.local/share}/lineclear
  unit=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/lineclear.service
  ext=${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/extensions/lineclear.ts
  bindir=$HOME/.local/bin
  path_before=$PATH
  PATH="$bindir:$HOME/.bun/bin:$PATH"
  export PATH
  builds=$(builds_dir)
  code=$builds/current
  changed=0; armed=0; api_before=noapi; active=0; restarted=0
  projects_before=$(mktemp -d)
  # a stop (Ctrl-C, a dropped SSH session) runs the EXIT trap too
  trap 'exit 130' INT TERM HUP
  trap on_exit EXIT

  install_tools
  if systemctl --user is-active --quiet lineclear.service 2>/dev/null; then
    active=1
    save_projects "$projects_before"
    if api_up; then api_before=api; fi
  fi
  save_store
  install_build
  link "$code/bin/lineclear" "$bindir/lineclear"
  extension_file "$code" "$ext"
  drop_old_extensions "$(dirname "$ext")"
  say "Lineclear: command in $bindir, pi extension in $ext"
  "$bindir/lineclear" store copy >/dev/null 2>&1 || true # the hourly copy doctor looks for, at once
  install_service
  if [ "$armed" -eq 1 ]; then smoke; fi
  armed=0
  prune_builds
  enable_linger

  case ":$path_before:" in
    *":$bindir:"*) ;;
    *) say "Add $bindir to your PATH to run 'lineclear' (for example: echo 'export PATH=\"$bindir:\$PATH\"' >> ~/.profile)" ;;
  esac
  say "Done. Run 'lineclear doctor' to check it."
}

main "$@" </dev/null
