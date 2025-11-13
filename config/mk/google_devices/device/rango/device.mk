$(call inherit-product, vendor/adevtool/config/mk/google_devices/platform/laguna/product-common.mk)

TARGET_KERNEL_DIR = device/google/laguna-kernels/6.6/grapheneos

include vendor/adevtool/config/mk/google_devices/platform/laguna/device.mk
