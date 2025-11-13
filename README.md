# adevtool

Android device support and bringup tool, designed for maximum automation and speed.

## Features

This tool automates the following tasks for devices that mostly run AOSP out-of-the-box (e.g. Google Pixel):

- Downloading factory images and full OTA packages
- Resolving overridden build rules and building modules from source (when possible)
- Extracting bootloader and radio firmware
- Finding and adding missing system properties
- Adding missing SELinux policies
- Adding missing HALs to vendor interface manifests
- Adding missing sysconfig entries

This typically results in better device support with fewer bugs and issues, and makes it possible to quickly add support for new devices.

## Usage

- [See docs/usage.md](docs/usage.md)
