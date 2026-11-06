#!/bin/sh
# Installs Lineclear, and updates it when run again:
#   curl -fsSL https://raw.githubusercontent.com/jouni-mikkola/lineclear/main/install.sh | sh
# LINECLEAR_REF picks a branch, tag or full commit id (default: this machine's stable build once it has one, else
# main). LINECLEAR_REPO picks another repository. A release tag (v1.2.3, made by `bun run release`) is built in
# ~/.lineclear/builds/1.2.3 and run from builds/current, with the build before it as builds/previous.
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

# The commit a ref names on the remote, or nothing when the ref is not a branch or tag there.
remote_commit() {
  git -C "$app" ls-remote origin "refs/heads/$ref" "refs/tags/$ref" "refs/tags/$ref^{}" |
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
# work when next is at $head and its lockfiles match, so the same commit is not built twice. Returns 1 (nothing copied) otherwise.
reuse_next() {
  next=${XDG_CACHE_HOME:-$HOME/.cache}/lineclear/next
  [ "$next" != "$app" ] && [ -d "$next/ui/web/dist" ] && [ -d "$next/node_modules" ] && [ -d "$next/server/node_modules" ] || return 1
  [ "$(git -C "$next" rev-parse HEAD 2>/dev/null || true)" = "$head" ] && [ "$(cat "$next/.lineclear-built" 2>/dev/null || true)" = "$head" ] || return 1
  cmp -s "$next/bun.lock" "$app/bun.lock" && cmp -s "$next/server/bun.lock" "$app/server/bun.lock" || return 1
  say "Lineclear: reusing the build of $(printf %.7s "$head")"
  rm -rf "$app/node_modules" "$app/server/node_modules" "$app/ui/web/dist"
  cp -a "$next/node_modules" "$app/node_modules" && cp -a "$next/server/node_modules" "$app/server/node_modules" \
    && cp -a "$next/ui/web/dist" "$app/ui/web/dist" || { rm -rf "$app/node_modules" "$app/server/node_modules" "$app/ui/web/dist"; return 1; }
}

# Installs the dependencies and builds the web pages for the commit in $app, unless that was done for it already.
# The stamp says which commit they were made for, so a failed install is tried again.
build_deps() {
  stamp=$app/node_modules/.lineclear-installed
  head=$(git -C "$app" rev-parse HEAD)
  [ "$(cat "$stamp" 2>/dev/null || true)" != "$head" ] || return 0
  if reuse_next; then printf '%s\n' "$head" >"$stamp"; changed=1; return 0; fi
  (cd "$app" && bun install --frozen-lockfile --silent) || return 1
  # the fork's push code, which sends the Inbox alerts, needs its own packages
  (cd "$app/server" && bun install --frozen-lockfile --silent) || return 1
  say "Lineclear: building the web pages"
  (cd "$app" && quiet bun run web:build) || return 1
  printf '%s\n' "$head" >"$stamp"
  changed=1
}

# A release (a version tag made by `bun run release`) is built once in its own folder, builds/<version>, with no .git. Its
# .release file is written last, so a folder without one is an unfinished build and is made again.
is_release() { printf '%s' "$ref" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; }
builds_dir() { printf '%s/builds' "$(data_dir)"; }

# install_release: builds the tag in $ref. It points builds/current at it only on a machine with no build yet; a newer
# build waits there as a candidate until `lineclear release promote`. Sets changed=1 when current moved. The service, the track and the command all run from builds/current.
install_release() {
  changed=0
  builds=$(builds_dir)
  dest=$builds/${ref#v}
  mkdir -p "$builds"
  if grep -qx "${ref#v}" "$builds/rejected" 2>/dev/null; then
    die "release ${ref#v} was rolled back (lineclear release rollback). It is offered again when a newer version is installed."
  fi
  if [ ! -f "$dest/.release" ]; then
    say "Lineclear: installing release ${ref#v}"
    rm -rf "$dest"
    git clone -q --branch "$ref" "$repo" "$dest" >/dev/null 2>&1 || { rm -rf "$dest"; die "could not get the release $ref from $repo"; }
    root=$app; app=$dest
    build_deps || { rm -rf "$dest"; die "building the release failed"; }
    app=$root
    rm -rf "$dest/.git"
    printf '%s\n' "${ref#v}" >"$dest/.release"
  else
    say "Lineclear: release ${ref#v} is built already"
  fi
  was=$(readlink "$builds/current" 2>/dev/null || true)
  if [ -z "$was" ]; then
    # the first build on this machine has nothing to be proven against
    ln -sfn "$dest" "$builds/current"
    changed=1
  elif [ "$was" != "$dest" ]; then
    say "Lineclear: release ${ref#v} is a candidate. It becomes stable only by: lineclear release promote ${ref#v}"
  fi
  code=$builds/current
  link "$code/bin/lineclear" "$bindir/lineclear"
  extension_file "$code" "$ext"
  say "Lineclear: command in $bindir, pi extension in $ext"
}

# lift_hold: a version newer than a rolled-back one has passed, so that hold ends.
lift_hold() {
  [ -f "$builds/rejected" ] || return 0
  while read -r bad; do
    [ "$(printf '%s\n%s\n' "$bad" "${ref#v}" | sort -V | tail -n 1)" = "$bad" ] && printf '%s\n' "$bad"
  done <"$builds/rejected" >"$builds/rejected.tmp" || true
  mv -f "$builds/rejected.tmp" "$builds/rejected"
}

# The update failed: builds/current goes back to the build before it.
rollback_release() {
  was=$(readlink "$builds/previous" 2>/dev/null || true)
  say "Lineclear: the update failed ($1)."
  if [ -n "$was" ] && [ -d "$was" ]; then
    ln -sfn "$was" "$builds/current"
    restore_projects
    restart_all || true
    say "Lineclear: back on $(basename "$was")"
  fi
  exit 1
}

# Puts the wanted version in $app. Sets changed=1 when the code is new.
install_lineclear() {
  changed=0
  if [ ! -d "$app/.git" ]; then
    [ -e "$app" ] && [ -n "$(ls -A "$app" | grep -v '^store-copies$')" ] && die "$app exists and is not a Lineclear checkout. Move it away, then run this again."
    say "Lineclear: installing $ref"
    mkdir -p "$app"
    git -C "$app" init -q
    git -C "$app" remote add origin "$repo"
    changed=1
  else
    # set-url rewrites .git/config even when the URL is the same: a second install changes no file
    [ "$(git -C "$app" remote get-url origin 2>/dev/null)" = "$repo" ] || git -C "$app" remote set-url origin "$repo"
    want=$(remote_commit)
    [ -n "$want" ] || want=$ref
    if [ "$(git -C "$app" rev-parse HEAD 2>/dev/null || true)" = "$want" ]; then
      say "Lineclear: already at $ref"
    else
      say "Lineclear: updating to $ref"
      changed=1
    fi
  fi
  if [ "$changed" -eq 1 ]; then
    git -C "$app" fetch -q --depth 1 origin "$ref"
    git -C "$app" checkout -q -f --detach FETCH_HEAD
  fi
  build_deps || die "building the dependencies failed"
  link "$app/bin/lineclear" "$bindir/lineclear"
  extension_file "$app" "$ext"
  say "Lineclear: command in $bindir, pi extension in $ext"
  say "Token pack: $("$bindir/lineclear" pack 2>/dev/null | tr '\n' ';' | sed 's/;$//;s/;/, /g' || true)"
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

# Task links open the web pages (and the board) from your phone, so both ports must be published on the tailnet.
publish_ports() {
  command -v tailscale >/dev/null 2>&1 || return 0
  for port in "${LINECLEAR_WEB_PORT:-${LINECLEAR_PORT:-7420}}" "$(board_port)"; do
    tailscale serve --bg --https="$port" "http://127.0.0.1:$port" >/dev/null 2>&1 \
      || say "Tailscale: port $port was not published. Run 'tailscale serve --bg --https=$port http://127.0.0.1:$port'."
  done
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
    say "Start it with 'lineclear run --board 7421' and keep that terminal open (in herdr or tmux, say)."
    return 0
  fi
  units=$(dirname "$unit")
  install_compile_cache
  write_unit "$unit" Lineclear "$(command -v bun) $code/bin/lineclear run"
  # The board (tasks, chats, merges) and herdr (the agents' terminals) get a unit too, unless they already have one.
  # asks the port the data folder records: a board on another port, or a test's own, is still a board
  if ! ls "$units"/lineclear-serve-*.service >/dev/null 2>&1 && curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$(board_port)/" 2>/dev/null; then
    say "Service: a board already answers on port $(board_port), so it gets no unit of its own."
  elif ! ls "$units"/lineclear-serve-*.service >/dev/null 2>&1; then
    write_unit "$units/lineclear-serve-7421.service" "Lineclear board" "$(command -v bun) $code/bin/lineclear serve --port 7421"
    systemctl --user enable --now lineclear-serve-7421.service >/dev/null 2>&1 || say "Service: the board did not start. See 'systemctl --user status lineclear-serve-7421.service'."
  fi
  publish_ports
  if [ ! -f "$units/lineclear-herdr.service" ] && ! herdr status server 2>/dev/null | grep -q 'status: running'; then
    write_unit "$units/lineclear-herdr.service" "herdr server for Lineclear's agents" "$(command -v herdr) server"
    systemctl --user enable --now lineclear-herdr.service >/dev/null 2>&1 || say "Service: herdr did not start. See 'systemctl --user status lineclear-herdr.service'."
  fi
  systemctl --user enable --now lineclear.service >/dev/null 2>&1 || die "the service did not start. Run 'systemctl --user status lineclear.service'."
  if [ "$changed" -eq 1 ]; then restart_all; fi
  sleep 1
  if systemctl --user is-active --quiet lineclear.service; then
    say "Service: lineclear.service is running"
  else
    say "Service: lineclear.service is not staying up. See 'systemctl --user status lineclear.service'."
  fi
}

# The test track (lineclear track) runs every night from a timer, and once after each update from its own unit.
install_track() {
  dir=$(dirname "$unit")
  mkdir -p "$dir"
  changed_track=0
  for name in lineclear-track lineclear-track-update; do
    flag=; [ "$name" = lineclear-track-update ] && flag=" --after-update"
    new=$(mktemp)
    cat >"$new" <<UNIT
[Unit]
Description=Lineclear test track${flag:+ after an update}

[Service]
Type=oneshot
Environment="PATH=$PATH"
ExecStart=$(command -v bun) $code/bin/lineclear track$flag
UNIT
    if cmp -s "$new" "$dir/$name.service" 2>/dev/null; then rm -f "$new"; else mv "$new" "$dir/$name.service" && chmod 644 "$dir/$name.service" && changed_track=1; fi
  done
  new=$(mktemp)
  cat >"$new" <<UNIT
[Unit]
Description=Lineclear test track, every night

[Timer]
OnCalendar=*-*-* 03:30
RandomizedDelaySec=20m
Persistent=true

[Install]
WantedBy=timers.target
UNIT
  if cmp -s "$new" "$dir/lineclear-track.timer" 2>/dev/null; then rm -f "$new"; else mv "$new" "$dir/lineclear-track.timer" && chmod 644 "$dir/lineclear-track.timer" && changed_track=1; fi
  [ "$changed_track" -eq 0 ] || systemctl --user daemon-reload 2>/dev/null || true
  systemctl --user enable --now lineclear-track.timer >/dev/null 2>&1 && say "Track: the test track runs every night" ||
    say "Track: the nightly timer did not start. See 'systemctl --user status lineclear-track.timer'."
}

# After an update that passed its smoke check, the test track runs the whole chain on it; a broken run rolls back.
track_after_update() {
  [ -z "${LINECLEAR_NO_TRACK:-}" ] || return 0
  if systemctl --user start --no-block lineclear-track-update.service >/dev/null 2>&1; then
    say "Track: the test track runs on the new version; a broken run puts $(printf '%.7s' "$prev") back"
  else
    say "Track: could not start the test track. Run 'lineclear track --after-update'."
  fi
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

# The board's Lineclear server runs as its own unit (lineclear-serve-<port>), so a new version needs it restarted too.
restart_all() {
  systemctl --user restart lineclear.service || return 1
  for u in $(systemctl --user list-units --state=active --plain --no-legend 'lineclear-serve-*.service' 2>/dev/null | awk '{print $1}'); do
    systemctl --user restart "$u" || true
  done
  return 0
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

# store_tasks <data folder>: how many tasks it holds (the hot ones and the cold log's ids).
store_tasks() {
  bun -e 'const fs = require("fs"), d = process.argv[process.argv.length - 1]; let n = 0;
try { n += JSON.parse(fs.readFileSync(d + "/tasks.json", "utf8")).tasks.length; } catch {}
try { const ids = new Set(); for (const l of fs.readFileSync(d + "/tasks-cold.jsonl", "utf8").split("\n")) { try { const r = JSON.parse(l); if (typeof r.gone === "string") ids.delete(r.gone); else if (typeof r.id === "string") ids.add(r.id); } catch {} } n += ids.size; } catch {}
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
  for u in $(systemctl --user list-units --state=active --plain --no-legend 'lineclear-serve-*.service' 2>/dev/null | awk '{print $1}'); do
    systemctl --user stop "$u" 2>/dev/null || true
  done
  for f in "$store_copy"/*; do
    [ "$(basename "$f")" = source ] || cp -p "$f" "$(data_dir)/" || return 1
  done
  rm -f "$(data_dir)/store-refused.txt"
}

# The version and the task count after a rollback, said and checked: a rollback that leaves either wrong is told, not hidden.
verify_back() {
  problems=
  [ "$(git -C "$app" rev-parse HEAD 2>/dev/null || true)" = "$prev" ] || problems="the version is not $short"
  if store_lost; then
    if restore_store && restart_all; then say "Lineclear: the update had lost tasks; the store is back ($tasks_before tasks)"; else problems="$problems; the store lost tasks and could not be put back from $store_copy"; fi
    store_lost && problems="$problems; the store holds fewer than the $tasks_before tasks from before"
  fi
  problems=$(printf '%s' "$problems" | sed 's/^; //')
  if [ -n "$problems" ]; then
    say "Lineclear: after the rollback: $problems. Run 'lineclear doctor'."
    bun "$app/scripts/smoke.ts" post "After putting $short back: $problems." >/dev/null 2>&1 || true
  fi
}

# rollback <what failed>: posts the Inbox item, puts the previous version back and restarts the service on it.
rollback() {
  armed=0
  short=$(printf '%.7s' "$prev")
  say "Lineclear: the update failed ($1). Putting $short back."
  bun "$app/scripts/smoke.ts" post "The update to $(git -C "$app" rev-parse --short HEAD 2>/dev/null || echo new) failed: $1. Putting $short back." >/dev/null 2>&1 ||
    say "Lineclear: could not post the Inbox item"
  # the new version may have half built the packages, and may have changed the projects: both are made right again
  rm -f "$app/node_modules/.lineclear-installed"
  if git -C "$app" checkout -q -f --detach "$prev" && build_deps && restore_projects && restart_all; then
    say "Lineclear: back on $short"
    verify_back
  else
    say "Lineclear: could not put $short back. Run 'lineclear doctor'."
    bun "$app/scripts/smoke.ts" post "Putting $short back failed. Lineclear may not be running: run lineclear doctor." >/dev/null 2>&1 || true
  fi
}

on_exit() {
  code=$?
  trap - EXIT
  rm -rf "${projects_before:-}"
  if [ "$armed" -eq 1 ] && [ "$code" -ne 0 ] && [ "$(git -C "$app" rev-parse HEAD 2>/dev/null || true)" != "$prev" ]; then
    rollback "the install stopped before it finished"
  fi
  exit "$code"
}

fail_update() { if is_release; then rollback_release "$1"; else rollback "$1"; fi; }

# After the restart: the web pages, the Lineclear API and a chat message must work within 2 minutes, and each project
# must be Running or Paused as it was.
smoke() {
  say "Lineclear: checking the new version (up to 2 minutes)"
  failed=$(bun "$code/scripts/smoke.ts" check "$projects_before" "$api_before" 2>&1) && {
    if store_lost; then
      fail_update "the task store holds $(store_tasks "$(data_dir)") tasks, it held $tasks_before before the update"
      exit 1
    fi
    say "Lineclear: the new version works"; return 0; }
  fail_update "$(printf '%s' "$failed" | tr '\n' ';' | sed 's/;$//;s/;/; /g')"
  exit 1
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

# Every machine added in Settings gets this install too. A machine's own install does not go on to others.
update_machines() {
  [ -z "${LINECLEAR_NO_FANOUT:-}" ] || return 0
  [ -x "$bindir/lineclear" ] || return 0
  [ -s "${LINECLEAR_CONFIG:-$HOME/.config/lineclear}/machines.json" ] || return 0
  say "Machines: updating each machine added in Settings"
  LINECLEAR_REF="$ref" LINECLEAR_REPO="$repo" "$bindir/lineclear" machine update || say "Some machines did not update. Run 'lineclear doctor' to see which."
}

# A machine another one installs (lineclear machine) takes that one's stable build and promotes none of its own.
mark_follows() {
  [ -n "${LINECLEAR_FOLLOWS:-}" ] || return 0
  mkdir -p "${LINECLEAR_CONFIG:-$HOME/.config/lineclear}"
  printf '%s\n' "$LINECLEAR_FOLLOWS" >"${LINECLEAR_CONFIG:-$HOME/.config/lineclear}/release-follows"
}

# The stable build the last promotion installed (lineclear release), so a run by hand never takes main untested.
stable_commit() {
  sed -n '/"stable"/,/}/s/.*"commit": *"\([0-9a-f]\{40\}\)".*/\1/p' "${LINECLEAR_CONFIG:-$HOME/.config/lineclear}/release.json" 2>/dev/null | head -n 1
  # a machine that follows another runs the stable build that one gave it last
  [ ! -s "${LINECLEAR_CONFIG:-$HOME/.config/lineclear}/release-follows" ] || [ -s "${LINECLEAR_CONFIG:-$HOME/.config/lineclear}/release.json" ] ||
    git -C "${XDG_DATA_HOME:-$HOME/.local/share}/lineclear" rev-parse HEAD 2>/dev/null || true
}

# The install of a release: see install_release. A failed smoke check puts builds/previous back as current.
main_release() {
  install_tools
  mark_follows
  armed=0; api_before=noapi
  projects_before=$(mktemp -d)
  active=0
  if systemctl --user is-active --quiet lineclear.service 2>/dev/null; then
    active=1
    save_projects "$projects_before"
    if api_up; then api_before=api; fi
  fi
  save_store
  install_release
  "$bindir/lineclear" store copy >/dev/null 2>&1 || true
  install_service
  install_track
  if [ "$active" -eq 1 ] && [ "$changed" -eq 1 ]; then smoke; fi
  lift_hold
  rm -rf "$projects_before"
  enable_linger
  update_machines
  say "Done. Run 'lineclear doctor' to check it."
}

main() {
  repo=${LINECLEAR_REPO:-https://github.com/jouni-mikkola/lineclear.git}
  ref=${LINECLEAR_REF:-$(stable_commit)}
  ref=${ref:-main}
  [ -n "${HOME:-}" ] || die "HOME is not set"
  app=${XDG_DATA_HOME:-$HOME/.local/share}/lineclear
  unit=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/lineclear.service
  ext=${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/extensions/lineclear.ts
  bindir=$HOME/.local/bin
  path_before=$PATH
  PATH="$bindir:$HOME/.bun/bin:$PATH"
  export PATH
  code=$app
  if is_release; then main_release; return; fi

  # lineclear track --after-update: the new version broke the test track, so the version before it comes back
  if [ -n "${LINECLEAR_ROLLBACK:-}" ]; then
    prev=$(git -C "$app" rev-parse -q --verify refs/lineclear/previous 2>/dev/null) || die "there is no version from before the update to put back"
    projects_before=
    [ -d "$app/.git" ] && save_store
    rollback "$LINECLEAR_ROLLBACK"
    [ "$(git -C "$app" rev-parse HEAD)" = "$prev" ]
    exit
  fi
  install_tools
  mark_follows
  # The version running now is kept: a failed update puts it back (rollback).
  prev=; armed=0; api_before=noapi
  projects_before=$(mktemp -d)
  if [ -d "$app/.git" ] && systemctl --user is-active --quiet lineclear.service 2>/dev/null; then
    prev=$(git -C "$app" rev-parse HEAD 2>/dev/null || true)
    if [ -n "$prev" ]; then
      save_projects "$projects_before"
      if api_up; then api_before=api; else api_before=noapi; fi
      armed=1
      # a stop (Ctrl-C, a dropped SSH session) runs the EXIT trap too
      trap 'exit 130' INT TERM HUP
      trap on_exit EXIT
    fi
  fi
  [ -d "$app/.git" ] && save_store
  install_lineclear
  "$bindir/lineclear" store copy >/dev/null 2>&1 || true # the hourly copy doctor looks for, at once
  [ -z "$prev" ] || [ "$(git -C "$app" rev-parse HEAD)" = "$prev" ] || git -C "$app" update-ref refs/lineclear/previous "$prev"
  install_service
  install_track
  if [ "$armed" -eq 1 ] && [ "$(git -C "$app" rev-parse HEAD)" != "$prev" ]; then smoke; track_after_update; fi
  armed=0
  rm -rf "$projects_before"
  enable_linger
  update_machines

  case ":$path_before:" in
    *":$bindir:"*) ;;
    *) say "Add $bindir to your PATH to run 'lineclear' (for example: echo 'export PATH=\"$bindir:\$PATH\"' >> ~/.profile)" ;;
  esac
  say "Done. Run 'lineclear doctor' to check it."
}

main "$@" </dev/null
