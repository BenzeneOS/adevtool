$(call inherit-product, vendor/adevtool/config/mk/google_devices/platform/zumapro/product-common.mk)

TARGET_KERNEL_DIR ?= $(RELEASE_KERNEL_CAIMAN_DIR)
TARGET_BOARD_KERNEL_HEADERS ?= $(RELEASE_KERNEL_CAIMAN_DIR)/kernel-headers

include vendor/adevtool/config/mk/google_devices/platform/zumapro/device.mk
