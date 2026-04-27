#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# migrate-to-global-regtech-v6.sh
#
# One-shot migration: copy the regtech/ sub-project out of the repuguard
# monorepo into its own brand-new GitHub repository (`global-regtech-v6`),
# initialize git, create the remote on GitHub, commit, and push to `main`.
#
# Idempotent where it can be:
#   - aborts cleanly if the target dir already has content
#   - skips remote creation if the repo already exists on GitHub
#
# Usage (from the repuguard repo root):
#   bash regtech/scripts/migrate-to-global-regtech-v6.sh
#
# Configurable via env vars:
#   REPO_NAME    default: global-regtech-v6
#   TARGET_DIR   default: $HOME/<REPO_NAME>
#   SOURCE_DIR   default: $(pwd)/regtech
#   VISIBILITY   default: public        (or: private | internal)
#   GH_OWNER     default: $(gh api user --jq .login)
# ----------------------------------------------------------------------------
set -euo pipefail

REPO_NAME="${REPO_NAME:-global-regtech-v6}"
TARGET_DIR="${TARGET_DIR:-$HOME/$REPO_NAME}"
SOURCE_DIR="${SOURCE_DIR:-$(pwd)/regtech}"
VISIBILITY="${VISIBILITY:-public}"

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
info()  { printf '  %s\n' "$*"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fail()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# --- Preflight --------------------------------------------------------------
bold "▶ Preflight"
command -v gh   >/dev/null || fail "gh CLI is not installed (https://cli.github.com)."
command -v git  >/dev/null || fail "git is not installed."
command -v tar  >/dev/null || fail "tar is not installed."

gh auth status >/dev/null 2>&1 || fail "gh is not authenticated. Run: gh auth login"
ok "gh + git available, gh authenticated"

[[ -d "$SOURCE_DIR" ]] || fail "source $SOURCE_DIR not found — run from the repuguard repo root."
ok "source: $SOURCE_DIR"

GH_OWNER="${GH_OWNER:-$(gh api user --jq .login)}"
ok "owner: $GH_OWNER"

if [[ -e "$TARGET_DIR" ]] && [[ -n "$(ls -A "$TARGET_DIR" 2>/dev/null || true)" ]]; then
  fail "target $TARGET_DIR exists and is not empty — refusing to clobber."
fi
ok "target: $TARGET_DIR (clean)"

# --- Copy the code ----------------------------------------------------------
bold "▶ Copying $SOURCE_DIR → $TARGET_DIR"
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

# The migration script and its parent dir do not belong in the new repo.
rm -f  "$TARGET_DIR/scripts/migrate-to-global-regtech-v6.sh"
rmdir  "$TARGET_DIR/scripts" 2>/dev/null || true
ok "files copied (excluded: .git, node_modules, .next, scripts/migrate-*.sh)"

# --- Initialize git ---------------------------------------------------------
bold "▶ Initializing git repository"
cd "$TARGET_DIR"
git init -q -b main
git add -A
ok "git initialized on branch main"

# --- Create the remote ------------------------------------------------------
bold "▶ Ensuring GitHub repo $GH_OWNER/$REPO_NAME exists"
if gh repo view "$GH_OWNER/$REPO_NAME" >/dev/null 2>&1; then
  info "repo already exists — skipping creation"
else
  gh repo create "$GH_OWNER/$REPO_NAME" \
    --"$VISIBILITY" \
    --description "Global RegTech compliance audit platform — Multi-Pass i18n engine" \
    --disable-wiki \
    >/dev/null
  ok "repo created: https://github.com/$GH_OWNER/$REPO_NAME"
fi

# Wire up origin (idempotent).
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "https://github.com/$GH_OWNER/$REPO_NAME.git"
else
  git remote add origin "https://github.com/$GH_OWNER/$REPO_NAME.git"
fi
ok "origin → https://github.com/$GH_OWNER/$REPO_NAME.git"

# --- Commit & push ----------------------------------------------------------
bold "▶ Committing and pushing"
git commit -q -m "feat: initial commit with multi-pass i18n engine"
ok "commit created: feat: initial commit with multi-pass i18n engine"

git push -u origin main
ok "pushed to main"

# --- Done -------------------------------------------------------------------
echo
bold "✓ Migration complete"
printf '  Repository: \033[1mhttps://github.com/%s/%s\033[0m\n' "$GH_OWNER" "$REPO_NAME"
printf '  Local path: %s\n' "$TARGET_DIR"
echo
echo "Next steps:"
echo "  cd $TARGET_DIR"
echo "  cp .env.example .env.local"
echo "  npm install"
echo "  npm run dev"
