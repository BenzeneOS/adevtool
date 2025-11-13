include build/make/target/board/BoardConfigMainlineCommon.mk
include build/make/target/board/BoardConfigPixelCommon.mk

include vendor/adevtool/config/mk/google_devices/common/BoardConfig-armv9.mk

include vendor/adevtool/config/mk/google_devices/common/BoardConfig-common-gs201-plus.mk

# system.img
BOARD_SYSTEMIMAGE_FILE_SYSTEM_TYPE := ext4
# persist.img
BOARD_PERSISTIMAGE_FILE_SYSTEM_TYPE := f2fs

# Testing related defines
BOARD_PERFSETUP_SCRIPT := platform_testing/scripts/perf-setup/p24-setup.sh
