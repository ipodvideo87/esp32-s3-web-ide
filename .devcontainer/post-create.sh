#!/usr/bin/env bash

set -e

echo "Installing ESP32 board package..."

arduino-cli core update-index

arduino-cli core install esp32:esp32

echo "Installing common libraries..."

arduino-cli lib install ArduinoJson
arduino-cli lib install AsyncTCP

echo "Done."
