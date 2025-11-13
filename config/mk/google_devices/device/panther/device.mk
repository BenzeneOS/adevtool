$(call inherit-product, vendor/adevtool/config/mk/google_devices/platform/gs201/product-common.mk)

TARGET_KERNEL_DIR ?= $(RELEASE_KERNEL_PANTHER_DIR)
TARGET_BOARD_KERNEL_HEADERS ?= $(RELEASE_KERNEL_PANTHER_DIR)/kernel-headers

include vendor/adevtool/config/mk/google_devices/platform/gs201/device.mk

