$(call inherit-product, vendor/adevtool/config/mk/google_devices/platform/zuma/product-common.mk)

TARGET_KERNEL_DIR ?= $(RELEASE_KERNEL_SHIBA_DIR)
TARGET_BOARD_KERNEL_HEADERS ?= $(RELEASE_KERNEL_SHIBA_DIR)/kernel-headers

include vendor/adevtool/config/mk/google_devices/platform/zuma/device.mk
