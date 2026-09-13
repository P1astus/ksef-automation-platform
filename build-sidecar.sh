#!/bin/bash
cd "/c/Users/antek/Documents/AI clude work/xades-sidecar"
docker build --no-cache -t aicludework-xades-sidecar . > /tmp/sidecar_build.log 2>&1
BUILD_EXIT=$?
echo "BUILD_EXIT_CODE=$BUILD_EXIT"
echo "Last 10 lines of build log:"
tail -10 /tmp/sidecar_build.log
