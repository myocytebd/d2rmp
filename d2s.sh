#!/bin/bash
set -e
set -u
self_dir=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

clear
time node ./main.js ./user_base.jsonc ./user_d2s.jsonc >log 2>&1
