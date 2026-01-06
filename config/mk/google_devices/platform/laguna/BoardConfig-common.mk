include build/make/target/board/BoardConfigMainlineCommon.mk
include build/make/target/board/BoardConfigPixelCommon.mk

include vendor/adevtool/config/mk/google_devices/common/BoardConfig-armv9.mk

include vendor/adevtool/config/mk/google_devices/common/BoardConfig-common-gs201-plus.mk

# system.img
BOARD_SYSTEMIMAGE_FILE_SYSTEM_TYPE := ext4
# persist.img
BOARD_PERSISTIMAGE_FILE_SYSTEM_TYPE := f2fs

SYSTEM_EXT_PUBLIC_SEPOLICY_DIRS += vendor/adevtool/config/mk/google_devices/platform/laguna/sepolicy/system_ext/public
SYSTEM_EXT_PRIVATE_SEPOLICY_DIRS += vendor/adevtool/config/mk/google_devices/platform/laguna/sepolicy/system_ext/private
