#!/bin/bash
set -e
set -u
self_dir=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

clear
time node ./main.js ./default.jsonc ./d2s_task.jsonc >log 2>&1
# vim log
