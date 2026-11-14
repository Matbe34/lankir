#!/bin/sh
# Prints the version builds stamp into the binary and artifact names: $VERSION
# when set (CI sets it from the tag), otherwise `git describe`. A leading "v" is dropped.
set -eu
v=${VERSION:-$(git describe --tags --always --dirty 2>/dev/null || echo dev)}
echo "${v#v}"
