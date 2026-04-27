#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# migrate-to-lexy.sh
#
# Birth Lexy: copy the lexy/ sub-project out of the repuguard monorepo into
# a clean directory, push it to https://github.com/repuguardapp/Lexy as the
# initial commit on `main`.
#
# The Lexy GitHub repo is assumed to already exist (created by the human owner
# at github.com/repuguardapp/Lexy). The script is idempotent: it skips repo
# creation and is safe to re-run after a partial failure.
#
# Usage (from the repuguard repo root):
#   bash lexy/scripts/migrate-to-lexy.sh
#
# Configurable via env vars:
#   GH_OWNER     default: repuguardapp
#   REPO_NAME    default: Lexy
#   TARGET_DIR   default: $HOME/Lexy
#   SOURCE_DIR   default: $(pwd)/lexy
#   BRANCH       default: main
#   COMMIT_MSG   default: feat: birth of Lexy - global regtech platform
# ----------------------------------------------------------------------------
set -euo pipefail

GH_OWNER="${GH_OWNER:-repuguardapp}"
REPO_NAME="${REPO_NAME:-Lexy}"
TARGET_DIR="${TARGET_DIR:-$HOME/$REPO_NAME}"
SOURCE_DIR="${SOURCE_DIR:-$(pwd)/lexy}"
BRANCH="${BRANCH:-main}"
COMMIT_MSG="${COMMIT_MSG:-feat: birth of Lexy - global regtech platform}"

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fail()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# --- Preflight --------------------------------------------------------------
bold "▶ Preflight"
command -v git >/dev/null || fail "git is not installed."
command -v tar >/dev/null || fail "tar is not installed."
[[ -d "$SOURCE_DIR" ]] || fail "source $SOURCE_DIR not found — run from the repuguard repo root."
ok "source: $SOURCE_DIR"
ok "target: $TARGET_DIR"
ok "remote: github.com/$GH_OWNER/$REPO_NAME (branch: $BRANCH)"

# Detect auth method: gh CLI > GH_TOKEN env > interactive credential helper.
REMOTE_URL="https://github.com/$GH_OWNER/$REPO_NAME.git"
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  ok "auth: gh CLI"
elif [[ -n "${GH_TOKEN:-}" ]]; then
  REMOTE_URL="https://x-access-token:${GH_TOKEN}@github.com/$GH_OWNER/$REPO_NAME.git"
  ok "auth: GH_TOKEN env var"
else
  ok "auth: git credential helper (you may be prompted)"
fi

# --- Prepare target directory ----------------------------------------------
bold "▶ Preparing $TARGET_DIR"
if [[ -e "$TARGET_DIR" ]] && [[ -n "$(ls -A "$TARGET_DIR" 2>/dev/null || true)" ]]; then
  fail "target $TARGET_DIR exists and is not empty — refusing to clobber."
fi
mkdir -p "$TARGET_DIR"
( cd "$SOURCE_DIR" \
  && tar -cf - \
       --exclude='.git' \
       --exclude='node_modules' \
       --exclude='.next' \
       --exclude='.vercel' \
       --exclude='coverage' \
       . \
) | ( cd "$TARGET_DIR" && tar -xf - )

# Drop the migration script itself — does not belong in the new repo.
rm -f "$TARGET_DIR/scripts/migrate-to-lexy.sh"
rmdir  "$TARGET_DIR/scripts" 2>/dev/null || true
ok "files copied (excluded: .git, node_modules, .next, scripts/migrate-*.sh)"

# --- Git init ---------------------------------------------------------------
bold "▶ Initializing git repository"
cd "$TARGET_DIR"
git init -q -b "$BRANCH"
git remote add origin "$REMOTE_URL" 2>/dev/null \
  || git remote set-url origin "$REMOTE_URL"
ok "git initialized on $BRANCH; origin → $GH_OWNER/$REPO_NAME"

# --- Commit -----------------------------------------------------------------
bold "▶ Committing"
git add -A
git commit -q -m "$COMMIT_MSG"
ok "commit: $COMMIT_MSG"

# --- Push -------------------------------------------------------------------
bold "▶ Pushing to GitHub"
# A brand-new GitHub repo has no commits, so a regular push works.
# If main already exists with content, the user is told explicitly so they
# can decide between rebasing or force-pushing. We never force-push here.
if ! git push -u origin "$BRANCH"; then
  echo
  fail "push rejected — the remote $BRANCH likely has commits already.
        Inspect with: git -C $TARGET_DIR fetch origin
        and decide between merging or starting fresh.
        This script will NOT force-push for you."
fi
ok "pushed to $BRANCH"

# --- Done -------------------------------------------------------------------
echo
bold "✓ Lexy is born"
printf '  Repository: \033[1mhttps://github.com/%s/%s\033[0m\n' "$GH_OWNER" "$REPO_NAME"
printf '  Local path: %s\n' "$TARGET_DIR"
echo
echo "Next steps:"
echo "  cd $TARGET_DIR"
echo "  cp .env.example .env.local"
echo "  npm install"
echo "  npm run dev"
echo
echo "Once verified, you can clean up the old branch on repuguard:"
echo "  git push repuguard --delete claude/regtech-multilingual-platform-ntVc1"
