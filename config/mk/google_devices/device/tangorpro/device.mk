BOARD_WITHOUT_RADIO := true

$(call inherit-product, vendor/adevtool/config/mk/google_devices/platform/gs201/product-common.mk)

TARGET_KERNEL_DIR ?= $(RELEASE_KERNEL_TANGORPRO_DIR)
TARGET_BOARD_KERNEL_HEADERS ?= $(RELEASE_KERNEL_TANGORPRO_DIR)/kernel-headers

PRODUCT_PACKAGES += GosTangorproOverlay

PRODUCT_PACKAGES += init.tangorpro.grapheneos.rc

include vendor/adevtool/config/mk/google_devices/platform/gs201/device.mk

PRODUCT_CHARACTERISTICS := tablet,nosdcard
