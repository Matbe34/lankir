#!/usr/bin/env bash
# Cuts release v<version> locally: checks master is clean and pushed, checks the
# CHANGELOG names the version, sets frontend/package.json to it, fills in a
# "**Release Date:** TBD" in the first CHANGELOG section with today's date,
# commits "chore: release v<version>" and makes an annotated tag. It never pushes; it
# prints the push commands. Pushing the tag starts .github/workflows/release.yml.
set -euo pipefail

die() {
	echo "error: $*" >&2
	exit 1
}

[ $# -eq 1 ] || die "usage: scripts/release.sh <version>, e.g. 1.0.0 or 1.0.0-rc1"
version=${1#v}
semver='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
[[ $version =~ $semver ]] || die "'$1' is not a version like 1.0.0 or 1.0.0-rc1"
tag="v${version}"

cd "$(git rev-parse --show-toplevel)"

branch=$(git symbolic-ref --short -q HEAD || true)
[ "$branch" = master ] || die "releases are cut from master, not ${branch:-a detached HEAD}"
[ -z "$(git status --porcelain)" ] || die "the working tree has uncommitted or untracked changes"
git fetch --quiet origin master
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/master)" ] || die "master is not the same commit as origin/master"
if git rev-parse --quiet --verify "refs/tags/${tag}" >/dev/null; then
	die "tag ${tag} already exists"
fi

heading=$(grep -m1 '^#' CHANGELOG.md || true)
version_re=${version//./\\.}
grep -qE "(^|[^[:alnum:].])v${version_re}([^[:alnum:].-]|$)" <<<"$heading" ||
	die "the first CHANGELOG.md heading must name ${tag}, found: ${heading:-none}"

# The tree is clean here, so a failure below can reset to this commit and lose nothing.
start=$(git rev-parse HEAD)
undo() {
	git reset --quiet --hard "$start"
	die "$1; reset master to $(git rev-parse --short "$start"), where it was before"
}

(cd frontend && npm version "$version" --no-git-tag-version --allow-same-version >/dev/null)
# Only the first section, the one up to the second top-level heading.
today=$(date +%F)
awk -v today="$today" '
	/^# / { sections++ }
	sections == 1 && $0 == "**Release Date:** TBD" { $0 = "**Release Date:** " today }
	{ print }
' CHANGELOG.md >CHANGELOG.md.tmp
mv CHANGELOG.md.tmp CHANGELOG.md
git add frontend/package.json frontend/package-lock.json CHANGELOG.md
if ! git diff --cached --quiet; then
	git commit --quiet -m "chore: release ${tag}" || undo "the release commit failed"
fi
git tag -a "$tag" -m "Lankir ${tag}" || undo "creating tag ${tag} failed"

echo "Tagged ${tag} at $(git rev-parse --short HEAD). Nothing is pushed yet; to publish run:"
echo "  git push origin master"
echo "  git push origin ${tag}"
