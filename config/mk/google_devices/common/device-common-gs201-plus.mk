include vendor/adevtool/config/mk/google_devices/common/device-common.mk

$(call inherit-product, $(SRC_TARGET_DIR)/product/virtual_ab_ota/android_t_baseline.mk)
PRODUCT_VIRTUAL_AB_COMPRESSION_METHOD := lz4

PRODUCT_BUILD_VENDOR_KERNEL_BOOT_IMAGE := true

$(call inherit-product, $(SRC_TARGET_DIR)/product/core_64_bit_only.mk)
