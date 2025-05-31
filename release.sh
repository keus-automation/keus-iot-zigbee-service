#!/bin/bash

# release.sh - Script to automate version bump, tagging, and publishing to npm
# Usage: ./release.sh
# Requires: git, pnpm, gh (GitHub CLI)

set -euo pipefail

# Get current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "🌿 Current branch: $CURRENT_BRANCH"

# Check if we're on main
if [[ "$CURRENT_BRANCH" == "main" ]]; then
  IS_PRERELEASE=false
else
  IS_PRERELEASE=true
fi

# Ensure working directory is up to date
git pull origin "$CURRENT_BRANCH"

# Run Changeset versioning
echo "🛠️ Running Changeset version..."
pnpm changeset version

# Commit version bump
echo "📤 Committing version bump..."
git add .
git commit -m "chore: version bump [skip ci]" || echo "Nothing to commit."
git push origin "$CURRENT_BRANCH"

# Get version and tag
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"
echo "🔖 Version: $VERSION"

# Check if tag already exists remotely
if git ls-remote --tags origin | grep -q "refs/tags/$TAG$"; then
  echo "⚠️ Tag $TAG already exists on remote. Aborting release."
  exit 1
fi

# Create and push Git tag
echo "🏷️ Creating and pushing tag $TAG..."
git tag "$TAG"
git push origin "$TAG"

# Determine prerelease flag
if $IS_PRERELEASE; then
  PRERELEASE_FLAG="--prerelease"
  echo "⚠️ Marking as pre-release (branch: $CURRENT_BRANCH)"
else
  PRERELEASE_FLAG=""
  echo "✅ Marking as full release (main branch)"
fi

# Create GitHub Release
echo "🚀 Creating GitHub release..."
gh release create "$TAG" \
  --title "Release $TAG" \
  --generate-notes \
  $PRERELEASE_FLAG \
  --repo "keus-automation/keus-iot-zigbee-service"

# Publish to npm
echo "📦 Publishing to npm..."
pnpm publish --no-git-checks

echo "✅ Release $TAG complete!"
