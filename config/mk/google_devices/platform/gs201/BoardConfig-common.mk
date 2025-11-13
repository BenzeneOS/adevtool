include build/make/target/board/BoardConfigMainlineCommon.mk
include build/make/target/board/BoardConfigPixelCommon.mk

TARGET_ARCH := arm64
TARGET_ARCH_VARIANT := armv8-2a-dotprod
TARGET_CPU_ABI := arm64-v8a
TARGET_CPU_VARIANT := cortex-a76

# Force any prefer32 targets to be compiled as 64 bit.
IGNORE_PREFER32_ON_DEVICE := true

include vendor/adevtool/config/mk/google_devices/common/BoardConfig-common-gs201-plus.mk

# persist.img
BOARD_PERSISTIMAGE_FILE_SYSTEM_TYPE := ext4

# Testing related defines
BOARD_PERFSETUP_SCRIPT := platform_testing/scripts/perf-setup/p10c10-setup.sh

